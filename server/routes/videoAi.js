import express from 'express';
import { pool, isDbReady } from '../db.js';
import { createAiClient } from '../services/scripts/aiClient.js';
import { SEES_IMAGES, WATCHES_VIDEO } from '../services/scripts/aiProviders.js';
import { parseVideoReport, preUploadPrompt, publishedReportPrompt } from '../services/scripts/aiPrompts.js';
import { VIDEO_PLATFORMS, baselineFor, collectPublishedMetrics, loadAccount, syncForReport } from '../services/videoAnalysis.js';

/**
 * AI video reports, made with the user's own AI provider (keys from script_ai_keys):
 * - published videos: Update syncs the account, gathers the real numbers and asks the AI for a report;
 * - before upload: frames from the video (and the video itself for Gemini) are analysed. Nothing is stored but the report.
 * Reading a report never calls the AI.
 */

/** Only this route takes big bodies (frames, or a short video for Gemini). Everything else keeps the 1 MB limit. */
export const PREUPLOAD_PATH = '/api/video-ai/preupload';
export const PREUPLOAD_BODY_LIMIT = '25mb';

const MAX_FRAMES = 12;
const MAX_FRAME_CHARS = 1_500_000; // ~1.1 MB of JPEG per frame, base64
// Gemini takes at most 20 MB per request inline; base64 adds a third, so the file itself must stay near 14 MB.
const MAX_VIDEO_MB = 14;
const MAX_VIDEO_CHARS = Math.ceil((MAX_VIDEO_MB + 0.5) * 1024 * 1024 * 4 / 3);
const IMAGE_MIME = /^image\/(jpeg|png|webp)$/;
const VIDEO_MIME = /^video\/(mp4|quicktime|webm|x-m4v|mpeg)$/;
const BASE64 = /^[A-Za-z0-9+/=\s]+$/;
const REPORT_TOKENS = 4096;

const asId = (v) => (/^\d{1,18}$/.test(String(v ?? '')) ? String(v) : null);
const mediaIdOf = (v) => (/^[\w:.-]{1,100}$/.test(String(v ?? '')) ? String(v) : null);
const text = (v, n) => String(v ?? '').trim().slice(0, n);

const REPORT_COLUMNS = 'id, kind, platform, account_id, media_id, title, thumbnail_url, provider, model, score, report, metrics_used, created_at';

export function createVideoAiRouter(authenticateToken, { env = process.env, fetchImpl = globalThis.fetch, aiLimiter } = {}) {
  const router = express.Router();
  const ai = createAiClient({ env, fetchImpl, ...(aiLimiter ? { limiter: aiLimiter } : {}) });

  router.use('/video-ai', authenticateToken, (req, res, next) => (isDbReady() ? next() : res.status(503).json({ error: 'Database is not connected.' })));

  const fail = (res, err, message) => {
    const shown = err?.status && (err.status < 500 || err.expose);
    if (!shown) console.error(message, err?.message ?? err);
    res.status(shown ? err.status : 500).json({ error: shown ? err.message : message });
  };
  const bad = (res, error) => res.status(400).json({ error });

  const saveReport = async (userId, fields) => {
    const { rows } = await pool.query(
      `INSERT INTO video_ai_reports (user_id, kind, platform, account_id, media_id, title, thumbnail_url, provider, model, score, report, metrics_used)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING ${REPORT_COLUMNS}`,
      [userId, fields.kind, fields.platform ?? null, fields.accountId ?? null, fields.mediaId ?? null, fields.title ?? null, fields.thumbnail ?? null,
        fields.provider, fields.model, fields.report.score, JSON.stringify(fields.report), JSON.stringify(fields.metrics ?? null)],
    );
    return rows[0];
  };

  /** What the browser needs to offer the feature: which provider would run, and whether it can see frames / watch video. */
  router.get('/video-ai/capabilities', async (req, res) => {
    try {
      const { view } = await ai.aiState(req.user.userId);
      const provider = ai.pickProvider(view, req.query.provider);
      res.json({
        provider,
        model: provider ? view.providers[provider].model : null,
        ready_providers: view.ready_providers,
        sees_images: view.ready_providers.filter((p) => SEES_IMAGES.includes(p) && !(p === 'openrouter' && view.providers[p].model.startsWith('meta-llama/'))),
        watches_video: view.ready_providers.filter((p) => WATCHES_VIDEO.includes(p)),
        max_video_mb: MAX_VIDEO_MB,
      });
    } catch (err) {
      fail(res, err, 'Failed to load AI settings.');
    }
  });

  /** The latest report for one published video, plus its earlier scores. No AI call. */
  router.get('/video-ai/reports', async (req, res) => {
    try {
      const { platform } = req.query;
      const accountId = asId(req.query.accountId);
      const mediaId = mediaIdOf(req.query.mediaId);
      if (!VIDEO_PLATFORMS.includes(platform) || !accountId || !mediaId) return bad(res, 'platform, accountId and mediaId are required.');
      const { rows } = await pool.query(
        `SELECT ${REPORT_COLUMNS} FROM video_ai_reports WHERE user_id = $1 AND platform = $2 AND account_id = $3 AND media_id = $4 AND kind = 'published'
          ORDER BY created_at DESC LIMIT 12`,
        [req.user.userId, platform, accountId, mediaId],
      );
      res.json({ report: rows[0] ?? null, history: rows.map((r) => ({ id: String(r.id), score: r.score, created_at: r.created_at, provider: r.provider })) });
    } catch (err) {
      fail(res, err, 'Failed to load the report.');
    }
  });

  /** The latest reports across all videos, for the Video AI dashboard. No AI call. */
  router.get('/video-ai/reports/recent', async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, kind, platform, account_id, media_id, title, thumbnail_url, provider, score, report->>'verdict' AS verdict, created_at
           FROM video_ai_reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 40`,
        [req.user.userId],
      );
      res.json({ reports: rows.map((r) => ({ ...r, id: String(r.id), account_id: r.account_id === null ? null : String(r.account_id) })) });
    } catch (err) {
      fail(res, err, 'Failed to load recent reports.');
    }
  });

  /** One saved report by id (e.g. a pre-upload check opened from the dashboard). */
  router.get('/video-ai/reports/:id', async (req, res) => {
    try {
      const id = asId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Report not found.' });
      const { rows } = await pool.query(`SELECT ${REPORT_COLUMNS} FROM video_ai_reports WHERE id = $1 AND user_id = $2`, [id, req.user.userId]);
      if (!rows[0]) return res.status(404).json({ error: 'Report not found.' });
      res.json({ report: rows[0] });
    } catch (err) {
      fail(res, err, 'Failed to load the report.');
    }
  });

  /** Update: newest numbers from the platform -> stored -> sent to the AI -> new report saved and returned. */
  router.post('/video-ai/published/update', async (req, res) => {
    try {
      const userId = req.user.userId;
      const { platform, provider } = req.body ?? {};
      const accountId = asId(req.body?.accountId);
      const mediaId = mediaIdOf(req.body?.mediaId);
      if (!VIDEO_PLATFORMS.includes(platform) || !accountId || !mediaId) return bad(res, 'platform, accountId and mediaId are required.');

      const { view } = await ai.aiState(userId);
      if (!ai.pickProvider(view, provider)) return res.status(409).json({ error: 'Set up an AI provider first (Scripts → Settings → AI providers).' });

      const account = await loadAccount(platform, userId, accountId);
      if (!account || String(account.id) !== accountId) return res.status(404).json({ error: 'That account is not connected.' });
      if (!ai.aiAllowed(req, res)) return;

      const syncError = await syncForReport(platform, account);
      const { data, latest } = await collectPublishedMetrics(userId, platform, accountId, mediaId);
      if (syncError) data.unavailable.push({ metric: 'latest sync', reason: `Could not refresh from ${platform} (${syncError.message}); using the last stored numbers.` });

      const niche = await ai.activeNicheOf(userId);
      const content = `Analyse this published video. Data from the platform API (JSON):\n${JSON.stringify(data)}`;
      const result = await ai.generate(userId, provider, publishedReportPrompt(niche), content, { maxTokens: REPORT_TOKENS });
      const report = parseVideoReport(result.text);
      const saved = await saveReport(userId, {
        kind: 'published', platform, accountId, mediaId, title: latest.title, thumbnail: latest.thumbnail_url,
        provider: result.provider, model: result.model, report, metrics: data,
      });
      res.json({ report: saved, sync_error: syncError });
    } catch (err) {
      fail(res, err, 'The video analysis failed.');
    }
  });

  /** Before upload: frames (+ the video for Gemini) and the planned caption -> AI report. The media is not kept. */
  router.post('/video-ai/preupload', express.json({ limit: PREUPLOAD_BODY_LIMIT }), async (req, res) => {
    try {
      const userId = req.user.userId;
      const b = req.body ?? {};
      const frames = Array.isArray(b.frames) ? b.frames : [];
      if (!frames.length) return bad(res, 'Send at least one frame from the video.');
      if (frames.length > MAX_FRAMES) return bad(res, `Send at most ${MAX_FRAMES} frames.`);
      for (const f of frames) {
        if (!IMAGE_MIME.test(String(f?.mime)) || typeof f?.data !== 'string' || f.data.length > MAX_FRAME_CHARS || !BASE64.test(f.data.slice(0, 200))) {
          return bad(res, 'Each frame must be a JPEG, PNG or WebP image.');
        }
      }
      const video = b.video && typeof b.video === 'object' ? b.video : null;
      if (video && (!VIDEO_MIME.test(String(video.mime)) || typeof video.data !== 'string' || video.data.length > MAX_VIDEO_CHARS)) {
        return bad(res, `The video must be an MP4, MOV or WebM file of up to ${MAX_VIDEO_MB} MB.`);
      }

      const { view } = await ai.aiState(userId);
      const provider = ai.pickProvider(view, b.provider);
      if (!provider) return res.status(409).json({ error: 'Set up an AI provider first (Scripts → Settings → AI providers).' });
      if (!SEES_IMAGES.includes(provider)) return res.status(422).json({ error: `${view.catalog.providers[provider].name} can't read images or video. Pick Gemini, Claude or OpenRouter for video analysis.` });
      const watchesVideo = Boolean(video) && WATCHES_VIDEO.includes(provider);
      if (!ai.aiAllowed(req, res)) return;

      const platforms = (Array.isArray(b.platforms) ? b.platforms : []).filter((p) => VIDEO_PLATFORMS.includes(p)).slice(0, 4);
      let script = null;
      const scriptId = asId(b.scriptId);
      if (scriptId) {
        const { rows } = await pool.query('SELECT title, notes FROM scripts WHERE id = $1 AND user_id = $2', [scriptId, userId]);
        if (rows[0]) script = { title: rows[0].title, planned_voiceover: text(rows[0].notes, 6000) };
      }
      const baselines = {};
      for (const p of platforms) {
        const base = await baselineFor(userId, p).catch(() => null);
        if (base) baselines[p] = base;
      }

      const info = {
        duration_seconds: Number(b.durationSec) || null, width: Number(b.width) || null, height: Number(b.height) || null,
        planned_title: text(b.title, 300) || null, planned_caption: text(b.caption, 3000) || null, platforms,
        frames_at_seconds: frames.map((f) => Number(f.t)).filter(Number.isFinite),
        script, creator_typical_numbers: Object.keys(baselines).length ? baselines : 'not available (no stored videos yet)',
      };
      const niche = await ai.activeNicheOf(userId);
      const content = {
        text: `Check this video before upload. The images are frames in time order (seconds: ${info.frames_at_seconds.join(', ')}).\nDetails (JSON):\n${JSON.stringify(info)}`,
        images: frames.map((f) => ({ mime: f.mime, data: f.data })),
        video: watchesVideo ? { mime: video.mime, data: video.data } : null,
      };
      const result = await ai.generate(userId, provider, preUploadPrompt(niche, { watchesVideo }), content, { maxTokens: REPORT_TOKENS });
      const report = parseVideoReport(result.text);
      report.watched_video = watchesVideo;
      const saved = await saveReport(userId, {
        kind: 'preupload', platform: platforms[0] ?? null, title: info.planned_title ?? text(b.fileName, 200) ?? null,
        provider: result.provider, model: result.model, report, metrics: info,
      });
      res.json({ report: saved });
    } catch (err) {
      fail(res, err, 'The video analysis failed.');
    }
  });

  return router;
}

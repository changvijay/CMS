import express from 'express';
import { pool, isDbReady } from '../db.js';
import { availablePlatforms, listAccounts, loadCredentials, loadRows, PLATFORMS } from '../services/publishAccounts.js';
import { isStorageConfigured, MAX_UPLOAD_BYTES, objectInfo, objectKey, publicUrl, signedUploadUrl } from '../services/storage.js';
import { FB_NATIVE_SCHEDULE } from '../services/publishers/facebook.js';
import { fbGet, isFacebookConfigured } from '../services/facebookApi.js';
import { isLinkedInConfigured } from '../services/linkedinAuth.js';
import { isInstagramConfigured } from './instagram.js';
import { runTarget, runTargets } from '../services/publishRunner.js';
import { validateAutoReply, validateTarget } from '../services/publishValidation.js';

const ALLOWED_MIME = /^(image\/(jpeg|png|webp|gif|heic)|video\/(mp4|quicktime|webm|x-m4v)|application\/pdf)$/;

/** True when this platform + post type is scheduled by the platform itself rather than our queue. */
export const nativelyScheduled = (platform, postType) => platform === 'youtube' || (platform === 'facebook' && FB_NATIVE_SCHEDULE.has(postType));

const fail = (res, err, fallback) => {
  const status = Number(err?.code || err?.status);
  return res.status(status >= 400 && status < 600 ? status : 500).json({ error: err?.message || fallback });
};

export function createPublishRouter(authenticateToken) {
  const router = express.Router();
  router.use('/publish', authenticateToken, (req, res, next) => (isDbReady() ? next() : res.status(503).json({ error: 'Database is not connected.' })));

  router.get('/publish/config', (req, res) => {
    res.json({
      storage: isStorageConfigured(),
      instagram: isInstagramConfigured(),
      facebook: isFacebookConfigured(),
      linkedin: isLinkedInConfigured(),
      google: Boolean((process.env.client_id || process.env.GOOGLE_CLIENT_ID) && (process.env.client_secret || process.env.GOOGLE_CLIENT_SECRET)),
    });
  });

  router.get('/publish/platforms', async (req, res) => {
    try {
      res.json({ platforms: await availablePlatforms(req.user.userId) });
    } catch (err) {
      fail(res, err, 'Failed to load platforms.');
    }
  });

  router.get('/publish/accounts', async (req, res) => {
    const wanted = String(req.query.platforms || '').split(',').filter((p) => PLATFORMS.includes(p));
    try {
      const entries = await Promise.all(wanted.map(async (p) => [p, await listAccounts(p, req.user.userId)]));
      res.json({ accounts: Object.fromEntries(entries) });
    } catch (err) {
      fail(res, err, 'Failed to load accounts.');
    }
  });

  // ---- Media uploads (browser -> Google Cloud Storage directly) ----
  router.post('/publish/uploads', async (req, res) => {
    const { fileName, mime, bytes } = req.body || {};
    if (!isStorageConfigured()) return res.status(500).json({ error: 'Media storage is not set up on the server (GCS_BUCKET).' });
    if (!ALLOWED_MIME.test(String(mime || ''))) return res.status(400).json({ error: `Files of type "${mime}" can't be posted. Use JPG, PNG, WEBP, MP4, MOV or PDF.` });
    if (!(Number(bytes) > 0) || Number(bytes) > MAX_UPLOAD_BYTES) return res.status(400).json({ error: 'The file is empty or larger than 4 GB.' });
    try {
      const key = objectKey(req.user.userId, fileName);
      const uploadUrl = await signedUploadUrl(key, mime);
      const { rows } = await pool.query(
        'INSERT INTO media_assets (user_id, gcs_key, public_url, file_name, mime, bytes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, public_url',
        [req.user.userId, key, publicUrl(key), String(fileName || '').slice(0, 200), mime, Number(bytes)]
      );
      res.status(201).json({ id: String(rows[0].id), uploadUrl, publicUrl: rows[0].public_url });
    } catch (err) {
      console.error('Upload URL error:', err.message);
      fail(res, err, 'Could not start the upload.');
    }
  });

  router.post('/publish/uploads/:id/complete', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM media_assets WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
      if (!rows.length) return res.status(404).json({ error: 'Upload not found.' });
      const info = await objectInfo(rows[0].gcs_key);
      if (!info) return res.status(409).json({ error: 'The file did not reach storage. Try uploading it again.' });
      const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
      const { width, height, duration } = req.body || {};
      const updated = await pool.query(
        `UPDATE media_assets SET uploaded = TRUE, bytes = $3, width = $4, height = $5, duration_s = $6 WHERE id = $1 AND user_id = $2
         RETURNING id, public_url, mime, bytes, width, height, duration_s`,
        [rows[0].id, req.user.userId, info.bytes, num(width), num(height), num(duration)]
      );
      res.json({ asset: updated.rows[0] });
    } catch (err) {
      fail(res, err, 'Could not finish the upload.');
    }
  });

  // ---- Lookups used by the forms ----
  const youtubeToken = async (req) => (await loadCredentials('youtube', req.user.userId, req.query.accountId)).accessToken;
  const ytGet = async (token, path) => {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (!r.ok) throw Object.assign(new Error(j.error?.message || 'YouTube request failed'), { code: r.status });
    return j;
  };

  router.get('/publish/youtube/categories', async (req, res) => {
    try {
      const region = /^[A-Z]{2}$/.test(String(req.query.region || '')) ? req.query.region : 'IN';
      const j = await ytGet(await youtubeToken(req), `videoCategories?part=snippet&regionCode=${region}`);
      res.json({ categories: (j.items || []).filter((c) => c.snippet?.assignable).map((c) => ({ id: c.id, title: c.snippet.title })) });
    } catch (err) {
      fail(res, err, 'Could not load YouTube categories.');
    }
  });

  router.get('/publish/youtube/playlists', async (req, res) => {
    try {
      const j = await ytGet(await youtubeToken(req), 'playlists?part=snippet&mine=true&maxResults=50');
      res.json({ playlists: (j.items || []).map((p) => ({ id: p.id, title: p.snippet?.title })) });
    } catch (err) {
      fail(res, err, 'Could not load playlists.');
    }
  });

  /** Any connected Facebook Page token works for searching places (Pages Search API). */
  const anyPageToken = async (userId) => (await loadRows('facebook', userId))[0]?.page_access_token || null;

  router.get(['/publish/instagram/locations', '/publish/facebook/places'], async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ places: [] });
    const token = await anyPageToken(req.user.userId);
    if (!token) return res.status(409).json({ error: 'Location search needs a connected Facebook Page. Connect Facebook first.' });
    const r = await fbGet('pages/search', token, { q, fields: 'id,name,location{city,country,street}', limit: 15 });
    if (r.error) return res.status(502).json({ error: r.error.message });
    res.json({
      places: (r.data.data || []).map((p) => ({ id: p.id, name: p.name, detail: [p.location?.street, p.location?.city, p.location?.country].filter(Boolean).join(', ') })),
    });
  });

  router.get('/publish/instagram/products', async (req, res) => {
    try {
      const { fbPage } = await loadCredentials('instagram', req.user.userId, req.query.accountId);
      if (!fbPage) return res.status(409).json({ error: 'Product tags need a Facebook Page linked to this Instagram account, with Instagram Shopping set up.' });
      const catalogs = await fbGet(`${fbPage.ig_user_id}/available_catalogs`, fbPage.page_access_token, { fields: 'catalog_id,catalog_name' });
      if (catalogs.error) return res.status(502).json({ error: catalogs.error.message });
      const catalog = catalogs.data.data?.[0];
      if (!catalog) return res.json({ products: [], shop: false });
      const r = await fbGet(`${fbPage.ig_user_id}/catalog_product_search`, fbPage.page_access_token, { catalog_id: catalog.catalog_id, q: String(req.query.q || '') });
      if (r.error) return res.status(502).json({ error: r.error.message });
      res.json({ shop: true, products: (r.data.data || []).map((p) => ({ id: String(p.product_id), name: p.product_name, image: p.image_url, review: p.review_status })) });
    } catch (err) {
      fail(res, err, 'Could not search products.');
    }
  });

  // ---- Posts ----
  const ownedPost = async (userId, id) => {
    if (!/^\d+$/.test(String(id))) return null;
    const { rows } = await pool.query('SELECT * FROM posts WHERE id = $1 AND user_id = $2', [id, userId]);
    return rows[0] ?? null;
  };

  router.get('/publish/posts', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT p.id, p.status, p.schedule_at, p.created_at, p.updated_at, p.wizard_state->'shared'->>'title' AS title,
              COALESCE(json_agg(json_build_object('platform', t.platform, 'status', t.status, 'permalink', t.permalink)) FILTER (WHERE t.id IS NOT NULL), '[]') AS targets
         FROM posts p LEFT JOIN post_targets t ON t.post_id = p.id
        WHERE p.user_id = $1 GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 50`,
      [req.user.userId]
    );
    res.json({ posts: rows });
  });

  router.post('/publish/posts', async (req, res) => {
    const { rows } = await pool.query('INSERT INTO posts (user_id, wizard_state) VALUES ($1, $2) RETURNING id, status, updated_at', [req.user.userId, req.body?.wizard || {}]);
    res.status(201).json({ post: rows[0] });
  });

  router.patch('/publish/posts/:id', async (req, res) => {
    const post = await ownedPost(req.user.userId, req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (post.status !== 'draft') return res.status(409).json({ error: 'Only drafts can be edited.' });
    const { rows } = await pool.query('UPDATE posts SET wizard_state = $2, updated_at = NOW() WHERE id = $1 RETURNING id, status, updated_at', [post.id, req.body?.wizard || {}]);
    res.json({ post: rows[0] });
  });

  router.delete('/publish/posts/:id', async (req, res) => {
    const post = await ownedPost(req.user.userId, req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (!['draft', 'failed', 'done', 'partial'].includes(post.status)) return res.status(409).json({ error: 'This post is still publishing or scheduled.' });
    await pool.query('DELETE FROM posts WHERE id = $1', [post.id]);
    res.status(204).end();
  });

  router.get('/publish/posts/:id', async (req, res) => {
    const post = await ownedPost(req.user.userId, req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    const targets = await pool.query(
      `SELECT id, platform, account_id, post_type, status, step, schedule_at, native_scheduled, external_id, permalink, error_code, error_message, note, attempts, updated_at
         FROM post_targets WHERE post_id = $1 ORDER BY id`, [post.id]);
    const rules = await pool.query(
      `SELECT r.id, r.post_target_id, r.is_active, r.keywords, r.match_type, r.media_id FROM automation_rules r
         JOIN post_targets t ON t.id = r.post_target_id WHERE t.post_id = $1`, [post.id]);
    const log = rules.rows.length ? await pool.query(
      `SELECT id, rule_id, comment_id, event_key, sender_username, keyword_matched, trigger_text, message_text, public_reply_text, status, skip_reason,
              error_code, error_message, note, created_at
         FROM automation_events WHERE rule_id = ANY($1::bigint[]) ORDER BY created_at DESC LIMIT 100`, [rules.rows.map((r) => r.id)]) : { rows: [] };
    res.json({ post, targets: targets.rows, autoReplies: rules.rows, autoReplyLog: log.rows });
  });

  /**
   * Publish now, or schedule. Every target is checked first; nothing is sent when any check fails.
   * Facebook and YouTube receive the schedule themselves; Instagram and LinkedIn wait in our queue.
   */
  router.post('/publish/posts/:id/submit', async (req, res) => {
    const post = await ownedPost(req.user.userId, req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (post.status !== 'draft') return res.status(409).json({ error: 'This post was already submitted.' });

    const { targets = [], scheduleAt = null, timezone = null, autoReply = null, wizard = post.wizard_state } = req.body || {};
    if (!Array.isArray(targets) || !targets.length) return res.status(400).json({ error: 'Choose at least one account.' });

    const errors = [];
    for (const t of targets) {
      const owned = (await loadRows(t.platform, req.user.userId).catch(() => [])).some((r) => String(r.id) === String(t.accountId));
      if (!owned) errors.push(`${t.platform}: that account is not connected to your login.`);
      errors.push(...validateTarget(t, scheduleAt));
    }
    const reply = autoReply?.enabled ? validateAutoReply(autoReply) : null;
    if (reply) errors.push(...reply.errors);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });

    const client = await pool.connect();
    const runNow = [];
    try {
      await client.query('BEGIN');
      await client.query('UPDATE posts SET wizard_state = $2, schedule_at = $3, timezone = $4, status = $5, updated_at = NOW() WHERE id = $1',
        [post.id, wizard, scheduleAt, timezone, scheduleAt ? 'scheduled' : 'publishing']);
      for (const t of targets) {
        const native = Boolean(scheduleAt) && nativelyScheduled(t.platform, t.postType);
        // Natively scheduled targets are sent right away (with the time); queue-scheduled ones wait for their time.
        const status = scheduleAt && !native ? 'scheduled' : 'pending';
        const { rows } = await client.query(
          `INSERT INTO post_targets (post_id, platform, account_id, post_type, fields, status, schedule_at, native_scheduled)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [post.id, t.platform, t.accountId, t.postType, t.fields || {}, status, scheduleAt, native]
        );
        if (status === 'pending') runNow.push(rows[0].id);

        if (reply && t.platform === 'instagram') {
          const v = reply.value;
          // Starts inactive; the runner switches it on with the post's media id once Instagram publishes it.
          await client.query(
            `INSERT INTO automation_rules (user_id, account_id, name, is_active, triggers, keywords, match_type, scope, reply_text, link_url, comment_reply_text,
                disclose_automation, cooldown_hours, post_target_id, public_reply_variants, send_dm, dm_buttons, quick_replies, require_follow, active_from, active_until)
             VALUES ($1,$2,$3,FALSE,ARRAY['comment'],$4,$5,'specific',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
            [req.user.userId, t.accountId, v.name, v.keywords, v.match_type, v.reply_text, v.link_url, v.comment_reply_text, v.disclose_automation, v.cooldown_hours,
              rows[0].id, v.public_reply_variants, v.send_dm, JSON.stringify(v.dm_buttons), JSON.stringify(v.quick_replies), v.require_follow, v.active_from, v.active_until]
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Submit error:', err.message);
      return res.status(500).json({ error: 'Failed to save the post.' });
    } finally {
      client.release();
    }

    // Publishing runs in the background; the page polls GET /publish/posts/:id for progress.
    if (runNow.length) runTargets(runNow).catch((err) => console.error('Publish run crashed:', err));
    res.status(202).json({ id: String(post.id), scheduled: Boolean(scheduleAt) });
  });

  router.post('/publish/targets/:id/retry', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT t.id, t.status FROM post_targets t JOIN posts p ON p.id = t.post_id WHERE t.id = $1 AND p.user_id = $2`,
      [req.params.id, req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found.' });
    if (rows[0].status !== 'failed') return res.status(409).json({ error: 'Only a failed platform can be retried.' });
    runTarget(rows[0].id).catch((err) => console.error('Retry crashed:', err));
    res.status(202).json({ ok: true });
  });

  return router;
}

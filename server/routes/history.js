import express from 'express';
import { pool, isDbReady, getInstagramAccountsByUserId, getLinkedInAccountsByUserId, getYoutubeAccountsByUserId } from '../db.js';
import { pickAccount } from '../utils/accounts.js';
import { syncFacebookPage, syncInstagramAccount, syncLinkedInAccount, syncYoutubeAccount } from '../services/syncService.js';
import { getFacebookPagesByUserId } from './facebookInsights.js';
import { isAuthError } from '../utils/authErrors.js';
import {
  METRICS,
  PRIMARY_METRIC,
  sumMetrics,
  computeDeltas,
  movingAverage,
  detectAnomalies,
  linearForecast,
  bestWeekday,
} from '../services/analytics.js';
import { invalidateLiveInsights, loadDaily } from '../services/dailyInsights.js';
import { addDays, daysBetween, isDateString, istDateString } from '../utils/dates.js';

/** One account may not hold up the rest: past this, it is reported as failed and the others still answer. */
const SYNC_TIMEOUT_MS = 90 * 1000;

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(message), { status: 504 })), ms); }),
  ]).finally(() => clearTimeout(timer));
}

const TABLES = {
  instagram: { table: 'ig_daily_metrics' },
  youtube: { table: 'yt_daily_metrics' },
  linkedin: { table: 'li_daily_metrics' },
};

const MEDIA_NUMERIC = ['reach', 'views', 'likes', 'comments', 'saves', 'shares', 'reposts', 'total_interactions', 'follows',
  'profile_visits', 'replies', 'link_clicks', 'skip_rate', 'avg_watch_seconds', 'total_watch_seconds', 'duration_seconds'];

/** Postgres returns BIGINT/NUMERIC as strings; the UI does arithmetic on these, so convert them. */
export function normalizeMediaRow(row) {
  const out = { ...row };
  for (const k of MEDIA_NUMERIC) out[k] = row[k] === null || row[k] === undefined ? null : Number(row[k]);
  return out;
}

/** True for ?live=1 / ?live=true: the user picked a custom range and wants numbers straight from the platform. */
export const wantsLive = (value) => value === '1' || value === 'true';

/**
 * The comparison period. Stored when it is inside the retention window, otherwise fetched live and kept for hours
 * (past days don't change). If the platform can't provide it, the comparison is simply left out.
 */
export async function loadPrevious(platform, accounts, since, until, opts = {}) {
  try {
    return (await loadDaily(platform, accounts, since, until, { ...opts, past: true })).rows;
  } catch {
    return [];
  }
}

export function createHistoryRouter(authenticateToken) {
  const router = express.Router();

  router.get('/history/:platform', authenticateToken, async (req, res) => {
    const { platform } = req.params;
    if (!TABLES[platform]) return res.status(400).json({ error: 'platform must be instagram, youtube or linkedin.' });
    if (!isDbReady()) return res.status(503).json({ error: 'Database is not connected; stored history is unavailable.' });

    try {
      const account = await pickAccount(platform, req.user.userId, req.query.accountId);
      if (!account) return res.status(404).json({ error: `No ${platform} account found for user.` });

      const until = isDateString(req.query.until) ? req.query.until : addDays(istDateString(), -1);
      const since = isDateString(req.query.since) ? req.query.since : addDays(until, -29);
      if (since > until) return res.status(400).json({ error: 'since must be on or before until.' });

      const span = daysBetween(since, until) + 1;
      const prevUntil = addDays(since, -1);
      const prevSince = addDays(prevUntil, -(span - 1));

      const [current, previous] = await Promise.all([
        loadDaily(platform, [account], since, until, { live: wantsLive(req.query.live) }),
        loadPrevious(platform, [account], prevSince, prevUntil),
      ]);
      if (current.errors.length) {
        const e = current.errors[0];
        const status = Number.isInteger(e.code) && e.code >= 400 && e.code < 600 ? e.code : 502;
        return res.status(status).json({ error: e.message, error_details: { code: e.code, message: e.message, reason: e.reason } });
      }
      const daily = current.rows;

      const metrics = METRICS[platform];
      const primary = PRIMARY_METRIC[platform];
      const points = daily.map((r) => ({ date: r.metric_date, value: r[primary] ?? 0 }));
      const values = points.map((p) => p.value);
      const ma7 = movingAverage(values, 7);

      return res.json({
        platform,
        source: current.source,
        account: { id: account.id, name: account.page_name || account.channel_name },
        range: { since, until, days: span, previous_since: prevSince, previous_until: prevUntil },
        coverage: { days_with_data: daily.length, previous_days_with_data: previous.length },
        primary_metric: primary,
        daily: daily.map((r, i) => ({
          date: r.metric_date,
          ...Object.fromEntries(metrics.map((m) => [m, r[m] ?? null])),
          [`${primary}_ma7`]: ma7[i],
        })),
        totals: sumMetrics(daily, metrics),
        deltas: computeDeltas(sumMetrics(daily, metrics), sumMetrics(previous, metrics)),
        anomalies: detectAnomalies(points),
        forecast: linearForecast(values, 7),
        best_weekday: bestWeekday(points),
        last_synced_at: current.source === 'stored' && daily.length ? daily[daily.length - 1].synced_at : null,
        fetched_at: current.source === 'live' ? new Date().toISOString() : null,
      });
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ error: error.message });
      console.error('History error:', error);
      return res.status(500).json({ error: 'Failed to load history.' });
    }
  });

  router.get('/history/:platform/media', authenticateToken, async (req, res) => {
    const { platform } = req.params;
    if (!TABLES[platform]) return res.status(400).json({ error: 'platform must be instagram, youtube or linkedin.' });
    if (!isDbReady()) return res.status(503).json({ error: 'Database is not connected; stored history is unavailable.' });
    try {
      const account = await pickAccount(platform, req.user.userId, req.query.accountId);
      if (!account) return res.status(404).json({ error: `No ${platform} account found for user.` });
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      // Latest snapshot per media item, newest posts first
      const { rows } = await pool.query(
        `SELECT * FROM (
           SELECT DISTINCT ON (media_id) *
             FROM media_snapshots
            WHERE platform = $1 AND account_id = $2
            ORDER BY media_id, captured_on DESC
         ) latest
         ORDER BY published_at DESC NULLS LAST
         LIMIT $3`,
        [platform, account.id, limit]
      );
      const media = rows.map(normalizeMediaRow);
      return res.json({ platform, account_id: account.id, media });
    } catch (error) {
      console.error('Media history error:', error);
      return res.status(500).json({ error: 'Failed to load stored media.' });
    }
  });

  // Manual sync of the current user's accounts (all, or one platform / account).
  // Every account runs at the same time and on its own: one that fails, hangs or is logged out never stops the others.
  router.post('/sync', authenticateToken, async (req, res) => {
    if (!isDbReady()) return res.status(503).json({ error: 'Database is not connected; cannot store snapshots.' });
    const platform = req.body?.platform;
    const onlyId = req.body?.accountId;
    const requested = parseInt(req.body?.mediaLimit, 10);
    const mediaLimit = Number.isFinite(requested) ? Math.min(Math.max(requested, 5), 200) : undefined;
    const want = (p) => !platform || platform === p;

    const SOURCES = [
      { platform: 'instagram', load: getInstagramAccountsByUserId, name: (a) => a.page_name, sync: (a) => syncInstagramAccount(a, { mediaLimit }) },
      { platform: 'youtube', load: getYoutubeAccountsByUserId, name: (a) => a.channel_name, sync: (a) => syncYoutubeAccount(a, { mediaLimit }) },
      { platform: 'linkedin', load: getLinkedInAccountsByUserId, name: (a) => a.page_name ?? a.name, sync: (a) => syncLinkedInAccount(a, { mediaLimit }) },
      { platform: 'facebook', load: getFacebookPagesByUserId, name: (a) => a.name, sync: (a) => syncFacebookPage(a) },
    ].filter((src) => want(src.platform));

    const errors = [];
    // Loading one platform's account list can fail on its own too.
    const lists = await Promise.all(SOURCES.map(async (src) => {
      try {
        return (await src.load(req.user.userId)).filter((a) => !onlyId || String(a.id) === String(onlyId));
      } catch (err) {
        errors.push({ platform: src.platform, account_id: null, name: null, code: 500, message: `Could not load ${src.platform} accounts: ${err.message}`, auth: false });
        return [];
      }
    }));

    const settled = await Promise.allSettled(SOURCES.flatMap((src, i) => lists[i].map((account) =>
      withTimeout(src.sync(account), SYNC_TIMEOUT_MS, `${src.platform} took too long to answer`)
        .then((result) => {
          if (src.platform !== 'facebook') invalidateLiveInsights(src.platform, account.id);
          return { ...result, platform: src.platform, account_id: account.id, name: src.name(account) };
        })
        .catch((err) => Promise.reject(Object.assign(err instanceof Error ? err : new Error(String(err)), { src, account }))))));

    const results = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') { results.push(s.value); continue; }
      const err = s.reason;
      errors.push({
        platform: err.src.platform,
        account_id: err.account.id,
        name: err.src.name(err.account),
        code: Number.isInteger(err.status) ? err.status : 500,
        reason: err.reason,
        message: err.message,
        auth: isAuthError(err),
      });
    }
    return res.status(errors.length && !results.length ? 502 : 200).json({ results, errors });
  });

  return router;
}

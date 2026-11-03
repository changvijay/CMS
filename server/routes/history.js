import express from 'express';
import { pool, isDbReady, getInstagramAccountsByUserId, getLinkedInAccountsByUserId, getYoutubeAccountsByUserId } from '../db.js';
import { pickAccount } from '../utils/accounts.js';
import { syncInstagramAccount, syncLinkedInAccount, syncYoutubeAccount } from '../services/syncService.js';
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
import { addDays, daysBetween, isDateString, istDateString } from '../utils/dates.js';

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

async function loadDaily(platform, accountId, since, until) {
  const { rows } = await pool.query(
    `SELECT * FROM ${TABLES[platform].table} WHERE account_id = $1 AND metric_date BETWEEN $2 AND $3 ORDER BY metric_date`,
    [accountId, since, until]
  );
  return rows.map((r) => ({ ...r, metric_date: r.metric_date instanceof Date ? istDateString(r.metric_date) : String(r.metric_date).slice(0, 10) }));
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

      const [daily, previous] = await Promise.all([
        loadDaily(platform, account.id, since, until),
        loadDaily(platform, account.id, prevSince, prevUntil),
      ]);

      const metrics = METRICS[platform];
      const primary = PRIMARY_METRIC[platform];
      const points = daily.map((r) => ({ date: r.metric_date, value: Number(r[primary] ?? 0) }));
      const values = points.map((p) => p.value);

      return res.json({
        platform,
        account: { id: account.id, name: account.page_name || account.channel_name },
        range: { since, until, days: span, previous_since: prevSince, previous_until: prevUntil },
        coverage: { days_with_data: daily.length, previous_days_with_data: previous.length },
        primary_metric: primary,
        daily: daily.map((r, i) => ({
          date: r.metric_date,
          ...Object.fromEntries(metrics.map((m) => [m, r[m] === null ? null : Number(r[m])])),
          [`${primary}_ma7`]: movingAverage(values, 7)[i],
        })),
        totals: sumMetrics(daily, metrics),
        deltas: computeDeltas(sumMetrics(daily, metrics), sumMetrics(previous, metrics)),
        anomalies: detectAnomalies(points),
        forecast: linearForecast(values, 7),
        best_weekday: bestWeekday(points),
        last_synced_at: daily.length ? daily[daily.length - 1].synced_at : null,
      });
    } catch (error) {
      console.error('History error:', error);
      return res.status(500).json({ error: 'Failed to load stored history.' });
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
      // Latest snapshot per media item
      const { rows } = await pool.query(
        `SELECT DISTINCT ON (media_id) *
           FROM media_snapshots
          WHERE platform = $1 AND account_id = $2
          ORDER BY media_id, captured_on DESC`,
        [platform, account.id]
      );
      const media = rows.map(normalizeMediaRow);
      media.sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));
      return res.json({ platform, account_id: account.id, media: media.slice(0, limit) });
    } catch (error) {
      console.error('Media history error:', error);
      return res.status(500).json({ error: 'Failed to load stored media.' });
    }
  });

  // Manual sync of the current user's accounts (all, or one platform / account)
  router.post('/sync', authenticateToken, async (req, res) => {
    if (!isDbReady()) return res.status(503).json({ error: 'Database is not connected; cannot store snapshots.' });
    const platform = req.body?.platform;
    const requested = parseInt(req.body?.mediaLimit, 10);
    const mediaLimit = Number.isFinite(requested) ? Math.min(Math.max(requested, 5), 200) : undefined;
    const results = [];
    const errors = [];
    const run = async (p, account, fn) => {
      try {
        results.push(await fn(account));
      } catch (err) {
        errors.push({ platform: p, account_id: account.id, code: err.status || 500, reason: err.reason, message: err.message });
      }
    };
    try {
      if (!platform || platform === 'instagram') {
        for (const a of await getInstagramAccountsByUserId(req.user.userId)) {
          if (req.body?.accountId && String(a.id) !== String(req.body.accountId)) continue;
          await run('instagram', a, (acc) => syncInstagramAccount(acc, { days: 30, mediaLimit }));
        }
      }
      if (!platform || platform === 'youtube') {
        for (const a of await getYoutubeAccountsByUserId(req.user.userId)) {
          if (req.body?.accountId && String(a.id) !== String(req.body.accountId)) continue;
          await run('youtube', a, (acc) => syncYoutubeAccount(acc, { days: 90, mediaLimit }));
        }
      }
      if (!platform || platform === 'linkedin') {
        for (const a of await getLinkedInAccountsByUserId(req.user.userId)) {
          if (req.body?.accountId && String(a.id) !== String(req.body.accountId)) continue;
          await run('linkedin', a, (acc) => syncLinkedInAccount(acc, { days: 90, mediaLimit }));
        }
      }
      return res.status(errors.length && !results.length ? 502 : 200).json({ results, errors });
    } catch (error) {
      console.error('Sync error:', error);
      return res.status(500).json({ error: 'Sync failed.', results, errors });
    }
  });

  return router;
}

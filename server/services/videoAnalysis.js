import { pool } from '../db.js';
import { pickAccount } from '../utils/accounts.js';
import { addDays, istDateString } from '../utils/dates.js';
import { engagementRate } from './analytics.js';
import { syncFacebookPage, syncInstagramAccount, syncLinkedInAccount, syncYoutubeAccount } from './syncService.js';
import { invalidateLiveInsights } from './dailyInsights.js';
import { fetchRetention, runReport, ytHeaders } from './youtubeReports.js';
import { getFacebookPagesByUserId } from '../routes/facebookInsights.js';

/**
 * Gathers the real numbers behind an AI video report: the video's latest stored metrics and their daily history
 * (media_snapshots), live YouTube watch-time and retention, and how it compares with the creator's own recent videos.
 * Nothing here is estimated: a metric the platform didn't return is listed in `unavailable` instead.
 */

export const VIDEO_PLATFORMS = ['instagram', 'youtube', 'facebook', 'linkedin'];
const PEERS = 20;

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const round = (v, d = 1) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

export function median(values) {
  const xs = values.filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** The user's account for a platform (their pick, else the first one). Null when they have none. */
export async function loadAccount(platform, userId, accountId) {
  if (platform === 'facebook') {
    const pages = await getFacebookPagesByUserId(userId);
    return pages.find((p) => String(p.id) === String(accountId)) ?? pages[0] ?? null;
  }
  return pickAccount(platform, userId, accountId);
}

const SYNCS = {
  instagram: (a) => syncInstagramAccount(a, { mediaLimit: 25 }),
  youtube: (a) => syncYoutubeAccount(a, { mediaLimit: 25 }),
  linkedin: (a) => syncLinkedInAccount(a, { mediaLimit: 25 }),
  facebook: (a) => syncFacebookPage(a, { days: 7 }),
};

/** Pulls the newest numbers from the platform into media_snapshots. A failure is reported, not thrown: stored numbers still work. */
export async function syncForReport(platform, account) {
  try {
    await SYNCS[platform](account);
    if (platform !== 'facebook') invalidateLiveInsights(platform, account.id);
    return null;
  } catch (err) {
    return { code: Number.isInteger(err.status) ? err.status : 502, message: err.message };
  }
}

const SNAPSHOT_COLUMNS = `media_id, captured_on, title, media_type, permalink, thumbnail_url, published_at, reach, views, likes, comments, saves, shares,
  total_interactions, reposts, profile_visits, follows, replies, link_clicks, skip_rate, avg_watch_seconds, total_watch_seconds, duration_seconds, extra`;

/** The metrics block for one stored row: numbers only, nulls kept so the AI sees what's missing. */
function metricsOf(row) {
  const m = {
    views: num(row.views), reach: num(row.reach), likes: num(row.likes), comments: num(row.comments), shares: num(row.shares),
    saves: num(row.saves), reposts: num(row.reposts), total_interactions: num(row.total_interactions), follows: num(row.follows),
    profile_visits: num(row.profile_visits), link_clicks: num(row.link_clicks), skip_rate_pct: num(row.skip_rate),
    avg_watch_seconds: num(row.avg_watch_seconds), total_watch_seconds: num(row.total_watch_seconds), duration_seconds: num(row.duration_seconds),
  };
  m.engagement_rate_pct = engagementRate(row);
  if (m.avg_watch_seconds !== null && m.duration_seconds) m.avg_watched_pct = round((m.avg_watch_seconds / m.duration_seconds) * 100);
  return m;
}

/** YouTube's own per-video watch-time numbers and a short retention curve (live; YouTube only keeps them in its API). */
async function youtubeLive(account, videoId, publishedAt) {
  const start = publishedAt ? String(publishedAt).slice(0, 10) : addDays(istDateString(), -90);
  const end = istDateString();
  const headers = await ytHeaders(account);
  const [totals, retention] = await Promise.all([
    runReport(headers, {
      startDate: start, endDate: end, filters: `video==${videoId}`,
      metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost',
    }),
    fetchRetention(account, videoId, start, end),
  ]);
  const out = { unavailable: [] };
  if (totals.error) out.unavailable.push({ metric: 'YouTube watch time', reason: totals.error.message });
  else if (totals.rows?.[0]) {
    const r = totals.rows[0];
    out.watch = {
      watch_minutes: num(r.estimatedMinutesWatched), avg_view_duration_seconds: num(r.averageViewDuration),
      avg_view_percentage: round(num(r.averageViewPercentage)), subscribers_gained: num(r.subscribersGained), subscribers_lost: num(r.subscribersLost),
      shares: num(r.shares),
    };
  }
  if (retention.error) out.unavailable.push({ metric: 'YouTube audience retention', reason: retention.error.message });
  else if (retention.rows?.length) {
    // % of viewers still watching at a few points of the video (elapsedVideoTimeRatio 0..1).
    const at = (ratio) => {
      const row = retention.rows.reduce((best, r) => (Math.abs(Number(r.elapsedVideoTimeRatio) - ratio) < Math.abs(Number(best.elapsedVideoTimeRatio) - ratio) ? r : best));
      return round(Number(row.audienceWatchRatio) * 100);
    };
    out.retention_curve_pct = Object.fromEntries([0, 0.1, 0.25, 0.5, 0.75, 1].map((p) => [`${Math.round(p * 100)}%`, at(p)]));
  }
  return out;
}

/** The creator's typical numbers: median of their recent videos of the same type (this one left out), and this video's rank. */
async function peerComparison(platform, accountId, mediaId, mediaType, own) {
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (media_id) ${SNAPSHOT_COLUMNS}
         FROM media_snapshots WHERE platform = $1 AND account_id = $2
        ORDER BY media_id, captured_on DESC) latest
      WHERE ($3::text IS NULL OR media_type = $3) AND media_id <> $4 AND media_type <> 'STORY'
      ORDER BY published_at DESC NULLS LAST LIMIT ${PEERS}`,
    [platform, Number(accountId), mediaType ?? null, mediaId ?? ''],
  );
  if (!rows.length) return null;
  const peers = rows.map(metricsOf);
  const keys = ['views', 'reach', 'likes', 'comments', 'shares', 'saves', 'engagement_rate_pct', 'avg_watch_seconds', 'skip_rate_pct'];
  const medians = Object.fromEntries(keys.map((k) => [k, round(median(peers.map((p) => p[k])))]).filter(([, v]) => v !== null));
  const best = rows.reduce((b, r) => (Number(r.views ?? 0) > Number(b.views ?? 0) ? r : b));
  const comparison = { compared_with: rows.length, media_type: mediaType ?? 'all', median: medians, best: { title: best.title, views: num(best.views), engagement_rate_pct: engagementRate(best) } };
  if (own) {
    const views = peers.map((p) => p.views ?? 0);
    comparison.rank_by_views = 1 + views.filter((v) => v > (own.views ?? 0)).length;
    comparison.vs_median = Object.fromEntries(Object.entries(medians).filter(([k]) => own[k] !== null && own[k] !== undefined).map(([k, med]) => [k, { this: own[k], median: med }]));
  }
  return comparison;
}

/** The typical numbers of an account, for checking a video before upload. Null without stored videos. */
export async function baselineFor(userId, platform) {
  if (!VIDEO_PLATFORMS.includes(platform)) return null;
  const account = await loadAccount(platform, userId);
  if (!account) return null;
  return peerComparison(platform, account.id, null, null, null);
}

/**
 * Everything the AI is told about a published video. Throws 404 when the video isn't stored for this user's account.
 * With `live` (Update), YouTube's watch-time numbers are fetched and the average watch time saved on today's snapshot.
 */
export async function collectPublishedMetrics(userId, platform, accountId, mediaId, { live = true } = {}) {
  const account = await loadAccount(platform, userId, accountId);
  if (!account || String(account.id) !== String(accountId)) throw Object.assign(new Error('That account is not connected.'), { status: 404 });

  const { rows: history } = await pool.query(
    `SELECT ${SNAPSHOT_COLUMNS} FROM media_snapshots WHERE platform = $1 AND account_id = $2 AND media_id = $3 ORDER BY captured_on DESC LIMIT 30`,
    [platform, Number(account.id), String(mediaId)],
  );
  const latest = history[0];
  if (!latest) throw Object.assign(new Error('No stored numbers for this video yet. Press Update data on its platform page first.'), { status: 404 });

  const metrics = metricsOf(latest);
  const unavailable = Object.entries(metrics).filter(([, v]) => v === null).map(([k]) => ({ metric: k, reason: 'not returned by the platform for this post' }));
  const metricErrors = latest.extra?.metric_errors;
  if (Array.isArray(metricErrors)) for (const e of metricErrors.slice(0, 10)) unavailable.push({ metric: e.metric, reason: e.message ?? e.reason ?? 'permission or support missing' });

  const data = {
    platform,
    account: account.page_name ?? account.channel_name ?? account.name ?? null,
    video: {
      id: latest.media_id, title: latest.title, type: latest.media_type, permalink: latest.permalink,
      published_at: latest.published_at, age_days: latest.published_at ? Math.max(0, Math.round((Date.now() - new Date(latest.published_at).getTime()) / 86_400_000)) : null,
    },
    metrics,
    // Oldest first, so growth reads left to right.
    growth: history.slice(0, 14).reverse().map((h) => ({ date: String(h.captured_on instanceof Date ? h.captured_on.toISOString().slice(0, 10) : h.captured_on), views: num(h.views), likes: num(h.likes), comments: num(h.comments) })),
    breakdowns: latest.extra?.breakdowns ?? undefined,
    unavailable,
  };

  if (platform === 'youtube' && live) {
    try {
      const yt = await youtubeLive(account, latest.media_id, latest.published_at);
      if (yt.watch) {
        data.youtube_watch = yt.watch;
        if (yt.watch.avg_view_duration_seconds !== null) {
          data.metrics.avg_watch_seconds = yt.watch.avg_view_duration_seconds;
          data.metrics.avg_watched_pct = yt.watch.avg_view_percentage;
          data.unavailable = data.unavailable.filter((u) => !['avg_watch_seconds', 'total_watch_seconds'].includes(u.metric));
          // Keep the newest average watch time with the stored numbers.
          await pool.query(
            `UPDATE media_snapshots SET avg_watch_seconds = $5, total_watch_seconds = COALESCE($6, total_watch_seconds)
              WHERE platform = $1 AND account_id = $2 AND media_id = $3 AND captured_on = $4`,
            [platform, Number(account.id), latest.media_id, latest.captured_on, yt.watch.avg_view_duration_seconds, yt.watch.watch_minutes === null ? null : yt.watch.watch_minutes * 60],
          ).catch(() => {});
        }
      }
      if (yt.retention_curve_pct) data.retention_curve_pct = yt.retention_curve_pct;
      data.unavailable.push(...yt.unavailable);
    } catch (err) {
      data.unavailable.push({ metric: 'YouTube watch time and retention', reason: err.message });
    }
  }

  data.comparison = await peerComparison(platform, account.id, latest.media_id, latest.media_type, data.metrics);
  return { data, account, latest };
}

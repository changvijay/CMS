import { pool } from '../db.js';
import { getGoogleAccessTokenFromRefreshToken, noteYoutubeResponse } from './googleAuth.js';
import { MEDIA_FIELDS, fetchMediaInsights, igGet, mediaLabel } from './instagramApi.js';
import { isoDurationToSeconds } from '../utils/duration.js';
import { getWorkingLinkedInToken } from './linkedinAuth.js';
import { fetchDailyStats, fetchPostSnapshots } from './linkedinApi.js';
import { addDays, dateRange, istDateString, istDayWindowSeconds } from '../utils/dates.js';
import { INSIGHTS_RETENTION_DAYS } from './retention.js';

import {
  FB_DAILY_COLUMNS, fetchPageDailyFull, fetchPagePosts, fetchPageReels, invalidateFacebookPage,
} from './facebookInsights.js';

const IG_DAILY_METRICS = 'reach,views,likes,comments,saves,shares,replies,reposts,total_interactions,accounts_engaged,profile_links_taps';
const IG_DAILY_FALLBACK = 'reach,views,likes,comments,saves,shares,total_interactions,accounts_engaged';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

async function getJson(url, init) {
  const res = await fetch(url, init);
  noteYoutubeResponse(res.status, init?.headers);
  return res.json();
}

/** Runs `fn` over `items` with at most `size` in flight, preserving order. */
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

/** total_value insights for a single IST day -> { metricName: value } */
async function fetchIgDay(account, dateStr) {
  const { since, until } = istDayWindowSeconds(dateStr);
  for (const metrics of [IG_DAILY_METRICS, IG_DAILY_FALLBACK]) {
    const res = await igGet(account, `${account.page_id}/insights`, { metric: metrics, period: 'day', metric_type: 'total_value', since, until });
    if (res.data?.data?.length) {
      const out = {};
      for (const m of res.data.data) out[m.name] = num(m.total_value?.value);
      return out;
    }
    if (res.error && metrics === IG_DAILY_FALLBACK) {
      throw Object.assign(new Error(res.error.message), { status: res.error.code, reason: res.error.reason });
    }
  }
  return null;
}

/** follower_count time series for the window -> { 'YYYY-MM-DD': netChange } (value covers the day ending at end_time) */
async function fetchIgFollowerChange(account, startStr, endStr) {
  const { since } = istDayWindowSeconds(startStr);
  const { until } = istDayWindowSeconds(endStr);
  const res = await igGet(account, `${account.page_id}/insights`, { metric: 'follower_count', period: 'day', since, until });
  const out = {};
  for (const point of res.data?.data?.[0]?.values || []) {
    if (typeof point.value !== 'number' || !point.end_time) continue;
    const day = istDateString(new Date(new Date(point.end_time).getTime() - 1000));
    out[day] = (out[day] || 0) + point.value;
  }
  return out;
}

function snapshotRow(item, insights) {
  return {
    media_id: item.id,
    title: item.caption || '',
    media_type: mediaLabel(item),
    permalink: item.permalink,
    thumbnail_url: item.thumbnail_url || item.media_url || null,
    published_at: item.timestamp || null,
    ...insights,
    // like/comment counts on the media node are available even when insights are not
    likes: insights.likes ?? num(item.like_count),
    comments: insights.comments ?? num(item.comments_count),
    extra: { breakdowns: insights.breakdowns, metric_errors: insights.errors, is_shared_to_feed: item.is_shared_to_feed ?? null },
  };
}

async function fetchIgMediaSnapshots(account, limit) {
  const list = await igGet(account, 'me/media', { fields: MEDIA_FIELDS, limit });
  if (list.error) throw Object.assign(new Error(list.error.message), { status: list.error.code, reason: list.error.reason });
  return inBatches(list.data?.data || [], 4, async (item) => snapshotRow(item, await fetchMediaInsights(account, item)));
}

/** Stories are only readable for 24 hours, so every sync captures whatever is live. Unsupported setups return []. */
async function fetchIgStoriesSnapshots(account) {
  const list = await igGet(account, 'me/stories', { fields: MEDIA_FIELDS });
  if (list.error) return [];
  return inBatches(list.data?.data || [], 4, async (item) =>
    snapshotRow({ ...item, media_product_type: 'STORY' }, await fetchMediaInsights(account, { ...item, media_product_type: 'STORY' })));
}

export const IG_DAILY_COLUMNS = ['reach', 'views', 'likes', 'comments', 'saves', 'shares', 'total_interactions', 'accounts_engaged',
  'profile_links_taps', 'follower_change', 'replies', 'reposts'];
export const YT_DAILY_COLUMNS = ['views', 'likes', 'comments', 'shares', 'minutes_watched', 'subs_gained', 'subs_lost', 'engaged_views',
  'avg_view_duration', 'avg_view_percentage', 'playlist_adds', 'playlist_removes', 'dislikes', 'card_impressions', 'card_clicks', 'premium_views'];

/**
 * Upserts daily rows in one statement. `keepExisting` keeps a stored value when the new one is null
 * (LinkedIn sometimes omits a part of the day on a later read).
 */
export async function upsertDaily(table, columns, accountId, rows, { keepExisting = false } = {}) {
  if (!rows.length) return;
  const width = columns.length + 2;
  const values = [];
  const tuples = rows.map((r, i) => {
    values.push(accountId, r.metric_date, ...columns.map((c) => (r[c] !== null && typeof r[c] === 'object' && !(r[c] instanceof Date) ? JSON.stringify(r[c]) : r[c] ?? null)));
    return `(${Array.from({ length: width }, (_, j) => `$${i * width + j + 1}`).join(',')},NOW())`;
  });
  const set = columns.map((c) => (keepExisting ? `${c} = COALESCE(EXCLUDED.${c}, ${table}.${c})` : `${c} = EXCLUDED.${c}`));
  await pool.query(
    `INSERT INTO ${table} (account_id, metric_date, ${columns.join(', ')}, synced_at) VALUES ${tuples.join(',')}
     ON CONFLICT (account_id, metric_date) DO UPDATE SET ${set.join(', ')}, synced_at = NOW()`,
    values
  );
}

const SNAPSHOT_COLUMNS = ['title', 'media_type', 'permalink', 'thumbnail_url', 'published_at', 'reach', 'views', 'likes', 'comments',
  'saves', 'shares', 'reposts', 'total_interactions', 'profile_visits', 'follows', 'replies', 'link_clicks', 'skip_rate',
  'avg_watch_seconds', 'total_watch_seconds', 'duration_seconds', 'extra'];

export async function upsertMediaSnapshots(platform, accountId, capturedOn, rows) {
  if (!rows.length) return;
  const cols = ['platform', 'account_id', 'media_id', 'captured_on', ...SNAPSHOT_COLUMNS];
  const updates = SNAPSHOT_COLUMNS.map((c) => `${c}=EXCLUDED.${c}`).join(', ');
  // One statement per 50 rows instead of one per row. A media id twice in one statement is refused by Postgres, so keep the last.
  const unique = [...new Map(rows.map((r) => [r.media_id, r])).values()];
  for (let i = 0; i < unique.length; i += 50) {
    const values = [];
    const tuples = unique.slice(i, i + 50).map((r, k) => {
      values.push(platform, accountId, r.media_id, capturedOn,
        ...SNAPSHOT_COLUMNS.map((c) => (c === 'extra' ? JSON.stringify(r.extra ?? null) : r[c] ?? null)));
      return `(${cols.map((_, j) => `$${k * cols.length + j + 1}`).join(',')})`;
    });
    await pool.query(
      `INSERT INTO media_snapshots (${cols.join(',')}) VALUES ${tuples.join(',')}
       ON CONFLICT (platform, account_id, media_id, captured_on) DO UPDATE SET ${updates}`,
      values
    );
  }
}

/** Daily Instagram account rows for [start, end], shaped like ig_daily_metrics rows. */
export async function fetchIgDailyRows(account, start, end) {
  // follower_count reports the day that ends at end_time, so ask for one day past the range
  const followerByDay = await fetchIgFollowerChange(account, start, addDays(end, 1)).catch(() => ({}));
  const days = await inBatches(dateRange(start, end), 5, async (day) => ({ day, m: await fetchIgDay(account, day) }));
  return days
    .filter(({ m }) => m)
    .map(({ day, m }) => ({
      metric_date: day,
      reach: m.reach ?? null, views: m.views ?? null, likes: m.likes ?? null, comments: m.comments ?? null,
      saves: m.saves ?? null, shares: m.shares ?? null, total_interactions: m.total_interactions ?? null,
      accounts_engaged: m.accounts_engaged ?? null, profile_links_taps: m.profile_links_taps ?? null,
      follower_change: followerByDay[day] ?? null, replies: m.replies ?? null, reposts: m.reposts ?? null,
    }));
}

/** The days a sync stores: the last `days` complete days, never more than the retention window. */
function syncWindow(days, maxDays = INSIGHTS_RETENTION_DAYS) {
  const today = istDateString();
  return { today, start: addDays(today, -Math.min(days, maxDays)), end: addDays(today, -1) }; // today is incomplete
}

export async function syncInstagramAccount(account, { days = INSIGHTS_RETENTION_DAYS, mediaLimit = 40 } = {}) {
  const { today, start, end } = syncWindow(days, Math.min(INSIGHTS_RETENTION_DAYS, 30)); // Graph API caps daily history at ~30 days
  const rows = await fetchIgDailyRows(account, start, end);
  await upsertDaily('ig_daily_metrics', IG_DAILY_COLUMNS, account.id, rows);

  const media = await fetchIgMediaSnapshots(account, Math.min(mediaLimit, 100));
  const stories = await fetchIgStoriesSnapshots(account);
  await upsertMediaSnapshots('instagram', account.id, today, [...media, ...stories]);
  return { platform: 'instagram', account_id: account.id, days_synced: rows.length, media_snapshots: media.length, stories: stories.length };
}

/** Captures only the stories that are live right now (they vanish after 24 hours). */
export async function syncInstagramStories(account) {
  const stories = await fetchIgStoriesSnapshots(account);
  await upsertMediaSnapshots('instagram', account.id, istDateString(), stories);
  return { platform: 'instagram', account_id: account.id, stories: stories.length };
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

const YT_DAILY_FULL = 'views,likes,comments,shares,estimatedMinutesWatched,subscribersGained,subscribersLost,engagedViews,averageViewDuration,averageViewPercentage,videosAddedToPlaylists,videosRemovedFromPlaylists,dislikes,cardImpressions,cardClicks,redViews';
const YT_DAILY_BASIC = 'views,likes,comments,shares,estimatedMinutesWatched,subscribersGained,subscribersLost';

async function fetchYtDailyReport(headers, start, end) {
  for (const metrics of [YT_DAILY_FULL, YT_DAILY_BASIC]) {
    const url = `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${start}&endDate=${end}&dimensions=day&metrics=${metrics}&sort=day`;
    const report = await getJson(url, { headers });
    if (!report?.error) return report;
    if (metrics === YT_DAILY_BASIC) {
      throw Object.assign(new Error(report.error.message || 'YouTube Analytics error'), { status: report.error.code, reason: report.error.errors?.[0]?.reason });
    }
  }
  return null;
}

const YT_REPORT_TO_COLUMN = {
  views: 'views', likes: 'likes', comments: 'comments', shares: 'shares', estimatedMinutesWatched: 'minutes_watched',
  subscribersGained: 'subs_gained', subscribersLost: 'subs_lost', engagedViews: 'engaged_views', averageViewDuration: 'avg_view_duration',
  averageViewPercentage: 'avg_view_percentage', videosAddedToPlaylists: 'playlist_adds', videosRemovedFromPlaylists: 'playlist_removes',
  dislikes: 'dislikes', cardImpressions: 'card_impressions', cardClicks: 'card_clicks', redViews: 'premium_views',
};

async function youtubeHeaders(account) {
  const accessToken = await getGoogleAccessTokenFromRefreshToken((account.access_token || '').trim());
  return { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
}

/** Daily YouTube channel rows for [start, end], shaped like yt_daily_metrics rows. */
export async function fetchYtDailyRows(account, start, end, headers) {
  const report = await fetchYtDailyReport(headers || (await youtubeHeaders(account)), start, end);
  const cols = (report?.columnHeaders || []).map((c) => c.name);
  return (report?.rows || []).map((row) => {
    const out = { metric_date: row[cols.indexOf('day')] };
    for (const column of YT_DAILY_COLUMNS) out[column] = null;
    cols.forEach((name, i) => {
      if (YT_REPORT_TO_COLUMN[name]) out[YT_REPORT_TO_COLUMN[name]] = row[i];
    });
    return out;
  });
}

export async function syncYoutubeAccount(account, { days = INSIGHTS_RETENTION_DAYS, mediaLimit = 50 } = {}) {
  const headers = await youtubeHeaders(account);
  const { today, start, end } = syncWindow(days);
  const daily = await fetchYtDailyRows(account, start, end, headers);
  await upsertDaily('yt_daily_metrics', YT_DAILY_COLUMNS, account.id, daily);
  const daysSynced = daily.length;

  // Latest uploads, paged 50 at a time up to mediaLimit
  const ids = [];
  let pageToken = '';
  while (ids.length < mediaLimit) {
    const playlist = await getJson(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(account.playlist_id)}&maxResults=${Math.min(50, mediaLimit - ids.length)}${pageToken ? `&pageToken=${pageToken}` : ''}`,
      { headers }
    );
    ids.push(...(playlist?.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean));
    pageToken = playlist?.nextPageToken || '';
    if (!pageToken) break;
  }

  const rows = [];
  for (let i = 0; i < ids.length; i += 50) {
    const vids = await getJson(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails,status&id=${encodeURIComponent(ids.slice(i, i + 50).join(','))}`,
      { headers }
    );
    for (const v of vids?.items || []) {
      rows.push({
        media_id: v.id,
        title: v.snippet?.title || '',
        media_type: 'VIDEO',
        permalink: `https://www.youtube.com/watch?v=${v.id}`,
        thumbnail_url: v.snippet?.thumbnails?.medium?.url || null,
        published_at: v.snippet?.publishedAt || null,
        views: parseInt(v.statistics?.viewCount || '0', 10),
        likes: parseInt(v.statistics?.likeCount || '0', 10),
        comments: parseInt(v.statistics?.commentCount || '0', 10),
        duration_seconds: isoDurationToSeconds(v.contentDetails?.duration),
        extra: {
          tags: v.snippet?.tags || [],
          category_id: v.snippet?.categoryId || null,
          privacy_status: v.status?.privacyStatus || null,
          definition: v.contentDetails?.definition || null,
          has_captions: v.contentDetails?.caption === 'true',
          live_broadcast: v.snippet?.liveBroadcastContent || null,
          default_language: v.snippet?.defaultAudioLanguage || v.snippet?.defaultLanguage || null,
        },
      });
    }
  }
  await upsertMediaSnapshots('youtube', account.id, today, rows);

  return { platform: 'youtube', account_id: account.id, days_synced: daysSynced, media_snapshots: rows.length };
}

// ---------------------------------------------------------------------------
// LinkedIn company pages
// ---------------------------------------------------------------------------

export const LI_DAILY_COLUMNS = ['impressions', 'unique_impressions', 'clicks', 'likes', 'comments', 'shares', 'page_views',
  'unique_page_views', 'desktop_page_views', 'mobile_page_views', 'organic_follower_gain', 'paid_follower_gain'];

/** A working access token for a linkedin_accounts row: renewed when close to expiry or when LinkedIn rejects it early. */
export async function linkedInTokenFor(account) {
  return (await getWorkingLinkedInToken(account)).access_token;
}

/** Daily LinkedIn page rows for [start, end], shaped like li_daily_metrics rows. */
export async function fetchLiDailyRows(account, start, end, accessToken) {
  const token = accessToken || (await linkedInTokenFor(account));
  const daily = await fetchDailyStats(token, account.page_id, start, end);
  return Object.entries(daily)
    .filter(([date]) => date >= start && date <= end)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, m]) => ({ metric_date: date, ...Object.fromEntries(LI_DAILY_COLUMNS.map((c) => [c, m[c] ?? null])) }));
}

export async function syncLinkedInAccount(account, { days = INSIGHTS_RETENTION_DAYS, mediaLimit = 50 } = {}) {
  const accessToken = await linkedInTokenFor(account);
  const { today, start, end } = syncWindow(days);
  const daily = await fetchLiDailyRows(account, start, end, accessToken);
  await upsertDaily('li_daily_metrics', LI_DAILY_COLUMNS, account.id, daily, { keepExisting: true });

  const posts = await fetchPostSnapshots(accessToken, account.page_id, Math.min(mediaLimit, 100));
  await upsertMediaSnapshots('linkedin', account.id, today, posts);
  return { platform: 'linkedin', account_id: account.id, days_synced: daily.length, media_snapshots: posts.length };
}

// ---------------------------------------------------------------------------
// Facebook
// ---------------------------------------------------------------------------

/** A Facebook post in media_snapshots' shape. Extra per-post numbers ride along in `extra`. */
export function postSnapshot(p) {
  return {
    media_id: p.id, title: p.message, media_type: p.type || 'post', permalink: p.permalink, thumbnail_url: p.picture,
    published_at: p.created_time, reach: p.reach, views: p.views, likes: p.reactions, comments: p.comments, shares: p.shares,
    total_interactions: p.interactions, link_clicks: p.clicks, avg_watch_seconds: p.avg_watch_seconds,
    extra: { reactions_by_type: p.reactions_by_type, video_views: p.video_views, engagement_rate: p.engagement_rate },
  };
}

/** A Facebook reel in media_snapshots' shape (media_type REEL; views = plays). */
export function reelSnapshot(r) {
  return {
    media_id: r.id, title: r.description, media_type: 'REEL', permalink: r.permalink, thumbnail_url: r.picture,
    published_at: r.created_time, views: r.plays, likes: r.reactions, comments: r.comments, shares: r.shares,
    total_interactions: r.reactions + r.comments + r.shares, follows: r.followers_gained, avg_watch_seconds: r.avg_watch_seconds,
    total_watch_seconds: r.watch_minutes === null ? null : Math.round(r.watch_minutes * 60), duration_seconds: r.length_seconds === null ? null : Math.round(r.length_seconds),
    extra: { initial_plays: r.initial_plays, replays: r.replays },
  };
}

/** Saves a Facebook Page's last `days` days of insights, plus its posts and reels from that window. */
export async function syncFacebookPage(page, { days = INSIGHTS_RETENTION_DAYS } = {}) {
  const { today, start, end } = syncWindow(days);
  // The daily numbers decide success: a broken Page token fails here and nothing half-saved is left behind.
  const { rows } = await fetchPageDailyFull(page, start, end);
  await upsertDaily('fb_daily_metrics', FB_DAILY_COLUMNS, page.id, rows);

  // Posts and reels cover the whole stored window, so the Content tab works for any preset range.
  const { start: mediaStart } = syncWindow(INSIGHTS_RETENTION_DAYS);
  const [posts, reels] = await Promise.all([fetchPagePosts(page, mediaStart, end), fetchPageReels(page, mediaStart, end)]);
  const media = [...(posts.posts || []).map(postSnapshot), ...(reels.reels || []).map(reelSnapshot)];
  await upsertMediaSnapshots('facebook', page.id, today, media);
  invalidateFacebookPage(page);
  return {
    platform: 'facebook', account_id: page.id, days_synced: rows.length,
    media_snapshots: (posts.posts || []).length, reels: (reels.reels || []).length,
  };
}

import { pool } from '../db.js';
import { getGoogleAccessTokenFromRefreshToken } from './googleAuth.js';
import { MEDIA_FIELDS, fetchMediaInsights, igGet, mediaLabel } from './instagramApi.js';
import { isoDurationToSeconds } from '../utils/duration.js';
import { refreshIfNeeded, tokenState } from './linkedinAuth.js';
import { fetchDailyStats, fetchPostSnapshots } from './linkedinApi.js';
import { addDays, dateRange, istDateString, istDayWindowSeconds } from '../utils/dates.js';

const IG_DAILY_METRICS = 'reach,views,likes,comments,saves,shares,replies,reposts,total_interactions,accounts_engaged,profile_links_taps';
const IG_DAILY_FALLBACK = 'reach,views,likes,comments,saves,shares,total_interactions,accounts_engaged';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

async function getJson(url, init) {
  const res = await fetch(url, init);
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

const SNAPSHOT_COLUMNS = ['title', 'media_type', 'permalink', 'thumbnail_url', 'published_at', 'reach', 'views', 'likes', 'comments',
  'saves', 'shares', 'reposts', 'total_interactions', 'profile_visits', 'follows', 'replies', 'link_clicks', 'skip_rate',
  'avg_watch_seconds', 'total_watch_seconds', 'duration_seconds', 'extra'];

async function upsertMediaSnapshots(platform, accountId, capturedOn, rows) {
  const cols = ['platform', 'account_id', 'media_id', 'captured_on', ...SNAPSHOT_COLUMNS];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
  const updates = SNAPSHOT_COLUMNS.map((c) => `${c}=EXCLUDED.${c}`).join(', ');
  for (const r of rows) {
    const values = SNAPSHOT_COLUMNS.map((c) => (c === 'extra' ? JSON.stringify(r.extra ?? null) : r[c] ?? null));
    await pool.query(
      `INSERT INTO media_snapshots (${cols.join(',')}) VALUES (${placeholders})
       ON CONFLICT (platform, account_id, media_id, captured_on) DO UPDATE SET ${updates}`,
      [platform, accountId, r.media_id, capturedOn, ...values]
    );
  }
}

export async function syncInstagramAccount(account, { days = 30, mediaLimit = 40 } = {}) {
  const today = istDateString();
  const start = addDays(today, -Math.min(days, 30)); // Graph API caps daily history at ~30 days
  const end = addDays(today, -1); // today is incomplete; sync through yesterday
  const followerByDay = await fetchIgFollowerChange(account, start, today).catch(() => ({}));

  let daysSynced = 0;
  for (const day of dateRange(start, end)) {
    const m = await fetchIgDay(account, day);
    if (!m) continue;
    await pool.query(
      `INSERT INTO ig_daily_metrics
         (account_id, metric_date, reach, views, likes, comments, saves, shares, total_interactions,
          accounts_engaged, profile_links_taps, follower_change, replies, reposts, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
       ON CONFLICT (account_id, metric_date) DO UPDATE SET
         reach=EXCLUDED.reach, views=EXCLUDED.views, likes=EXCLUDED.likes, comments=EXCLUDED.comments,
         saves=EXCLUDED.saves, shares=EXCLUDED.shares, total_interactions=EXCLUDED.total_interactions,
         accounts_engaged=EXCLUDED.accounts_engaged, profile_links_taps=EXCLUDED.profile_links_taps,
         follower_change=EXCLUDED.follower_change, replies=EXCLUDED.replies, reposts=EXCLUDED.reposts, synced_at=NOW()`,
      [account.id, day, m.reach ?? null, m.views ?? null, m.likes ?? null, m.comments ?? null, m.saves ?? null,
        m.shares ?? null, m.total_interactions ?? null, m.accounts_engaged ?? null, m.profile_links_taps ?? null,
        followerByDay[day] ?? null, m.replies ?? null, m.reposts ?? null]
    );
    daysSynced += 1;
  }

  const media = await fetchIgMediaSnapshots(account, Math.min(mediaLimit, 100));
  const stories = await fetchIgStoriesSnapshots(account);
  await upsertMediaSnapshots('instagram', account.id, today, [...media, ...stories]);
  return { platform: 'instagram', account_id: account.id, days_synced: daysSynced, media_snapshots: media.length, stories: stories.length };
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

export async function syncYoutubeAccount(account, { days = 90, mediaLimit = 50 } = {}) {
  const accessToken = await getGoogleAccessTokenFromRefreshToken((account.access_token || '').trim());
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };

  const today = istDateString();
  const end = addDays(today, -1);
  const start = addDays(today, -days);

  const report = await fetchYtDailyReport(headers, start, end);
  const cols = (report.columnHeaders || []).map((c) => c.name);
  const idx = (name) => cols.indexOf(name);
  const at = (row, name) => (idx(name) === -1 ? null : row[idx(name)]);
  let daysSynced = 0;
  for (const row of report.rows || []) {
    await pool.query(
      `INSERT INTO yt_daily_metrics
         (account_id, metric_date, views, likes, comments, shares, minutes_watched, subs_gained, subs_lost,
          engaged_views, avg_view_duration, avg_view_percentage, playlist_adds, playlist_removes, dislikes,
          card_impressions, card_clicks, premium_views, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
       ON CONFLICT (account_id, metric_date) DO UPDATE SET
         views=EXCLUDED.views, likes=EXCLUDED.likes, comments=EXCLUDED.comments, shares=EXCLUDED.shares,
         minutes_watched=EXCLUDED.minutes_watched, subs_gained=EXCLUDED.subs_gained, subs_lost=EXCLUDED.subs_lost,
         engaged_views=EXCLUDED.engaged_views, avg_view_duration=EXCLUDED.avg_view_duration,
         avg_view_percentage=EXCLUDED.avg_view_percentage, playlist_adds=EXCLUDED.playlist_adds,
         playlist_removes=EXCLUDED.playlist_removes, dislikes=EXCLUDED.dislikes,
         card_impressions=EXCLUDED.card_impressions, card_clicks=EXCLUDED.card_clicks,
         premium_views=EXCLUDED.premium_views, synced_at=NOW()`,
      [account.id, row[idx('day')], at(row, 'views'), at(row, 'likes'), at(row, 'comments'), at(row, 'shares'),
        at(row, 'estimatedMinutesWatched'), at(row, 'subscribersGained'), at(row, 'subscribersLost'),
        at(row, 'engagedViews'), at(row, 'averageViewDuration'), at(row, 'averageViewPercentage'),
        at(row, 'videosAddedToPlaylists'), at(row, 'videosRemovedFromPlaylists'), at(row, 'dislikes'),
        at(row, 'cardImpressions'), at(row, 'cardClicks'), at(row, 'redViews')]
    );
    daysSynced += 1;
  }

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

const LI_DAILY_COLUMNS = ['impressions', 'unique_impressions', 'clicks', 'likes', 'comments', 'shares', 'page_views',
  'unique_page_views', 'desktop_page_views', 'mobile_page_views', 'organic_follower_gain', 'paid_follower_gain'];

/** A working access token for a linkedin_accounts row, refreshing it first when it is close to expiring. */
export async function linkedInTokenFor(account) {
  const fresh = await refreshIfNeeded(account);
  if (tokenState(fresh) === 'expired') {
    throw Object.assign(new Error('LinkedIn access expired. Reconnect LinkedIn on the Accounts page.'), { status: 401, reason: 'token_expired' });
  }
  return fresh.access_token;
}

export async function syncLinkedInAccount(account, { days = 90, mediaLimit = 50 } = {}) {
  const accessToken = await linkedInTokenFor(account);
  const orgId = account.page_id;
  const today = istDateString();
  const end = addDays(today, -1);
  const start = addDays(today, -Math.min(days, 360)); // LinkedIn keeps 12 months of daily statistics

  const daily = await fetchDailyStats(accessToken, orgId, start, end);
  let daysSynced = 0;
  for (const [date, m] of Object.entries(daily)) {
    if (date < start || date > end) continue;
    await pool.query(
      `INSERT INTO li_daily_metrics (account_id, metric_date, ${LI_DAILY_COLUMNS.join(', ')}, synced_at)
       VALUES ($1, $2, ${LI_DAILY_COLUMNS.map((_, i) => `$${i + 3}`).join(', ')}, NOW())
       ON CONFLICT (account_id, metric_date) DO UPDATE SET
         ${LI_DAILY_COLUMNS.map((c) => `${c} = COALESCE(EXCLUDED.${c}, li_daily_metrics.${c})`).join(', ')}, synced_at = NOW()`,
      [account.id, date, ...LI_DAILY_COLUMNS.map((c) => m[c] ?? null)]
    );
    daysSynced += 1;
  }

  const posts = await fetchPostSnapshots(accessToken, orgId, Math.min(mediaLimit, 100));
  await upsertMediaSnapshots('linkedin', account.id, today, posts);
  return { platform: 'linkedin', account_id: account.id, days_synced: daysSynced, media_snapshots: posts.length };
}

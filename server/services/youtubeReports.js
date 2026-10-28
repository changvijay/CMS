import { getGoogleAccessTokenFromRefreshToken } from './googleAuth.js';
import { analyzeComments } from './textAnalysis.js';
import { isoDurationToSeconds } from '../utils/duration.js';

const ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports';
const DATA = 'https://www.googleapis.com/youtube/v3';

/** Converts a YouTube Analytics report ({columnHeaders, rows}) into an array of plain objects. */
export function reportToRows(report) {
  const cols = (report?.columnHeaders || []).map((c) => c.name);
  return (report?.rows || []).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

export function apiErrorFrom(json, status) {
  const e = json?.error || {};
  return { code: e.code || status || 502, message: e.message || 'YouTube API request failed', reason: e.errors?.[0]?.reason };
}

export async function ytHeaders(account) {
  const accessToken = await getGoogleAccessTokenFromRefreshToken((account.access_token || '').trim());
  return { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
}

/** One Analytics report -> { rows } or { error }. Never throws. */
export async function runReport(headers, params) {
  try {
    const res = await fetch(`${ANALYTICS}?${new URLSearchParams({ ids: 'channel==MINE', ...params }).toString()}`, { headers });
    const json = await res.json();
    if (!res.ok || json.error) return { error: apiErrorFrom(json, res.status) };
    return { rows: reportToRows(json) };
  } catch (err) {
    return { error: { code: 502, message: `Failed to reach the YouTube API: ${err.message}` } };
  }
}

async function dataGet(headers, path, params) {
  try {
    const res = await fetch(`${DATA}/${path}?${new URLSearchParams(params).toString()}`, { headers });
    const json = await res.json();
    if (!res.ok || json.error) return { error: apiErrorFrom(json, res.status) };
    return { data: json };
  } catch (err) {
    return { error: { code: 502, message: `Failed to reach the YouTube API: ${err.message}` } };
  }
}

/** Replaces video ids in `key` with titles (adds `title`), using the Data API. Titles are optional. */
async function attachTitles(headers, rows, key) {
  const ids = [...new Set((rows || []).map((r) => r[key]).filter((v) => typeof v === 'string' && /^[\w-]{11}$/.test(v)))];
  if (!ids.length) return rows;
  const res = await dataGet(headers, 'videos', { part: 'snippet', id: ids.slice(0, 50).join(',') });
  const byId = Object.fromEntries((res.data?.items || []).map((v) => [v.id, v.snippet]));
  return rows.map((r) => ({ ...r, title: byId[r[key]]?.title || r.title, thumbnail_url: byId[r[key]]?.thumbnails?.default?.url || r.thumbnail_url || null }));
}

/**
 * Every report is declared once. `groups` lets the UI ask only for what a tab needs.
 * Detail reports (search terms etc.) require a sort and maxResults per the API.
 */
export function reportDefinitions(range) {
  const top = { sort: '-views', maxResults: '25' };
  return {
    overview: {
      channel_totals: { ...range, metrics: 'engagedViews,views,redViews,comments,likes,dislikes,videosAddedToPlaylists,videosRemovedFromPlaylists,shares,estimatedMinutesWatched,estimatedRedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost' },
      cards: { ...range, metrics: 'cardImpressions,cardClicks,cardClickRate,cardTeaserImpressions,cardTeaserClicks,cardTeaserClickRate' },
      content_types: { ...range, dimensions: 'creatorContentType', metrics: 'engagedViews,views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,shares' }, // playlist metrics are rejected with this dimension (400)
      subscribed_status: { ...range, dimensions: 'subscribedStatus', metrics: 'engagedViews,views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,shares' },
    },
    audience: {
      countries: { ...range, dimensions: 'country', metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage', sort: '-views', maxResults: '15' },
      cities: { ...range, dimensions: 'city', metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,engagedViews', ...top },
      devices: { ...range, dimensions: 'deviceType', metrics: 'views,estimatedMinutesWatched,engagedViews', sort: '-views' },
      operating_systems: { ...range, dimensions: 'operatingSystem', metrics: 'views,estimatedMinutesWatched,engagedViews', sort: '-views' },
      demographics: { ...range, dimensions: 'ageGroup,gender', metrics: 'viewerPercentage' },
    },
    acquisition: {
      traffic_sources: { ...range, dimensions: 'insightTrafficSourceType', metrics: 'views,estimatedMinutesWatched,engagedViews', sort: '-views' },
      search_terms: { ...range, dimensions: 'insightTrafficSourceDetail', metrics: 'views,estimatedMinutesWatched,engagedViews', filters: 'insightTrafficSourceType==YT_SEARCH', ...top },
      external_sites: { ...range, dimensions: 'insightTrafficSourceDetail', metrics: 'views,estimatedMinutesWatched,engagedViews', filters: 'insightTrafficSourceType==EXT_URL', ...top },
      related_videos: { ...range, dimensions: 'insightTrafficSourceDetail', metrics: 'views,estimatedMinutesWatched,engagedViews', filters: 'insightTrafficSourceType==RELATED_VIDEO', ...top },
      playback_locations: { ...range, dimensions: 'insightPlaybackLocationType', metrics: 'views,estimatedMinutesWatched,engagedViews', sort: '-views' },
      embedded_sites: { ...range, dimensions: 'insightPlaybackLocationDetail', metrics: 'views,estimatedMinutesWatched,engagedViews', filters: 'insightPlaybackLocationType==EMBEDDED', ...top },
      sharing_services: { ...range, dimensions: 'sharingService', metrics: 'shares', sort: '-shares' },
    },
  };
}

export const REPORT_GROUPS = ['overview', 'audience', 'acquisition'];

export async function fetchYoutubeBreakdowns(account, startDate, endDate, groups = REPORT_GROUPS) {
  const headers = await ytHeaders(account);
  const defs = reportDefinitions({ startDate, endDate });
  const wanted = Object.assign({}, ...groups.filter((g) => defs[g]).map((g) => defs[g]));
  const keys = Object.keys(wanted);
  const results = await Promise.all(keys.map((k) => runReport(headers, wanted[k])));
  const out = Object.fromEntries(keys.map((k, i) => [k, results[i]]));

  if (out.related_videos?.rows) out.related_videos.rows = await attachTitles(headers, out.related_videos.rows, 'insightTrafficSourceDetail');
  return out;
}

/**
 * Analytics can't break down by video and creatorContentType together (400 "query is not supported"), so the format comes from
 * the Data API instead: live streams carry liveStreamingDetails, and Shorts are the videos of up to 3 minutes.
 */
export function classifyContentType(video) {
  if (!video) return null;
  if (video.liveStreamingDetails) return 'LIVE_STREAM';
  const seconds = isoDurationToSeconds(video.contentDetails?.duration);
  if (seconds === null || seconds === undefined) return null;
  return seconds <= 180 ? 'SHORTS' : 'VIDEO_ON_DEMAND';
}

/** Per-video analytics for up to 200 videos, merged with Data API details (length, tags, publish date). */
export async function fetchVideoAnalytics(account, startDate, endDate, limit = 200) {
  const headers = await ytHeaders(account);
  const report = await runReport(headers, {
    startDate, endDate, dimensions: 'video', sort: '-views', maxResults: String(Math.min(limit, 200)),
    metrics: 'engagedViews,views,comments,likes,dislikes,videosAddedToPlaylists,videosRemovedFromPlaylists,shares,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost',
  });
  if (report.error) return report;

  const details = {};
  const ids = report.rows.map((r) => r.video);
  for (let i = 0; i < ids.length; i += 50) {
    const res = await dataGet(headers, 'videos', { part: 'snippet,contentDetails,statistics,liveStreamingDetails', id: ids.slice(i, i + 50).join(',') });
    for (const v of res.data?.items || []) details[v.id] = v;
  }
  return {
    rows: report.rows.map((r) => {
      const d = details[r.video];
      return {
        ...r,
        creatorContentType: classifyContentType(d),
        title: d?.snippet?.title || r.video,
        thumbnail_url: d?.snippet?.thumbnails?.medium?.url || null,
        published_at: d?.snippet?.publishedAt || null,
        duration_seconds: isoDurationToSeconds(d?.contentDetails?.duration),
        tags: d?.snippet?.tags || [],
        lifetime_views: d ? Number(d.statistics?.viewCount ?? 0) : null,
      };
    }),
  };
}

/** Audience retention curve for one video: how much of the audience is still watching at each point. */
export async function fetchRetention(account, videoId, startDate, endDate) {
  const headers = await ytHeaders(account);
  return runReport(headers, {
    startDate, endDate, dimensions: 'elapsedVideoTimeRatio', filters: `video==${videoId}`,
    metrics: 'audienceWatchRatio,relativeRetentionPerformance,startedWatching,stoppedWatching,totalSegmentImpressions',
  });
}

/** Revenue needs the monetary scope and Partner Program membership; failures come back as { error } per report. */
export async function fetchRevenue(account, startDate, endDate) {
  const headers = await ytHeaders(account);
  const range = { startDate, endDate };
  const [totals, daily, topVideos] = await Promise.all([
    runReport(headers, { ...range, metrics: 'estimatedRevenue,estimatedAdRevenue,estimatedRedPartnerRevenue,grossRevenue,cpm,playbackBasedCpm,adImpressions,monetizedPlaybacks' }),
    runReport(headers, { ...range, dimensions: 'day', metrics: 'estimatedRevenue', sort: 'day' }),
    runReport(headers, { ...range, dimensions: 'video', metrics: 'estimatedRevenue,views', sort: '-estimatedRevenue', maxResults: '10' }),
  ]);
  if (topVideos.rows) topVideos.rows = await attachTitles(headers, topVideos.rows, 'video');
  return { totals, daily, top_videos: topVideos };
}

/** The channel's playlists with their performance. */
export async function fetchPlaylists(account, startDate, endDate) {
  const headers = await ytHeaders(account);
  const list = await dataGet(headers, 'playlists', { part: 'snippet,contentDetails', mine: 'true', maxResults: '25' });
  if (list.error) return list;
  const items = list.data?.items || [];
  const stats = await Promise.all(items.slice(0, 15).map((p) =>
    runReport(headers, {
      startDate, endDate, filters: `playlist==${p.id}`,
      metrics: 'views,estimatedMinutesWatched,averageViewDuration,playlistStarts,playlistViews,viewsPerPlaylistStart,averageTimeInPlaylist,playlistSaves',
    })));
  return {
    rows: items.map((p, i) => ({
      id: p.id,
      title: p.snippet?.title || '',
      item_count: p.contentDetails?.itemCount ?? null,
      thumbnail_url: p.snippet?.thumbnails?.default?.url || null,
      stats: stats[i] ? (stats[i].error ? { error: stats[i].error } : stats[i].rows?.[0] || null) : null,
    })),
  };
}

/**
 * Comments on public videos are public data. With YOUTUBE_API_KEY set they are read with the key alone, so the channel's
 * Google token does not need the youtube.force-ssl permission (the saved token usually only has youtube.readonly).
 */
export async function fetchYoutubeComments(account, videoId, env = process.env) {
  const apiKey = String(env.YOUTUBE_API_KEY ?? '').trim();
  const params = { part: 'snippet', videoId, maxResults: '100', order: 'relevance', textFormat: 'plainText' };
  const res = apiKey
    ? await dataGet({ Accept: 'application/json' }, 'commentThreads', { ...params, key: apiKey })
    : await dataGet(await ytHeaders(account), 'commentThreads', params);
  if (res.error) return res;
  const comments = (res.data?.items || []).map((t) => ({
    text: t.snippet?.topLevelComment?.snippet?.textDisplay || '',
    like_count: t.snippet?.topLevelComment?.snippet?.likeCount || 0,
    username: t.snippet?.topLevelComment?.snippet?.authorDisplayName || null,
    reply_count: t.snippet?.totalReplyCount || 0,
  }));
  return { analysis: analyzeComments(comments), sample_size: comments.length };
}

/** Public channel info + lifetime counters (cheap single call, no Analytics report). */
export async function fetchYoutubeChannel(account) {
  const headers = await ytHeaders(account);
  const res = await dataGet(headers, 'channels', { part: 'snippet,statistics', mine: 'true' });
  if (res.error) {
    throw Object.assign(new Error(res.error.message), { status: res.error.code, reason: res.error.reason });
  }
  const item = res.data?.items?.[0];
  if (!item) throw Object.assign(new Error('YouTube returned no channel for this token.'), { status: 404 });
  return {
    title: item.snippet?.title || '',
    description: item.snippet?.description || '',
    custom_url: item.snippet?.customUrl || null,
    country: item.snippet?.country || null,
    published_at: item.snippet?.publishedAt || null,
    thumbnail_url: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null,
    subscriber_count: item.statistics?.hiddenSubscriberCount ? null : Number(item.statistics?.subscriberCount ?? 0),
    view_count: Number(item.statistics?.viewCount ?? 0),
    video_count: Number(item.statistics?.videoCount ?? 0),
  };
}

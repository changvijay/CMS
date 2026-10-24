/**
 * Instagram API (Instagram Login) helpers.
 * Network calls return { data } or { error: { code, message, reason } } and never throw,
 * so one unsupported metric can't take down a whole page.
 * The parsers below are pure and unit-tested.
 */
const BASE = 'https://graph.instagram.com/v24.0';

export function toApiError(json, status) {
  const e = json?.error || {};
  return { code: e.code || status || 502, message: e.message || 'Instagram API error', reason: e.type };
}

export async function igGet(account, path, params = {}) {
  const qs = new URLSearchParams({ ...params, access_token: account.access_token });
  try {
    const res = await fetch(`${BASE}/${path}?${qs.toString()}`);
    const json = await res.json();
    if (!res.ok || json.error) return { error: toApiError(json, res.status) };
    return { data: json };
  } catch (err) {
    return { error: { code: 502, message: `Failed to reach the Instagram API: ${err.message}` } };
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** { metricName: number } from an insights response (handles values[] and total_value shapes). */
export function parseInsightValues(json) {
  const out = {};
  for (const m of json?.data || []) {
    const v = num(m.total_value?.value) ?? num(m.values?.[0]?.value);
    if (v !== null) out[m.name] = v;
  }
  return out;
}

/** [{ label, value }] for a breakdown response, labels joined when there are several dimensions. */
export function parseBreakdown(json) {
  const results = json?.data?.[0]?.total_value?.breakdowns?.[0]?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((r) => ({ label: (r.dimension_values || []).join(' / '), value: Number(r.value) || 0 }))
    .filter((r) => r.label)
    .sort((a, b) => b.value - a.value);
}

/** Instagram reports skip rate either as a fraction or a percentage; real skip rates are never under 1%. */
export function normalizeSkipRate(v) {
  if (v === null || v === undefined) return null;
  return Math.round((v <= 1 ? v * 100 : v) * 10) / 10;
}

const REELS = ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'reposts', 'total_interactions',
  'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate'];
const FEED = ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'reposts', 'total_interactions', 'follows', 'profile_visits'];
const STORY = ['reach', 'views', 'shares', 'reposts', 'total_interactions', 'follows', 'profile_visits', 'replies', 'link_clicks'];

/** Which insight metrics (and breakdown-only metrics) apply to a media item. */
export function metricsForMedia(item) {
  if (item.media_product_type === 'STORY') {
    return { kind: 'STORY', metrics: STORY, breakdowns: [{ metric: 'navigation', breakdown: 'story_navigation_action_type' }, { metric: 'profile_activity', breakdown: 'action_type' }] };
  }
  if (item.media_product_type === 'REELS') return { kind: 'REEL', metrics: REELS, breakdowns: [] };
  return { kind: item.media_type || 'FEED', metrics: FEED, breakdowns: [{ metric: 'profile_activity', breakdown: 'action_type' }] };
}

/** Raw insight values -> the typed columns we store (watch time ms -> seconds, skip rate -> percent). */
export function shapeMediaMetrics(values) {
  const seconds = (ms) => (ms === undefined ? null : Math.round((ms / 1000) * 10) / 10);
  return {
    reach: values.reach ?? null,
    views: values.views ?? null,
    likes: values.likes ?? null,
    comments: values.comments ?? null,
    saves: values.saved ?? null,
    shares: values.shares ?? null,
    reposts: values.reposts ?? null,
    total_interactions: values.total_interactions ?? null,
    follows: values.follows ?? null,
    profile_visits: values.profile_visits ?? null,
    replies: values.replies ?? null,
    link_clicks: values.link_clicks ?? null,
    skip_rate: normalizeSkipRate(values.reels_skip_rate),
    avg_watch_seconds: seconds(values.ig_reels_avg_watch_time),
    total_watch_seconds: seconds(values.ig_reels_video_view_total_time),
  };
}

/**
 * Fetches every applicable insight for one media item.
 * Tries all metrics in one call; if Instagram rejects the set, retries each metric alone and records which failed.
 */
export async function fetchMediaInsights(account, item) {
  const plan = metricsForMedia(item);
  let values = {};
  const errors = [];

  const all = await igGet(account, `${item.id}/insights`, { metric: plan.metrics.join(',') });
  if (all.data) {
    values = parseInsightValues(all.data);
  } else {
    const each = await Promise.all(plan.metrics.map(async (metric) => ({ metric, res: await igGet(account, `${item.id}/insights`, { metric }) })));
    for (const { metric, res } of each) {
      if (res.data) Object.assign(values, parseInsightValues(res.data));
      else errors.push({ metric, ...res.error });
    }
  }

  const breakdowns = {};
  await Promise.all(plan.breakdowns.map(async ({ metric, breakdown }) => {
    const res = await igGet(account, `${item.id}/insights`, { metric, breakdown, metric_type: 'total_value' });
    if (res.data) breakdowns[metric] = parseBreakdown(res.data);
    else errors.push({ metric, ...res.error });
  }));

  return { kind: plan.kind, ...shapeMediaMetrics(values), breakdowns, errors };
}

export const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,permalink,like_count,comments_count,shortcode,is_comment_enabled,is_shared_to_feed';

/** Our storage label for a media item. */
export function mediaLabel(item) {
  if (item.media_product_type === 'REELS') return 'REEL';
  if (item.media_product_type === 'STORY') return 'STORY';
  return item.media_type || 'POST';
}

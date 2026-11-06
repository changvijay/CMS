/**
 * Facebook Page insights, read live from the Graph API with the stored Page token.
 * Meta renames Page metrics now and then (e.g. page_impressions -> page_media_view in late 2025), so each metric
 * lists its names newest first and the first one Facebook accepts is used. A metric Facebook refuses entirely is
 * reported as unavailable instead of failing the whole page.
 */
import { fbGet } from './facebookApi.js';
import { createTtlCache } from '../utils/ttlCache.js';
import { pool } from '../db.js';
import { isStoredRange } from './retention.js';
import { addDays, daysBetween, istDateString } from '../utils/dates.js';

/**
 * `kind`: 'sum' adds the days up; 'total' is a running total (the last day is the value);
 * 'split' values are objects (e.g. reactions by type) that are also kept per key.
 * `scale` turns Facebook's unit into ours (video view time arrives in milliseconds).
 */
export const PAGE_METRICS = [
  { key: 'views', names: ['page_media_view', 'page_impressions'] },
  { key: 'reach', names: ['page_total_media_view_unique', 'page_impressions_unique'] },
  { key: 'engagements', names: ['page_post_engagements'] },
  { key: 'reactions', names: ['page_actions_post_reactions_total'], kind: 'split' },
  { key: 'follows', names: ['page_daily_follows_unique', 'page_fan_adds_unique'] },
  { key: 'unfollows', names: ['page_daily_unfollows_unique', 'page_fan_removes_unique'] },
  { key: 'followers_total', names: ['page_follows', 'page_fans'], kind: 'total' },
  { key: 'page_visits', names: ['page_views_total'] },
  { key: 'actions', names: ['page_total_actions'] },
  { key: 'new_conversations', names: ['page_messages_new_conversations_unique'] },
  { key: 'video_views', names: ['page_video_views'] },
  { key: 'video_views_organic', names: ['page_video_views_organic'] },
  { key: 'video_views_paid', names: ['page_video_views_paid'] },
  { key: 'video_autoplayed', names: ['page_video_views_autoplayed'] },
  { key: 'video_click_to_play', names: ['page_video_views_click_to_play'] },
  { key: 'video_complete_30s', names: ['page_video_complete_views_30s'] },
  { key: 'video_repeat_views', names: ['page_video_repeat_views'] },
  { key: 'watch_minutes', names: ['page_video_view_time'], scale: 1 / 60000 },
];

export const METRIC_KEYS = PAGE_METRICS.map((m) => m.key);
const BY_KEY = Object.fromEntries(PAGE_METRICS.map((m) => [m.key, m]));

/** Graph allows about 90 days per insights call. */
const CHUNK_DAYS = 90;
export const MAX_DAYS = 366;
const TTL_MS = 2 * 60 * 1000;
/** A finished past period (the "vs previous" comparison) doesn't change, so it is kept longer. */
const PAST_TTL_MS = 6 * 60 * 60 * 1000;
const cache = createTtlCache({ maxEntries: 300 });

/** [since, until] split into windows of at most CHUNK_DAYS days. */
export function chunkRange(since, until, size = CHUNK_DAYS) {
  const out = [];
  for (let s = since; s <= until; s = addDays(s, size)) {
    const e = addDays(s, size - 1);
    out.push([s, e < until ? e : until]);
  }
  return out;
}

/**
 * A daily value's end_time is the end of that day in Pacific time (the next day at 07:00/08:00 UTC),
 * so the day it describes is the date before end_time's date.
 */
export function valueDate(endTime) {
  return addDays(String(endTime).slice(0, 10), -1);
}

const objectSum = (o) => Object.values(o).reduce((a, b) => a + (Number(b) || 0), 0);
const round1 = (v) => Math.round(v * 10) / 10;

/** Graph `values` -> Map(date -> number). Object values (breakdowns by type) are summed. */
export function valuesByDate(values = []) {
  const out = new Map();
  for (const v of values) {
    if (!v?.end_time) continue;
    const n = typeof v.value === 'number' ? v.value : v.value && typeof v.value === 'object' ? objectSum(v.value) : 0;
    out.set(valueDate(v.end_time), n);
  }
  return out;
}

/** Object values summed per key over the days in range, e.g. { like: 12, love: 3 }. */
function splitTotals(values = [], since, until) {
  const out = {};
  for (const v of values) {
    if (!v?.end_time || !v.value || typeof v.value !== 'object') continue;
    const d = valueDate(v.end_time);
    if (d < since || d > until) continue;
    for (const [k, n] of Object.entries(v.value)) out[k] = (out[k] || 0) + (Number(n) || 0);
  }
  return out;
}

/** One insights request per chunk for the given metric names. Returns { series: Map(name -> values[]) } or { error }. */
async function fetchNames(page, names, since, until, get) {
  const series = new Map(names.map((n) => [n, []]));
  for (const [s, e] of chunkRange(since, until)) {
    // `until` is exclusive on Graph's side, so ask for one day more.
    const r = await get(`${page.page_id}/insights`, page.page_access_token, { metric: names.join(','), period: 'day', since: s, until: addDays(e, 1) });
    if (r.error) return { error: r.error };
    for (const d of r.data.data || []) if (series.has(d.name)) series.get(d.name).push(...(d.values || []));
  }
  return { series };
}

const fatal = (err) => Number(err?.code) === 190 || err?.retryable;

/**
 * Daily rows for every metric, oldest first, plus which metrics were unavailable and why.
 * All current names are asked for in one call; if Facebook refuses that, each metric is tried on its own
 * (newest name first) so one renamed metric doesn't hide the rest.
 */
export async function fetchPageDaily(page, since, until, { get = fbGet } = {}) {
  const found = {}; // key -> { name, values }
  const batch = await fetchNames(page, PAGE_METRICS.map((m) => m.names[0]), since, until, get);
  if (!batch.error) {
    for (const m of PAGE_METRICS) {
      const values = batch.series.get(m.names[0]);
      if (values?.length) found[m.key] = { name: m.names[0], values };
    }
  } else if (fatal(batch.error)) {
    throw Object.assign(new Error(batch.error.message), { status: Number(batch.error.code) === 190 ? 401 : 502 });
  }

  const unavailable = [];
  await Promise.all(PAGE_METRICS.filter((m) => !found[m.key]).map(async (m) => {
    let lastError = null;
    for (const name of m.names) {
      const r = await fetchNames(page, [name], since, until, get);
      if (!r.error) { found[m.key] = { name, values: r.series.get(name) }; return; }
      lastError = r.error;
      if (fatal(r.error)) break;
    }
    unavailable.push({ metric: m.key, code: lastError?.code, message: lastError?.message });
  }));

  if (!Object.keys(found).length) {
    const first = unavailable[0];
    throw Object.assign(new Error(first?.message || 'Facebook did not return any insights.'), { status: Number(first?.code) === 190 ? 401 : 502 });
  }

  const rows = [];
  for (let d = since; d <= until; d = addDays(d, 1)) rows.push({ date: d });
  const metrics = {};
  const splits = {};
  for (const m of PAGE_METRICS) {
    const f = found[m.key];
    if (!f) continue;
    metrics[m.key] = f.name;
    const byDate = valuesByDate(f.values);
    let last = null;
    for (const row of rows) {
      const raw = byDate.get(row.date);
      if (m.kind === 'total') {
        // A running total carries over days Facebook skipped.
        if (raw !== undefined) last = raw;
        row[m.key] = last;
      } else {
        row[m.key] = raw === undefined ? 0 : m.scale ? round1(raw * m.scale) : raw;
      }
    }
    if (m.kind === 'split') {
      splits[m.key] = splitTotals(f.values, since, until);
      const perDay = new Map(f.values.filter((v) => v?.end_time && v.value && typeof v.value === 'object').map((v) => [valueDate(v.end_time), v.value]));
      for (const row of rows) row[`${m.key}_by_type`] = perDay.get(row.date) ?? null;
    }
  }
  unavailable.sort((a, b) => METRIC_KEYS.indexOf(a.metric) - METRIC_KEYS.indexOf(b.metric));
  return { rows, metrics, unavailable, splits };
}

/** Sum of each metric over the rows ('total' metrics take the last known value). */
export function totalsOf(rows, keys) {
  return Object.fromEntries(keys.map((k) => {
    if (BY_KEY[k]?.kind === 'total') {
      const last = [...rows].reverse().find((r) => r[k] !== null && r[k] !== undefined);
      return [k, last ? Number(last[k]) : 0];
    }
    const total = rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    return [k, BY_KEY[k]?.scale ? round1(total) : total];
  }));
}

/** { current, previous, change_pct } per metric; change_pct is null when there is no previous value. */
export function deltasOf(current, previous) {
  return Object.fromEntries(Object.keys(current).map((k) => {
    const p = previous?.[k];
    const pct = p ? Math.round(((current[k] - p) / p) * 1000) / 10 : null;
    return [k, { current: current[k], previous: p ?? 0, change_pct: pct }];
  }));
}

/** The equal-length period just before [since, until]. */
export function previousRange(since, until) {
  const span = daysBetween(since, until) + 1;
  const prevUntil = addDays(since, -1);
  return { since: addDays(prevUntil, -(span - 1)), until: prevUntil };
}

/** Views split by a breakdown (is_from_followers / is_from_ads) per day: Map(date -> { '0': n, '1': n }), or null if refused. */
export async function fetchViewsBreakdownDaily(page, breakdown, since, until, { get = fbGet } = {}) {
  const out = new Map();
  for (const [s, e] of chunkRange(since, until)) {
    const r = await get(`${page.page_id}/insights`, page.page_access_token, { metric: 'page_media_view', period: 'day', breakdown, since: s, until: addDays(e, 1) });
    if (r.error) return null;
    for (const v of r.data.data?.[0]?.values || []) {
      const d = valueDate(v.end_time);
      if (d < since || d > until || v[breakdown] === undefined) continue;
      const day = out.get(d) || {};
      day[v[breakdown]] = (day[v[breakdown]] || 0) + (Number(v.value) || 0);
      out.set(d, day);
    }
  }
  return out;
}

/** Views split by a breakdown, summed over the range: { '0': n, '1': n }. */
export async function fetchViewsBreakdown(page, breakdown, since, until, opts) {
  const daily = await fetchViewsBreakdownDaily(page, breakdown, since, until, opts);
  if (!daily) return null;
  const out = {};
  for (const day of daily.values()) for (const [k, n] of Object.entries(day)) out[k] = (out[k] || 0) + n;
  return out;
}

/** Columns of fb_daily_metrics besides account_id / metric_date: every metric plus the per-day breakdowns. */
export const BREAKDOWN_COLUMNS = ['views_followers', 'views_non_followers', 'views_organic', 'views_ads'];
export const FB_DAILY_COLUMNS = [...METRIC_KEYS, ...BREAKDOWN_COLUMNS, 'reactions_by_type'];

/**
 * Daily rows straight from Facebook with the breakdowns merged in, in the shape stored in fb_daily_metrics.
 * Metrics Facebook refused are null (not 0), so a stored day still tells "no data" from "zero".
 */
export async function fetchPageDailyFull(page, since, until, { get = fbGet } = {}) {
  const [daily, followers, ads] = await Promise.all([
    fetchPageDaily(page, since, until, { get }),
    fetchViewsBreakdownDaily(page, 'is_from_followers', since, until, { get }),
    fetchViewsBreakdownDaily(page, 'is_from_ads', since, until, { get }),
  ]);
  const rows = daily.rows.map((r) => {
    const out = { metric_date: r.date };
    for (const k of METRIC_KEYS) out[k] = daily.metrics[k] ? r[k] ?? null : null;
    const f = followers?.get(r.date);
    const a = ads?.get(r.date);
    out.views_followers = followers ? f?.['1'] ?? 0 : null;
    out.views_non_followers = followers ? f?.['0'] ?? 0 : null;
    out.views_organic = ads ? a?.['0'] ?? 0 : null;
    out.views_ads = ads ? a?.['1'] ?? 0 : null;
    out.reactions_by_type = r.reactions_by_type ?? null;
    return out;
  });
  return { rows, unavailable: daily.unavailable };
}

/** Daily rows straight from Facebook, briefly cached so the Facebook page and the Overview share one set of calls. */
export function cachedPageDaily(page, since, until, { past = false } = {}) {
  return cache.getOrLoad(`${page.id}:daily:${since}:${until}`, past ? PAST_TTL_MS : TTL_MS, () => fetchPageDailyFull(page, since, until));
}

/** Saved rows for [since, until], oldest first, as plain numbers. */
export async function loadStoredFacebookDaily(pageIds, since, until, db = pool) {
  if (!pageIds.length) return [];
  const { rows } = await db.query(
    'SELECT * FROM fb_daily_metrics WHERE account_id = ANY($1) AND metric_date BETWEEN $2 AND $3 ORDER BY metric_date',
    [pageIds.map(Number), since, until]
  );
  return rows.map((r) => {
    const out = { account_id: String(r.account_id), metric_date: r.metric_date instanceof Date ? istDateString(r.metric_date) : String(r.metric_date).slice(0, 10), synced_at: r.synced_at };
    for (const c of FB_DAILY_COLUMNS) out[c] = c === 'reactions_by_type' ? r[c] : r[c] === null || r[c] === undefined ? null : Number(r[c]);
    return out;
  });
}

/**
 * One Page's daily rows: from the database for preset ranges inside the stored window (7/14/30 days),
 * straight from Facebook for custom ranges or when nothing is saved yet. `source` says which.
 */
export async function loadFacebookDaily(page, since, until, { live = false, past = false } = {}) {
  if (!live && isStoredRange(since, until)) {
    const stored = await loadStoredFacebookDaily([page.id], since, until);
    if (stored.length) return { source: 'stored', rows: stored, unavailable: [] };
  }
  const fresh = await cachedPageDaily(page, since, until, { past });
  return { source: 'live', rows: fresh.rows.map((r) => ({ ...r, account_id: String(page.id) })), unavailable: fresh.unavailable };
}

const sumCol = (rows, c) => rows.reduce((a, r) => a + (Number(r[c]) || 0), 0);
const hasCol = (rows, c) => rows.some((r) => r[c] !== null && r[c] !== undefined);

/** Everything the daily view needs: rows, totals, deltas against the period before, and the breakdowns. */
export async function buildDailyReport(page, since, until, { live = false } = {}) {
  const prev = previousRange(since, until);
  const [current, previous] = await Promise.all([
    loadFacebookDaily(page, since, until, { live }),
    // The comparison period is a nice-to-have: if Facebook refuses it (too old), show no deltas.
    loadFacebookDaily(page, prev.since, prev.until, { live, past: true }).catch(() => null),
  ]);
  // One row per day of the range, so charts have no gaps (days Facebook skipped count as nothing happened).
  const byDate = new Map(current.rows.map((r) => [r.metric_date, r]));
  const daily = [];
  for (let d = since; d <= until; d = addDays(d, 1)) {
    const r = byDate.get(d);
    daily.push({ date: d, ...Object.fromEntries(METRIC_KEYS.map((k) => [k, r ? r[k] : null])) });
  }
  const keys = METRIC_KEYS.filter((k) => hasCol(current.rows, k));
  // Running totals (followers) carry over missing days; other metrics count a missing day as 0.
  for (const k of keys) {
    let last = null;
    for (const row of daily) {
      if (BY_KEY[k]?.kind === 'total') { if (row[k] !== null) last = row[k]; row[k] = last; } else if (row[k] === null) row[k] = 0;
    }
  }
  for (const k of METRIC_KEYS.filter((x) => !keys.includes(x))) for (const row of daily) delete row[k];

  const totals = totalsOf(daily, keys);
  const previousTotals = previous?.rows.length ? totalsOf(previous.rows, keys) : null;
  const reactions = {};
  for (const r of current.rows) for (const [t, n] of Object.entries(r.reactions_by_type || {})) reactions[t] = (reactions[t] || 0) + (Number(n) || 0);
  const lastSynced = current.source === 'stored'
    ? current.rows.reduce((m, r) => (r.synced_at && (!m || new Date(r.synced_at) > new Date(m)) ? r.synced_at : m), null)
    : null;
  const unavailable = current.unavailable.length
    ? current.unavailable
    : METRIC_KEYS.filter((k) => !keys.includes(k)).map((k) => ({ metric: k, code: null, message: 'Facebook did not return this metric for the saved days.' }));

  return {
    account_id: page.id,
    source: current.source,
    last_synced_at: lastSynced,
    range: { since, until, days: daily.length, previous_since: prev.since, previous_until: prev.until },
    fetched_at: new Date().toISOString(),
    metrics: Object.fromEntries(keys.map((k) => [k, BY_KEY[k].names[0]])),
    unavailable,
    totals,
    deltas: deltasOf(totals, previousTotals),
    breakdowns: {
      reactions: Object.keys(reactions).length || hasCol(current.rows, 'reactions') ? reactions : null,
      views_by_audience: hasCol(current.rows, 'views_followers') ? { followers: sumCol(current.rows, 'views_followers'), non_followers: sumCol(current.rows, 'views_non_followers') } : null,
      views_by_source: hasCol(current.rows, 'views_organic') ? { organic: sumCol(current.rows, 'views_organic'), ads: sumCol(current.rows, 'views_ads') } : null,
    },
    daily,
  };
}

export async function fetchPageProfile(page, { get = fbGet } = {}) {
  const r = await get(page.page_id, page.page_access_token, {
    fields: 'id,name,username,about,category,link,website,followers_count,fan_count,talking_about_count,checkins,rating_count,overall_star_rating,verification_status,picture{url},cover{source}',
  });
  if (r.error) throw Object.assign(new Error(r.error.message), { status: Number(r.error.code) === 190 ? 401 : 502 });
  const p = r.data;
  return {
    id: page.id,
    page_id: page.page_id,
    name: p.name || page.name,
    username: p.username || null,
    about: p.about || null,
    category: p.category || null,
    link: p.link || `https://www.facebook.com/${page.page_id}`,
    website: p.website || null,
    followers: p.followers_count ?? null,
    likes: p.fan_count ?? null,
    talking_about: p.talking_about_count ?? null,
    checkins: p.checkins ?? null,
    rating_count: p.rating_count ?? null,
    rating: p.overall_star_rating || null,
    verified: p.verification_status ? p.verification_status !== 'not_verified' : null,
    picture_url: p.picture?.data?.url || page.picture_url || null,
    cover_url: p.cover?.source || null,
  };
}

/** Lifetime insights from a field expansion -> { metric: value }. Posts also return day values; those are skipped. */
function lifetimeValues(insights) {
  const out = {};
  for (const d of insights?.data || []) {
    if (d.period && d.period !== 'lifetime') continue;
    if (d.id && !d.id.endsWith('/lifetime')) continue;
    out[d.name] = d.values?.[0]?.value ?? null;
  }
  return out;
}

const POST_INSIGHTS = ['post_media_view', 'post_total_media_view_unique', 'post_clicks', 'post_reactions_by_type_total', 'post_video_views', 'post_video_avg_time_watched'];
const POST_FIELDS = 'id,message,created_time,permalink_url,full_picture,status_type,shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)';

const istSeconds = (date) => Math.floor(new Date(`${date}T00:00:00+05:30`).getTime() / 1000);

export function shapePost(p) {
  const ins = lifetimeValues(p.insights);
  const reactions = p.reactions?.summary?.total_count ?? objectSum(ins.post_reactions_by_type_total || {});
  const comments = p.comments?.summary?.total_count ?? 0;
  const shares = p.shares?.count ?? 0;
  const clicks = Number(ins.post_clicks) || 0;
  const views = ins.post_media_view ?? null;
  const reach = ins.post_total_media_view_unique ?? null;
  const interactions = reactions + comments + shares;
  return {
    id: p.id,
    message: p.message || null,
    created_time: p.created_time,
    permalink: p.permalink_url || null,
    picture: p.full_picture || null,
    type: p.status_type || null,
    views,
    reach,
    clicks,
    reactions,
    reactions_by_type: ins.post_reactions_by_type_total || null,
    comments,
    shares,
    interactions,
    video_views: ins.post_video_views ?? null,
    avg_watch_seconds: ins.post_video_avg_time_watched ? round1(ins.post_video_avg_time_watched / 1000) : null,
    // Interactions + clicks per person reached.
    engagement_rate: reach ? round1(((interactions + clicks) / reach) * 100) : null,
  };
}

/** Posts published in [since, until] (IST dates), newest first, with their own insights. */
export async function fetchPagePosts(page, since, until, { get = fbGet, maxPages = 4 } = {}) {
  const base = { since: istSeconds(since), until: istSeconds(addDays(until, 1)), limit: 50 };
  // Posts insights are a nice-to-have: if Facebook refuses them, the posts still show with their counts.
  const attempts = [`${POST_FIELDS},insights.metric(${POST_INSIGHTS.join(',')}).period(lifetime){name,period,values}`, POST_FIELDS];
  let lastError = null;
  for (const fields of attempts) {
    const posts = [];
    let params = { ...base, fields };
    let failed = null;
    for (let i = 0; i < maxPages && params; i += 1) {
      const r = await get(`${page.page_id}/published_posts`, page.page_access_token, params);
      if (r.error) { failed = r.error; break; }
      posts.push(...(r.data.data || []));
      const after = r.data.paging?.cursors?.after;
      params = r.data.paging?.next && after ? { ...params, after } : null;
    }
    if (!failed) return { posts: posts.map(shapePost), insights: fields !== POST_FIELDS };
    lastError = failed;
    if (fatal(failed)) break;
  }
  return { unavailable: true, reason: lastError?.message, posts: [] };
}

const REEL_INSIGHTS = ['fb_reels_total_plays', 'blue_reels_play_count', 'fb_reels_replay_count', 'post_video_avg_time_watched', 'post_video_view_time', 'post_video_followers', 'post_video_social_actions', 'post_video_likes_by_reaction_type'];

export function shapeReel(r) {
  const ins = lifetimeValues(r.video_insights);
  const social = ins.post_video_social_actions || {};
  const reactions = ins.post_video_likes_by_reaction_type || {};
  const permalink = r.permalink_url ? (r.permalink_url.startsWith('http') ? r.permalink_url : `https://www.facebook.com${r.permalink_url}`) : null;
  return {
    id: r.id,
    description: r.description || null,
    created_time: r.created_time,
    permalink,
    picture: r.picture || null,
    length_seconds: r.length ? round1(r.length) : null,
    plays: ins.fb_reels_total_plays ?? null,
    initial_plays: ins.blue_reels_play_count ?? null,
    replays: ins.fb_reels_replay_count ?? null,
    avg_watch_seconds: ins.post_video_avg_time_watched ? round1(ins.post_video_avg_time_watched / 1000) : null,
    watch_minutes: ins.post_video_view_time ? round1(ins.post_video_view_time / 60000) : null,
    followers_gained: ins.post_video_followers ?? null,
    reactions: objectSum(reactions),
    comments: Number(social.COMMENT) || 0,
    shares: Number(social.SHARE) || 0,
  };
}

/** Reels published in [since, until], with plays and watch time. */
export async function fetchPageReels(page, since, until, { get = fbGet, maxPages = 4 } = {}) {
  const fields = `id,description,created_time,length,permalink_url,picture,video_insights.metric(${REEL_INSIGHTS.join(',')}){name,period,values}`;
  const out = [];
  let params = { fields, limit: 50 };
  const from = istSeconds(since) * 1000;
  const to = istSeconds(addDays(until, 1)) * 1000;
  for (let i = 0; i < maxPages && params; i += 1) {
    const r = await get(`${page.page_id}/video_reels`, page.page_access_token, params);
    if (r.error) return { unavailable: true, reason: r.error.message, reels: [] };
    const batch = r.data.data || [];
    for (const reel of batch) {
      const t = new Date(reel.created_time).getTime();
      if (t >= from && t < to) out.push(shapeReel(reel));
    }
    // Reels come newest first: once one is older than the range, the rest are too.
    if (batch.some((reel) => new Date(reel.created_time).getTime() < from)) break;
    const after = r.data.paging?.cursors?.after;
    params = r.data.paging?.next && after ? { ...params, after } : null;
  }
  return { reels: out };
}

/** Followers by country and city. Facebook only fills these in once a Page has enough followers (about 100). */
export async function fetchPageAudience(page, { get = fbGet } = {}) {
  const r = await get(`${page.page_id}/insights`, page.page_access_token, { metric: 'page_follows_country,page_follows_city', period: 'lifetime' });
  if (r.error) return { unavailable: true, reason: r.error.message, country: [], city: [] };
  const pick = (name) => {
    const values = (r.data.data || []).find((d) => d.name === name)?.values || [];
    const latest = values.at(-1)?.value || {};
    return Object.entries(latest).map(([label, value]) => ({ label, value: Number(value) || 0 })).sort((a, b) => b.value - a.value).slice(0, 15);
  };
  return { country: pick('page_follows_country'), city: pick('page_follows_city') };
}

/** Cached per Page: keys start with the Page's id so one Page can be refreshed on its own. */
export const cached = (page, key, load) => cache.getOrLoad(`${page.id}:${key}`, TTL_MS, load);

/** Forget everything cached for one Page (the Refresh button). */
export const invalidateFacebookPage = (page) => cache.invalidate(`${page.id}:`);

// ---------------------------------------------------------------------------
// Saved posts and reels (media_snapshots, platform 'facebook')
// ---------------------------------------------------------------------------

const n0 = (v) => (v === null || v === undefined ? null : Number(v));

/** The newest saved capture of each post (or reel) published in [since, until] (IST dates). */
async function loadStoredMedia(page, since, until, reels, db = pool) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (media_id) * FROM media_snapshots
      WHERE platform = 'facebook' AND account_id = $1 AND published_at >= $2 AND published_at < $3
        AND ${reels ? "media_type = 'REEL'" : "media_type IS DISTINCT FROM 'REEL'"}
      ORDER BY media_id, captured_on DESC`,
    [Number(page.id), new Date(`${since}T00:00:00+05:30`), new Date(`${addDays(until, 1)}T00:00:00+05:30`)]
  );
  return rows.sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
}

/** Has this Page ever been saved? (An empty result then means "no posts", not "not saved yet".) */
async function hasStoredDays(page, db = pool) {
  const { rows } = await db.query('SELECT 1 FROM fb_daily_metrics WHERE account_id = $1 LIMIT 1', [Number(page.id)]);
  return rows.length > 0;
}

export async function loadStoredPosts(page, since, until) {
  if (!(await hasStoredDays(page))) return null;
  const rows = await loadStoredMedia(page, since, until, false);
  return rows.map((m) => {
    const x = m.extra || {};
    return {
      id: m.media_id, message: m.title, created_time: new Date(m.published_at).toISOString(), permalink: m.permalink, picture: m.thumbnail_url,
      type: m.media_type, views: n0(m.views), reach: n0(m.reach), clicks: Number(m.link_clicks) || 0, reactions: Number(m.likes) || 0,
      reactions_by_type: x.reactions_by_type ?? null, comments: Number(m.comments) || 0, shares: Number(m.shares) || 0,
      interactions: Number(m.total_interactions) || 0, video_views: x.video_views ?? null, avg_watch_seconds: n0(m.avg_watch_seconds),
      engagement_rate: x.engagement_rate ?? null, captured_on: m.captured_on,
    };
  });
}

export async function loadStoredReels(page, since, until) {
  if (!(await hasStoredDays(page))) return null;
  const rows = await loadStoredMedia(page, since, until, true);
  return rows.map((m) => {
    const x = m.extra || {};
    return {
      id: m.media_id, description: m.title, created_time: new Date(m.published_at).toISOString(), permalink: m.permalink, picture: m.thumbnail_url,
      length_seconds: n0(m.duration_seconds), plays: n0(m.views), initial_plays: x.initial_plays ?? null, replays: x.replays ?? null,
      avg_watch_seconds: n0(m.avg_watch_seconds), watch_minutes: m.total_watch_seconds === null ? null : round1(Number(m.total_watch_seconds) / 60),
      followers_gained: n0(m.follows), reactions: Number(m.likes) || 0, comments: Number(m.comments) || 0, shares: Number(m.shares) || 0,
    };
  });
}

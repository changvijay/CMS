import express from 'express';
import { pickAccount } from '../utils/accounts.js';
import { igGet, fetchMediaInsights, MEDIA_FIELDS, parseBreakdown, parseInsightValues } from '../services/instagramApi.js';
import { analyzeComments, summarizeBenchmark } from '../services/textAnalysis.js';
import { parseDemographicBreakdown } from '../services/analytics.js';
import {
  fetchPlaylists, fetchRetention, fetchRevenue, fetchVideoAnalytics, fetchYoutubeComments,
} from '../services/youtubeReports.js';
import { istDayWindowSeconds, resolveRange } from '../utils/dates.js';

const VIDEO_ID = /^[\w-]{11}$/;
const MEDIA_ID = /^\d{5,30}$/;

/** [response key, metric, breakdown, alternative breakdown name Instagram has used] */
const ACCOUNT_BREAKDOWNS = [
  ['views_by_format', 'views', 'media_product_type'],
  ['views_by_follower_type', 'views', 'follow_type', 'follower_type'],
  ['reach_by_format', 'reach', 'media_product_type'],
  ['reach_by_follower_type', 'reach', 'follow_type', 'follower_type'],
  ['interactions_by_format', 'total_interactions', 'media_product_type'],
  ['likes_by_format', 'likes', 'media_product_type'],
  ['comments_by_format', 'comments', 'media_product_type'],
  ['saves_by_format', 'saves', 'media_product_type'],
  ['shares_by_format', 'shares', 'media_product_type'],
  ['follows_and_unfollows', 'follows_and_unfollows', 'follow_type'],
  ['profile_link_taps', 'profile_links_taps', 'contact_button_type'],
];

const ACCOUNT_TOTAL_METRICS = ['accounts_engaged', 'reach', 'views', 'total_interactions', 'likes', 'comments', 'shares', 'saves', 'replies', 'reposts', 'profile_views'];
const DEMOGRAPHIC_BREAKDOWNS = ['age', 'gender', 'country', 'city'];

export function createDeepRouter(authenticateToken) {
  const router = express.Router();

  const igRoute = (path, handler) =>
    router.get(path, authenticateToken, async (req, res) => {
      try {
        const account = await pickAccount('instagram', req.user.userId, req.query.accountId);
        if (!account) return res.status(404).json({ error: 'No connected Instagram account found for this user.' });
        await handler(req, res, account);
      } catch (error) {
        res.status(502).json({ error_details: { code: 502, message: error.message } });
      }
    });

  const ytRoute = (path, handler) =>
    router.get(path, authenticateToken, async (req, res) => {
      try {
        const account = await pickAccount('youtube', req.user.userId, req.query.accountId);
        if (!account) return res.status(404).json({ error: 'No connected YouTube account found for this user.' });
        await handler(req, res, account);
      } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 502;
        res.status(status).json({ error_details: { code: status, message: error.message, reason: error.reason } });
      }
    });

  const fail = (res, error) => res.status(Number.isInteger(error.code) && error.code >= 400 && error.code < 600 ? error.code : 502).json({ error_details: error });

  // ------------------------------------------------------------------ Instagram

  // Account insights over a range, with every breakdown the API offers. Each query succeeds or fails alone.
  igRoute('/instagram/account-insights', async (req, res, account) => {
    const { since, until } = resolveRange(req.query);
    const window = { since: istDayWindowSeconds(since).since, until: istDayWindowSeconds(until).until };
    const base = { period: 'day', metric_type: 'total_value', ...window };
    const path = `${account.page_id}/insights`;

    const totals = {};
    const totalErrors = {};
    const combined = await igGet(account, path, { ...base, metric: ACCOUNT_TOTAL_METRICS.slice(0, -1).join(',') });
    if (combined.data) Object.assign(totals, parseInsightValues(combined.data));
    const singles = combined.data ? ['profile_views'] : ACCOUNT_TOTAL_METRICS;
    await Promise.all(singles.map(async (metric) => {
      const r = await igGet(account, path, { ...base, metric });
      if (r.data) Object.assign(totals, parseInsightValues(r.data));
      else totalErrors[metric] = r.error;
    }));

    const breakdowns = {};
    await Promise.all(ACCOUNT_BREAKDOWNS.map(async ([key, metric, breakdown, alt]) => {
      let r = await igGet(account, path, { ...base, metric, breakdown });
      if (r.error && alt) r = await igGet(account, path, { ...base, metric, breakdown: alt });
      breakdowns[key] = r.data ? { rows: parseBreakdown(r.data) } : { error: r.error };
    }));

    res.json({ account_id: account.id, range: { since, until }, totals, total_errors: totalErrors, breakdowns });
  });

  // Follower or engaged-audience demographics (timeframe is required by current API versions)
  igRoute('/instagram/demographics', async (req, res, account) => {
    const metric = req.query.type === 'engaged' ? 'engaged_audience_demographics' : 'follower_demographics';
    const out = { account_id: account.id, type: metric };
    await Promise.all(DEMOGRAPHIC_BREAKDOWNS.map(async (breakdown) => {
      const params = { metric, period: 'lifetime', metric_type: 'total_value', breakdown };
      let r = await igGet(account, `${account.page_id}/insights`, { ...params, timeframe: 'this_month' });
      if (r.error) {
        const retry = await igGet(account, `${account.page_id}/insights`, params);
        if (retry.data) r = retry;
      }
      out[breakdown] = r.data ? { rows: parseDemographicBreakdown(r.data, breakdown) } : { error: r.error };
    }));
    res.json(out);
  });

  igRoute('/instagram/stories', async (req, res, account) => {
    const list = await igGet(account, 'me/stories', { fields: MEDIA_FIELDS });
    if (list.error) return fail(res, list.error);
    const items = list.data?.data || [];
    const stories = await Promise.all(items.map(async (item) => {
      const insights = await fetchMediaInsights(account, { ...item, media_product_type: 'STORY' });
      return {
        media_id: item.id, permalink: item.permalink, thumbnail_url: item.thumbnail_url || item.media_url || null,
        media_type: item.media_type, published_at: item.timestamp, caption: item.caption || '', ...insights,
      };
    }));
    res.json({ account_id: account.id, stories });
  });

  igRoute('/instagram/comments', async (req, res, account) => {
    const mediaId = String(req.query.mediaId || '');
    if (!MEDIA_ID.test(mediaId)) return res.status(400).json({ error: 'mediaId must be a numeric Instagram media id.' });
    const r = await igGet(account, `${mediaId}/comments`, { fields: 'id,text,timestamp,username,like_count', limit: 50 });
    if (r.error) return fail(res, r.error);
    const comments = r.data?.data || [];
    res.json({ media_id: mediaId, analysis: analyzeComments(comments), comments: comments.slice(0, 20) });
  });

  igRoute('/instagram/tags', async (req, res, account) => {
    const r = await igGet(account, 'me/tags', { fields: 'id,caption,media_type,permalink,timestamp,username,like_count,comments_count', limit: 25 });
    if (r.error) return fail(res, r.error);
    res.json({ account_id: account.id, tags: r.data?.data || [] });
  });

  igRoute('/instagram/publishing-limit', async (req, res, account) => {
    const r = await igGet(account, `${account.page_id}/content_publishing_limit`, { fields: 'quota_usage,config' });
    if (r.error) return fail(res, r.error);
    const row = r.data?.data?.[0] || {};
    res.json({ quota_usage: row.quota_usage ?? null, quota_total: row.config?.quota_total ?? null, quota_duration_seconds: row.config?.quota_duration ?? null });
  });

  // Another public business/creator account's headline numbers, for benchmarking
  igRoute('/instagram/benchmark', async (req, res, account) => {
    const username = String(req.query.username || '').replace(/^@/, '');
    if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) return res.status(400).json({ error: 'Enter a valid Instagram username.' });
    const fields = `business_discovery.username(${username}){username,name,biography,followers_count,follows_count,media_count,profile_picture_url,media.limit(30){id,caption,media_type,like_count,comments_count,timestamp,permalink}}`;
    const r = await igGet(account, account.page_id, { fields });
    if (r.error) return fail(res, r.error);
    const summary = summarizeBenchmark(r.data);
    if (!summary) return res.status(404).json({ error_details: { code: 404, message: 'No public data returned. The account must be a public business or creator account.' } });
    res.json(summary);
  });

  igRoute('/instagram/hashtag', async (req, res, account) => {
    const q = String(req.query.q || '').replace(/^#/, '');
    if (!/^[\p{L}\p{M}\p{N}_]{1,60}$/u.test(q)) return res.status(400).json({ error: 'Enter one hashtag without spaces.' });
    const found = await igGet(account, 'ig_hashtag_search', { user_id: account.page_id, q });
    if (found.error) return fail(res, found.error);
    const id = found.data?.data?.[0]?.id;
    if (!id) return res.status(404).json({ error_details: { code: 404, message: 'Instagram found no hashtag with that name.' } });
    const fields = 'id,caption,media_type,like_count,comments_count,permalink,timestamp';
    const [top, recent] = await Promise.all([
      igGet(account, `${id}/top_media`, { user_id: account.page_id, fields, limit: 25 }),
      igGet(account, `${id}/recent_media`, { user_id: account.page_id, fields, limit: 25 }),
    ]);
    res.json({ hashtag: q, hashtag_id: id, top: top.data?.data || [], recent: recent.data?.data || [], top_error: top.error || null, recent_error: recent.error || null });
  });

  // ------------------------------------------------------------------ YouTube

  ytRoute('/youtube/videos', async (req, res, account) => {
    const { since, until } = resolveRange(req.query);
    const result = await fetchVideoAnalytics(account, since, until, parseInt(req.query.limit, 10) || 200);
    if (result.error) return fail(res, result.error);
    res.json({ account_id: account.id, range: { since, until }, videos: result.rows });
  });

  ytRoute('/youtube/retention', async (req, res, account) => {
    const videoId = String(req.query.videoId || '');
    if (!VIDEO_ID.test(videoId)) return res.status(400).json({ error: 'videoId must be an 11-character YouTube video id.' });
    const { since, until } = resolveRange({ since: req.query.since || '2005-02-14', until: req.query.until });
    const result = await fetchRetention(account, videoId, since, until);
    if (result.error) return fail(res, result.error);
    res.json({ video_id: videoId, points: result.rows });
  });

  ytRoute('/youtube/revenue', async (req, res, account) => {
    const { since, until } = resolveRange(req.query);
    res.json({ account_id: account.id, range: { since, until }, ...(await fetchRevenue(account, since, until)) });
  });

  ytRoute('/youtube/playlists', async (req, res, account) => {
    const { since, until } = resolveRange(req.query);
    const result = await fetchPlaylists(account, since, until);
    if (result.error) return fail(res, result.error);
    res.json({ account_id: account.id, range: { since, until }, playlists: result.rows });
  });

  ytRoute('/youtube/comments', async (req, res, account) => {
    const videoId = String(req.query.videoId || '');
    if (!VIDEO_ID.test(videoId)) return res.status(400).json({ error: 'videoId must be an 11-character YouTube video id.' });
    const result = await fetchYoutubeComments(account, videoId);
    if (result.error) return fail(res, result.error);
    res.json({ video_id: videoId, ...result });
  });

  return router;
}

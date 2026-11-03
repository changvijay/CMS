import express from 'express';
import { pool, isDbReady, getInstagramAccountsByUserId, getLinkedInAccountsByUserId, getYoutubeAccountsByUserId } from '../db.js';
import { pickAccount } from '../utils/accounts.js';
import { buildBestTimeMatrix, computeDeltas, engagementRate, sumMetrics } from '../services/analytics.js';
import { REPORT_GROUPS, fetchYoutubeBreakdowns, fetchYoutubeChannel } from '../services/youtubeReports.js';
import { loadAccountCards } from '../services/accountCards.js';
import { addDays, daysBetween, resolveRange } from '../utils/dates.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function createInsightsRouter(authenticateToken) {
  const router = express.Router();

  // Best time to post, from Instagram's online_followers (live call)
  router.get('/instagram/best-time', authenticateToken, async (req, res) => {
    try {
      const account = await pickAccount('instagram', req.user.userId, req.query.accountId);
      if (!account) return res.status(404).json({ error: 'No connected Instagram account found for this user.' });

      const url = `https://graph.instagram.com/v24.0/${account.page_id}/insights?metric=online_followers&period=lifetime&access_token=${encodeURIComponent(account.access_token)}`;
      const response = await fetch(url);
      const json = await response.json();
      if (!response.ok || json.error) {
        const e = json.error || {};
        return res.status(response.ok ? 502 : response.status).json({
          error_details: { code: e.code || response.status, message: e.message || 'Instagram API error', reason: e.type },
        });
      }
      return res.json({ account_id: account.id, ...buildBestTimeMatrix(json.data) });
    } catch (error) {
      console.error('Best-time error:', error);
      return res.status(502).json({ error_details: { code: 502, message: `Failed to reach the Instagram API: ${error.message}` } });
    }
  });

  // YouTube audience & content breakdowns (live calls, each report independent)
  router.get('/youtube/breakdowns', authenticateToken, async (req, res) => {
    try {
      const account = await pickAccount('youtube', req.user.userId, req.query.accountId);
      if (!account) return res.status(404).json({ error: 'No connected YouTube account found for this user.' });
      const { since, until } = resolveRange(req.query);
      const requested = String(req.query.groups || '').split(',').filter((g) => REPORT_GROUPS.includes(g));
      const reports = await fetchYoutubeBreakdowns(account, since, until, requested.length ? requested : REPORT_GROUPS);
      return res.json({ account_id: account.id, range: { since, until }, ...reports });
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 502;
      return res.status(status).json({ error_details: { code: status, message: error.message, reason: error.reason } });
    }
  });

  // Instagram profile card (live call)
  router.get('/instagram/profile', authenticateToken, async (req, res) => {
    try {
      const account = await pickAccount('instagram', req.user.userId, req.query.accountId);
      if (!account) return res.status(404).json({ error: 'No connected Instagram account found for this user.' });
      const fields = 'username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count,account_type';
      const response = await fetch(`https://graph.instagram.com/v24.0/me?fields=${fields}&access_token=${encodeURIComponent(account.access_token)}`);
      const json = await response.json();
      if (!response.ok || json.error) {
        const e = json.error || {};
        return res.status(response.ok ? 502 : response.status).json({
          error_details: { code: e.code || response.status, message: e.message || 'Instagram API error', reason: e.type },
        });
      }
      return res.json({ account_id: account.id, profile: json });
    } catch (error) {
      return res.status(502).json({ error_details: { code: 502, message: `Failed to reach the Instagram API: ${error.message}` } });
    }
  });

  // YouTube channel card (live call)
  router.get('/youtube/channel', authenticateToken, async (req, res) => {
    try {
      const account = await pickAccount('youtube', req.user.userId, req.query.accountId);
      if (!account) return res.status(404).json({ error: 'No connected YouTube account found for this user.' });
      return res.json({ account_id: account.id, channel: await fetchYoutubeChannel(account) });
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 502;
      return res.status(status).json({ error_details: { code: status, message: error.message, reason: error.reason } });
    }
  });

  // Cross-platform overview from stored history
  router.get('/overview', authenticateToken, async (req, res) => {
    if (!isDbReady()) return res.status(503).json({ error: 'Database is not connected; stored history is unavailable.' });
    try {
      const { since, until } = resolveRange(req.query);
      if (since > until) return res.status(400).json({ error: 'since must be on or before until.' });
      const span = daysBetween(since, until) + 1;
      const prevUntil = addDays(since, -1);
      const prevSince = addDays(prevUntil, -(span - 1));

      const [igAccounts, ytAccounts, liAccounts] = await Promise.all([
        getInstagramAccountsByUserId(req.user.userId),
        getYoutubeAccountsByUserId(req.user.userId),
        getLinkedInAccountsByUserId(req.user.userId),
      ]);
      const igIds = igAccounts.map((a) => Number(a.id));
      const ytIds = ytAccounts.map((a) => Number(a.id));
      const liIds = liAccounts.map((a) => Number(a.id));

      const igQuery = (from, to) => pool.query(
        `SELECT to_char(metric_date, 'YYYY-MM-DD') AS date,
                COALESCE(SUM(views),0)::bigint AS views, COALESCE(SUM(reach),0)::bigint AS reach,
                COALESCE(SUM(total_interactions),0)::bigint AS interactions,
                COALESCE(SUM(follower_change),0)::bigint AS net_followers
           FROM ig_daily_metrics WHERE account_id = ANY($1) AND metric_date BETWEEN $2 AND $3
          GROUP BY metric_date ORDER BY metric_date`, [igIds, from, to]);
      const ytQuery = (from, to) => pool.query(
        `SELECT to_char(metric_date, 'YYYY-MM-DD') AS date,
                COALESCE(SUM(views),0)::bigint AS views, COALESCE(SUM(minutes_watched),0)::bigint AS minutes_watched,
                COALESCE(SUM(likes + comments + shares),0)::bigint AS interactions,
                COALESCE(SUM(subs_gained - subs_lost),0)::bigint AS net_followers
           FROM yt_daily_metrics WHERE account_id = ANY($1) AND metric_date BETWEEN $2 AND $3
          GROUP BY metric_date ORDER BY metric_date`, [ytIds, from, to]);
      // LinkedIn impressions count as "views" in the combined numbers.
      const liQuery = (from, to) => pool.query(
        `SELECT to_char(metric_date, 'YYYY-MM-DD') AS date,
                COALESCE(SUM(impressions),0)::bigint AS views,
                COALESCE(SUM(COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0) + COALESCE(clicks,0)),0)::bigint AS interactions,
                COALESCE(SUM(COALESCE(organic_follower_gain,0) + COALESCE(paid_follower_gain,0)),0)::bigint AS net_followers
           FROM li_daily_metrics WHERE account_id = ANY($1) AND metric_date BETWEEN $2 AND $3
          GROUP BY metric_date ORDER BY metric_date`, [liIds, from, to]);

      const accountCardsPromise = loadAccountCards(pool, { igAccounts, ytAccounts, liAccounts, since, until, prevSince, prevUntil });
      const [ig, igPrev, yt, ytPrev, li, liPrev, media] = await Promise.all([
        igQuery(since, until), igQuery(prevSince, prevUntil), ytQuery(since, until), ytQuery(prevSince, prevUntil),
        liQuery(since, until), liQuery(prevSince, prevUntil),
        pool.query(
          `SELECT DISTINCT ON (platform, account_id, media_id) *
             FROM media_snapshots
            WHERE (platform = 'instagram' AND account_id = ANY($1)) OR (platform = 'youtube' AND account_id = ANY($2))
               OR (platform = 'linkedin' AND account_id = ANY($3))
            ORDER BY platform, account_id, media_id, captured_on DESC`, [igIds, ytIds, liIds]),
      ]);

      const keys = ['views', 'interactions', 'net_followers'];
      const num = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'date' ? v : Number(v)])));
      const igRows = num(ig.rows);
      const ytRows = num(yt.rows);
      const liRows = num(li.rows);
      const totals = {
        instagram: sumMetrics(igRows, keys),
        youtube: sumMetrics(ytRows, keys),
        linkedin: sumMetrics(liRows, keys),
      };
      const previous = {
        instagram: sumMetrics(num(igPrev.rows), keys),
        youtube: sumMetrics(num(ytPrev.rows), keys),
        linkedin: sumMetrics(num(liPrev.rows), keys),
      };
      const combined = Object.fromEntries(keys.map((k) => [k, totals.instagram[k] + totals.youtube[k] + totals.linkedin[k]]));
      const combinedPrev = Object.fromEntries(keys.map((k) => [k, previous.instagram[k] + previous.youtube[k] + previous.linkedin[k]]));

      const byDate = new Map();
      const blank = (date) => ({ date, instagram_views: 0, youtube_views: 0, linkedin_views: 0 });
      for (const [rows, key] of [[igRows, 'instagram_views'], [ytRows, 'youtube_views'], [liRows, 'linkedin_views']]) {
        for (const r of rows) byDate.set(r.date, { ...(byDate.get(r.date) || blank(r.date)), [key]: r.views });
      }
      const daily = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

      const leaderboard = media.rows
        .map((m) => ({ ...m, engagement_rate: engagementRate(m) }))
        .filter((m) => m.engagement_rate !== null && Number(m.views ?? m.reach ?? 0) >= 100)
        .sort((a, b) => b.engagement_rate - a.engagement_rate)
        .slice(0, 10)
        .map((m) => ({
          platform: m.platform, media_id: m.media_id, title: m.title, media_type: m.media_type, permalink: m.permalink,
          thumbnail_url: m.thumbnail_url, published_at: m.published_at, views: m.views === null ? null : Number(m.views),
          reach: m.reach === null ? null : Number(m.reach), engagement_rate: m.engagement_rate,
        }));

      const insights = [];
      const viewsDelta = computeDeltas(combined, combinedPrev).views;
      if (viewsDelta.change_pct !== null) {
        insights.push(`Combined views ${viewsDelta.change_pct >= 0 ? 'up' : 'down'} ${Math.abs(viewsDelta.change_pct)}% vs the previous ${span} days.`);
      }
      if (combined.views > 0) {
        const [lead, leadViews] = [['Instagram', totals.instagram.views], ['YouTube', totals.youtube.views], ['LinkedIn', totals.linkedin.views]]
          .sort((a, b) => b[1] - a[1])[0];
        insights.push(`${lead} drives ${Math.round((leadViews / combined.views) * 100)}% of views.`);
      }
      const dayTotals = new Map();
      for (const d of daily) dayTotals.set(new Date(`${d.date}T00:00:00Z`).getUTCDay(), (dayTotals.get(new Date(`${d.date}T00:00:00Z`).getUTCDay()) || 0) + d.instagram_views + d.youtube_views + d.linkedin_views);
      if (dayTotals.size) {
        const [bestDay] = [...dayTotals.entries()].sort((a, b) => b[1] - a[1])[0];
        insights.push(`${WEEKDAYS[bestDay]} is your strongest day for views.`);
      }
      if (leaderboard[0]) insights.push(`Highest engagement rate: "${(leaderboard[0].title || 'Untitled').slice(0, 60)}" on ${leaderboard[0].platform} (${leaderboard[0].engagement_rate}%).`);

      return res.json({
        range: { since, until, days: span, previous_since: prevSince, previous_until: prevUntil },
        accounts: { instagram: igAccounts.length, youtube: ytAccounts.length, linkedin: liAccounts.length },
        coverage: { instagram_days: igRows.length, youtube_days: ytRows.length, linkedin_days: liRows.length },
        totals: { ...totals, combined },
        deltas: {
          instagram: computeDeltas(totals.instagram, previous.instagram),
          youtube: computeDeltas(totals.youtube, previous.youtube),
          linkedin: computeDeltas(totals.linkedin, previous.linkedin),
          combined: computeDeltas(combined, combinedPrev),
        },
        daily,
        account_cards: await accountCardsPromise,
        leaderboard,
        insights,
      });
    } catch (error) {
      console.error('Overview error:', error);
      return res.status(500).json({ error: 'Failed to build overview.' });
    }
  });

  return router;
}

import express from 'express';
import { pool, isDbReady, getInstagramAccountsByUserId, getLinkedInAccountsByUserId, getYoutubeAccountsByUserId } from '../db.js';
import { pickAccount } from '../utils/accounts.js';
import { buildBestTimeMatrix, computeDeltas, engagementRate, sumMetrics } from '../services/analytics.js';
import { REPORT_GROUPS, fetchYoutubeBreakdowns, fetchYoutubeChannel } from '../services/youtubeReports.js';
import { buildAccountCards } from '../services/accountCards.js';
import { loadDaily } from '../services/dailyInsights.js';
import { loadPrevious, wantsLive } from './history.js';
import { addDays, daysBetween, resolveRange } from '../utils/dates.js';
import { loadFacebookDaily } from '../services/facebookInsights.js';
import { getFacebookPagesByUserId } from './facebookInsights.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const v = (x) => (x === null || x === undefined ? 0 : Number(x));

/** What each platform contributes to the combined numbers. LinkedIn impressions count as views. */
const COMBINED = {
  instagram: (r) => ({ views: v(r.views), interactions: v(r.total_interactions), net_followers: v(r.follower_change) }),
  youtube: (r) => ({ views: v(r.views), interactions: v(r.likes) + v(r.comments) + v(r.shares), net_followers: v(r.subs_gained) - v(r.subs_lost) }),
  linkedin: (r) => ({
    views: v(r.impressions),
    interactions: v(r.likes) + v(r.comments) + v(r.shares) + v(r.clicks),
    net_followers: v(r.organic_follower_gain) + v(r.paid_follower_gain),
  }),
  facebook: (r) => ({ views: v(r.views), interactions: v(r.engagements), net_followers: v(r.follows) - v(r.unfollows) }),
};

/** Facebook days for every Page: saved ones for the stored window, live otherwise. One failing Page doesn't hide the rest. */
async function loadFacebookPagesDaily(pages, since, until, errors, live = false, past = false) {
  const perPage = await Promise.all(pages.map(async (page) => {
    try {
      const { rows } = await loadFacebookDaily(page, since, until, { live, past });
      return rows.map((r) => ({ ...r, account_id: String(page.id) }));
    } catch (err) {
      errors?.push({ platform: 'facebook', account_id: page.id, code: err.status || 502, message: err.message });
      return [];
    }
  }));
  return perPage.flat();
}

/** Daily rows of several accounts -> one row per date with the combined numbers, oldest first. */
export function combineByDate(platform, rows) {
  const byDate = new Map();
  for (const r of rows) {
    const m = COMBINED[platform](r);
    const cur = byDate.get(r.metric_date) || { date: r.metric_date, views: 0, interactions: 0, net_followers: 0 };
    for (const k of ['views', 'interactions', 'net_followers']) cur[k] += m[k];
    byDate.set(r.metric_date, cur);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

const MEDIA_LEADERBOARD_COLUMNS = 'platform, account_id, media_id, title, media_type, permalink, thumbnail_url, published_at, reach, views, likes, comments, saves, shares, total_interactions';

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

      const [igAccounts, ytAccounts, liAccounts, fbPages] = await Promise.all([
        getInstagramAccountsByUserId(req.user.userId),
        getYoutubeAccountsByUserId(req.user.userId),
        getLinkedInAccountsByUserId(req.user.userId),
        getFacebookPagesByUserId(req.user.userId),
      ]);
      const igIds = igAccounts.map((a) => Number(a.id));
      const ytIds = ytAccounts.map((a) => Number(a.id));
      const liIds = liAccounts.map((a) => Number(a.id));
      const accountsByPlatform = { instagram: igAccounts, youtube: ytAccounts, linkedin: liAccounts };
      const live = wantsLive(req.query.live);

      const platforms = Object.keys(accountsByPlatform);
      const fbErrors = [];
      const [currentSets, previousSets, media, fbCurrent, fbPrevious] = await Promise.all([
        Promise.all(platforms.map((p) => loadDaily(p, accountsByPlatform[p], since, until, { live }))),
        Promise.all(platforms.map((p) => loadPrevious(p, accountsByPlatform[p], prevSince, prevUntil))),
        pool.query(
          `SELECT DISTINCT ON (platform, account_id, media_id) ${MEDIA_LEADERBOARD_COLUMNS}
             FROM media_snapshots
            WHERE (platform = 'instagram' AND account_id = ANY($1)) OR (platform = 'youtube' AND account_id = ANY($2))
               OR (platform = 'linkedin' AND account_id = ANY($3))
            ORDER BY platform, account_id, media_id, captured_on DESC`, [igIds, ytIds, liIds]),
        loadFacebookPagesDaily(fbPages, since, until, fbErrors, live),
        loadFacebookPagesDaily(fbPages, prevSince, prevUntil, null, false, true),
      ]);
      const current = Object.fromEntries(platforms.map((p, i) => [p, currentSets[i].rows]));
      const previousRows = Object.fromEntries(platforms.map((p, i) => [p, previousSets[i]]));
      current.facebook = fbCurrent;
      previousRows.facebook = fbPrevious;
      const fetchErrors = [...currentSets.flatMap((set) => set.errors), ...fbErrors];
      const source = currentSets.some((set) => set.source === 'live') ? 'live' : 'stored';

      const keys = ['views', 'interactions', 'net_followers'];
      const igRows = combineByDate('instagram', current.instagram);
      const ytRows = combineByDate('youtube', current.youtube);
      const liRows = combineByDate('linkedin', current.linkedin);
      const fbRows = combineByDate('facebook', current.facebook);
      const totals = {
        instagram: sumMetrics(igRows, keys),
        youtube: sumMetrics(ytRows, keys),
        linkedin: sumMetrics(liRows, keys),
        facebook: sumMetrics(fbRows, keys),
      };
      const previous = {
        instagram: sumMetrics(combineByDate('instagram', previousRows.instagram), keys),
        youtube: sumMetrics(combineByDate('youtube', previousRows.youtube), keys),
        linkedin: sumMetrics(combineByDate('linkedin', previousRows.linkedin), keys),
        facebook: sumMetrics(combineByDate('facebook', previousRows.facebook), keys),
      };
      const ALL = ['instagram', 'youtube', 'linkedin', 'facebook'];
      const combined = Object.fromEntries(keys.map((k) => [k, ALL.reduce((a, p) => a + totals[p][k], 0)]));
      const combinedPrev = Object.fromEntries(keys.map((k) => [k, ALL.reduce((a, p) => a + previous[p][k], 0)]));

      const byDate = new Map();
      const blank = (date) => ({ date, instagram_views: 0, youtube_views: 0, linkedin_views: 0, facebook_views: 0 });
      for (const [rows, key] of [[igRows, 'instagram_views'], [ytRows, 'youtube_views'], [liRows, 'linkedin_views'], [fbRows, 'facebook_views']]) {
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
        const [lead, leadViews] = [['Instagram', totals.instagram.views], ['YouTube', totals.youtube.views], ['LinkedIn', totals.linkedin.views], ['Facebook', totals.facebook.views]]
          .sort((a, b) => b[1] - a[1])[0];
        insights.push(`${lead} drives ${Math.round((leadViews / combined.views) * 100)}% of views.`);
      }
      const dayTotals = new Map();
      for (const d of daily) {
        const weekday = new Date(`${d.date}T00:00:00Z`).getUTCDay();
        dayTotals.set(weekday, (dayTotals.get(weekday) || 0) + d.instagram_views + d.youtube_views + d.linkedin_views + d.facebook_views);
      }
      if (dayTotals.size) {
        const [bestDay] = [...dayTotals.entries()].sort((a, b) => b[1] - a[1])[0];
        insights.push(`${WEEKDAYS[bestDay]} is your strongest day for views.`);
      }
      if (leaderboard[0]) insights.push(`Highest engagement rate: "${(leaderboard[0].title || 'Untitled').slice(0, 60)}" on ${leaderboard[0].platform} (${leaderboard[0].engagement_rate}%).`);

      return res.json({
        source,
        errors: fetchErrors,
        range: { since, until, days: span, previous_since: prevSince, previous_until: prevUntil },
        accounts: { instagram: igAccounts.length, youtube: ytAccounts.length, linkedin: liAccounts.length, facebook: fbPages.length },
        coverage: { instagram_days: igRows.length, youtube_days: ytRows.length, linkedin_days: liRows.length, facebook_days: fbRows.length },
        totals: { ...totals, combined },
        deltas: {
          instagram: computeDeltas(totals.instagram, previous.instagram),
          youtube: computeDeltas(totals.youtube, previous.youtube),
          linkedin: computeDeltas(totals.linkedin, previous.linkedin),
          facebook: computeDeltas(totals.facebook, previous.facebook),
          combined: computeDeltas(combined, combinedPrev),
        },
        daily,
        account_cards: buildAccountCards({ ...accountsByPlatform, facebook: fbPages }, current, previousRows),
        leaderboard,
        insights,
      });
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ error: error.message });
      console.error('Overview error:', error);
      return res.status(500).json({ error: 'Failed to build overview.' });
    }
  });

  return router;
}

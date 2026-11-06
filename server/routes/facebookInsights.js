import express from 'express';
import { pool, isDbReady } from '../db.js';
import { daysBetween, resolveRange } from '../utils/dates.js';
import {
  MAX_DAYS,
  buildDailyReport,
  cached,
  fetchPageAudience,
  fetchPagePosts,
  fetchPageProfile,
  fetchPageReels,
  loadStoredPosts,
  loadStoredReels,
} from '../services/facebookInsights.js';
import { isStoredRange } from '../services/retention.js';
import { syncFacebookPage } from '../services/syncService.js';

/** Pages being saved in the background right now, so repeated page loads don't start the same save twice. */
const saving = new Set();

/** First visit with nothing saved yet: show live numbers now, and save them in the background for next time. */
function saveInBackground(page) {
  if (saving.has(String(page.id))) return;
  saving.add(String(page.id));
  syncFacebookPage(page)
    .catch((err) => console.warn(`Saving Facebook page#${page.id} failed: ${err.message}`))
    .finally(() => saving.delete(String(page.id)));
}

const wantsLive = (q) => q.live === '1' || q.live === 'true';

/** Every Facebook Page of a user, with its token, newest first. */
export async function getFacebookPagesByUserId(userId) {
  const { rows } = await pool.query(
    'SELECT id, page_id, name, picture_url, page_access_token FROM facebook_pages WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return rows;
}

/** The user's chosen Facebook Page, or their most recently added one. */
async function pickPage(userId, pageId) {
  const rows = await getFacebookPagesByUserId(userId);
  return rows.find((r) => String(r.id) === String(pageId)) || rows[0] || null;
}

function checkedRange(query) {
  const { since, until } = resolveRange(query);
  if (since > until) throw Object.assign(new Error('since must be on or before until.'), { status: 400 });
  if (daysBetween(since, until) + 1 > MAX_DAYS) throw Object.assign(new Error(`Pick a range of at most ${MAX_DAYS} days.`), { status: 400 });
  return { since, until };
}

export function createFacebookInsightsRouter(authenticateToken) {
  const router = express.Router();

  const withPage = (handler) => async (req, res) => {
    if (!isDbReady()) return res.status(503).json({ error: 'Database is not connected.' });
    try {
      const page = await pickPage(req.user.userId, req.query.accountId);
      if (!page) return res.status(404).json({ error: 'No Facebook Page connected.' });
      return res.json(await handler(page, req.query));
    } catch (err) {
      console.error('Facebook insights error:', err.message);
      const status = err.status === 400 ? 400 : err.status === 401 ? 401 : 502;
      const message = status === 401 ? `Facebook refused the saved Page token. Reconnect Facebook on the Accounts page. (${err.message})` : err.message;
      return res.status(status).json({ error: message });
    }
  };

  router.get('/facebook/insights/profile', authenticateToken, withPage((page) =>
    cached(page, 'profile', () => fetchPageProfile(page))));

  // Preset ranges (7/14/30 days) read the saved days; a custom range (?live=1) or older days come from Facebook.
  router.get('/facebook/insights/daily', authenticateToken, withPage(async (page, query) => {
    const { since, until } = checkedRange(query);
    const report = await buildDailyReport(page, since, until, { live: wantsLive(query) });
    if (report.source === 'live' && !wantsLive(query) && isStoredRange(since, until)) saveInBackground(page);
    return report;
  }));

  router.get('/facebook/insights/posts', authenticateToken, withPage(async (page, query) => {
    const { since, until } = checkedRange(query);
    if (!wantsLive(query) && isStoredRange(since, until)) {
      const stored = await loadStoredPosts(page, since, until);
      if (stored) return { posts: stored, insights: true, source: 'stored' };
    }
    return { ...(await cached(page, `posts:${since}:${until}`, () => fetchPagePosts(page, since, until))), source: 'live' };
  }));

  router.get('/facebook/insights/reels', authenticateToken, withPage(async (page, query) => {
    const { since, until } = checkedRange(query);
    if (!wantsLive(query) && isStoredRange(since, until)) {
      const stored = await loadStoredReels(page, since, until);
      if (stored) return { reels: stored, source: 'stored' };
    }
    return { ...(await cached(page, `reels:${since}:${until}`, () => fetchPageReels(page, since, until))), source: 'live' };
  }));

  router.get('/facebook/insights/audience', authenticateToken, withPage((page) =>
    cached(page, 'audience', () => fetchPageAudience(page))));

  return router;
}

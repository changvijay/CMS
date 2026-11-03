import express from 'express';
import { isDbReady } from '../db.js';
import { pickAccount } from '../utils/accounts.js';
import { linkedInTokenFor } from '../services/syncService.js';
import {
  fetchDailyStats,
  fetchFollowerCount,
  fetchFollowerDemographics,
  fetchOrganization,
  fetchVisitorStats,
} from '../services/linkedinApi.js';
import { addDays, isDateString, istDateString } from '../utils/dates.js';

/** Runs one LinkedIn call; a failure becomes { unavailable, reason } so the rest of the page still loads. */
async function part(fn) {
  try {
    return await fn();
  } catch (err) {
    const denied = err.status === 403 || err.status === 401;
    return {
      unavailable: true,
      reason: denied ? 'Not available on your LinkedIn access level yet.' : err.message,
    };
  }
}

export function createLinkedInInsightsRouter(authenticateToken) {
  const router = express.Router();

  // Resolves the selected company page and a working token, or answers the request with an error.
  const withPage = (handler) => async (req, res) => {
    if (!isDbReady()) return res.status(503).json({ error: 'Database is not connected.' });
    try {
      const account = await pickAccount('linkedin', req.user.userId, req.query.accountId);
      if (!account) return res.status(404).json({ error: 'No LinkedIn company page connected.' });
      const token = await linkedInTokenFor(account);
      return res.json(await handler({ account, token, orgId: account.page_id, query: req.query }));
    } catch (err) {
      console.error('LinkedIn insights error:', err.message);
      return res.status(err.status === 401 ? 401 : 502).json({ error: err.message });
    }
  };

  router.get('/linkedin/profile', authenticateToken, withPage(async ({ account, token, orgId }) => {
    const [org, followers] = await Promise.all([
      part(() => fetchOrganization(token, orgId)),
      part(() => fetchFollowerCount(token, orgId)),
    ]);
    return {
      id: account.id,
      name: org.name || account.page_name,
      vanity_name: org.vanity_name || account.vanity_name,
      description: org.description ?? null,
      website: org.website ?? null,
      staff_count: org.staff_count ?? null,
      followers: typeof followers === 'number' ? followers : null,
    };
  }));

  router.get('/linkedin/followers', authenticateToken, withPage(async ({ token, orgId, query }) => {
    const until = isDateString(query.until) ? query.until : addDays(istDateString(), -1);
    const since = isDateString(query.since) ? query.since : addDays(until, -29);
    const [total, daily, demographics] = await Promise.all([
      part(() => fetchFollowerCount(token, orgId)),
      part(() => fetchDailyStats(token, orgId, since, until)),
      part(() => fetchFollowerDemographics(token, orgId)),
    ]);
    const growth = daily.unavailable ? daily : Object.entries(daily)
      .filter(([d]) => d >= since && d <= until)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, m]) => ({ date, organic: m.organic_follower_gain ?? 0, paid: m.paid_follower_gain ?? 0 }));
    return { total: typeof total === 'number' ? total : null, growth, demographics };
  }));

  router.get('/linkedin/visitors', authenticateToken, withPage(async ({ token, orgId }) => part(() => fetchVisitorStats(token, orgId))));

  return router;
}

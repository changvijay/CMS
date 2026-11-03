import express from 'express';
import jwt from 'jsonwebtoken';
import { pool, isDbReady } from '../db.js';
import { safeReturnPath, withParams } from '../utils/oauth.js';
import {
  buildAuthUrl,
  ensureWorkingToken,
  exchangeCode,
  fetchAdminPages,
  fetchMember,
  PERSON_SCOPES,
  isLinkedInConfigured,
  linkedinConfig,
  refreshIfNeeded,
  tokenExpiry,
  tokenState,
} from '../services/linkedinAuth.js';

const CALLBACK_PATH = '/api/linkedin/callback';

/** Where LinkedIn sends the user back. An explicit env value wins; otherwise the site the user clicked from. */
function resolveRedirectUri(origin) {
  const configured = linkedinConfig().redirectUri;
  if (configured) return configured;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.origin}${CALLBACK_PATH}`;
  } catch {
    return null;
  }
}

function publicAccount(row) {
  return {
    id: row.id,
    name: row.name,
    organization_urn: row.member_id,
    account_type: row.account_type || 'organization',
    vanity_name: row.vanity_name,
    status: row.forced_expired ? 'expired' : tokenState(row),
    access_token_expires_at: row.access_token_expires_at,
    refresh_token_expires_at: row.refresh_token_expires_at,
    auto_refresh: Boolean(row.refresh_token),
    last_refresh_error: row.last_refresh_error,
    created_at: row.created_at,
  };
}

export function createLinkedInRouter(authenticateToken, jwtSecret) {
  const router = express.Router();

  // Step 1: the button asks for LinkedIn's sign-in page address.
  router.get('/linkedin/connect-url', authenticateToken, (req, res) => {
    if (!isLinkedInConfigured()) {
      return res.status(500).json({ error: 'LinkedIn is not set up on the server yet (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET).' });
    }
    const redirectUri = resolveRedirectUri(String(req.query.origin || ''));
    if (!redirectUri) return res.status(400).json({ error: 'Missing or invalid origin.' });
    // ?type=person connects your own profile (to post as yourself); the default connects the company pages you admin.
    const type = req.query.type === 'person' ? 'person' : 'organization';
    // The state proves the callback belongs to this logged-in user and was started in the last 10 minutes.
    const state = jwt.sign({ uid: req.user.userId, ru: redirectUri, purpose: 'linkedin', type, back: safeReturnPath(req.query.returnTo) }, jwtSecret, { expiresIn: '10m' });
    return res.json({ url: buildAuthUrl({ state, redirectUri, scopes: type === 'person' ? PERSON_SCOPES : undefined }) });
  });

  // Step 2: LinkedIn sends the browser back here with a one-time code.
  router.get('/linkedin/callback', async (req, res) => {
    let back = '/accounts';
    const finish = (params) => res.redirect(withParams(back, params));
    try {
      const payload = jwt.verify(String(req.query.state || ''), jwtSecret);
      if (payload.purpose !== 'linkedin') throw new Error('bad state');
      back = `${new URL(payload.ru).origin}${safeReturnPath(payload.back)}`;

      if (req.query.error) {
        const cancelled = req.query.error === 'user_cancelled_login' || req.query.error === 'user_cancelled_authorize';
        return finish({ linkedin: 'error', message: cancelled ? 'LinkedIn connection was cancelled.' : String(req.query.error_description || req.query.error) });
      }
      if (!isDbReady()) return finish({ linkedin: 'error', message: 'Database is not connected.' });

      const tokens = await exchangeCode(String(req.query.code || ''), payload.ru);
      const { accessExpiresAt: personExpires, refreshExpiresAt: personRefreshExpires } = tokenExpiry(tokens);

      if (payload.type === 'person') {
        const me = await fetchMember(tokens.access_token);
        await pool.query(
          `INSERT INTO linkedin_accounts
             (user_id, member_id, name, email, picture_url, access_token, access_token_expires_at, refresh_token, refresh_token_expires_at, scope, account_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'person')
           ON CONFLICT (user_id, member_id) DO UPDATE SET
             name = EXCLUDED.name, email = EXCLUDED.email, picture_url = EXCLUDED.picture_url,
             access_token = EXCLUDED.access_token, access_token_expires_at = EXCLUDED.access_token_expires_at,
             refresh_token = COALESCE(EXCLUDED.refresh_token, linkedin_accounts.refresh_token),
             refresh_token_expires_at = COALESCE(EXCLUDED.refresh_token_expires_at, linkedin_accounts.refresh_token_expires_at),
             scope = EXCLUDED.scope, account_type = 'person', last_refresh_error = NULL, last_refresh_failed_at = NULL, last_refresh_failed_at = NULL, updated_at = NOW()`,
          [payload.uid, `urn:li:person:${me.sub}`, me.name || 'LinkedIn profile', me.email || null, me.picture || null,
            tokens.access_token, personExpires, tokens.refresh_token || null, personRefreshExpires, tokens.scope || PERSON_SCOPES.join(' ')]
        );
        return finish({ linkedin: 'connected', name: me.name || 'your profile' });
      }

      const pages = await fetchAdminPages(tokens.access_token);
      if (!pages.length) {
        return finish({ linkedin: 'error', message: 'This LinkedIn login is not an admin of any company page. Sign in with a page admin account.' });
      }
      const { accessExpiresAt, refreshExpiresAt } = tokenExpiry(tokens);

      // One row per company page. Connecting again just updates the tokens.
      for (const page of pages) {
        await pool.query(
          `INSERT INTO linkedin_accounts
             (user_id, member_id, name, vanity_name, access_token, access_token_expires_at, refresh_token, refresh_token_expires_at, scope)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (user_id, member_id) DO UPDATE SET
             name = EXCLUDED.name,
             vanity_name = EXCLUDED.vanity_name,
             access_token = EXCLUDED.access_token,
             access_token_expires_at = EXCLUDED.access_token_expires_at,
             refresh_token = COALESCE(EXCLUDED.refresh_token, linkedin_accounts.refresh_token),
             refresh_token_expires_at = COALESCE(EXCLUDED.refresh_token_expires_at, linkedin_accounts.refresh_token_expires_at),
             scope = EXCLUDED.scope,
             last_refresh_error = NULL, last_refresh_failed_at = NULL,
             updated_at = NOW()`,
          [payload.uid, page.urn, page.name, page.vanityName, tokens.access_token, accessExpiresAt,
            tokens.refresh_token || null, refreshExpiresAt, tokens.scope || null]
        );
      }
      // Drop the placeholder row left by the earlier personal-account version, if any.
      await pool.query("DELETE FROM linkedin_accounts WHERE user_id = $1 AND member_id = 'self'", [payload.uid]);
      return finish({ linkedin: 'connected', name: pages.map((p) => p.name).join(', ') });
    } catch (err) {
      console.error('LinkedIn callback failed:', err.message);
      const message = err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError' || err.message === 'bad state'
        ? 'That LinkedIn sign-in link expired. Please click Connect LinkedIn again.'
        : err.message;
      return finish({ linkedin: 'error', message });
    }
  });

  router.get('/linkedin-accounts', authenticateToken, async (req, res) => {
    if (!isDbReady()) return res.status(503).json({ error: 'Database is not connected.' });
    try {
      const { rows } = await pool.query('SELECT * FROM linkedin_accounts WHERE user_id = $1 ORDER BY created_at DESC', [req.user.userId]);
      // Opening the page is a good moment to top up any token that is close to expiring.
      const fresh = await Promise.all(rows.map(async (r) => {
        const row = await refreshIfNeeded(r).catch(() => r);
        // Expired only when renewing failed and LinkedIn really rejects the token.
        if (row.last_refresh_error && tokenState(row) !== 'expired') {
          const check = await ensureWorkingToken(row);
          return check.ok ? check.account : { ...check.account, forced_expired: true, last_refresh_error: check.message };
        }
        return row;
      }));
      return res.json({ configured: isLinkedInConfigured(), accounts: fresh.map(publicAccount) });
    } catch (err) {
      console.error('Error loading LinkedIn accounts:', err.message);
      return res.status(500).json({ error: 'Failed to load LinkedIn accounts.' });
    }
  });

  router.delete('/linkedin-accounts/:id', authenticateToken, async (req, res) => {
    if (!isDbReady()) return res.status(503).json({ error: 'Database is not connected.' });
    try {
      const result = await pool.query('DELETE FROM linkedin_accounts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
      if (!result.rowCount) return res.status(404).json({ error: 'Account not found.' });
      return res.status(204).end();
    } catch (err) {
      console.error('Error deleting LinkedIn account:', err.message);
      return res.status(500).json({ error: 'Failed to remove account.' });
    }
  });

  return router;
}

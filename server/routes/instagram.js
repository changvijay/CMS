import express from 'express';
import jwt from 'jsonwebtoken';
import { pool, isDbReady } from '../db.js';
import { resolveRedirectUri, safeReturnPath, withParams } from '../utils/oauth.js';
import { subscribeAccount } from '../services/instagramMessaging.js';

/**
 * "Connect Instagram" (Instagram API with Instagram Login). The short-lived code is swapped for a 60-day token,
 * which instagramAuth.js then renews automatically, so there is nothing to paste.
 */
const CALLBACK_PATH = '/api/instagram/callback';
const GRAPH = 'https://graph.instagram.com';

// Profile + analytics, posting, comments (auto-replies) and DMs (private replies).
export const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_insights',
  'instagram_business_content_publish',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
];

export function instagramConfig() {
  return {
    // Trimmed: a stray space or newline pasted into the host's env settings breaks every call.
    appId: process.env.INSTAGRAM_APP_ID?.trim(),
    appSecret: process.env.INSTAGRAM_APP_SECRET?.trim(),
    redirectUri: process.env.INSTAGRAM_REDIRECT_URI || null,
    scopes: (process.env.INSTAGRAM_SCOPES ? process.env.INSTAGRAM_SCOPES.split(/[\s,]+/) : INSTAGRAM_SCOPES).filter(Boolean),
  };
}
export const isInstagramConfigured = () => Boolean(instagramConfig().appId && instagramConfig().appSecret);

async function json(res, what) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error || data.error_type) {
    const message = data.error?.message || data.error_message || data.error_description || `failed (${res.status})`;
    console.error(`${what} failed (${res.status}):`, JSON.stringify(data));
    // Say which step failed, so the error on the Accounts page points at the right call.
    throw Object.assign(new Error(`${what}: ${message}`), { status: res.status });
  }
  return data;
}

/** code -> short-lived token -> 60-day token -> profile. */
export async function exchangeInstagramCode(code, redirectUri, fetchImpl = fetch) {
  const { appId, appSecret } = instagramConfig();
  const shortRes = await json(await fetchImpl('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: appId, client_secret: appSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code }).toString(),
  }), 'Instagram sign-in');
  // Some app setups wrap the answer as { data: [ {...} ] }.
  const short = Array.isArray(shortRes.data) ? shortRes.data[0] || {} : shortRes;
  if (!short.access_token) throw new Error(`Instagram sign-in: no token in the reply (got: ${Object.keys(shortRes).join(', ') || 'nothing'})`);

  // Swap for a 60-day token. Some apps get a token Instagram won't swap ("Unsupported request"); then keep the
  // one we have, and the renewal job (instagramAuth.js) turns it into a 60-day token when Instagram allows.
  let token = short.access_token;
  let expiresIn = Number(short.expires_in) || 3600;
  // The two secrets on the Meta dashboard are easy to mix up, so try both before giving up.
  const secrets = [['INSTAGRAM_APP_SECRET', appSecret], ['META_APP_SECRET', process.env.META_APP_SECRET?.trim()]]
    .filter(([, s], i, all) => s && all.findIndex(([, t]) => t === s) === i);
  let exchanged = false;
  for (const [secretName, secret] of secrets) {
    try {
      const long = await json(await fetchImpl(`${GRAPH}/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: secret, access_token: short.access_token })}`), 'Instagram long-lived token');
      if (!long.access_token) continue;
      token = long.access_token;
      expiresIn = Number(long.expires_in) || 60 * 24 * 3600;
      exchanged = true;
      if (secretName !== 'INSTAGRAM_APP_SECRET') console.warn(`Instagram long-lived swap worked with ${secretName}: set INSTAGRAM_APP_SECRET to that value.`);
      break;
    } catch (err) {
      console.warn(`Instagram long-lived swap failed with ${secretName}: ${err.message}`);
    }
  }
  if (!exchanged) console.warn(`Instagram long-lived swap failed with every secret; keeping the sign-in token (reply had: ${Object.keys(short).join(', ')}, expires_in=${short.expires_in ?? 'none'})`);
  const me = await json(await fetchImpl(`${GRAPH}/v24.0/me?${new URLSearchParams({ fields: 'id,user_id,username,name,profile_picture_url', access_token: token })}`), 'Instagram profile');
  return { token, expiresIn, exchanged, scope: [].concat(short.permissions || []).join(',') || null, me };
}

export function createInstagramRouter(authenticateToken, jwtSecret) {
  const router = express.Router();

  router.get('/instagram/connect-url', authenticateToken, (req, res) => {
    if (!isInstagramConfigured()) return res.status(500).json({ error: 'Instagram sign-in is not set up on the server yet (INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET).' });
    const redirectUri = resolveRedirectUri(String(req.query.origin || ''), instagramConfig().redirectUri, CALLBACK_PATH);
    if (!redirectUri) return res.status(400).json({ error: 'Missing or invalid origin.' });
    const state = jwt.sign({ uid: req.user.userId, ru: redirectUri, back: safeReturnPath(req.query.returnTo), purpose: 'instagram' }, jwtSecret, { expiresIn: '10m' });
    const params = new URLSearchParams({
      client_id: instagramConfig().appId, redirect_uri: redirectUri, response_type: 'code', scope: instagramConfig().scopes.join(','), state,
      enable_fb_login: '0', force_reauth: 'true',
    });
    return res.json({ url: `https://www.instagram.com/oauth/authorize?${params.toString()}` });
  });

  router.get('/instagram/callback', async (req, res) => {
    let back = '/accounts';
    const finish = (params) => res.redirect(withParams(back, params));
    try {
      const payload = jwt.verify(String(req.query.state || ''), jwtSecret);
      if (payload.purpose !== 'instagram') throw new Error('bad state');
      back = `${new URL(payload.ru).origin}${safeReturnPath(payload.back)}`;
      if (req.query.error) return finish({ instagram: 'error', message: String(req.query.error_description || req.query.error_reason || req.query.error) });
      if (!isDbReady()) return finish({ instagram: 'error', message: 'Database is not connected.' });

      // Instagram appends "#_" to the code; it is not part of it.
      const code = String(req.query.code || '').replace(/#_$/, '');
      const { token, expiresIn, exchanged, me } = await exchangeInstagramCode(code, payload.ru);
      // Not swapped yet: leave "last renewed" empty so the renewal job tries again soon.
      const refreshedAt = exchanged ? new Date() : null;
      const name = me.username || me.name || 'Instagram account';
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      // Same account connected again (or added by hand before): update it instead of adding a duplicate.
      const updated = await pool.query(
        `UPDATE instagram_accounts SET page_name = $3, access_token = $4, page_id = $5, ig_user_id = $6, profile_picture_url = $7,
                token_expires_at = $8, token_refreshed_at = $9, last_refresh_error = NULL, last_refresh_failed_at = NULL
          WHERE user_id = $1 AND (page_id = $5 OR ig_user_id = $6 OR page_id = $6 OR ig_user_id = $2) RETURNING *`,
        [payload.uid, String(me.id), name, token, String(me.id), String(me.user_id || me.id), me.profile_picture_url || null, expiresAt, refreshedAt]
      );
      const account = updated.rows[0] || (await pool.query(
        `INSERT INTO instagram_accounts (user_id, page_name, access_token, page_id, ig_user_id, profile_picture_url, token_expires_at, token_refreshed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [payload.uid, name, token, String(me.id), String(me.user_id || me.id), me.profile_picture_url || null, expiresAt, refreshedAt]
      )).rows[0];

      // Turn on comment/DM webhooks for auto-replies straight away; failing here is not fatal (the Auto-replies page can retry).
      const sub = await subscribeAccount(account).catch((err) => ({ error: { message: err.message } }));
      if (sub.error) console.warn(`Instagram webhook subscribe failed for instagram#${account.id}: ${sub.error.message}`);
      return finish({ instagram: 'connected', name: `@${name}` });
    } catch (err) {
      console.error('Instagram callback failed:', err.message);
      const expired = err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError' || err.message === 'bad state';
      return finish({ instagram: 'error', message: expired ? 'That Instagram sign-in link expired. Please click Connect Instagram again.' : err.message });
    }
  });

  return router;
}

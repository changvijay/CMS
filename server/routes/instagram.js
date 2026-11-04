import express from 'express';
import jwt from 'jsonwebtoken';
import { pool, isDbReady } from '../db.js';
import { resolveRedirectUri, safeReturnPath, withParams } from '../utils/oauth.js';
import { subscribeAccount } from '../services/instagramMessaging.js';
import { flowLogger, mask, newFlowId, requestInfo } from '../utils/oauthLog.js';

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
export async function exchangeInstagramCode(code, redirectUri, fetchImpl = fetch, log = null) {
  const { appId, appSecret } = instagramConfig();
  // With a flow logger, every call to Instagram is logged with its full (masked) reply.
  const call = (label) => (log ? log.fetchLogged(label, fetchImpl) : fetchImpl);
  log?.step('exchange.start', { appId, appSecret: mask(appSecret), metaAppSecret: mask(process.env.META_APP_SECRET?.trim()), redirectUri, code: mask(code) });
  const shortRes = await json(await call('short_token')('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: appId, client_secret: appSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code }).toString(),
  }), 'Instagram sign-in');
  // Some app setups wrap the answer as { data: [ {...} ] }.
  const short = Array.isArray(shortRes.data) ? shortRes.data[0] || {} : shortRes;
  log?.step('exchange.short_token', { wrapped: Array.isArray(shortRes.data), keys: Object.keys(short), user_id: short.user_id, permissions: short.permissions, expires_in: short.expires_in, access_token: mask(short.access_token) });
  if (!short.access_token) throw new Error(`Instagram sign-in: no token in the reply (got: ${Object.keys(shortRes).join(', ') || 'nothing'})`);

  // Swap for a 60-day token. Some apps get a token Instagram won't swap ("Unsupported request"); then keep the
  // one we have, and the renewal job (instagramAuth.js) turns it into a 60-day token when Instagram allows.
  let token = short.access_token;
  let expiresIn = Number(short.expires_in) || 3600;
  // The two secrets on the Meta dashboard are easy to mix up, so try both before giving up.
  const secrets = [['INSTAGRAM_APP_SECRET', appSecret], ['META_APP_SECRET', process.env.META_APP_SECRET?.trim()]]
    .filter(([, s], i, all) => s && all.findIndex(([, t]) => t === s) === i);
  log?.step('exchange.long_token.secrets_to_try', secrets.map(([name, s]) => ({ name, secret: mask(s) })));
  let exchanged = false;
  for (const [secretName, secret] of secrets) {
    try {
      const long = await json(await call(`long_token[${secretName}]`)(`${GRAPH}/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: secret, access_token: short.access_token })}`), 'Instagram long-lived token');
      if (!long.access_token) { log?.step('exchange.long_token.no_token', { secretName, keys: Object.keys(long) }); continue; }
      token = long.access_token;
      expiresIn = Number(long.expires_in) || 60 * 24 * 3600;
      exchanged = true;
      log?.step('exchange.long_token.ok', { secretName, expires_in: long.expires_in, access_token: mask(token) });
      if (secretName !== 'INSTAGRAM_APP_SECRET') console.warn(`Instagram long-lived swap worked with ${secretName}: set INSTAGRAM_APP_SECRET to that value.`);
      break;
    } catch (err) {
      console.warn(`Instagram long-lived swap failed with ${secretName}: ${err.message}`);
      log?.error('exchange.long_token', err, { secretName });
    }
  }
  if (!exchanged) console.warn(`Instagram long-lived swap failed with every secret; keeping the sign-in token (reply had: ${Object.keys(short).join(', ')}, expires_in=${short.expires_in ?? 'none'})`);
  const me = await json(await call('profile')(`${GRAPH}/v24.0/me?${new URLSearchParams({ fields: 'id,user_id,username,name,profile_picture_url', access_token: token })}`), 'Instagram profile');
  log?.step('exchange.done', { exchanged, expiresIn, me });
  return { token, expiresIn, exchanged, scope: [].concat(short.permissions || []).join(',') || null, me };
}

export function createInstagramRouter(authenticateToken, jwtSecret) {
  const router = express.Router();

  router.get('/instagram/connect-url', authenticateToken, (req, res) => {
    const log = flowLogger('instagram', newFlowId('instagram'));
    const cfg = instagramConfig();
    log.step('connect_url.request', { ...requestInfo(req), userId: req.user?.userId });
    log.step('connect_url.config', {
      configured: isInstagramConfigured(), appId: cfg.appId || null, appSecret: mask(cfg.appSecret),
      envRedirectUri: cfg.redirectUri, scopes: cfg.scopes, scopesFromEnv: Boolean(process.env.INSTAGRAM_SCOPES),
    });
    if (!isInstagramConfigured()) { log.step('connect_url.abort', { reason: 'INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET missing' }); return res.status(500).json({ error: 'Instagram sign-in is not set up on the server yet (INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET).' }); }
    const redirectUri = resolveRedirectUri(String(req.query.origin || ''), instagramConfig().redirectUri, CALLBACK_PATH);
    log.step('connect_url.redirect_uri', { origin: req.query.origin || null, redirectUri, source: cfg.redirectUri ? 'INSTAGRAM_REDIRECT_URI env' : 'browser origin', note: 'must match a Valid OAuth Redirect URI in the Meta app EXACTLY' });
    if (!redirectUri) { log.step('connect_url.abort', { reason: 'missing or invalid origin' }); return res.status(400).json({ error: 'Missing or invalid origin.' }); }
    const back = safeReturnPath(req.query.returnTo);
    const state = jwt.sign({ uid: req.user.userId, ru: redirectUri, back, purpose: 'instagram', fid: log.flowId }, jwtSecret, { expiresIn: '10m' });
    log.step('connect_url.state', { uid: req.user.userId, returnTo: req.query.returnTo || null, back, expiresIn: '10m' });
    const params = new URLSearchParams({
      client_id: instagramConfig().appId, redirect_uri: redirectUri, response_type: 'code', scope: instagramConfig().scopes.join(','), state,
      enable_fb_login: '0', force_reauth: 'true',
    });
    const url = `https://www.instagram.com/oauth/authorize?${params.toString()}`;
    log.step('connect_url.sent', { authorizeUrl: url.replace(/state=[^&]+/, 'state=<jwt>'), next: 'browser goes to Instagram; waiting for /api/instagram/callback' });
    return res.json({ url, flowId: log.flowId });
  });

  router.get('/instagram/callback', async (req, res) => {
    // Read the flow id from the state (unverified peek, only for the log) so these lines join the connect-url ones.
    const peek = jwt.decode(String(req.query.state || '')) || {};
    const log = flowLogger('instagram', peek.fid || newFlowId('instagram'));
    log.step('callback.hit', { ...requestInfo(req), hasCode: Boolean(req.query.code), hasState: Boolean(req.query.state), statePeek: peek });
    let back = '/accounts';
    const finish = (params) => {
      const to = withParams(back, params);
      log.step(params.instagram === 'connected' ? 'callback.finish SUCCESS' : 'callback.finish FAILED', { redirectTo: to, ...params });
      return res.redirect(to);
    };
    try {
      let payload;
      try {
        payload = jwt.verify(String(req.query.state || ''), jwtSecret);
      } catch (err) {
        log.error('callback.state_verify', err, { hint: err.name === 'TokenExpiredError' ? 'more than 10 min between clicking Connect and coming back' : 'state missing/tampered, or JWT_SECRET differs between the server that made the URL and this one' });
        throw err;
      }
      if (payload.purpose !== 'instagram') { log.step('callback.state_bad_purpose', { purpose: payload.purpose }); throw new Error('bad state'); }
      back = `${new URL(payload.ru).origin}${safeReturnPath(payload.back)}`;
      log.step('callback.state_ok', { uid: payload.uid, redirectUri: payload.ru, back, issuedAt: new Date(payload.iat * 1000).toISOString(), expiresAt: new Date(payload.exp * 1000).toISOString() });
      if (req.query.error) {
        log.step('callback.instagram_returned_error', { error: req.query.error, error_reason: req.query.error_reason, error_description: req.query.error_description, hint: 'user cancelled, or the app/tester/scopes are not allowed for this Instagram account' });
        return finish({ instagram: 'error', message: String(req.query.error_description || req.query.error_reason || req.query.error) });
      }
      if (!isDbReady()) { log.step('callback.db_not_ready'); return finish({ instagram: 'error', message: 'Database is not connected.' }); }
      if (!req.query.code) log.step('callback.no_code', { hint: 'Instagram came back with neither code nor error' });

      // Instagram appends "#_" to the code; it is not part of it.
      const code = String(req.query.code || '').replace(/#_$/, '');
      const { token, expiresIn, exchanged, me } = await exchangeInstagramCode(code, payload.ru, fetch, log);
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
      log.step('callback.db_update', { matchedRows: updated.rowCount, ids: updated.rows.map((r) => r.id), name, igId: String(me.id), igUserId: String(me.user_id || me.id), expiresAt, refreshedAt });
      if (!updated.rows[0]) log.step('callback.db_insert', { reason: 'no existing row for this Instagram account; adding a new one' });
      const account = updated.rows[0] || (await pool.query(
        `INSERT INTO instagram_accounts (user_id, page_name, access_token, page_id, ig_user_id, profile_picture_url, token_expires_at, token_refreshed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [payload.uid, name, token, String(me.id), String(me.user_id || me.id), me.profile_picture_url || null, expiresAt, refreshedAt]
      )).rows[0];

      // Turn on comment/DM webhooks for auto-replies straight away; failing here is not fatal (the Auto-replies page can retry).
      log.step('callback.db_saved', { accountId: account.id, page_name: account.page_name, token: mask(account.access_token) });
      log.step('callback.webhook_subscribe.start', { accountId: account.id });
      const sub = await subscribeAccount(account).catch((err) => ({ error: { message: err.message } }));
      log.step(sub.error ? 'callback.webhook_subscribe FAILED (not fatal)' : 'callback.webhook_subscribe.ok', sub);
      if (sub.error) console.warn(`Instagram webhook subscribe failed for instagram#${account.id}: ${sub.error.message}`);
      return finish({ instagram: 'connected', name: `@${name}` });
    } catch (err) {
      console.error('Instagram callback failed:', err.message);
      log.error('callback.failed', err);
      const expired = err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError' || err.message === 'bad state';
      return finish({ instagram: 'error', message: expired ? 'That Instagram sign-in link expired. Please click Connect Instagram again.' : err.message });
    }
  });

  return router;
}

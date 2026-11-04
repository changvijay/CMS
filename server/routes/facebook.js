import express from 'express';
import jwt from 'jsonwebtoken';
import { pool, isDbReady } from '../db.js';
import { buildFacebookAuthUrl, exchangeFacebookCode, facebookConfig, fetchManagedPages, isFacebookConfigured, logFacebookTokenDiagnostics } from '../services/facebookApi.js';
import { flowLogger, mask, newFlowId, requestInfo } from '../utils/oauthLog.js';
import { resolveRedirectUri, safeReturnPath, withParams } from '../utils/oauth.js';

const CALLBACK_PATH = '/api/facebook/callback';

export function createFacebookRouter(authenticateToken, jwtSecret) {
  const router = express.Router();

  router.get('/facebook/connect-url', authenticateToken, (req, res) => {
    const log = flowLogger('facebook', newFlowId('facebook'), req.user?.userId);
    const cfg = facebookConfig();
    log.step('connect_url.request', { ...requestInfo(req), userId: req.user?.userId });
    log.step('connect_url.config', {
      configured: isFacebookConfigured(), appId: cfg.appId || null, appSecret: mask(cfg.appSecret), envRedirectUri: cfg.redirectUri,
      configId: cfg.configId, mode: cfg.configId ? 'Login for Business (config_id; scopes come from the saved configuration)' : 'classic scope list',
      scopes: cfg.configId ? '(ignored, config_id used)' : cfg.scopes, scopesFromEnv: Boolean(process.env.FACEBOOK_SCOPES),
    });
    if (!isFacebookConfigured()) { log.step('connect_url.abort', { reason: 'FACEBOOK_APP_ID / FACEBOOK_APP_SECRET missing' }); return res.status(500).json({ error: 'Facebook is not set up on the server yet (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET).' }); }
    const redirectUri = resolveRedirectUri(String(req.query.origin || ''), cfg.redirectUri, CALLBACK_PATH);
    log.step('connect_url.redirect_uri', { origin: req.query.origin || null, redirectUri, source: cfg.redirectUri ? 'FACEBOOK_REDIRECT_URI env' : 'browser origin', note: 'must match a Valid OAuth Redirect URI in the Meta app EXACTLY' });
    if (!redirectUri) { log.step('connect_url.abort', { reason: 'missing or invalid origin' }); return res.status(400).json({ error: 'Missing or invalid origin.' }); }
    const back = safeReturnPath(req.query.returnTo);
    const state = jwt.sign({ uid: req.user.userId, ru: redirectUri, back, purpose: 'facebook', fid: log.flowId }, jwtSecret, { expiresIn: '10m' });
    log.step('connect_url.state', { uid: req.user.userId, returnTo: req.query.returnTo || null, back, expiresIn: '10m' });
    const url = buildFacebookAuthUrl({ state, redirectUri });
    log.step('connect_url.sent', { authorizeUrl: url.replace(/state=[^&]+/, 'state=<jwt>'), next: 'browser goes to Facebook; waiting for /api/facebook/callback' });
    return res.json({ url, flowId: log.flowId });
  });

  router.get('/facebook/callback', async (req, res) => {
    // Read the flow id from the state (unverified peek, only for the log) so these lines join the connect-url ones.
    const peek = jwt.decode(String(req.query.state || '')) || {};
    const log = flowLogger('facebook', peek.fid || newFlowId('facebook'), peek.uid);
    log.step('callback.hit', { ...requestInfo(req), hasCode: Boolean(req.query.code), hasState: Boolean(req.query.state), statePeek: peek });
    let back = '/accounts';
    const finish = (params) => {
      const to = withParams(back, params);
      log.step(params.facebook === 'connected' ? 'callback.finish SUCCESS' : 'callback.finish FAILED', { redirectTo: to, ...params });
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
      if (payload.purpose !== 'facebook') { log.step('callback.state_bad_purpose', { purpose: payload.purpose }); throw new Error('bad state'); }
      back = `${new URL(payload.ru).origin}${safeReturnPath(payload.back)}`;
      log.step('callback.state_ok', { uid: payload.uid, redirectUri: payload.ru, back, issuedAt: new Date(payload.iat * 1000).toISOString(), expiresAt: new Date(payload.exp * 1000).toISOString() });
      if (req.query.error) {
        log.step('callback.facebook_returned_error', { error: req.query.error, error_code: req.query.error_code, error_reason: req.query.error_reason, error_description: req.query.error_description, hint: 'user cancelled, or the app/scopes/config_id are not allowed for this Facebook user' });
        return finish({ facebook: 'error', message: String(req.query.error_description || req.query.error) });
      }
      if (!isDbReady()) { log.step('callback.db_not_ready'); return finish({ facebook: 'error', message: 'Database is not connected.' }); }
      if (!req.query.code) log.step('callback.no_code', { hint: 'Facebook came back with neither code nor error' });

      const user = await exchangeFacebookCode(String(req.query.code || ''), payload.ru, log);
      await logFacebookTokenDiagnostics(user.access_token, log);
      const pages = await fetchManagedPages(user.access_token, log);
      if (!pages.length) log.step('callback.no_pages', { hint: 'me/accounts returned nothing: no Page was ticked in the dialog, the user is not a Page admin, or pages_show_list was not granted. Check diag.debug_token granular_scopes above.' });
      if (!pages.length) return finish({ facebook: 'error', message: 'This Facebook login does not manage any Page, or no Page was ticked when connecting.' });

      for (const p of pages) {
        await pool.query(
          `INSERT INTO facebook_pages (user_id, page_id, name, picture_url, page_access_token, ig_user_id, scope)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (user_id, page_id) DO UPDATE SET name = EXCLUDED.name, picture_url = EXCLUDED.picture_url,
             page_access_token = EXCLUDED.page_access_token, ig_user_id = EXCLUDED.ig_user_id, scope = EXCLUDED.scope, updated_at = NOW()`,
          [payload.uid, p.page_id, p.name, p.picture_url, p.access_token, p.ig_user_id, facebookConfig().scopes.join(',')]
        );
        log.step('callback.db_page_saved', { page_id: p.page_id, name: p.name, ig_user_id: p.ig_user_id, page_access_token: mask(p.access_token) });
        // Fill the Instagram account's professional id from the page link, so webhooks and publishing can match it.
        if (p.ig_user_id) {
          const linked = await pool.query('UPDATE instagram_accounts SET ig_user_id = $2 WHERE user_id = $1 AND ig_user_id IS NULL AND page_id = $2', [payload.uid, p.ig_user_id]);
          log.step('callback.db_link_instagram', { ig_user_id: p.ig_user_id, instagramRowsUpdated: linked.rowCount });
        }
      }
      return finish({ facebook: 'connected', name: pages.map((p) => p.name).join(', ') });
    } catch (err) {
      console.error('Facebook callback failed:', err.message);
      log.error('callback.failed', err);
      const expired = err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError' || err.message === 'bad state';
      return finish({ facebook: 'error', message: expired ? 'That Facebook sign-in link expired. Please click Connect Facebook again.' : err.message });
    }
  });

  router.get('/facebook-pages', authenticateToken, async (req, res) => {
    if (!isDbReady()) return res.status(503).json({ error: 'Database is not connected.' });
    try {
      const { rows } = await pool.query('SELECT id, page_id, name, picture_url, ig_user_id, created_at FROM facebook_pages WHERE user_id = $1 ORDER BY created_at DESC', [req.user.userId]);
      return res.json({ configured: isFacebookConfigured(), pages: rows });
    } catch (err) {
      console.error('Error loading Facebook pages:', err.message);
      return res.status(500).json({ error: 'Failed to load Facebook pages.' });
    }
  });

  router.delete('/facebook-pages/:id', authenticateToken, async (req, res) => {
    if (!isDbReady()) return res.status(503).json({ error: 'Database is not connected.' });
    const result = await pool.query('DELETE FROM facebook_pages WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Page not found.' });
    return res.status(204).end();
  });

  return router;
}

import express from 'express';
import jwt from 'jsonwebtoken';
import { pool, isDbReady } from '../db.js';
import { buildFacebookAuthUrl, exchangeFacebookCode, facebookConfig, fetchManagedPages, isFacebookConfigured } from '../services/facebookApi.js';
import { resolveRedirectUri, safeReturnPath, withParams } from '../utils/oauth.js';

const CALLBACK_PATH = '/api/facebook/callback';

export function createFacebookRouter(authenticateToken, jwtSecret) {
  const router = express.Router();

  router.get('/facebook/connect-url', authenticateToken, (req, res) => {
    if (!isFacebookConfigured()) return res.status(500).json({ error: 'Facebook is not set up on the server yet (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET).' });
    const redirectUri = resolveRedirectUri(String(req.query.origin || ''), facebookConfig().redirectUri, CALLBACK_PATH);
    if (!redirectUri) return res.status(400).json({ error: 'Missing or invalid origin.' });
    const state = jwt.sign({ uid: req.user.userId, ru: redirectUri, back: safeReturnPath(req.query.returnTo), purpose: 'facebook' }, jwtSecret, { expiresIn: '10m' });
    return res.json({ url: buildFacebookAuthUrl({ state, redirectUri }) });
  });

  router.get('/facebook/callback', async (req, res) => {
    let back = '/accounts';
    const finish = (params) => res.redirect(withParams(back, params));
    try {
      const payload = jwt.verify(String(req.query.state || ''), jwtSecret);
      if (payload.purpose !== 'facebook') throw new Error('bad state');
      back = `${new URL(payload.ru).origin}${safeReturnPath(payload.back)}`;
      if (req.query.error) return finish({ facebook: 'error', message: String(req.query.error_description || req.query.error) });
      if (!isDbReady()) return finish({ facebook: 'error', message: 'Database is not connected.' });

      const user = await exchangeFacebookCode(String(req.query.code || ''), payload.ru);
      const pages = await fetchManagedPages(user.access_token);
      if (!pages.length) return finish({ facebook: 'error', message: 'This Facebook login does not manage any Page, or no Page was ticked when connecting.' });

      for (const p of pages) {
        await pool.query(
          `INSERT INTO facebook_pages (user_id, page_id, name, picture_url, page_access_token, ig_user_id, scope)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (user_id, page_id) DO UPDATE SET name = EXCLUDED.name, picture_url = EXCLUDED.picture_url,
             page_access_token = EXCLUDED.page_access_token, ig_user_id = EXCLUDED.ig_user_id, scope = EXCLUDED.scope, updated_at = NOW()`,
          [payload.uid, p.page_id, p.name, p.picture_url, p.access_token, p.ig_user_id, facebookConfig().scopes.join(',')]
        );
        // Fill the Instagram account's professional id from the page link, so webhooks and publishing can match it.
        if (p.ig_user_id) {
          await pool.query('UPDATE instagram_accounts SET ig_user_id = $2 WHERE user_id = $1 AND ig_user_id IS NULL AND page_id = $2', [payload.uid, p.ig_user_id]);
        }
      }
      return finish({ facebook: 'connected', name: pages.map((p) => p.name).join(', ') });
    } catch (err) {
      console.error('Facebook callback failed:', err.message);
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

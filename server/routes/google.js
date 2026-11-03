import express from 'express';
import jwt from 'jsonwebtoken';
import { pool, isDbReady } from '../db.js';
import { resolveRedirectUri, safeReturnPath, withParams } from '../utils/oauth.js';
import { YOUTUBE_SCOPES } from '../services/googleAuth.js';

const CALLBACK_PATH = '/api/google/callback';
const googleClient = () => ({
  clientId: process.env.client_id || process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.client_secret || process.env.GOOGLE_CLIENT_SECRET,
});

export function createGoogleRouter(authenticateToken, jwtSecret) {
  const router = express.Router();

  router.get('/google/connect-url', authenticateToken, (req, res) => {
    const { clientId, clientSecret } = googleClient();
    if (!clientId || !clientSecret) return res.status(500).json({ error: 'Google OAuth client_id / client_secret are not configured on the server.' });
    const redirectUri = resolveRedirectUri(String(req.query.origin || ''), process.env.GOOGLE_REDIRECT_URI, CALLBACK_PATH);
    if (!redirectUri) return res.status(400).json({ error: 'Missing or invalid origin.' });
    const state = jwt.sign({ uid: req.user.userId, ru: redirectUri, back: safeReturnPath(req.query.returnTo), purpose: 'google' }, jwtSecret, { expiresIn: '10m' });
    const params = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: YOUTUBE_SCOPES.join(' '),
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
    });
    return res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  });

  router.get('/google/callback', async (req, res) => {
    let back = '/accounts';
    const finish = (params) => res.redirect(withParams(back, params));
    try {
      const payload = jwt.verify(String(req.query.state || ''), jwtSecret);
      if (payload.purpose !== 'google') throw new Error('bad state');
      back = `${new URL(payload.ru).origin}${safeReturnPath(payload.back)}`;
      if (req.query.error) return finish({ youtube: 'error', message: String(req.query.error) });
      if (!isDbReady()) return finish({ youtube: 'error', message: 'Database is not connected.' });

      const { clientId, clientSecret } = googleClient();
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: String(req.query.code || ''), client_id: clientId, client_secret: clientSecret, redirect_uri: payload.ru, grant_type: 'authorization_code' }).toString(),
      });
      const tokens = await tokenRes.json();
      if (!tokenRes.ok || tokens.error) throw new Error(tokens.error_description || tokens.error || 'Google sign-in failed');
      if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove this app at myaccount.google.com/permissions and connect again.');

      const chRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      const ch = await chRes.json();
      const channels = ch.items || [];
      if (!channels.length) throw new Error('This Google account has no YouTube channel.');

      for (const c of channels) {
        const uploads = c.contentDetails?.relatedPlaylists?.uploads || '';
        const picture = c.snippet?.thumbnails?.default?.url || null;
        const updated = await pool.query(
          `UPDATE Youtube_accounts SET channel_name = $3, access_token = $4, scope = $5, channel_id = $6, picture_url = $7, playlist_id = COALESCE(NULLIF($8, ''), playlist_id)
            WHERE user_id = $1 AND (channel_id = $2 OR playlist_id = $8) RETURNING id`,
          [payload.uid, c.id, c.snippet?.title || 'YouTube channel', tokens.refresh_token, tokens.scope || YOUTUBE_SCOPES.join(' '), c.id, picture, uploads]
        );
        if (!updated.rowCount) {
          await pool.query(
            `INSERT INTO Youtube_accounts (user_id, channel_name, access_token, playlist_id, scope, channel_id, picture_url) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [payload.uid, c.snippet?.title || 'YouTube channel', tokens.refresh_token, uploads, tokens.scope || YOUTUBE_SCOPES.join(' '), c.id, picture]
          );
        }
      }
      return finish({ youtube: 'connected', name: channels.map((c) => c.snippet?.title).join(', ') });
    } catch (err) {
      console.error('Google callback failed:', err.message);
      const expired = err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError' || err.message === 'bad state';
      return finish({ youtube: 'error', message: expired ? 'That Google sign-in link expired. Please click Connect YouTube again.' : err.message });
    }
  });

  return router;
}

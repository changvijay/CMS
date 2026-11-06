import crypto from 'node:crypto';
import { createTtlCache } from '../utils/ttlCache.js';

// Analytics + comments (already used by the dashboards) plus upload, thumbnails and playlists for publishing.
export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
];

/** True when a stored scope string allows uploading. Unknown (null) means a hand-pasted token: we can't tell. */
export function canUpload(scope) {
  if (!scope) return null;
  // videos.insert accepts any of these (youtube.readonly alone does not).
  return String(scope).split(/\s+/).some((s) => /auth\/youtube(\.upload|\.force-ssl)?$/.test(s));
}

// Google access tokens live about an hour. Reusing one saves an OAuth round trip on every YouTube request.
const accessTokens = createTtlCache({ maxEntries: 200 });
const EXPIRY_MARGIN_S = 120;
const cacheKeyOf = new Map(); // access token -> cache key, so a rejected access token can be dropped

const keyFor = (rawToken) => crypto.createHash('sha256').update(rawToken).digest('hex');

export function clearGoogleTokenCache() {
  accessTokens.invalidate();
  cacheKeyOf.clear();
}

/**
 * Call when a YouTube API answers 401 for this access token (Google revoked access early):
 * the next request exchanges the refresh token again, which either works or says to reconnect.
 */
export function forgetGoogleAccessToken(accessToken) {
  const token = String(accessToken || '').replace(/^Bearer\s+/i, '');
  const key = cacheKeyOf.get(token);
  if (key) accessTokens.invalidate(key);
  cacheKeyOf.delete(token);
}

/** Drops the cached access token when a YouTube response says it is no longer accepted. */
export function noteYoutubeResponse(status, headers) {
  if (status === 401) forgetGoogleAccessToken(headers?.Authorization);
}

export const RECONNECT_YOUTUBE = 'YouTube access was revoked or has expired. Press Reconnect on the Accounts page.';
// Google expires refresh tokens of apps in "Testing" after 7 days; this is the usual cause of a weekly disconnect.
const TESTING_HINT = 'If this happens about once a week, the Google Cloud OAuth app is still in "Testing": '
  + 'open Google Cloud Console -> APIs & Services -> OAuth consent screen and press "Publish app" (In production).';

/**
 * Exchanges a stored Google refresh token for a short-lived access token.
 * Errors carry `status` (HTTP-ish code) and `reason` (Google's error code) for the UI.
 */
export async function getGoogleAccessTokenFromRefreshToken(rawToken, { fresh = false } = {}) {
  if (!rawToken || rawToken === '******') return exchangeRefreshToken(rawToken);
  const key = keyFor(rawToken);
  // `fresh` asks Google now (status checks): a revoked refresh token is noticed at once instead of after the cache expires.
  if (fresh) accessTokens.invalidate(key);
  const { token } = await accessTokens.getOrLoad(
    key,
    ({ expiresIn }) => Math.max(0, (expiresIn - EXPIRY_MARGIN_S) * 1000),
    async () => {
      const result = await exchangeRefreshToken(rawToken, { withExpiry: true });
      cacheKeyOf.set(result.access_token, key);
      if (cacheKeyOf.size > 500) cacheKeyOf.delete(cacheKeyOf.keys().next().value);
      return { token: result.access_token, expiresIn: Number(result.expires_in) || 0 };
    }
  );
  return token;
}

async function exchangeRefreshToken(rawToken, { withExpiry = false } = {}) {
  const clientId = process.env.client_id || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.client_secret || process.env.GOOGLE_CLIENT_SECRET;
  const grantType = process.env.grant_type || 'refresh_token';

  if (!rawToken || rawToken === '******') {
    throw Object.assign(new Error('No valid refresh token provided in Youtube_accounts database.'), { status: 400 });
  }

  if (!clientId || !clientSecret) {
    throw Object.assign(new Error('Google OAuth client_id / client_secret are not configured on the server.'), { status: 500 });
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: rawToken,
      grant_type: grantType,
    }).toString(),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    const errDesc = data.error_description || data.error || 'Failed to refresh Google OAuth access token';
    // invalid_grant: the refresh token was revoked or expired. Only signing in again fixes it.
    if (data.error === 'invalid_grant') {
      throw Object.assign(new Error(`${RECONNECT_YOUTUBE} (Google: ${errDesc}) ${TESTING_HINT}`), { status: 401, reason: 'reconnect_required' });
    }
    throw Object.assign(new Error(`Google OAuth Exchange Failed (${response.status}): ${errDesc}`), {
      status: response.status,
      reason: data.error,
    });
  }

  return withExpiry ? data : data.access_token;
}

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

/**
 * Exchanges a stored Google refresh token for a short-lived access token.
 * Errors carry `status` (HTTP-ish code) and `reason` (Google's error code) for the UI.
 */
export async function getGoogleAccessTokenFromRefreshToken(rawToken) {
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
    throw Object.assign(new Error(`Google OAuth Exchange Failed (${response.status}): ${errDesc}`), {
      status: response.status,
      reason: data.error,
    });
  }

  return data.access_token;
}

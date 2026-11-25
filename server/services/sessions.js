import crypto from 'crypto';
import { pool } from '../db.js';

/** Access JWTs are short; the refresh token keeps the device signed in until logout. */
export const ACCESS_TOKEN_TTL = '1h';
/** A session nobody has used for this long is treated as gone. */
export const IDLE_LIMIT_DAYS = 365;
/** How long the token just replaced by a refresh still works (covers parallel refreshes). */
export const ROTATION_GRACE_SECONDS = 120;

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function newRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function deviceLabel(req) {
  return String(req.get?.('user-agent') || '').slice(0, 200) || null;
}

/** Starts a session for a freshly signed-in device and returns its refresh token. */
export async function createSession(userId, req, db = pool) {
  const token = newRefreshToken();
  await db.query(
    'INSERT INTO user_sessions (user_id, token_hash, device) VALUES ($1, $2, $3)',
    [userId, hashToken(token), deviceLabel(req)],
  );
  return token;
}

/**
 * Swaps a refresh token for a new one. Returns { userId, refreshToken } or null when the
 * token is unknown, revoked, or idle for too long.
 */
export async function rotateSession(token, db = pool) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const hash = hashToken(token);
  const res = await db.query(
    `SELECT id, user_id FROM user_sessions
      WHERE revoked_at IS NULL
        AND last_used_at > NOW() - ($2 || ' days')::interval
        AND (token_hash = $1
             OR (prev_token_hash = $1 AND rotated_at > NOW() - ($3 || ' seconds')::interval))
      LIMIT 1`,
    [hash, String(IDLE_LIMIT_DAYS), String(ROTATION_GRACE_SECONDS)],
  );
  const session = res.rows[0];
  if (!session) return null;
  const next = newRefreshToken();
  await db.query(
    `UPDATE user_sessions
        SET prev_token_hash = token_hash, token_hash = $2, rotated_at = NOW(), last_used_at = NOW()
      WHERE id = $1`,
    [session.id, hashToken(next)],
  );
  return { userId: session.user_id, refreshToken: next };
}

/** Signs one device out for good. Unknown tokens are ignored. */
export async function revokeSession(token, db = pool) {
  if (typeof token !== 'string' || !token) return;
  const hash = hashToken(token);
  await db.query(
    'UPDATE user_sessions SET revoked_at = NOW() WHERE revoked_at IS NULL AND (token_hash = $1 OR prev_token_hash = $1)',
    [hash],
  );
}

/** Drops sessions that were revoked or left unused past the idle limit. */
export async function pruneSessions(db = pool) {
  await db.query(
    `DELETE FROM user_sessions
      WHERE (revoked_at IS NOT NULL AND revoked_at < NOW() - interval '7 days')
         OR last_used_at < NOW() - ($1 || ' days')::interval`,
    [String(IDLE_LIMIT_DAYS)],
  );
}

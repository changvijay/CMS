/**
 * Is this error "the account is logged out / its access no longer works" (fixed by reconnecting),
 * rather than an outage or a bug? Each platform says it differently:
 * - Instagram / Facebook Graph: code 190 (OAuthException, expired or invalidated session), 102, 463, 467
 * - Google (YouTube): 401, or our own reason 'reconnect_required' / Google's 'invalid_grant'
 * - LinkedIn: 401, our reason 'reconnect_required', REVOKED_ACCESS_TOKEN / EXPIRED_ACCESS_TOKEN
 */
const AUTH_CODES = new Set([401, 190, 102, 463, 467]);
const AUTH_REASONS = new Set(['reconnect_required', 'invalid_grant', 'OAuthException', 'unauthorized', 'authError', 'REVOKED_ACCESS_TOKEN', 'EXPIRED_ACCESS_TOKEN', 'foreign_app']);
const AUTH_TEXT = /reconnect|access token|session has (expired|been invalidated)|token (has )?(expired|been revoked|is invalid)|invalid (oauth|refresh|access) token|refresh token is invalid|not authorized|unauthenticated|could not authenticate|login required|logged out/i;

export function isAuthError(err) {
  if (!err) return false;
  if (AUTH_CODES.has(Number(err.status)) || AUTH_CODES.has(Number(err.code))) return true;
  if (AUTH_REASONS.has(String(err.reason || ''))) return true;
  return AUTH_TEXT.test(String(err.message || ''));
}

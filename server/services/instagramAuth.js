import { pool, isDbReady } from '../db.js';

/**
 * Keeps Instagram long-lived tokens alive. They last 60 days and can be renewed for another 60 days any time
 * after they are 24 hours old, as long as they still work. We renew every 7 days, so a token only runs out if
 * renewing keeps failing for weeks. Only then is the account shown as expired.
 */
const REFRESH_URL = 'https://graph.instagram.com/refresh_access_token';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const REFRESH_EVERY_DAYS = 7;
/** After a failed renewal, wait this long before trying again (so a broken token isn't retried on every page load). */
export const RETRY_FAILED_AFTER_HOURS = 6;

const time = (v) => (v ? new Date(v).getTime() : null);

/** Is it time to renew this account's token? Pure, so it is unit-tested. */
export function refreshDue(account, now = Date.now()) {
  const failedAt = time(account.last_refresh_failed_at);
  if (failedAt && now - failedAt < RETRY_FAILED_AFTER_HOURS * HOUR_MS) return false;
  const renewedAt = time(account.token_refreshed_at);
  // Never renewed (or a token was just pasted in): try now. A token under 24 hours old is refused by
  // Instagram; that just counts as a failed try and is retried 6 hours later.
  if (!renewedAt) return true;
  return now - renewedAt >= REFRESH_EVERY_DAYS * DAY_MS;
}

/** Calls Instagram's refresh endpoint. Returns { data: { access_token, expires_in } } or { error }. */
export async function requestRefresh(accessToken, fetchImpl = fetch) {
  try {
    const qs = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: accessToken });
    const res = await fetchImpl(`${REFRESH_URL}?${qs.toString()}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error || !json.access_token) {
      return { error: { code: json.error?.code || res.status, message: json.error?.message || `Instagram token refresh failed (${res.status})` } };
    }
    return { data: json };
  } catch (err) {
    return { error: { code: 502, message: `Failed to reach Instagram: ${err.message}` } };
  }
}

/** Renews one token and saves the result. Never throws: a failure is recorded on the account and returned. */
export async function refreshInstagramToken(account, { fetchImpl = fetch, now = Date.now() } = {}) {
  const r = await requestRefresh(account.access_token, fetchImpl);
  if (r.error) {
    const message = `Error ${r.error.code}: ${r.error.message}`;
    await pool.query('UPDATE instagram_accounts SET last_refresh_error = $2, last_refresh_failed_at = $3 WHERE id = $1', [account.id, message, new Date(now)]).catch(() => {});
    return { ...account, last_refresh_error: message, last_refresh_failed_at: new Date(now) };
  }
  const expiresAt = new Date(now + Number(r.data.expires_in || 60 * 24 * 3600) * 1000);
  await pool.query(
    `UPDATE instagram_accounts SET access_token = $2, token_expires_at = $3, token_refreshed_at = $4, last_refresh_error = NULL, last_refresh_failed_at = NULL
      WHERE id = $1`,
    [account.id, r.data.access_token, expiresAt, new Date(now)]
  );
  return { ...account, access_token: r.data.access_token, token_expires_at: expiresAt, token_refreshed_at: new Date(now), last_refresh_error: null, last_refresh_failed_at: null };
}

/** Returns the account with a renewed token when renewal is due; otherwise as it was. */
export async function refreshIfDue(account, opts) {
  if (!account?.access_token || !refreshDue(account, opts?.now)) return account;
  try {
    return await refreshInstagramToken(account, opts);
  } catch {
    return account;
  }
}

/** Nightly job: renews every token that is due. */
export async function refreshAllInstagramTokens() {
  if (!isDbReady()) return;
  const { rows } = await pool.query('SELECT * FROM instagram_accounts ORDER BY id');
  for (const account of rows) {
    if (!refreshDue(account)) continue;
    const r = await refreshInstagramToken(account);
    if (r.last_refresh_error) console.warn(`Instagram token refresh failed for instagram#${account.id}: ${r.last_refresh_error}`);
    else console.log(`Instagram token refreshed for instagram#${account.id} (valid until ${r.token_expires_at.toISOString()})`);
  }
}

/**
 * What the Accounts page shows. Expired only when renewing failed AND the token no longer works
 * (`liveOk` is the result of a real API call, or null when it wasn't checked).
 */
export function tokenStatus(account, liveOk = null) {
  const failing = Boolean(account.last_refresh_error);
  if (failing && liveOk === false) return { status: 'expired', message: account.last_refresh_error };
  return {
    status: 'ok',
    auto_refresh: !failing && Boolean(account.token_refreshed_at),
    expires_at: account.token_expires_at || null,
    message: failing ? account.last_refresh_error : null,
  };
}

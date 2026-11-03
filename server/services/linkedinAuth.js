import { pool, isDbReady } from '../db.js';

const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const REST_URL = 'https://api.linkedin.com/rest';

const DAY_MS = 24 * 60 * 60 * 1000;
// Refresh this long before the access token runs out, so a missed nightly run never breaks anything.
export const REFRESH_WINDOW_DAYS = 7;

export function linkedinConfig() {
  return {
    clientId: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    // Company-page permissions from the Community Management API: list the pages you admin,
    // read their follower / visitor / post analytics, read their posts, and post as the page.
    scopes: (process.env.LINKEDIN_SCOPES || 'rw_organization_admin r_organization_social r_organization_followers r_organization_social_feed w_organization_social').split(/[\s,]+/).filter(Boolean),
    redirectUri: process.env.LINKEDIN_REDIRECT_URI || null,
  };
}

export function isLinkedInConfigured() {
  const { clientId, clientSecret } = linkedinConfig();
  return Boolean(clientId && clientSecret);
}

/** Posting as yourself ("Share on LinkedIn" + "Sign In with LinkedIn using OpenID Connect" products). */
export const PERSON_SCOPES = (process.env.LINKEDIN_PERSON_SCOPES || 'openid profile email w_member_social').split(/[\s,]+/).filter(Boolean);

export function buildAuthUrl({ state, redirectUri, scopes: override }) {
  const { clientId } = linkedinConfig();
  const scopes = override || linkedinConfig().scopes;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: scopes.join(' '),
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function tokenRequest(body) {
  const { clientId, clientSecret } = linkedinConfig();
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...body, client_id: clientId, client_secret: clientSecret }).toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw Object.assign(new Error(data.error_description || data.error || `LinkedIn token request failed (${response.status})`), {
      status: response.status,
      reason: data.error,
    });
  }
  return data;
}

export function exchangeCode(code, redirectUri) {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

export function refreshWithToken(refreshToken) {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

/** LinkedIn's versioned API wants a YYYYMM version; use one a couple of months old so it is always live. */
export function apiVersion(now = new Date()) {
  if (process.env.LINKEDIN_API_VERSION) return process.env.LINKEDIN_API_VERSION;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** GET on LinkedIn's versioned REST API. Use this for all company-page data calls. */
export async function linkedinGet(accessToken, path) {
  const response = await fetch(`${REST_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'LinkedIn-Version': apiVersion(),
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data.message || `LinkedIn API request failed (${response.status})`), { status: response.status });
  }
  return data;
}

/** The company pages this login is an admin of: [{ urn, id, name, vanityName }]. */
export async function fetchAdminPages(accessToken) {
  const acls = await linkedinGet(accessToken, '/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED');
  const urns = [...new Set((acls.elements || []).map((e) => e.organization).filter(Boolean))];
  return Promise.all(urns.map(async (urn) => {
    const id = urn.split(':').pop();
    try {
      const org = await linkedinGet(accessToken, `/organizations/${id}`);
      return { urn, id, name: org.localizedName || `Company page ${id}`, vanityName: org.vanityName || null };
    } catch {
      return { urn, id, name: `Company page ${id}`, vanityName: null };
    }
  }));
}

/** The signed-in member (OpenID userinfo): { sub, name, picture, email }. */
export async function fetchMember(accessToken) {
  const response = await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.sub) throw Object.assign(new Error(data.message || `LinkedIn profile request failed (${response.status})`), { status: response.status });
  return data;
}

/** Turns LinkedIn's "expires_in" seconds into absolute timestamps. */
export function tokenExpiry(data, now = Date.now()) {
  return {
    accessExpiresAt: new Date(now + Number(data.expires_in || 0) * 1000),
    refreshExpiresAt: data.refresh_token_expires_in ? new Date(now + Number(data.refresh_token_expires_in) * 1000) : null,
  };
}

/** 'ok' | 'refresh' (do it now) | 'expired' (needs the user to connect again). */
export function tokenState(account, now = Date.now()) {
  const accessLeft = new Date(account.access_token_expires_at).getTime() - now;
  const canRefresh = Boolean(account.refresh_token) &&
    (!account.refresh_token_expires_at || new Date(account.refresh_token_expires_at).getTime() > now);
  if (accessLeft > REFRESH_WINDOW_DAYS * DAY_MS) return 'ok';
  if (canRefresh) return 'refresh';
  return accessLeft > 0 ? 'ok' : 'expired';
}

/**
 * Saves a fresh token response. Every page connected with the same login shares one token, so all of
 * them are updated. LinkedIn may omit a new refresh token, in which case the old one is kept.
 */
export async function saveTokens(accountId, data, now = Date.now()) {
  const { accessExpiresAt, refreshExpiresAt } = tokenExpiry(data, now);
  const { rows } = await pool.query(
    `UPDATE linkedin_accounts SET
        access_token = $2,
        access_token_expires_at = $3,
        refresh_token = COALESCE($4, refresh_token),
        refresh_token_expires_at = CASE WHEN $4::text IS NULL THEN refresh_token_expires_at ELSE $5 END,
        scope = COALESCE($6, scope),
        last_refresh_error = NULL,
        last_refresh_failed_at = NULL,
        updated_at = NOW()
      WHERE id = $1
         OR (refresh_token IS NOT NULL AND refresh_token = (SELECT refresh_token FROM linkedin_accounts WHERE id = $1))
      RETURNING *`,
    [accountId, data.access_token, accessExpiresAt, data.refresh_token || null, refreshExpiresAt, data.scope || null]
  );
  return rows;
}

/** After a failed renewal, wait this long before trying again (so a broken token isn't retried on every page load). */
export const RETRY_FAILED_AFTER_HOURS = 6;

/** Is it time to renew? Due when close to expiry (see tokenState), unless a renewal failed in the last 6 hours. */
export function refreshDue(account, now = Date.now()) {
  if (tokenState(account, now) !== 'refresh') return false;
  const failedAt = account.last_refresh_failed_at ? new Date(account.last_refresh_failed_at).getTime() : null;
  return !failedAt || now - failedAt >= RETRY_FAILED_AFTER_HOURS * 60 * 60 * 1000;
}

/** True when the refresh token can still be used (LinkedIn only issues one to some apps; it lasts a year). */
export const canRefresh = (account, now = Date.now()) => Boolean(account.refresh_token)
  && (!account.refresh_token_expires_at || new Date(account.refresh_token_expires_at).getTime() > now);

/** Renews now, whatever the dates say. Records the error on failure and throws it. */
export async function forceRefresh(account) {
  try {
    const data = await refreshWithToken(account.refresh_token);
    const rows = await saveTokens(account.id, data);
    return rows.find((r) => String(r.id) === String(account.id)) || rows[0];
  } catch (err) {
    await pool.query('UPDATE linkedin_accounts SET last_refresh_error = $2, last_refresh_failed_at = NOW(), updated_at = NOW() WHERE id = $1', [account.id, err.message]).catch(() => {});
    throw err;
  }
}

/** Refreshes one account's tokens if they are close to expiring. Returns the (possibly updated) row. */
export async function refreshIfNeeded(account) {
  if (!refreshDue(account)) return account;
  return forceRefresh(account);
}

/** A cheap real API call that proves the token works: the page for company pages, the profile for people. */
export async function verifyLinkedInToken(account) {
  try {
    if (account.account_type === 'person' || String(account.member_id).startsWith('urn:li:person:')) await fetchMember(account.access_token);
    else await linkedinGet(account.access_token, `/organizations/${String(account.member_id).split(':').pop()}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, status: err.status, message: err.message };
  }
}

/**
 * Checks the token for real; on 401 (revoked or expired early) tries one renewal and checks again.
 * Returns { account, ok, message }: ok=false means renewing could not save it and the user must reconnect.
 */
export async function ensureWorkingToken(account) {
  let current = account;
  try {
    current = await refreshIfNeeded(account);
  } catch {
    // the live check below decides whether the old token still works
  }
  const first = await verifyLinkedInToken(current);
  if (first.ok || first.status !== 401) return { account: current, ok: first.ok || first.status !== 401, message: first.ok ? null : first.message };
  if (!canRefresh(current)) return { account: current, ok: false, message: `${first.message} LinkedIn did not give this app a refresh token, so please reconnect.` };
  try {
    current = await forceRefresh(current);
  } catch (err) {
    return { account: current, ok: false, message: `${first.message} (automatic renewal also failed: ${err.message})` };
  }
  const second = await verifyLinkedInToken(current);
  return { account: current, ok: second.ok, message: second.ok ? null : second.message };
}

/** Use this from any LinkedIn data call: always hands back a working access token. */
export async function getLinkedInAccessToken(userId, accountId) {
  const { rows } = await pool.query(
    'SELECT * FROM linkedin_accounts WHERE user_id = $1 AND ($2::bigint IS NULL OR id = $2) ORDER BY created_at DESC LIMIT 1',
    [userId, accountId ?? null]
  );
  if (!rows.length) throw Object.assign(new Error('No LinkedIn account connected.'), { status: 404 });
  const account = await refreshIfNeeded(rows[0]);
  if (tokenState(account) === 'expired') {
    throw Object.assign(new Error('LinkedIn access expired. Please connect LinkedIn again.'), { status: 401 });
  }
  return account.access_token;
}

/** Nightly job: keeps every connected account's token alive. */
export async function refreshAllLinkedInTokens() {
  if (!isDbReady() || !isLinkedInConfigured()) return;
  const { rows } = await pool.query('SELECT * FROM linkedin_accounts ORDER BY id');
  const done = new Set();
  for (const account of rows) {
    if (!refreshDue(account) || done.has(account.refresh_token)) continue;
    done.add(account.refresh_token);
    try {
      await refreshIfNeeded(account);
      console.log(`LinkedIn token refreshed for linkedin#${account.id}`);
    } catch (err) {
      console.warn(`LinkedIn refresh failed for linkedin#${account.id}: ${err.message}`);
    }
  }
}

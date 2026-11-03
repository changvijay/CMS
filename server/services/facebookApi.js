/**
 * Facebook Graph API (Facebook Login) helpers: the OAuth flow for Pages, and a small request wrapper.
 * The same page token also unlocks Instagram features that Instagram-Login tokens cannot use
 * (location search, product tags), through the page's linked Instagram account.
 */
export const GRAPH_VERSION = 'v24.0';
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Posting + analytics for Pages and their linked Instagram accounts. Every scope here must be added to the Meta app
 * (through its use cases) or Facebook rejects the login with "Invalid Scopes".
 * Product tags also need `instagram_shopping_tag_products,catalog_management`: add them with FACEBOOK_SCOPES once the
 * app has the catalog use case.
 */
export const FACEBOOK_SCOPES = [
  // Facebook Pages: list, post, read posts/comments, insights, reply to comments, webhooks
  'pages_show_list',
  'pages_manage_posts',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_engagement',
  'pages_manage_metadata',
  'read_insights',
  'business_management',
  // Instagram accounts linked to those Pages: post, insights, comments
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_insights',
  'instagram_manage_comments',
];

export function facebookConfig() {
  return {
    appId: process.env.FACEBOOK_APP_ID,
    appSecret: process.env.FACEBOOK_APP_SECRET,
    redirectUri: process.env.FACEBOOK_REDIRECT_URI || null,
    scopes: (process.env.FACEBOOK_SCOPES ? process.env.FACEBOOK_SCOPES.split(/[\s,]+/) : FACEBOOK_SCOPES).filter(Boolean),
  };
}

export const isFacebookConfigured = () => Boolean(facebookConfig().appId && facebookConfig().appSecret);

export function buildFacebookAuthUrl({ state, redirectUri }) {
  const { appId, scopes } = facebookConfig();
  const params = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state, scope: scopes.join(','), response_type: 'code' });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

/** Graph errors in the shape the rest of the app uses. `retryable` marks rate limits and outages. */
export function graphError(json, status) {
  const e = json?.error || {};
  const code = e.code || status || 502;
  const message = e.error_user_msg || e.message || `Facebook API error (${status})`;
  return { code, subcode: e.error_subcode, message, reason: e.type, retryable: isRetryable(code, status) };
}

/** Meta rate-limit codes (4, 17, 32, 613, 80001-80014) and server errors are worth retrying later. */
export function isRetryable(code, status) {
  return [1, 2, 4, 17, 32, 341, 613].includes(Number(code)) || (Number(code) >= 80001 && Number(code) <= 80014) || status === 429 || status >= 500;
}

/**
 * GET/POST to a Graph API host. Params go in the query for GET and form body for POST (Graph accepts both,
 * and form bodies handle JSON-valued fields like `targeting` and `attached_media`). Returns { data } or { error }.
 */
export async function graphCall(method, url, token, params = {}, { fetchImpl = fetch } = {}) {
  const clean = Object.fromEntries(Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]));
  const body = new URLSearchParams({ ...clean, ...(token ? { access_token: token } : {}) });
  try {
    const res = method === 'GET'
      ? await fetchImpl(`${url}?${body.toString()}`)
      : await fetchImpl(url, { method, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) return { error: graphError(json, res.status) };
    return { data: json };
  } catch (err) {
    return { error: { code: 502, message: `Failed to reach ${new URL(url).host}: ${err.message}`, retryable: true } };
  }
}

export const fbGet = (path, token, params, opts) => graphCall('GET', `${GRAPH}/${path}`, token, params, opts);
export const fbPost = (path, token, params, opts) => graphCall('POST', `${GRAPH}/${path}`, token, params, opts);

async function must(promise) {
  const r = await promise;
  if (r.error) throw Object.assign(new Error(r.error.message), { status: r.error.code });
  return r.data;
}

export async function exchangeFacebookCode(code, redirectUri) {
  const { appId, appSecret } = facebookConfig();
  const short = await must(fbGet('oauth/access_token', null, { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }));
  // A long-lived user token makes page tokens that never expire.
  return must(fbGet('oauth/access_token', null, { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: short.access_token }));
}

/** Every page this login manages, with its never-expiring page token and linked Instagram account. */
export async function fetchManagedPages(userToken) {
  const pages = [];
  let next = { fields: 'id,name,access_token,picture{url},instagram_business_account', limit: 100 };
  for (let i = 0; i < 10 && next; i += 1) {
    const page = await must(fbGet('me/accounts', userToken, next));
    pages.push(...(page.data || []));
    const after = page.paging?.cursors?.after;
    next = page.paging?.next && after ? { ...next, after } : null;
  }
  return pages.map((p) => ({
    page_id: String(p.id),
    name: p.name,
    access_token: p.access_token,
    picture_url: p.picture?.data?.url || null,
    ig_user_id: p.instagram_business_account?.id ? String(p.instagram_business_account.id) : null,
  }));
}

/** Granted permissions for a token, for showing "missing permission" before the user tries to post. */
export async function grantedScopes(token) {
  const r = await fbGet('me/permissions', token);
  if (r.error) return { error: r.error };
  return { data: (r.data.data || []).filter((p) => p.status === 'granted').map((p) => p.permission) };
}

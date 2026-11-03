/** Shared bits for the "Connect …" OAuth buttons. */

/** Where the provider sends the user back. An explicit env value wins; otherwise the site the user clicked from. */
export function resolveRedirectUri(origin, configured, callbackPath) {
  if (configured) return configured;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.origin}${callbackPath}`;
  } catch {
    return null;
  }
}

/** Only same-site paths are allowed as the page to return to after connecting (no open redirects). */
export function safeReturnPath(value, fallback = '/accounts') {
  const s = String(value || '');
  return /^\/(?!\/)[\w\-/?=&%.]*$/.test(s) ? s : fallback;
}

/** Adds query params to a return path that may already have some. */
export function withParams(path, params) {
  const [base, query = ''] = path.split('?');
  const qs = new URLSearchParams(query);
  for (const [k, v] of Object.entries(params)) qs.set(k, v);
  return `${base}?${qs.toString()}`;
}

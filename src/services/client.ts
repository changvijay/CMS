/**
 * Session handling for every API call: keeps the access token fresh using the long-lived refresh token,
 * so a user stays signed in until they press Logout.
 *
 * `apiFetch` is a drop-in for `fetch`. When a request that carried a Bearer token is refused because the
 * token expired, it refreshes the session once (parallel requests share one refresh) and retries with the new token.
 */
const ACCESS_KEY = 'cms_token';
const REFRESH_KEY = 'cms_refresh';

const SESSION_ERRORS = new Set(['Invalid or expired session token.', 'Access token required. Please login.']);

type TokenListener = (token: string | null) => void;
const listeners = new Set<TokenListener>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the session lasts until the tab closes */
  }
}

export function getAccessToken(): string | null {
  return read(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return read(REFRESH_KEY);
}

export function saveSession(token: string, refreshToken?: string | null) {
  write(ACCESS_KEY, token);
  if (refreshToken !== undefined) write(REFRESH_KEY, refreshToken);
  for (const l of listeners) l(token);
}

export function clearSession() {
  write(ACCESS_KEY, null);
  write(REFRESH_KEY, null);
  for (const l of listeners) l(null);
}

/** Told whenever the access token changes (refreshed, or cleared because the session ended). */
export function onTokenChange(listener: TokenListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let refreshing: Promise<string | null> | null = null;

/**
 * Swaps the refresh token for a new access token. Resolves null when the session is over (the user must sign in).
 * Throws on network errors, so being offline never signs anyone out.
 */
export function refreshSession(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return null;
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (res.status === 401) {
        // Another tab may have refreshed first and saved a newer pair.
        const latest = getRefreshToken();
        if (latest && latest !== refreshToken) return getAccessToken();
        return null;
      }
      if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
      const data = (await res.json()) as { token: string; refreshToken: string };
      saveSession(data.token, data.refreshToken);
      return data.token;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Ends this device's session on the server (best effort) and forgets the tokens. */
export async function logoutSession(): Promise<void> {
  const refreshToken = getRefreshToken();
  clearSession();
  if (!refreshToken) return;
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      keepalive: true,
    });
  } catch {
    /* offline: the server forgets the session after a year of no use */
  }
}

async function isSessionError(res: Response): Promise<boolean> {
  if (res.status !== 401 && res.status !== 403) return false;
  try {
    const body = await res.clone().json();
    return SESSION_ERRORS.has(body?.error);
  } catch {
    return false;
  }
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const auth = headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    // Props can hold a token that was refreshed a moment ago; always send the newest one.
    const latest = getAccessToken();
    if (latest) headers.set('Authorization', `Bearer ${latest}`);
  }
  const res = await fetch(input, { ...init, headers });
  if (!auth || !(await isSessionError(res))) return res;

  let fresh: string | null;
  try {
    fresh = await refreshSession();
  } catch {
    return res; // offline or server trouble: report the original error, keep the session
  }
  if (!fresh) {
    clearSession();
    return res;
  }
  headers.set('Authorization', `Bearer ${fresh}`);
  return fetch(input, { ...init, headers });
}

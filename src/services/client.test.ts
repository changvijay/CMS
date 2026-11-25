import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { apiFetch, saveSession, getAccessToken, getRefreshToken } = await import('./client');

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const expired = () => json(403, { error: 'Invalid or expired session token.' });

describe('apiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage);
    store.clear();
    saveSession('old-access', 'refresh-1');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('refreshes once and retries when the access token expired', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/refresh') return json(200, { token: 'new-access', refreshToken: 'refresh-2' });
      const auth = new Headers(init?.headers).get('Authorization');
      return auth === 'Bearer new-access' ? json(200, { ok: true }) : expired();
    });
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([
      apiFetch('/api/x', { headers: { Authorization: 'Bearer old-access' } }),
      apiFetch('/api/y', { headers: { Authorization: 'Bearer old-access' } }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(fetchMock.mock.calls.filter(([u]) => u === '/api/auth/refresh')).toHaveLength(1);
    expect(getAccessToken()).toBe('new-access');
    expect(getRefreshToken()).toBe('refresh-2');
  });

  it('signs out when the refresh token is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/auth/refresh' ? json(401, { error: 'Session ended.' }) : expired())));
    const res = await apiFetch('/api/x', { headers: { Authorization: 'Bearer old-access' } });
    expect(res.status).toBe(403);
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('keeps the session when the refresh fails because the network is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/refresh') throw new TypeError('Failed to fetch');
      return expired();
    }));
    await apiFetch('/api/x', { headers: { Authorization: 'Bearer old-access' } });
    expect(getRefreshToken()).toBe('refresh-1');
  });

  it('leaves requests without a token alone', async () => {
    const fetchMock = vi.fn(async () => json(401, { error: 'Invalid username or password.' }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await apiFetch('/api/auth/login', { method: 'POST' });
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

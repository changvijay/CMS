import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pagesFromPastedToken } from '../services/facebookApi.js';

const APP = '1019299374426425';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const PAGE_TOKEN = 'EAAPageToken1234567890';
const USER_TOKEN = 'EAAUserToken1234567890';
const LONG_USER = 'EAALongUserToken123456';

/** A small fake Graph API: `who` says what each token is, `appOf` which app made it, `expires` its expiry (0 = never). */
function fakeGraph({ who, appOf = {}, expires = {}, pages = [], igOk = true }) {
  return vi.fn(async (url) => {
    const u = new URL(String(url));
    const token = u.searchParams.get('access_token');
    const path = u.pathname.replace(/^\/v\d+\.\d+\//, '');
    if (path === 'oauth/access_token') return json({ access_token: LONG_USER, token_type: 'bearer' });
    if (path === 'debug_token') {
      const t = u.searchParams.get('input_token');
      return json({ data: { app_id: appOf[t] ?? APP, expires_at: expires[t] ?? 0, scopes: ['pages_show_list', 'pages_manage_posts'] } });
    }
    const kind = who[token];
    if (!kind) return json({ error: { message: 'Invalid OAuth access token.', code: 190 } }, 400);
    if (path === 'me' && u.searchParams.get('metadata') === '1') return json({ id: kind === 'page' ? '111' : '999', name: 'x', metadata: { type: kind } });
    if (path === 'me' && u.searchParams.get('fields') === 'instagram_business_account') {
      return igOk ? json({ instagram_business_account: { id: '1784' } }) : json({ error: { message: 'needs instagram_basic', code: 10 } }, 400);
    }
    if (path === 'me') return json({ id: '111', name: 'Chang Research Base', picture: { data: { url: 'pic' } } });
    if (path === 'me/accounts') return json({ data: pages });
    return json({ error: { message: `unexpected ${path}` } }, 500);
  });
}

describe('pagesFromPastedToken', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.FACEBOOK_APP_ID = APP;
    process.env.FACEBOOK_APP_SECRET = 'secret';
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('adds the one Page a Page token belongs to, with its Instagram link', async () => {
    globalThis.fetch = fakeGraph({ who: { [PAGE_TOKEN]: 'page' } });
    const r = await pagesFromPastedToken(`  ${PAGE_TOKEN}  `);
    expect(r).toMatchObject({ kind: 'page', expiresAt: null, exchanged: false });
    expect(r.pages).toEqual([{ page_id: '111', name: 'Chang Research Base', access_token: PAGE_TOKEN, picture_url: 'pic', ig_user_id: '1784' }]);
  });

  it('still adds a Page when the token cannot see the Instagram link', async () => {
    globalThis.fetch = fakeGraph({ who: { [PAGE_TOKEN]: 'page' }, igOk: false });
    const r = await pagesFromPastedToken(PAGE_TOKEN);
    expect(r.pages[0].ig_user_id).toBeNull();
  });

  it('makes a User token from this app long-lived, then adds every Page it manages', async () => {
    const pages = [
      { id: '111', name: 'A', access_token: 'EAAPageA1234567890123', picture: { data: { url: 'a' } }, instagram_business_account: { id: '1784' } },
      { id: '222', name: 'B', access_token: 'EAAPageB1234567890123' },
    ];
    const fetchMock = fakeGraph({ who: { [USER_TOKEN]: 'user', [LONG_USER]: 'user' }, pages });
    globalThis.fetch = fetchMock;
    const r = await pagesFromPastedToken(USER_TOKEN);
    expect(r.kind).toBe('user');
    expect(r.exchanged).toBe(true);
    expect(r.pages.map((p) => [p.page_id, p.name, p.ig_user_id])).toEqual([['111', 'A', '1784'], ['222', 'B', null]]);
    const listCall = fetchMock.mock.calls.map(([u]) => new URL(String(u))).find((u) => u.pathname.endsWith('/me/accounts') && u.searchParams.get('limit') === '100');
    expect(listCall.searchParams.get('access_token')).toBe(LONG_USER);
  });

  it('uses a User token from another app (Graph API Explorer) as it is, and reports when its Pages expire', async () => {
    const exp = Math.floor(Date.UTC(2026, 10, 6, 12) / 1000);
    const pageToken = 'EAAPageA1234567890123';
    globalThis.fetch = fakeGraph({
      who: { [USER_TOKEN]: 'user' }, appOf: { [USER_TOKEN]: '145634995501895' }, expires: { [pageToken]: exp },
      pages: [{ id: '111', name: 'A', access_token: pageToken }],
    });
    const r = await pagesFromPastedToken(USER_TOKEN);
    expect(r.exchanged).toBe(false);
    expect(r.appId).toBe('145634995501895');
    expect(r.expiresAt).toBe('2026-11-06T12:00:00.000Z');
  });

  it('explains a token Facebook rejects', async () => {
    globalThis.fetch = fakeGraph({ who: {} });
    await expect(pagesFromPastedToken(USER_TOKEN)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Invalid OAuth access token') });
  });

  it('explains a User token that cannot see any Page', async () => {
    globalThis.fetch = fakeGraph({ who: { [USER_TOKEN]: 'user', [LONG_USER]: 'user' }, pages: [] });
    await expect(pagesFromPastedToken(USER_TOKEN)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('pages_show_list') });
  });

  it('refuses something that is not a token without calling Facebook', async () => {
    globalThis.fetch = vi.fn();
    await expect(pagesFromPastedToken('hello world')).rejects.toMatchObject({ status: 400 });
    await expect(pagesFromPastedToken('')).rejects.toMatchObject({ status: 400 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

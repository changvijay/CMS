import { describe, it, expect, vi, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import { isAuthError } from '../utils/authErrors.js';

const started = [];
vi.mock('../db.js', () => ({
  pool: { query: vi.fn() },
  isDbReady: () => true,
  getInstagramAccountsByUserId: async () => [{ id: 1, page_name: 'IG One' }, { id: 2, page_name: 'IG Two' }],
  getYoutubeAccountsByUserId: async () => { throw new Error('db hiccup'); },
  getLinkedInAccountsByUserId: async () => [{ id: 5, page_name: 'LI Page' }],
}));
vi.mock('../routes/facebookInsights.js', () => ({ getFacebookPagesByUserId: async () => [{ id: 9, name: 'FB Page' }] }));
vi.mock('../services/syncService.js', () => ({
  syncInstagramAccount: async (a) => {
    started.push(`ig${a.id}`);
    // Account 1 is slow: if syncs ran one after another, LinkedIn would start only after it.
    if (a.id === 1) await new Promise((r) => setTimeout(r, 50));
    if (a.id === 2) throw Object.assign(new Error('Error validating access token: Session has expired'), { status: 190, reason: 'OAuthException' });
    return { days_synced: 30, media_snapshots: 10 };
  },
  syncYoutubeAccount: async () => ({ days_synced: 30, media_snapshots: 5 }),
  syncLinkedInAccount: async () => { started.push('li5'); throw Object.assign(new Error('Internal LinkedIn error'), { status: 500 }); },
  syncFacebookPage: async () => { started.push('fb9'); return { days_synced: 30, media_snapshots: 3, reels: 1 }; },
}));
vi.mock('../services/dailyInsights.js', () => ({ invalidateLiveInsights: () => {}, loadDaily: async () => ({ rows: [], errors: [] }) }));

const { createHistoryRouter } = await import('../routes/history.js');
const app = express();
app.use(express.json());
app.use('/api', createHistoryRouter((req, _res, next) => { req.user = { userId: 1 }; next(); }));
const server = http.createServer(app).listen(0);
afterAll(() => server.close());

describe('POST /sync (Update all data)', () => {
  it('updates every account at the same time, and one failure never stops the others', async () => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const body = await res.json();
    expect(res.status).toBe(200);

    // All started before the slow Instagram account finished.
    expect(started.slice(0, 4).sort()).toEqual(['fb9', 'ig1', 'ig2', 'li5']);

    expect(body.results.map((r) => `${r.platform}:${r.name}`).sort()).toEqual(['facebook:FB Page', 'instagram:IG One']);
    const byName = Object.fromEntries(body.errors.map((e) => [e.name ?? e.platform, e]));
    expect(byName['IG Two']).toMatchObject({ platform: 'instagram', auth: true });
    expect(byName['LI Page']).toMatchObject({ platform: 'linkedin', auth: false, code: 500 });
    // YouTube's account list failed to load: reported, and the rest still ran.
    expect(byName.youtube).toMatchObject({ platform: 'youtube', auth: false });
  });
});

describe('isAuthError', () => {
  it('recognises logged-out accounts on every platform', () => {
    expect(isAuthError({ status: 190, message: 'Session has expired' })).toBe(true); // Instagram / Facebook
    expect(isAuthError({ status: 401, reason: 'reconnect_required', message: 'Reconnect YouTube' })).toBe(true); // YouTube / LinkedIn
    expect(isAuthError({ status: 400, message: 'The provided authorization grant or refresh token is invalid, expired or revoked' })).toBe(true);
    expect(isAuthError({ status: 500, message: 'Internal error' })).toBe(false);
    expect(isAuthError({ status: 504, message: 'linkedin took too long to answer' })).toBe(false);
  });
});

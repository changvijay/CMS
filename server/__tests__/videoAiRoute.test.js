import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import express from 'express';

// The tables the video AI routes read, faked.
const db = { settings: null, keys: [], reports: [] };
const query = vi.fn(async (sql, params = []) => {
  if (sql.startsWith('SELECT * FROM script_settings')) return { rows: db.settings ? [db.settings] : [] };
  if (sql.startsWith('SELECT provider, ciphertext')) return { rows: db.keys };
  if (sql.startsWith('SELECT id, title, language')) return { rows: [] };
  if (sql.includes('FROM video_ai_reports WHERE user_id = $1 AND platform')) return { rows: db.reports.filter((r) => r.media_id === params[3]) };
  return { rows: [], rowCount: 0 };
});
vi.mock('../db.js', async (orig) => ({ ...(await orig()), pool: { query: (...a) => query(...a) }, isDbReady: () => true }));

const aiFetch = vi.fn();
const { createVideoAiRouter } = await import('../routes/videoAi.js');
const { createRateLimiter } = await import('../utils/rateLimit.js');
const app = express();
app.use(express.json());
app.use('/api', createVideoAiRouter((req, _res, next) => { req.user = { userId: 1 }; next(); }, {
  env: { SCRIPTS_SECRET_KEY: Buffer.alloc(32, 3).toString('base64') }, fetchImpl: aiFetch,
  aiLimiter: createRateLimiter({ limit: 100, windowMs: 60_000 }),
}));
const server = http.createServer(app).listen(0);
afterAll(() => server.close());

const call = async (method, path, body) => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const frame = { t: 0, mime: 'image/jpeg', data: 'AAAA' };

beforeEach(() => { db.settings = null; db.keys = []; db.reports = []; aiFetch.mockReset(); });

describe('video AI routes', () => {
  it('asks for an AI provider before analysing anything', async () => {
    expect((await call('POST', '/video-ai/preupload', { frames: [frame] })).status).toBe(409);
    expect((await call('POST', '/video-ai/published/update', { platform: 'instagram', accountId: '3', mediaId: 'abc' })).status).toBe(409);
    expect(aiFetch).not.toHaveBeenCalled();
  });

  it('refuses a text-only provider for frames, without calling it', async () => {
    db.settings = { providers: { groq: { enabled: true } }, active_provider: 'groq', action_prefs: {} };
    db.keys = [{ provider: 'groq', ciphertext: 'x', iv: 'x', tag: 'x', last4: '1234' }];
    const res = await call('POST', '/video-ai/preupload', { frames: [frame] });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/can't read images/);
    expect(aiFetch).not.toHaveBeenCalled();
  });

  it('validates frames and ids', async () => {
    expect((await call('POST', '/video-ai/preupload', { frames: [] })).status).toBe(400);
    expect((await call('POST', '/video-ai/preupload', { frames: Array(13).fill(frame) })).status).toBe(400);
    expect((await call('POST', '/video-ai/preupload', { frames: [{ ...frame, mime: 'text/html' }] })).status).toBe(400);
    expect((await call('GET', '/video-ai/reports?platform=tiktok&accountId=1&mediaId=a')).status).toBe(400);
  });

  it('reading a saved report never calls the AI', async () => {
    db.reports = [{ id: 7, media_id: 'abc', score: 61, created_at: '2026-11-25', provider: 'gemini', report: { score: 61 } }];
    const res = await call('GET', '/video-ai/reports?platform=instagram&accountId=3&mediaId=abc');
    expect(res.status).toBe(200);
    expect(res.body.report.score).toBe(61);
    expect(res.body.history).toHaveLength(1);
    expect(aiFetch).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import express from 'express';

// A tiny fake of the tables the AI routes touch.
const db = { keys: [], settings: null, niches: [], queries: [] };
const query = vi.fn(async (sql, params = []) => {
  db.queries.push({ sql, params });
  if (sql.startsWith('SELECT * FROM script_settings')) return { rows: db.settings ? [db.settings] : [] };
  if (sql.startsWith('SELECT provider, ciphertext')) return { rows: db.keys.filter((k) => k.user_id === params[0]) };
  if (sql.startsWith('SELECT id, title, language')) return { rows: db.niches };
  if (sql.startsWith('INSERT INTO script_ai_keys')) {
    db.keys = [{ user_id: params[0], provider: params[1], ciphertext: params[2], iv: params[3], tag: params[4], last4: params[5] }];
    return { rows: [] };
  }
  if (sql.startsWith('INSERT INTO script_settings (user_id, providers, active_provider)')) {
    db.settings = { user_id: params[0], providers: JSON.parse(params[1]), active_provider: params[2], action_prefs: {}, active_niche_id: null };
    return { rows: [] };
  }
  if (sql.includes('FROM scripts s WHERE')) return { rows: [{ n: 0 }] };
  if (sql.includes('FROM scripts s LEFT JOIN')) return { rows: [] };
  if (sql.startsWith('DELETE FROM script_todos WHERE id')) return { rowCount: 0 };
  if (sql.startsWith('SELECT 1 FROM script_folders')) return { rows: params[0] === '5' && params[1] === 1 ? [{}] : [] };
  if (sql.startsWith('UPDATE scripts SET folder_id')) return { rowCount: params[1].length };
  return { rows: [], rowCount: 0 };
});
vi.mock('../db.js', () => ({ pool: { query: (...a) => query(...a), connect: async () => ({ query: (...a) => query(...a), release() {} }) }, isDbReady: () => true }));

const aiFetch = vi.fn(async (url, init) => {
  const key = init.headers['x-api-key'];
  if (key !== 'sk-ant-good-1234') return { ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) };
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'Better script' }] }) };
});

const { createScriptsRouter } = await import('../routes/scripts.js');
const app = express();
app.use(express.json());
app.use('/api', createScriptsRouter((req, _res, next) => { req.user = { userId: 1 }; next(); }, {
  env: { SCRIPTS_SECRET_KEY: Buffer.alloc(32, 3).toString('base64') },
  fetchImpl: aiFetch,
}));
const server = http.createServer(app).listen(0);
afterAll(() => server.close());

const call = async (method, path, body) => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

beforeEach(() => { db.queries = []; });

describe('scripts routes', () => {
  it('scopes every list query to the signed-in user', async () => {
    const res = await call('GET', '/scripts/items?q=50%25_off&status=completed');
    expect(res.status).toBe(200);
    for (const q of db.queries) expect(q.params[0]).toBe(1);
    expect(db.queries[0].params).toContain('%50\\%\\_off%');
    expect(db.queries[1].sql).toContain('ORDER BY s.deadline ASC NULLS LAST, s.modified_at DESC');
  });

  it('rejects a script without a title', async () => {
    const res = await call('POST', '/scripts/items', { title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Title/);
  });

  it('returns 404 for ids that are not numbers', async () => {
    expect((await call('DELETE', '/scripts/todos/abc')).status).toBe(404);
  });

  it('refuses a key that fails the test and stores a good one encrypted, never returning it', async () => {
    const badKey = await call('PUT', '/scripts/ai/providers/claude', { api_key: 'sk-ant-bad', enabled: true, model: 'claude-haiku-5-5' });
    expect(badKey.status).toBe(400);
    expect(badKey.body.error).toMatch(/invalid x-api-key/);
    expect(db.keys).toEqual([]);

    const good = await call('PUT', '/scripts/ai/providers/claude', { api_key: 'sk-ant-good-1234', enabled: true, model: 'claude-haiku-5-5' });
    expect(good.status).toBe(200);
    expect(JSON.stringify(good.body)).not.toContain('sk-ant-good');
    expect(good.body.providers.claude).toMatchObject({ configured: true, enabled: true, last4: '1234' });
    expect(good.body.active_provider).toBe('claude');
    expect(db.keys[0].ciphertext).not.toContain('sk-ant');
  });

  it('runs an action with the decrypted key', async () => {
    const res = await call('POST', '/scripts/ai/run', { action: 'grammar', content: 'my scrpit' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: 'Better script', provider: 'claude', model: 'claude-haiku-5-5' });
    const sent = JSON.parse(aiFetch.mock.calls.at(-1)[1].body);
    expect(sent.system).toMatch(/Fix only spelling/);
    expect(sent.messages[0].content).toBe('my scrpit');
  });

  it('rejects unknown actions and empty scripts', async () => {
    expect((await call('POST', '/scripts/ai/run', { action: 'nope', content: 'x' })).status).toBe(400);
    expect((await call('POST', '/scripts/ai/run', { action: 'grammar', content: '  ' })).status).toBe(400);
  });

  it('filters by folder, including unfiled', async () => {
    await call('GET', '/scripts/items?folder=none');
    expect(db.queries[0].sql).toContain('s.folder_id IS NULL');
    db.queries = [];
    await call('GET', '/scripts/items?folder=5');
    expect(db.queries[0].sql).toContain('s.folder_id = $2');
    expect(db.queries[0].params).toEqual([1, '5']);
  });

  it('rejects a script in someone else\'s folder', async () => {
    const res = await call('POST', '/scripts/items', { title: 'Scene', folder_id: '9' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Folder not found.');
  });

  it('bulk-moves only into an owned folder', async () => {
    expect((await call('POST', '/scripts/items/bulk-move', { ids: ['1', '2'], folder_id: '9' })).status).toBe(400);
    const ok = await call('POST', '/scripts/items/bulk-move', { ids: ['1', '2'], folder_id: '5' });
    expect(ok.body).toEqual({ moved: 2 });
    const move = db.queries.find((q) => q.sql.startsWith('UPDATE scripts SET folder_id'));
    expect(move.params).toEqual([1, ['1', '2'], '5']);
  });
});

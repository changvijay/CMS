import crypto from 'node:crypto';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWebhooksRouter } from '../routes/webhooks.js';

const SECRET = 'app-secret';
const VERIFY = 'verify-me';
const sign = (body) => `sha256=${crypto.createHmac('sha256', SECRET).update(body).digest('hex')}`;

let server;
let base;
let calls;
let behaviour;

function start(env, options = {}) {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/api', createWebhooksRouter({
    env,
    isReady: () => options.ready ?? true,
    dbFactory: () => ({ fake: 'db' }),
    processor: async (payload, deps) => { calls.push({ payload, dryRun: deps.dryRun }); return behaviour(); },
  }));
  return new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
}

async function boot(env, options) {
  calls = [];
  behaviour = () => [{ source: 'dm', status: 'sent' }];
  server = await start(env, options);
  base = `http://127.0.0.1:${server.address().port}/api/webhooks/instagram`;
}

const post = (body, headers = {}) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

describe('webhook route', () => {
  beforeAll(() => boot({ META_APP_SECRET: SECRET, WEBHOOK_VERIFY_TOKEN: VERIFY }));
  afterAll(() => server.close());

  it('completes Meta’s handshake by echoing the challenge', async () => {
    const res = await fetch(`${base}?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('12345');
  });

  it('refuses the handshake with a wrong token or mode', async () => {
    expect((await fetch(`${base}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`)).status).toBe(403);
    expect((await fetch(`${base}?hub.mode=unsubscribe&hub.verify_token=${VERIFY}&hub.challenge=1`)).status).toBe(403);
    expect((await fetch(base)).status).toBe(403);
  });

  it('processes a correctly signed delivery and answers 200', async () => {
    const body = JSON.stringify({ object: 'instagram', entry: [{ id: '1' }] });
    const res = await post(body, { 'X-Hub-Signature-256': sign(body) });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.object).toBe('instagram');
    expect(calls[0].dryRun).toBe(false);
  });

  it('rejects a missing, wrong or tampered signature without processing', async () => {
    const body = JSON.stringify({ object: 'instagram', entry: [] });
    const before = calls.length;
    expect((await post(body)).status).toBe(403);
    expect((await post(body, { 'X-Hub-Signature-256': 'sha256=deadbeef' })).status).toBe(403);
    expect((await post(body + ' ', { 'X-Hub-Signature-256': sign(body) })).status).toBe(403);
    expect(calls.length).toBe(before);
  });

  it('answers 500 when processing blows up so Meta retries', async () => {
    behaviour = () => { throw new Error('db down'); };
    const body = JSON.stringify({ entry: [] });
    expect((await post(body, { 'X-Hub-Signature-256': sign(body) })).status).toBe(500);
  });
});

describe('webhook route configuration', () => {
  it('refuses unsigned processing when META_APP_SECRET is missing', async () => {
    await boot({ WEBHOOK_VERIFY_TOKEN: VERIFY });
    const res = await post('{}', { 'X-Hub-Signature-256': sign('{}') });
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(0);
    server.close();
  });

  it('answers 503 (so Meta retries) while the database is unavailable', async () => {
    await boot({ META_APP_SECRET: SECRET }, { ready: false });
    const body = '{}';
    expect((await post(body, { 'X-Hub-Signature-256': sign(body) })).status).toBe(503);
    server.close();
  });

  it('passes the dry-run flag through', async () => {
    await boot({ META_APP_SECRET: SECRET, AUTOMATION_DRY_RUN: 'true' });
    const body = '{}';
    await post(body, { 'X-Hub-Signature-256': sign(body) });
    expect(calls[0].dryRun).toBe(true);
    server.close();
  });
});

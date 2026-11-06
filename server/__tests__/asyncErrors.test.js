import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import { catchAsyncErrors, jsonErrorHandler } from '../utils/asyncErrors.js';

const app = express();
app.use(express.json());
const router = express.Router();
router.get('/rejects', async () => {
  throw new Error('db down');
});
router.get('/ok', async (req, res) => res.json({ ok: true }));
router.use('/nested', express.Router().get('/x', async () => Promise.reject(new Error('nested'))));
app.use('/api', router);
app.post('/api/echo', (req, res) => res.json(req.body));
catchAsyncErrors(app);
app.use(jsonErrorHandler);

const server = http.createServer(app).listen(0);
const base = () => `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

const quiet = async (fn) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

describe('catchAsyncErrors + jsonErrorHandler', () => {
  it('answers a rejected async handler with a JSON 500 instead of hanging', async () => {
    const res = await quiet(() => fetch(`${base()}/api/rejects`, { signal: AbortSignal.timeout(2000) }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Something went wrong on the server.' });
  });

  it('covers routers nested inside routers', async () => {
    const res = await quiet(() => fetch(`${base()}/api/nested/x`, { signal: AbortSignal.timeout(2000) }));
    expect(res.status).toBe(500);
  });

  it('leaves working handlers alone', async () => {
    const res = await fetch(`${base()}/api/ok`);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('turns a malformed JSON body into a JSON 400', async () => {
    const res = await fetch(`${base()}/api/echo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Request body is not valid JSON.' });
  });

  it('is safe to apply twice', () => {
    expect(() => catchAsyncErrors(app)).not.toThrow();
  });
});

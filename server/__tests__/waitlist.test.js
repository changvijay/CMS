import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { normalizePhone, parseLinks, validateWaitlist } from '../services/waitlistValidation.js';
import { createWaitlistRouter } from '../routes/waitlist.js';
import { createRateLimiter } from '../utils/rateLimit.js';

const good = {
  email: '  Priya@Example.com ',
  phone: '+91 98765-43210',
  instagram: 2,
  facebook: '1',
  linkedin: 0,
  youtube: 1,
  links: 'instagram.com/priya, https://youtube.com/@priya ,\n instagram.com/priya/',
};

describe('waiting list validation', () => {
  it('cleans a good sign-up', () => {
    const r = validateWaitlist(good);
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({
      email: 'priya@example.com',
      phone: '+919876543210',
      instagram: 2, facebook: 1, linkedin: 0, youtube: 1,
      links: ['https://instagram.com/priya', 'https://youtube.com/@priya'],
    });
  });

  it('splits links on commas and new lines, adds https and drops repeats', () => {
    expect(parseLinks('a.com, b.com\nA.com/ ,, http://c.org')).toEqual(['https://a.com', 'https://b.com', 'http://c.org']);
    expect(parseLinks(['x.com', ' ', 'x.com'])).toEqual(['https://x.com']);
  });

  it('keeps a leading plus in phone numbers', () => {
    expect(normalizePhone(' +1 (415) 555-0100 ')).toBe('+14155550100');
    expect(normalizePhone('098765 43210')).toBe('09876543210');
  });

  it('names every field that needs fixing', () => {
    const r = validateWaitlist({ email: 'nope', phone: '12ab', instagram: -1, facebook: 2.5, linkedin: 51, youtube: 'x', links: '' });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(['email', 'facebook', 'instagram', 'links', 'linkedin', 'phone', 'youtube'].sort());
  });

  it('needs at least one account', () => {
    const r = validateWaitlist({ ...good, instagram: 0, facebook: 0, linkedin: 0, youtube: 0 });
    expect(r.errors).toEqual({ accounts: expect.any(String) });
  });

  it('rejects text that is not a link, and too many links', () => {
    expect(validateWaitlist({ ...good, links: 'instagram.com/priya, my channel' }).errors.links).toMatch(/my channel/);
    const many = Array.from({ length: 31 }, (_, i) => `site${i}.com`).join(',');
    expect(validateWaitlist({ ...good, links: many }).errors.links).toMatch(/up to 30/);
  });

  it('rejects phone numbers that are too short or too long', () => {
    expect(validateWaitlist({ ...good, phone: '12345' }).errors.phone).toBeTruthy();
    expect(validateWaitlist({ ...good, phone: '+1234567890123456' }).errors.phone).toBeTruthy();
  });
});

describe('waiting list route', () => {
  let server;
  let url;
  let queries;
  let ready;
  let dbResult;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createWaitlistRouter({
      db: { query: async (sql, params) => { queries.push({ sql, params }); return dbResult(); } },
      isReady: () => ready,
      limiter: createRateLimiter({ limit: 4, windowMs: 60_000 }),
    }));
    server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    url = `http://127.0.0.1:${server.address().port}/api/waitlist`;
  });
  afterAll(() => server.close());
  beforeEach(() => { queries = []; ready = true; dbResult = () => ({ rows: [{ created: true }] }); });

  const post = (body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('saves a new sign-up', async () => {
    const res = await post(good);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, updated: false });
    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual(['priya@example.com', '+919876543210', 2, 1, 0, 1, ['https://instagram.com/priya', 'https://youtube.com/@priya']]);
  });

  it('reports an update when the email signed up before', async () => {
    dbResult = () => ({ rows: [{ created: false }] });
    const res = await post(good);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, updated: true });
  });

  it('returns field errors without touching the database', async () => {
    const res = await post({ email: 'bad' });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.fields.email).toBeTruthy();
    expect(queries).toHaveLength(0);
  });

  it('accepts and ignores sign-ups that fill the hidden spam field', async () => {
    const res = await post({ ...good, website: 'http://spam.example' });
    expect(res.status).toBe(201);
    expect(queries).toHaveLength(0);
  });

  it('says so when the database is down', async () => {
    ready = false;
    expect((await post(good)).status).toBe(503);
  });

  it('limits sign-ups per connection', async () => {
    // Earlier tests used all 4 allowed attempts (the spam-trap request never reaches the limiter).
    const res = await post(good);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
  });
});

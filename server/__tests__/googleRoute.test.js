import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import { createGoogleRouter } from '../routes/google.js';
import { YOUTUBE_SCOPES } from '../services/googleAuth.js';

process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'cs';
delete process.env.GOOGLE_REDIRECT_URI;

const app = express();
app.use('/api', createGoogleRouter((req, _res, next) => { req.user = { userId: 1 }; next(); }, 'secret'));
const server = http.createServer(app).listen(0);
afterAll(() => server.close());

describe('GET /google/connect-url', () => {
  it('asks Google for the YouTube scopes only, without merging in scopes granted earlier', async () => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/google/connect-url?origin=${encodeURIComponent('https://changtechs.com')}`);
    const { url } = await res.json();
    const params = new URL(url).searchParams;
    // include_granted_scopes would pull in e.g. drive.file, which Google refuses next to YouTube scopes
    expect(params.has('include_granted_scopes')).toBe(false);
    expect(params.get('scope').split(' ')).toEqual(YOUTUBE_SCOPES);
    expect(params.get('scope')).not.toContain('drive');
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('prompt')).toBe('consent');
    expect(params.get('redirect_uri')).toBe('https://changtechs.com/api/google/callback');
  });
});

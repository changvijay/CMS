import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearGoogleTokenCache, getGoogleAccessTokenFromRefreshToken, noteYoutubeResponse } from '../services/googleAuth.js';

describe('getGoogleAccessTokenFromRefreshToken', () => {
  const realFetch = globalThis.fetch;
  let fetchMock;

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    clearGoogleTokenCache();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const ok = (token, expiresIn = 3600) => new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), { status: 200 });

  it('exchanges once and reuses the access token while it is valid', async () => {
    fetchMock.mockResolvedValue(ok('a1'));
    expect(await getGoogleAccessTokenFromRefreshToken('refresh-1')).toBe('a1');
    expect(await getGoogleAccessTokenFromRefreshToken('refresh-1')).toBe('a1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps tokens of different refresh tokens apart', async () => {
    fetchMock.mockResolvedValueOnce(ok('a1')).mockResolvedValueOnce(ok('a2'));
    expect(await getGoogleAccessTokenFromRefreshToken('refresh-1')).toBe('a1');
    expect(await getGoogleAccessTokenFromRefreshToken('refresh-2')).toBe('a2');
  });

  it('does not cache a token that is about to expire', async () => {
    fetchMock.mockResolvedValueOnce(ok('short', 60)).mockResolvedValueOnce(ok('next'));
    expect(await getGoogleAccessTokenFromRefreshToken('refresh-1')).toBe('short');
    expect(await getGoogleAccessTokenFromRefreshToken('refresh-1')).toBe('next');
  });

  it('does not cache a failed exchange and keeps the error details', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been revoked.' }), { status: 400 }))
      .mockResolvedValueOnce(ok('a1'));
    await expect(getGoogleAccessTokenFromRefreshToken('refresh-1')).rejects.toMatchObject({ status: 401, reason: 'reconnect_required' });
    expect(await getGoogleAccessTokenFromRefreshToken('refresh-1')).toBe('a1');
  });

  it('explains a revoked or expired refresh token and how to stop weekly expiry', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), { status: 400 }));
    const err = await getGoogleAccessTokenFromRefreshToken('refresh-1').catch((e) => e);
    expect(err.message).toContain('Press Reconnect');
    expect(err.message).toContain('Token has been expired or revoked.');
    expect(err.message).toContain('Publish app');
  });

  it('keeps other Google errors as they were', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 }));
    await expect(getGoogleAccessTokenFromRefreshToken('refresh-1')).rejects.toMatchObject({ status: 401, reason: 'invalid_client' });
  });

  it('asks Google again when a status check wants a fresh answer', async () => {
    fetchMock.mockResolvedValueOnce(ok('a1')).mockResolvedValueOnce(ok('a2'));
    expect(await getGoogleAccessTokenFromRefreshToken('refresh-1')).toBe('a1');
    expect(await getGoogleAccessTokenFromRefreshToken('refresh-1', { fresh: true })).toBe('a2');
    expect(await getGoogleAccessTokenFromRefreshToken('refresh-1')).toBe('a2');
  });

  it('drops a cached access token that YouTube rejected, so the next call exchanges again', async () => {
    fetchMock.mockResolvedValueOnce(ok('a1')).mockResolvedValueOnce(ok('a2'));
    expect(await getGoogleAccessTokenFromRefreshToken('refresh-1')).toBe('a1');
    noteYoutubeResponse(200, { Authorization: 'Bearer a1' });
    expect(await getGoogleAccessTokenFromRefreshToken('refresh-1')).toBe('a1');
    noteYoutubeResponse(401, { Authorization: 'Bearer a1' });
    expect(await getGoogleAccessTokenFromRefreshToken('refresh-1')).toBe('a2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a missing token without calling Google', async () => {
    await expect(getGoogleAccessTokenFromRefreshToken('')).rejects.toMatchObject({ status: 400 });
    await expect(getGoogleAccessTokenFromRefreshToken('******')).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

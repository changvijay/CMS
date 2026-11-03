import { describe, it, expect } from 'vitest';
import { refreshDue, requestRefresh, tokenStatus } from '../services/instagramAuth.js';

const now = Date.parse('2026-11-03T10:00:00Z');
const daysAgo = (d) => new Date(now - d * 24 * 3600 * 1000).toISOString();
const hoursAgo = (h) => new Date(now - h * 3600 * 1000).toISOString();

describe('refreshDue', () => {
  it('renews tokens never renewed, and weekly after that', () => {
    expect(refreshDue({ token_refreshed_at: null }, now)).toBe(true);
    expect(refreshDue({ token_refreshed_at: daysAgo(3) }, now)).toBe(false);
    expect(refreshDue({ token_refreshed_at: daysAgo(7) }, now)).toBe(true);
  });

  it('waits 6 hours after a failed renewal before trying again', () => {
    expect(refreshDue({ token_refreshed_at: null, last_refresh_failed_at: hoursAgo(2) }, now)).toBe(false);
    expect(refreshDue({ token_refreshed_at: null, last_refresh_failed_at: hoursAgo(7) }, now)).toBe(true);
  });
});

describe('requestRefresh', () => {
  it('returns the new token', async () => {
    let called = '';
    const fetchImpl = async (url) => { called = url; return { ok: true, json: async () => ({ access_token: 'NEW', token_type: 'bearer', expires_in: 5184000 }) }; };
    expect(await requestRefresh('OLD', fetchImpl)).toEqual({ data: { access_token: 'NEW', token_type: 'bearer', expires_in: 5184000 } });
    expect(called).toContain('grant_type=ig_refresh_token');
    expect(called).toContain('access_token=OLD');
  });

  it("passes Instagram's error through", async () => {
    const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 190, message: 'Error validating access token: Session has expired' } }) });
    expect(await requestRefresh('OLD', fetchImpl)).toEqual({ error: { code: 190, message: 'Error validating access token: Session has expired' } });
  });
});

describe('tokenStatus', () => {
  it('shows expired only when renewal failed and the token no longer works', () => {
    expect(tokenStatus({ last_refresh_error: 'Error 190: expired' }, false)).toEqual({ status: 'expired', message: 'Error 190: expired' });
    expect(tokenStatus({ last_refresh_error: 'Error 190: too new' }, true).status).toBe('ok');
    expect(tokenStatus({ token_refreshed_at: daysAgo(1), token_expires_at: '2027-01-01T00:00:00Z' })).toEqual({ status: 'ok', auto_refresh: true, expires_at: '2027-01-01T00:00:00Z', message: null });
  });
});

import { describe, it, expect } from 'vitest';
import { tokenExpiry, tokenState } from '../services/linkedinAuth.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 2);
const at = (days) => new Date(now + days * DAY).toISOString();

describe('tokenState', () => {
  it('leaves tokens with plenty of time alone', () => {
    expect(tokenState({ access_token_expires_at: at(30), refresh_token: 'r', refresh_token_expires_at: at(300) }, now)).toBe('ok');
  });
  it('refreshes a token close to expiry while the refresh token is valid', () => {
    expect(tokenState({ access_token_expires_at: at(3), refresh_token: 'r', refresh_token_expires_at: at(300) }, now)).toBe('refresh');
    expect(tokenState({ access_token_expires_at: at(-1), refresh_token: 'r', refresh_token_expires_at: at(1) }, now)).toBe('refresh');
  });
  it('keeps using a token without refresh until it actually expires', () => {
    expect(tokenState({ access_token_expires_at: at(3), refresh_token: null }, now)).toBe('ok');
    expect(tokenState({ access_token_expires_at: at(-1), refresh_token: null }, now)).toBe('expired');
  });
  it('treats an expired refresh token as needing a reconnect', () => {
    expect(tokenState({ access_token_expires_at: at(-1), refresh_token: 'r', refresh_token_expires_at: at(-1) }, now)).toBe('expired');
  });
});

describe('tokenExpiry', () => {
  it('converts LinkedIn expires_in seconds to dates', () => {
    const r = tokenExpiry({ expires_in: 5184000, refresh_token_expires_in: 31536000 }, now);
    expect(r.accessExpiresAt.getTime()).toBe(now + 60 * DAY);
    expect(r.refreshExpiresAt.getTime()).toBe(now + 365 * DAY);
    expect(tokenExpiry({ expires_in: 10 }, now).refreshExpiresAt).toBeNull();
  });
});

describe('apiVersion', async () => {
  const { apiVersion } = await import('../services/linkedinAuth.js');
  it('uses a version two months back, across year ends', () => {
    expect(apiVersion(new Date(Date.UTC(2026, 10, 2)))).toBe('202609');
    expect(apiVersion(new Date(Date.UTC(2027, 0, 15)))).toBe('202611');
  });
});

import { canRefresh, refreshDue } from '../services/linkedinAuth.js';

describe('refreshDue (LinkedIn)', () => {
  const now = Date.parse('2026-11-03T10:00:00Z');
  const in_ = (days) => new Date(now + days * 86400000).toISOString();
  const hoursAgo = (h) => new Date(now - h * 3600000).toISOString();
  const nearExpiry = { access_token_expires_at: in_(3), refresh_token: 'r', refresh_token_expires_at: in_(300) };

  it('renews near expiry, but waits 6 hours after a failed try', () => {
    expect(refreshDue(nearExpiry, now)).toBe(true);
    expect(refreshDue({ ...nearExpiry, last_refresh_failed_at: hoursAgo(1) }, now)).toBe(false);
    expect(refreshDue({ ...nearExpiry, last_refresh_failed_at: hoursAgo(7) }, now)).toBe(true);
    expect(refreshDue({ ...nearExpiry, access_token_expires_at: in_(40) }, now)).toBe(false);
  });

  it('knows when a refresh token can be used', () => {
    expect(canRefresh({ refresh_token: 'r', refresh_token_expires_at: in_(10) }, now)).toBe(true);
    expect(canRefresh({ refresh_token: 'r', refresh_token_expires_at: in_(-1) }, now)).toBe(false);
    expect(canRefresh({ refresh_token: null }, now)).toBe(false);
  });
});

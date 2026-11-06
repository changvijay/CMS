import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const query = vi.fn();
vi.mock('../db.js', () => ({ pool: { query: (...a) => query(...a) }, isDbReady: () => true }));

const { clearLinkedInTokenChecks, getWorkingLinkedInToken } = await import('../services/linkedinAuth.js');

const DAY = 24 * 60 * 60 * 1000;
const account = (over = {}) => ({
  id: 5, member_id: 'urn:li:organization:5', account_type: 'organization', access_token: 'old',
  access_token_expires_at: new Date(Date.now() + 50 * DAY).toISOString(), refresh_token: 'refresh',
  refresh_token_expires_at: new Date(Date.now() + 300 * DAY).toISOString(), token_invalid_at: null, last_refresh_failed_at: null, ...over,
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const REVOKED = { status: 401, code: 'REVOKED_ACCESS_TOKEN', serviceErrorCode: 65601, message: 'The token used in the request has been revoked by the user' };

describe('getWorkingLinkedInToken', () => {
  const realFetch = globalThis.fetch;
  let fetchMock;
  let validTokens;

  beforeEach(() => {
    process.env.LINKEDIN_CLIENT_ID = 'id';
    process.env.LINKEDIN_CLIENT_SECRET = 'secret';
    clearLinkedInTokenChecks();
    validTokens = new Set(['old']);
    query.mockReset();
    // saveTokens returns the updated row; everything else just succeeds
    query.mockImplementation(async (sql, params) => {
      if (sql.includes('RETURNING *')) return { rows: [account({ access_token: params[1], token_invalid_at: null })], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    fetchMock = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.includes('/oauth/v2/accessToken')) {
        return validTokens.has('refresh-fails') ? json({ error: 'invalid_grant', error_description: 'Refresh token revoked' }, 400) : json({ access_token: 'new', expires_in: 5184000 });
      }
      if (u.includes('/rest/organizations/5')) {
        const token = init.headers.Authorization.replace('Bearer ', '');
        if (token === 'new' && !validTokens.has('refresh-fails')) validTokens.add('new');
        return validTokens.has(token) ? json({ id: 5 }) : json(REVOKED, 401);
      }
      return json({}, 500);
    });
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('returns the account when LinkedIn accepts the token, and trusts it for a while', async () => {
    const a = await getWorkingLinkedInToken(account());
    expect(a.access_token).toBe('old');
    await getWorkingLinkedInToken(account());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renews with the refresh token when LinkedIn revokes the access token early', async () => {
    validTokens.delete('old');
    const a = await getWorkingLinkedInToken(account());
    expect(a.access_token).toBe('new');
    const calls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(calls.filter((u) => u.includes('accessToken'))).toHaveLength(1);
    expect(query.mock.calls.some(([sql]) => sql.includes('token_invalid_at = NULL') && sql.includes('RETURNING *'))).toBe(true);
  });

  it('flags the account and asks for a reconnect when renewing fails too, with LinkedIn\'s reason', async () => {
    validTokens.delete('old');
    validTokens.add('refresh-fails');
    await expect(getWorkingLinkedInToken(account())).rejects.toMatchObject({ status: 401, reason: 'reconnect_required' });
    const flag = query.mock.calls.find(([sql]) => sql.includes('SET token_invalid_at = NOW()'));
    expect(flag).toBeTruthy();
    expect(flag[1][1]).toContain('REVOKED_ACCESS_TOKEN');
    expect(flag[1][1]).toContain('Refresh token revoked');
  });

  it('asks for a reconnect without a refresh token', async () => {
    validTokens.delete('old');
    await expect(getWorkingLinkedInToken(account({ refresh_token: null }))).rejects.toMatchObject({ reason: 'reconnect_required' });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('accessToken'))).toBe(false);
  });

  it('does not ask LinkedIn again right after it refused, but a new token is checked straight away', async () => {
    const flagged = account({ token_invalid_at: new Date().toISOString(), last_refresh_error: 'revoked' });
    await expect(getWorkingLinkedInToken(flagged)).rejects.toMatchObject({ reason: 'reconnect_required' });
    expect(fetchMock).not.toHaveBeenCalled();
    validTokens.add('reconnected');
    const a = await getWorkingLinkedInToken(account({ access_token: 'reconnected' }));
    expect(a.access_token).toBe('reconnected');
  });

  it('treats a 403 (API not granted) as a working token, not a revoked one', async () => {
    fetchMock.mockImplementationOnce(async () => json({ status: 403, message: 'Not enough permissions' }, 403));
    const a = await getWorkingLinkedInToken(account());
    expect(a.access_token).toBe('old');
    expect(query.mock.calls.some(([sql]) => sql.includes('SET token_invalid_at = NOW()'))).toBe(false);
  });

  it('clears an old flag once the token works again', async () => {
    const flaggedLongAgo = account({ token_invalid_at: new Date(Date.now() - DAY).toISOString() });
    const a = await getWorkingLinkedInToken(flaggedLongAgo);
    expect(a.token_invalid_at).toBeNull();
    expect(query.mock.calls.some(([sql]) => sql.includes('SET token_invalid_at = NULL'))).toBe(true);
  });
  it('works with a token from another LinkedIn app, but never renews or flags it', async () => {
    const foreign = account({ client_id: 'other-app' });
    expect((await getWorkingLinkedInToken(foreign)).access_token).toBe('old');

    clearLinkedInTokenChecks();
    validTokens.delete('old');
    await expect(getWorkingLinkedInToken(foreign)).rejects.toMatchObject({ reason: 'reconnect_required' });
    // No refresh with the other app's refresh token, and no flag that would lock out the copy that owns it.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('accessToken'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes('SET token_invalid_at = NOW()'))).toBe(false);
  });

  it('renews its own app\'s tokens and records which app issued the new one', async () => {
    validTokens.delete('old');
    const a = await getWorkingLinkedInToken(account({ client_id: 'id' }));
    expect(a.access_token).toBe('new');
    const save = query.mock.calls.find(([sql]) => sql.includes('RETURNING *'));
    expect(save[0]).toContain('client_id = $7');
    expect(save[1][6]).toBe('id');
  });

  it('labels stored errors with the server that hit them', async () => {
    validTokens.delete('old');
    validTokens.add('refresh-fails');
    await expect(getWorkingLinkedInToken(account())).rejects.toMatchObject({ reason: 'reconnect_required' });
    const flag = query.mock.calls.find(([sql]) => sql.includes('SET token_invalid_at = NOW()'));
    expect(flag[1][1]).toMatch(/^\[(local|cloud-run):/);
  });
});


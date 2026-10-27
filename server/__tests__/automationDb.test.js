import { describe, it, expect } from 'vitest';
import { createAutomationDb } from '../services/automationDb.js';

const USER_ID = '17841444338597640';
const API_ID = '39231704886428647';

/** Minimal stand-in for pg's pool, understanding only the three queries getAccountByIgId makes. */
function fakePool(rows) {
  return {
    query: async (sql, params = []) => {
      if (sql.includes('WHERE ig_user_id = $1')) return { rows: rows.filter((r) => r.ig_user_id === params[0] || r.page_id === params[0]).slice(0, 1) };
      if (sql.includes('WHERE ig_user_id IS NULL')) return { rows: rows.filter((r) => !r.ig_user_id) };
      if (sql.startsWith('UPDATE instagram_accounts')) { rows.find((r) => r.id === params[0]).ig_user_id = params[1]; return { rows: [] }; }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

describe('getAccountByIgId', () => {
  it('matches a webhook carrying the professional account id once ig_user_id is stored', async () => {
    const db = createAutomationDb(fakePool([{ id: 1, page_id: API_ID, ig_user_id: USER_ID }]));
    expect((await db.getAccountByIgId(USER_ID)).id).toBe(1);
  });

  it('still matches the API id', async () => {
    const db = createAutomationDb(fakePool([{ id: 1, page_id: API_ID, ig_user_id: USER_ID }]));
    expect((await db.getAccountByIgId(API_ID)).id).toBe(1);
  });

  it('fills in a missing ig_user_id from Instagram, then matches', async () => {
    const rows = [{ id: 1, page_id: API_ID, ig_user_id: null }];
    const db = createAutomationDb(fakePool(rows), { checkToken: async () => ({ data: { user_id: USER_ID } }) });
    expect((await db.getAccountByIgId(USER_ID)).id).toBe(1);
    expect(rows[0].ig_user_id).toBe(USER_ID);
  });

  it('returns null for an unknown id', async () => {
    const db = createAutomationDb(fakePool([{ id: 1, page_id: API_ID, ig_user_id: USER_ID }]), { checkToken: async () => ({ error: { code: 190 } }) });
    expect(await db.getAccountByIgId('999')).toBeNull();
  });
});

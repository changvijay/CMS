import { pool } from '../db.js';
import { createTtlCache } from '../utils/ttlCache.js';
import { daysBetween, istDateString } from '../utils/dates.js';
import { fetchIgDailyRows, fetchLiDailyRows, fetchYtDailyRows } from './syncService.js';
import { isStoredRange } from './retention.js';

const TABLES = { instagram: 'ig_daily_metrics', youtube: 'yt_daily_metrics', linkedin: 'li_daily_metrics' };
const LIVE_FETCHERS = { instagram: fetchIgDailyRows, youtube: fetchYtDailyRows, linkedin: fetchLiDailyRows };

/** Longest range fetched live in one request (Instagram costs one API call per day). */
export const MAX_LIVE_DAYS = 366;
/** A live range asked for on purpose stays fresh; this only absorbs repeat clicks and parallel tabs. */
const LIVE_TTL_MS = 2 * 60 * 1000;
/** Past comparison periods do not change once the platforms finalise them, so they can be kept longer. */
const PAST_TTL_MS = 6 * 60 * 60 * 1000;
const PAST_FAILURE_TTL_MS = 30 * 60 * 1000;

const liveCache = createTtlCache({ maxEntries: 300 });

/** Forget live results for one account (e.g. after it is synced or its token changes). */
export function invalidateLiveInsights(platform, accountId) {
  liveCache.invalidate(platform && accountId !== undefined ? `${platform}:${accountId}:` : '');
}

const TEXT_FIELDS = new Set(['account_id', 'metric_date', 'synced_at']);

/** Postgres BIGINT/NUMERIC arrive as strings and dates as Date objects: one shape for stored and live rows. */
export function normalizeDailyRow(row, accountId) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'metric_date') out[k] = v instanceof Date ? istDateString(v) : String(v).slice(0, 10);
    else if (TEXT_FIELDS.has(k)) out[k] = v;
    else out[k] = v === null || v === undefined || v === '' ? null : Number(v);
  }
  if (accountId !== undefined) out.account_id = String(accountId);
  else if (out.account_id !== undefined) out.account_id = String(out.account_id);
  return out;
}

/** Stored rows for several accounts in one query, oldest first. */
export async function loadStoredDaily(platform, accountIds, since, until, db = pool) {
  if (!accountIds.length) return [];
  const { rows } = await db.query(
    `SELECT * FROM ${TABLES[platform]} WHERE account_id = ANY($1) AND metric_date BETWEEN $2 AND $3 ORDER BY metric_date`,
    [accountIds.map(Number), since, until]
  );
  return rows.map((r) => normalizeDailyRow(r));
}

/** Rows fetched from the platform right now (briefly cached and shared between identical requests). */
const liveKey = (platform, account, since, until) => `${platform}:${account.id}:${since}:${until}`;

export async function loadLiveDaily(platform, account, since, until, { ttl = LIVE_TTL_MS } = {}) {
  const rows = await liveCache.getOrLoad(liveKey(platform, account, since, until), ttl, () => LIVE_FETCHERS[platform](account, since, until));
  return rows.map((r) => normalizeDailyRow(r, account.id));
}

/**
 * Daily rows for every account over [since, until], from the database when the whole range is inside the stored
 * window, otherwise live from the platforms. `live: true` always goes to the platforms (custom ranges).
 * One failing account does not hide the others: its error is returned next to the rows.
 */
export async function loadDaily(platform, accounts, since, until, { live = false, past = false, db = pool } = {}) {
  const source = !live && isStoredRange(since, until) ? 'stored' : 'live';
  if (source === 'stored') {
    return { source, rows: await loadStoredDaily(platform, accounts.map((a) => a.id), since, until, db), errors: [] };
  }
  if (daysBetween(since, until) + 1 > MAX_LIVE_DAYS) {
    throw Object.assign(new Error(`Pick a range of at most ${MAX_LIVE_DAYS} days.`), { status: 400 });
  }
  const errors = [];
  const perAccount = await Promise.all(accounts.map(async (account) => {
    try {
      return await loadLiveDaily(platform, account, since, until, { ttl: past ? PAST_TTL_MS : LIVE_TTL_MS });
    } catch (err) {
      // A comparison period the platform refuses (e.g. older than it keeps) is remembered as empty for a while,
      // so every page load doesn't repeat the same failing calls.
      if (past) liveCache.set(liveKey(platform, account, since, until), [], PAST_FAILURE_TTL_MS);
      errors.push({ platform, account_id: account.id, code: err.status || 502, reason: err.reason, message: err.message });
      return [];
    }
  }));
  const rows = perAccount.flat().sort((a, b) => (a.metric_date < b.metric_date ? -1 : a.metric_date > b.metric_date ? 1 : 0));
  return { source, rows, errors };
}

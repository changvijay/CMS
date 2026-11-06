import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ pool: { query: vi.fn() }, isDbReady: () => true }));
const live = { instagram: vi.fn(), youtube: vi.fn(), linkedin: vi.fn() };
vi.mock('../services/syncService.js', () => ({
  fetchIgDailyRows: (...a) => live.instagram(...a),
  fetchYtDailyRows: (...a) => live.youtube(...a),
  fetchLiDailyRows: (...a) => live.linkedin(...a),
}));

const { INSIGHTS_RETENTION_DAYS, isStoredRange, pruneInsights, retentionStart } = await import('../services/retention.js');
const { loadDaily, normalizeDailyRow, invalidateLiveInsights, MAX_LIVE_DAYS } = await import('../services/dailyInsights.js');
const { pool } = await import('../db.js');
const { addDays, istDateString } = await import('../utils/dates.js');

describe('retention window', () => {
  it('defaults to 30 days', () => {
    expect(INSIGHTS_RETENTION_DAYS).toBe(30);
    expect(retentionStart('2026-11-05')).toBe('2026-10-06');
  });

  it('treats a range as stored only when every day is inside the window and complete', () => {
    const today = '2026-11-05';
    expect(isStoredRange('2026-10-06', '2026-11-04', today)).toBe(true); // the default 30-day view
    expect(isStoredRange('2026-10-05', '2026-11-04', today)).toBe(false); // one day too old
    expect(isStoredRange('2026-11-01', '2026-11-05', today)).toBe(false); // today is not complete
  });
});

describe('pruneInsights', () => {
  it('deletes daily rows before the cutoff, old post captures, orphans and old OAuth logs', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 2 }) };
    const result = await pruneInsights({ db, today: '2026-11-05' });
    expect(result.cutoff).toBe('2026-10-06');
    const sql = db.query.mock.calls.map(([q]) => q);
    for (const table of ['ig_daily_metrics', 'yt_daily_metrics', 'li_daily_metrics', 'fb_daily_metrics']) {
      expect(sql).toContainEqual(`DELETE FROM ${table} WHERE metric_date < $1`);
    }
    expect(db.query.mock.calls.filter(([, params]) => params?.[0] === '2026-10-06')).toHaveLength(5);
    expect(sql.some((q) => q.includes('n.captured_on > s.captured_on'))).toBe(true);
    expect(sql.filter((q) => q.includes('NOT EXISTS'))).toHaveLength(4);
    expect(result.deleted).toEqual({
      ig_daily_metrics: 2, yt_daily_metrics: 2, li_daily_metrics: 2, fb_daily_metrics: 2, media_snapshots: 2, orphaned_snapshots: 8, oauth_log: 2,
    });
  });
});

describe('normalizeDailyRow', () => {
  it('turns Postgres strings and dates into numbers and YYYY-MM-DD', () => {
    const row = normalizeDailyRow({ account_id: 3, metric_date: new Date('2026-11-01T00:00:00+05:30'), views: '120', reach: null, avg_view_percentage: '41.5', synced_at: 'x' });
    expect(row).toEqual({ account_id: '3', metric_date: '2026-11-01', views: 120, reach: null, avg_view_percentage: 41.5, synced_at: 'x' });
  });
});

describe('loadDaily', () => {
  const today = istDateString();
  const yesterday = addDays(today, -1);
  const account = { id: 7 };

  beforeEach(() => {
    invalidateLiveInsights();
    pool.query.mockReset();
    for (const fn of Object.values(live)) fn.mockReset();
  });

  it('reads a range inside the stored window from the database in one query', async () => {
    pool.query.mockResolvedValue({ rows: [{ account_id: '7', metric_date: yesterday, views: '5' }] });
    const out = await loadDaily('youtube', [account, { id: 8 }], addDays(today, -7), yesterday);
    expect(out.source).toBe('stored');
    expect(out.rows).toEqual([{ account_id: '7', metric_date: yesterday, views: 5 }]);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][1][0]).toEqual([7, 8]);
    expect(live.youtube).not.toHaveBeenCalled();
  });

  it('fetches live when asked to, and shares the result for a short while', async () => {
    live.youtube.mockResolvedValue([{ metric_date: yesterday, views: 9 }]);
    const a = await loadDaily('youtube', [account], addDays(today, -3), yesterday, { live: true });
    const b = await loadDaily('youtube', [account], addDays(today, -3), yesterday, { live: true });
    expect(a).toEqual({ source: 'live', rows: [{ metric_date: yesterday, views: 9, account_id: '7' }], errors: [] });
    expect(b.rows).toEqual(a.rows);
    expect(live.youtube).toHaveBeenCalledTimes(1);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('fetches live when the range is older than the stored window', async () => {
    live.instagram.mockResolvedValue([]);
    const out = await loadDaily('instagram', [account], addDays(today, -60), addDays(today, -40));
    expect(out.source).toBe('live');
    expect(live.instagram).toHaveBeenCalledWith(account, addDays(today, -60), addDays(today, -40));
  });

  it('reports one failing account without hiding the others', async () => {
    live.linkedin.mockImplementation(async (acc) => {
      if (acc.id === 1) throw Object.assign(new Error('expired'), { status: 401, reason: 'token_expired' });
      return [{ metric_date: yesterday, impressions: 3 }];
    });
    const out = await loadDaily('linkedin', [{ id: 1 }, { id: 2 }], addDays(today, -90), addDays(today, -80));
    expect(out.rows).toEqual([{ metric_date: yesterday, impressions: 3, account_id: '2' }]);
    expect(out.errors).toEqual([{ platform: 'linkedin', account_id: 1, code: 401, reason: 'token_expired', message: 'expired' }]);
  });

  it('remembers a refused comparison period for a while instead of retrying on every load', async () => {
    live.instagram.mockRejectedValue(Object.assign(new Error('too old'), { status: 400 }));
    const range = [addDays(today, -60), addDays(today, -31)];
    const first = await loadDaily('instagram', [account], ...range, { past: true });
    const second = await loadDaily('instagram', [account], ...range, { past: true });
    expect(first.errors).toHaveLength(1);
    expect(second).toEqual({ source: 'live', rows: [], errors: [] });
    expect(live.instagram).toHaveBeenCalledTimes(1);
  });

  it('refuses live ranges longer than the cap', async () => {
    await expect(loadDaily('youtube', [account], addDays(yesterday, -MAX_LIVE_DAYS), yesterday)).rejects.toMatchObject({ status: 400 });
  });
});

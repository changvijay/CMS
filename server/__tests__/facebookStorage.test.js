import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../db.js', () => ({ pool: { query: (...a) => query(...a) }, isDbReady: () => true }));

const { buildDailyReport, fetchPageDailyFull, FB_DAILY_COLUMNS } = await import('../services/facebookInsights.js');
const { addDays, istDateString } = await import('../utils/dates.js');

const page = { id: '7', page_id: '111', page_access_token: 'tok' };
const v = (date, value, extra = {}) => ({ end_time: `${addDays(date, 1)}T08:00:00+0000`, value, ...extra });

describe('fetchPageDailyFull (what gets saved)', () => {
  it('merges breakdowns into each day and keeps refused metrics as null, not 0', async () => {
    const day = '2026-11-01';
    const get = async (_p, _t, params) => {
      if (params.breakdown === 'is_from_followers') return { data: { data: [{ values: [v(day, 2, { is_from_followers: '1' }), v(day, 5, { is_from_followers: '0' })] }] } };
      if (params.breakdown === 'is_from_ads') return { error: { code: 100, message: 'no' } };
      if (params.metric.includes(',')) {
        return { data: { data: [
          { name: 'page_media_view', values: [v(day, 7)] },
          { name: 'page_actions_post_reactions_total', values: [v(day, { like: 2 })] },
        ] } };
      }
      return { error: { code: 100, message: 'invalid metric' } };
    };
    const { rows } = await fetchPageDailyFull(page, day, day, { get });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      metric_date: day, views: 7, reactions: 2, reactions_by_type: { like: 2 }, reach: null,
      views_followers: 2, views_non_followers: 5, views_organic: null, views_ads: null,
    });
    expect(Object.keys(rows[0]).sort()).toEqual(['metric_date', ...FB_DAILY_COLUMNS].sort());
  });
});

describe('buildDailyReport (what gets shown)', () => {
  beforeEach(() => query.mockReset());

  it('reads the saved days for a preset range, without calling Facebook', async () => {
    const until = addDays(istDateString(), -1);
    const since = addDays(until, -1);
    const row = (date, views) => ({
      account_id: 7, metric_date: date, synced_at: '2026-11-06T10:00:00Z', views, reach: 3, engagements: 1, follows: 1, unfollows: 0,
      followers_total: 10, reactions: 1, reactions_by_type: { like: 1 }, views_followers: 1, views_non_followers: views - 1,
      views_organic: views, views_ads: 0,
    });
    query.mockImplementation(async (sql, params) => {
      if (params?.[1] === since) return { rows: [row(since, 4), row(until, 6)] };
      return { rows: [] }; // previous period: nothing saved
    });
    // The comparison period isn't saved, so it asks Facebook; here Facebook refuses, which must only drop the deltas.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ error: { code: 190, message: 'Session expired' } }), { status: 400 }));
    const r = await buildDailyReport(page, since, until);
    expect(r.source).toBe('stored');
    expect(r.deltas.views.change_pct).toBeNull();
    expect(r.last_synced_at).toBe('2026-11-06T10:00:00Z');
    expect(r.totals).toMatchObject({ views: 10, reach: 6, followers_total: 10 });
    expect(r.breakdowns).toEqual({ reactions: { like: 2 }, views_by_audience: { followers: 2, non_followers: 8 }, views_by_source: { organic: 10, ads: 0 } });
    expect(r.metrics.video_views).toBeUndefined();
    expect(r.daily.map((d) => d.date)).toEqual([since, until]);
    fetchSpy.mockRestore();
  });
});

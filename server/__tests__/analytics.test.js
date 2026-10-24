import { describe, it, expect } from 'vitest';
import {
  sumMetrics, pctChange, computeDeltas, movingAverage, detectAnomalies, linearForecast, bestWeekday,
} from '../services/analytics.js';
import { addDays, dateRange, daysBetween, istDayWindowSeconds, isDateString } from '../utils/dates.js';

describe('analytics', () => {
  it('sums metrics treating null as 0', () => {
    expect(sumMetrics([{ a: 1, b: null }, { a: 2, b: 3 }], ['a', 'b'])).toEqual({ a: 3, b: 3 });
  });

  it('weights average metrics by views instead of summing them', () => {
    const rows = [{ views: 100, avg_view_percentage: 50 }, { views: 300, avg_view_percentage: 30 }];
    expect(sumMetrics(rows, ['views', 'avg_view_percentage'])).toEqual({ views: 400, avg_view_percentage: 35 });
    expect(sumMetrics([], ['avg_view_percentage'])).toEqual({ avg_view_percentage: 0 });
  });

  it('pctChange returns null without a baseline and rounds to 1 decimal', () => {
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(103, 100)).toBe(3);
  });

  it('computeDeltas pairs current and previous', () => {
    expect(computeDeltas({ views: 120 }, { views: 100 }).views).toEqual({ current: 120, previous: 100, change_pct: 20 });
  });

  it('movingAverage uses a trailing window', () => {
    expect(movingAverage([2, 4, 6, 8], 2)).toEqual([2, 3, 5, 7]);
  });

  it('detectAnomalies flags a spike and ignores flat or short series', () => {
    const base = Array.from({ length: 10 }, (_, i) => ({ date: addDays('2026-01-01', i), value: 100 }));
    expect(detectAnomalies(base)).toEqual([]);
    const spiked = base.map((p, i) => (i === 5 ? { ...p, value: 1000 } : p));
    const found = detectAnomalies(spiked);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ date: '2026-01-06', type: 'spike' });
    expect(detectAnomalies(base.slice(0, 3))).toEqual([]);
  });

  it('linearForecast extends an upward line and never goes negative', () => {
    const f = linearForecast([10, 20, 30, 40], 2);
    expect(f.slope).toBe(10);
    expect(f.predictions).toEqual([50, 60]);
    expect(linearForecast([30, 20, 10], 3).predictions).toEqual([0, 0, 0]);
  });

  it('bestWeekday picks the highest-average day', () => {
    // 2026-01-04 is a Sunday (0)
    expect(bestWeekday([{ date: '2026-01-04', value: 50 }, { date: '2026-01-05', value: 10 }])).toBe(0);
    expect(bestWeekday([])).toBeNull();
  });
});

describe('dates', () => {
  it('addDays crosses month boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('dateRange is inclusive', () => {
    expect(dateRange('2026-01-01', '2026-01-03')).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  });
  it('daysBetween', () => expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30));
  it('istDayWindowSeconds spans exactly 24h starting at IST midnight', () => {
    const { since, until } = istDayWindowSeconds('2026-01-01');
    expect(until - since).toBe(86400);
    expect(new Date(since * 1000).toISOString()).toBe('2025-12-31T18:30:00.000Z');
  });
  it('isDateString validates format', () => {
    expect(isDateString('2026-01-01')).toBe(true);
    expect(isDateString('01-01-2026')).toBe(false);
    expect(isDateString(undefined)).toBe(false);
  });
});

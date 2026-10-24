import { describe, it, expect } from 'vitest';
import { buildBestTimeMatrix, engagementRate, parseDemographicBreakdown } from '../services/analytics.js';
import { reportToRows } from '../services/youtubeReports.js';

const hours = (fill) => Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), fill(h)]));

describe('buildBestTimeMatrix', () => {
  it('builds a weekday x hour matrix and ranks the busiest slots', () => {
    // end_time 07:00Z on Sat 2026-10-24 describes Friday 2026-10-23 (weekday 5)
    const data = [{ name: 'online_followers', values: [{ value: hours((h) => (h === 19 ? 500 : 100)), end_time: '2026-10-24T07:00:00+0000' }] }];
    const r = buildBestTimeMatrix(data);
    expect(r.days_sampled).toBe(1);
    expect(r.matrix[5][19]).toBe(500);
    expect(r.matrix[5][3]).toBe(100);
    expect(r.matrix[1][3]).toBeNull();
    expect(r.top_slots[0]).toEqual({ weekday: 5, hour: 19, value: 500 });
    expect(r.hourly_avg[19]).toBe(500);
  });

  it('averages repeated weekdays', () => {
    const data = [{ name: 'online_followers', values: [
      { value: hours(() => 100), end_time: '2026-10-24T07:00:00+0000' },
      { value: hours(() => 300), end_time: '2026-10-31T07:00:00+0000' },
    ] }];
    expect(buildBestTimeMatrix(data).matrix[5][0]).toBe(200);
  });

  it('returns an empty matrix for missing or malformed data', () => {
    expect(buildBestTimeMatrix(undefined).days_sampled).toBe(0);
    expect(buildBestTimeMatrix([{ name: 'online_followers', values: [{ value: 5, end_time: 'x' }] }]).top_slots).toEqual([]);
  });
});

describe('engagementRate', () => {
  it('is reactions over views, falling back to reach', () => {
    expect(engagementRate({ views: 1000, likes: 50, comments: 10, saves: 5, shares: 5 })).toBe(7);
    expect(engagementRate({ views: null, reach: 200, likes: 10 })).toBe(5);
  });
  it('is null with no audience', () => {
    expect(engagementRate({ views: 0, reach: null, likes: 5 })).toBeNull();
  });
});

describe('reportToRows', () => {
  it('zips column headers with rows', () => {
    const rows = reportToRows({ columnHeaders: [{ name: 'country' }, { name: 'views' }], rows: [['IN', 10], ['US', 4]] });
    expect(rows).toEqual([{ country: 'IN', views: 10 }, { country: 'US', views: 4 }]);
  });
  it('handles empty reports', () => {
    expect(reportToRows({})).toEqual([]);
  });
});

describe('parseDemographicBreakdown', () => {
  const resp = (results) => ({ data: [{ total_value: { breakdowns: [{ results }] } }] });
  it('sorts by value and labels genders', () => {
    const rows = parseDemographicBreakdown(resp([
      { dimension_values: ['M'], value: 30 },
      { dimension_values: ['F'], value: 70 },
      { dimension_values: ['U'], value: 5 },
    ]), 'gender');
    expect(rows).toEqual([{ label: 'Women', value: 70 }, { label: 'Men', value: 30 }, { label: 'Not specified', value: 5 }]);
  });
  it('keeps raw labels for age and country', () => {
    expect(parseDemographicBreakdown(resp([{ dimension_values: ['25-34'], value: 12 }]), 'age')).toEqual([{ label: '25-34', value: 12 }]);
  });
  it('returns [] for malformed responses', () => {
    expect(parseDemographicBreakdown({}, 'age')).toEqual([]);
    expect(parseDemographicBreakdown(null, 'age')).toEqual([]);
  });
});

import { reportDefinitions, REPORT_GROUPS } from '../services/youtubeReports.js';
describe('reportDefinitions', () => {
  const defs = reportDefinitions({ startDate: '2026-01-01', endDate: '2026-01-31' });
  it('covers every group and attaches the date range', () => {
    expect(Object.keys(defs).sort()).toEqual([...REPORT_GROUPS].sort());
    expect(defs.overview.channel_totals.startDate).toBe('2026-01-01');
  });
  it('gives every detail report the sort and maxResults the API demands', () => {
    for (const key of ['search_terms', 'external_sites', 'related_videos', 'embedded_sites']) {
      const d = defs.acquisition[key];
      expect(d.sort).toBeTruthy();
      expect(d.maxResults).toBeTruthy();
      expect(d.filters).toMatch(/==/);
    }
    expect(defs.audience.cities.maxResults).toBe('25');
  });
  it('requests search terms only for YouTube search traffic', () => {
    expect(defs.acquisition.search_terms.filters).toBe('insightTrafficSourceType==YT_SEARCH');
  });
});

import { describe, it, expect } from 'vitest';
import { buildInsights } from './insights';
import { extractHashtags, hashtagPerformance, mediaEngagementRate, performanceByFormat } from './content';
import type { HistoryResponse, StoredMedia } from '../../services/api';

const media = (over: Partial<StoredMedia>): StoredMedia => ({
  media_id: 'x', title: 'T', media_type: 'IMAGE', permalink: null, thumbnail_url: null, published_at: null,
  reach: null, views: 1000, likes: 50, comments: 10, saves: 5, shares: 5, reposts: null, total_interactions: null,
  profile_visits: null, follows: null, replies: null, link_clicks: null, skip_rate: null, avg_watch_seconds: null,
  total_watch_seconds: null, duration_seconds: null, extra: null, ...over,
});

const history = (over: Partial<HistoryResponse> = {}): HistoryResponse => ({
  platform: 'instagram',
  account: { id: 1, name: 'a' },
  range: { since: '2026-01-01', until: '2026-01-30', days: 30, previous_since: '', previous_until: '' },
  coverage: { days_with_data: 30, previous_days_with_data: 30 },
  primary_metric: 'reach',
  daily: [],
  totals: { views: 1000, likes: 50, comments: 10, saves: 5, shares: 5 },
  deltas: {
    reach: { current: 1200, previous: 1000, change_pct: 20 },
    views: { current: 1000, previous: 1000, change_pct: 0 },
    likes: { current: 50, previous: 40, change_pct: 25 },
    comments: { current: 10, previous: 10, change_pct: 0 },
    saves: { current: 5, previous: 5, change_pct: 0 },
    shares: { current: 5, previous: 5, change_pct: 0 },
  },
  anomalies: [],
  forecast: { slope: 0, predictions: [] },
  best_weekday: 4,
  last_synced_at: null,
  ...over,
});

describe('mediaEngagementRate', () => {
  it('is reactions over views, falling back to reach', () => {
    expect(mediaEngagementRate(media({}))).toBe(7);
    expect(mediaEngagementRate(media({ views: null, reach: 200, likes: 10, comments: 0, saves: 0, shares: 0 }))).toBe(5);
  });
  it('is null with no audience', () => {
    expect(mediaEngagementRate(media({ views: 0, reach: null }))).toBeNull();
  });
});

describe('buildInsights', () => {
  it('reports growth, engagement and best weekday', () => {
    const out = buildInsights('instagram', history(), []);
    expect(out[0]).toMatchObject({ tone: 'good', title: 'Reach is growing' });
    expect(out.some((i) => i.title.startsWith('Engagement rate is 7'))).toBe(true);
    expect(out.some((i) => i.title === 'Thursday is your strongest day')).toBe(true);
  });

  it('flags a decline', () => {
    const h = history({ deltas: { ...history().deltas, reach: { current: 700, previous: 1000, change_pct: -30 } } });
    expect(buildInsights('instagram', h, [])[0]).toMatchObject({ tone: 'bad', title: 'Reach is slowing down' });
  });

  it('uses the plural verb for views', () => {
    const h = history({ primary_metric: 'views', deltas: { ...history().deltas, views: { current: 2000, previous: 1000, change_pct: 100 } } });
    expect(buildInsights('youtube', h, [])[0].title).toBe('Views are growing');
  });

  it('names the best performer and the best format', () => {
    const items = [
      media({ media_id: 'a', title: 'Reel A', media_type: 'REEL', likes: 200 }),
      media({ media_id: 'b', title: 'Reel B', media_type: 'REEL', likes: 180 }),
      media({ media_id: 'c', title: 'Photo', media_type: 'IMAGE', likes: 10 }),
      media({ media_id: 'd', title: 'Photo 2', media_type: 'IMAGE', likes: 12 }),
    ];
    const out = buildInsights('instagram', history(), items);
    expect(out.find((i) => i.title === 'Your best performer')?.text).toContain('Reel A');
    expect(out.find((i) => i.title === 'Reels engage best')).toBeDefined();
  });

  it('never returns more than six insights', () => {
    const items = Array.from({ length: 6 }, (_, i) => media({ media_id: String(i), media_type: i % 2 ? 'REEL' : 'IMAGE' }));
    const h = history({ anomalies: [{ date: '2026-01-10', value: 9000, z_score: 3, type: 'spike' }] });
    expect(buildInsights('instagram', h, items).length).toBeLessThanOrEqual(6);
  });
});

describe('content helpers', () => {
  it('extracts unique lowercase hashtags, including unicode', () => {
    expect(extractHashtags('Great #Nifty #nifty and #பங்குச்சந்தை today')).toEqual(['#nifty', '#பங்குச்சந்தை']);
    expect(extractHashtags(null)).toEqual([]);
  });

  it('ranks formats by average engagement rate', () => {
    const rows = performanceByFormat([
      media({ media_type: 'REEL', likes: 200 }),
      media({ media_type: 'REEL', likes: 100 }),
      media({ media_type: 'IMAGE', likes: 10 }),
    ]);
    expect(rows[0]).toMatchObject({ type: 'REEL', label: 'Reels', count: 2 });
    expect(rows[1].type).toBe('IMAGE');
  });

  it('ranks hashtags used at least twice', () => {
    const rows = hashtagPerformance([
      media({ title: 'a #stocks #ipo', likes: 100 }),
      media({ title: 'b #stocks', likes: 60 }),
      media({ title: 'c #ipo', likes: 10 }),
    ]);
    expect(rows.map((r) => r.tag)).toEqual(['#stocks', '#ipo']);
    expect(rows[0].posts).toBe(2);
    expect(hashtagPerformance([media({ title: '#solo' })])).toEqual([]);
  });
});

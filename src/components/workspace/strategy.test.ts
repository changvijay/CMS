import { describe, it, expect } from 'vitest';
import type { StoredMedia, YoutubeVideoAnalytics } from '../../services/api';
import {
  cadence, captionAnalysis, durationBuckets, formatTable, instagramActions, mean, pearson,
  postingSchedule, reelScorecard, storyScorecard, titleAnalysis, youtubeActions,
} from './strategy';

const media = (over: Partial<StoredMedia>): StoredMedia => ({
  media_id: Math.random().toString(36).slice(2), title: 'T', media_type: 'IMAGE', permalink: null, thumbnail_url: null, published_at: null,
  reach: 1000, views: 1000, likes: 50, comments: 10, saves: 5, shares: 5, reposts: null, total_interactions: null,
  profile_visits: null, follows: null, replies: null, link_clicks: null, skip_rate: null, avg_watch_seconds: null,
  total_watch_seconds: null, duration_seconds: null, extra: null, ...over,
});

const video = (over: Partial<YoutubeVideoAnalytics>): YoutubeVideoAnalytics => ({
  video: 'abcdefghijk', title: 'A video', thumbnail_url: null, published_at: null, duration_seconds: 300, tags: [], lifetime_views: null,
  views: 1000, engagedViews: 900, comments: 5, likes: 40, dislikes: 0, shares: 5, estimatedMinutesWatched: 2000, averageViewDuration: 120,
  averageViewPercentage: 40, subscribersGained: 10, subscribersLost: 1, videosAddedToPlaylists: 3, videosRemovedFromPlaylists: 0, ...over,
});

describe('stats helpers', () => {
  it('mean rounds to one decimal and handles empty', () => {
    expect(mean([1, 2, 2])).toBe(1.7);
    expect(mean([])).toBeNull();
  });
  it('pearson detects a perfect inverse relationship and refuses tiny samples', () => {
    expect(pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBe(-1);
    expect(pearson([1, 2, 3], [1, 2, 3])).toBeNull();
    expect(pearson([1, 1, 1, 1, 1], [1, 2, 3, 4, 5])).toBeNull();
  });
});

describe('reelScorecard', () => {
  const reels = [20, 35, 50, 65, 40].map((skip, i) =>
    media({ media_type: 'REEL', skip_rate: skip, views: 1000 + i * 100, avg_watch_seconds: 5 + i, total_watch_seconds: 3600, likes: 100 - skip, comments: 0, saves: 0, shares: 0, title: `Reel ${i}` }));

  it('weights skip rate by views and ranks hooks', () => {
    const s = reelScorecard(reels)!;
    expect(s.count).toBe(5);
    expect(s.weightedSkipRate).toBeGreaterThan(40);
    expect(s.weightedSkipRate).toBeLessThan(45);
    expect(s.best[0].skip_rate).toBe(20);
    expect(s.worst[0].skip_rate).toBe(65);
    expect(s.avgWatchSeconds).toBe(7);
    expect(s.totalWatchHours).toBe(5);
    expect(s.buckets.map((b) => b.count)).toEqual([1, 2, 1, 1]);
  });

  it('finds that lower skip goes with higher engagement', () => {
    expect(reelScorecard(reels)!.skipVsEngagement).toBeLessThan(-0.9);
  });

  it('never shows the same reel as both a best and a worst hook', () => {
    const few = [20, 40, 60].map((skip, i) => media({ media_type: 'REEL', skip_rate: skip, views: 1000, title: `R${i}` }));
    const s = reelScorecard(few)!;
    const best = new Set(s.best.map((m) => m.media_id));
    expect(s.worst.every((m) => !best.has(m.media_id))).toBe(true);
    expect(s.best[0].skip_rate).toBe(20);
    expect(s.worst[0].skip_rate).toBe(60);
  });

  it('is null when no reel has a skip rate', () => {
    expect(reelScorecard([media({ media_type: 'REEL' }), media({})])).toBeNull();
  });
});

describe('formatTable', () => {
  it('compares formats and ignores stories', () => {
    const rows = formatTable([
      media({ media_type: 'REEL', likes: 200, reach: 1000, saves: 30, follows: 10 }),
      media({ media_type: 'IMAGE', likes: 20, reach: 1000, saves: 5, follows: 1 }),
      media({ media_type: 'STORY', likes: 999 }),
    ]);
    expect(rows.map((r) => r.type)).toEqual(['REEL', 'IMAGE']);
    expect(rows[0].saveRate).toBe(3);
    expect(rows[0].followsPer1kReach).toBe(10);
  });
});

describe('postingSchedule', () => {
  it('uses IST: 20:00 UTC Thursday is already Friday 1:30 AM in India', () => {
    const s = postingSchedule([media({ published_at: '2026-10-22T20:00:00Z' })]);
    expect(s.weekdays.find((d) => d.label === 'Friday')!.count).toBe(1);
    expect(s.weekdays.find((d) => d.label === 'Thursday')!.count).toBe(0);
    expect(s.bands[0].count).toBe(1); // night band
    expect(s.enough).toBe(false);
  });

  it('names the best weekday only with at least two posts', () => {
    const mk = (iso: string, likes: number) => media({ published_at: iso, likes });
    const s = postingSchedule([mk('2026-10-19T06:00:00Z', 300), mk('2026-10-26T06:00:00Z', 300), mk('2026-10-20T06:00:00Z', 10)]);
    expect(s.bestWeekday?.label).toBe('Monday');
  });
});

describe('cadence', () => {
  it('computes posts per week, median gap and busy-vs-quiet weeks', () => {
    const days = [0, 1, 2, 7, 14, 15, 16, 17];
    const items = days.map((d) => media({ published_at: new Date(Date.UTC(2026, 9, 5 + d, 6)).toISOString(), views: d >= 14 ? 3000 : 1000 }));
    const c = cadence(items)!;
    expect(c.postsPerWeek).toBe(2.9); // 7 gaps over 17 days
    expect(c.weekly.length).toBe(3);
    expect(c.busyWeeksAvg).toBe(3000);
  });
  it('needs at least three posts', () => {
    expect(cadence([media({ published_at: '2026-10-01T00:00:00Z' })])).toBeNull();
  });
});

describe('captionAnalysis', () => {
  it('buckets by length, hashtags and questions', () => {
    const r = captionAnalysis([
      media({ title: '' }),
      media({ title: 'Why is the market falling? #stocks #ipo' }),
      media({ title: 'x'.repeat(300) }),
    ]);
    expect(r.length.find((b) => b.label === 'No caption')!.count).toBe(1);
    expect(r.length.find((b) => b.label === 'Long (251+)')!.count).toBe(1);
    expect(r.hashtags.find((b) => b.label === '1–3 hashtags')!.count).toBe(1);
    expect(r.question.find((b) => b.label === 'Asks a question')!.count).toBe(1);
  });
});

describe('storyScorecard', () => {
  it('derives navigation rates from the breakdown', () => {
    const story = (views: number, nav: Record<string, number>) => media({
      media_type: 'STORY', views, reach: views, replies: 2, follows: 1, link_clicks: 3,
      extra: { breakdowns: { navigation: Object.entries(nav).map(([label, value]) => ({ label, value })) } },
    });
    const s = storyScorecard([story(100, { TAP_FORWARD: 60, TAP_EXIT: 20, TAP_BACK: 5 }), story(100, { TAP_FORWARD: 40, TAP_EXIT: 20, SWIPE_FORWARD: 10 })])!;
    expect(s.count).toBe(2);
    expect(s.exitRate).toBe(20);
    expect(s.forwardTapRate).toBe(50);
    expect(s.backTapRate).toBe(2.5);
    expect(s.swipeRate).toBe(5);
    expect(s.replies).toBe(4);
    expect(s.linkClicks).toBe(6);
  });
  it('is null without stories', () => {
    expect(storyScorecard([media({})])).toBeNull();
  });
});

describe('YouTube analysis', () => {
  it('buckets by duration with views-weighted retention', () => {
    const b = durationBuckets([
      video({ duration_seconds: 30, averageViewPercentage: 80, views: 1000 }),
      video({ duration_seconds: 45, averageViewPercentage: 60, views: 3000 }),
      video({ duration_seconds: 600, averageViewPercentage: 30 }),
      video({ duration_seconds: null }),
    ]);
    expect(b[0]).toMatchObject({ label: 'Under 1 min', count: 2, avgViewPct: 65 });
    expect(b[3].count).toBe(1);
    expect(b.reduce((a, x) => a + x.count, 0)).toBe(3);
  });

  it('compares title patterns on age-independent measures', () => {
    const t = titleAnalysis([
      video({ title: '5 mistakes', likes: 100 }),
      video({ title: 'Top 10 stocks', likes: 100 }),
      video({ title: 'Why stocks fall?', likes: 10 }),
    ]);
    expect(t.number[0].count).toBe(2);
    expect(t.number[0].engagementPer1k!).toBeGreaterThan(t.number[1].engagementPer1k!);
    expect(t.question[0].count).toBe(1);
  });
});

describe('recommendations', () => {
  it('tells an Instagram creator to fix hooks and favour the winning format', () => {
    const items = [
      ...Array.from({ length: 4 }, (_, i) => media({ media_type: 'REEL', skip_rate: 60 + i, likes: 300, title: `Reel ${i}` })),
      ...Array.from({ length: 4 }, (_, i) => media({ media_type: 'IMAGE', likes: 20, title: `Photo ${i}` })),
    ];
    const actions = instagramActions(items);
    expect(actions[0].priority).toBe('high');
    expect(actions.some((a) => a.title.startsWith('Make more reels'))).toBe(true);
    expect(actions.some((a) => a.title.includes('first 3 seconds'))).toBe(true);
  });

  it('stays quiet when there is not enough data', () => {
    expect(instagramActions([media({})])).toEqual([]);
    expect(youtubeActions([video({})])).toEqual([]);
  });

  it('flags weak YouTube retention', () => {
    const vids = Array.from({ length: 4 }, (_, i) => video({ title: `V${i}`, averageViewPercentage: 20 + i }));
    const actions = youtubeActions(vids);
    expect(actions[0]).toMatchObject({ priority: 'high', title: 'Viewers leave early' });
  });
});

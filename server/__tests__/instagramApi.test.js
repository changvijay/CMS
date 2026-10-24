import { describe, it, expect } from 'vitest';
import { metricsForMedia, normalizeSkipRate, parseBreakdown, parseInsightValues, shapeMediaMetrics, mediaLabel } from '../services/instagramApi.js';
import { analyzeComments, summarizeBenchmark } from '../services/textAnalysis.js';

describe('parseInsightValues', () => {
  it('reads values[] and total_value shapes', () => {
    const json = { data: [{ name: 'reach', values: [{ value: 120 }] }, { name: 'views', total_value: { value: 300 } }, { name: 'bad', values: [{ value: 'x' }] }] };
    expect(parseInsightValues(json)).toEqual({ reach: 120, views: 300 });
    expect(parseInsightValues(null)).toEqual({});
  });
});

describe('parseBreakdown', () => {
  it('joins dimensions and sorts by value', () => {
    const json = { data: [{ total_value: { breakdowns: [{ results: [
      { dimension_values: ['FOLLOWER'], value: 10 }, { dimension_values: ['NON_FOLLOWER'], value: 90 },
    ] }] } }] };
    expect(parseBreakdown(json)).toEqual([{ label: 'NON_FOLLOWER', value: 90 }, { label: 'FOLLOWER', value: 10 }]);
    expect(parseBreakdown({})).toEqual([]);
  });
});

describe('normalizeSkipRate', () => {
  it('treats values up to 1 as fractions and larger values as percentages', () => {
    expect(normalizeSkipRate(0.382)).toBe(38.2);
    expect(normalizeSkipRate(38.2)).toBe(38.2);
    expect(normalizeSkipRate(null)).toBeNull();
    expect(normalizeSkipRate(undefined)).toBeNull();
  });
});

describe('metricsForMedia / mediaLabel', () => {
  it('picks reel metrics including skip rate', () => {
    const plan = metricsForMedia({ media_product_type: 'REELS' });
    expect(plan.kind).toBe('REEL');
    expect(plan.metrics).toContain('reels_skip_rate');
    expect(plan.metrics).toContain('ig_reels_avg_watch_time');
  });
  it('picks story metrics with navigation breakdown', () => {
    const plan = metricsForMedia({ media_product_type: 'STORY' });
    expect(plan.metrics).toContain('replies');
    expect(plan.breakdowns.map((b) => b.metric)).toContain('navigation');
  });
  it('feed posts get follows and profile visits', () => {
    expect(metricsForMedia({ media_product_type: 'FEED', media_type: 'IMAGE' }).metrics).toContain('profile_visits');
  });
  it('labels formats', () => {
    expect(mediaLabel({ media_product_type: 'REELS' })).toBe('REEL');
    expect(mediaLabel({ media_product_type: 'STORY' })).toBe('STORY');
    expect(mediaLabel({ media_product_type: 'FEED', media_type: 'CAROUSEL_ALBUM' })).toBe('CAROUSEL_ALBUM');
  });
});

describe('shapeMediaMetrics', () => {
  it('converts watch time to seconds and skip rate to percent', () => {
    const s = shapeMediaMetrics({ saved: 5, ig_reels_avg_watch_time: 4200, ig_reels_video_view_total_time: 1200000, reels_skip_rate: 0.41 });
    expect(s).toMatchObject({ saves: 5, avg_watch_seconds: 4.2, total_watch_seconds: 1200, skip_rate: 41 });
    expect(s.reach).toBeNull();
  });
});

describe('analyzeComments', () => {
  it('counts questions and frequent words, ignoring stopwords', () => {
    const r = analyzeComments([
      { text: 'Which broker is best for IPO?', like_count: 3 },
      { text: 'Great IPO explanation', like_count: 9 },
      { text: 'Please explain mutual fund IPO again' },
      { text: '' },
    ]);
    expect(r.total).toBe(3);
    expect(r.questions).toBe(1);
    expect(r.top_words[0]).toEqual({ word: 'ipo', count: 3 });
    expect(r.top_comments[0].like_count).toBe(9);
  });
  it('handles Tamil text', () => {
    const r = analyzeComments([{ text: 'பங்குச்சந்தை பற்றி சொல்லுங்கள்' }, { text: 'பங்குச்சந்தை நன்றி' }]);
    expect(r.top_words[0].word).toBe('பங்குச்சந்தை');
  });
  it('returns zeros for nothing', () => {
    expect(analyzeComments(undefined)).toMatchObject({ total: 0, question_share: 0 });
  });
});

describe('summarizeBenchmark', () => {
  it('computes engagement rate and cadence', () => {
    const json = { business_discovery: { username: 'rival', followers_count: 1000, media: { data: [
      { like_count: 50, comments_count: 10, timestamp: '2026-10-01T00:00:00+0000', media_type: 'IMAGE' },
      { like_count: 30, comments_count: 10, timestamp: '2026-10-08T00:00:00+0000', media_type: 'VIDEO' },
      { like_count: 20, comments_count: 0, timestamp: '2026-10-15T00:00:00+0000', media_type: 'IMAGE' },
    ] } } };
    const s = summarizeBenchmark(json);
    expect(s.sampled_posts).toBe(3);
    expect(s.avg_likes).toBe(33);
    expect(s.engagement_rate).toBe(4);
    expect(s.posts_per_week).toBe(1);
    expect(s.format_mix).toEqual({ IMAGE: 2, VIDEO: 1 });
    expect(summarizeBenchmark({})).toBeNull();
  });
});

import { normalizeMediaRow } from '../routes/history.js';
describe('normalizeMediaRow', () => {
  it('converts Postgres numeric strings to numbers and keeps nulls', () => {
    const r = normalizeMediaRow({ media_id: 'x', views: '1500', likes: '20', skip_rate: '38.2', reach: null, title: 'T' });
    expect(r).toMatchObject({ views: 1500, likes: 20, skip_rate: 38.2, reach: null, title: 'T' });
    expect(r.likes + 5).toBe(25);
  });
});

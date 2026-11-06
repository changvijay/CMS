import { describe, it, expect } from 'vitest';
import { chunkRange, deltasOf, fetchPageDaily, fetchPagePosts, previousRange, valueDate, valuesByDate } from '../services/facebookInsights.js';

const page = { id: '7', page_id: '111', page_access_token: 'tok' };

describe('facebook insights helpers', () => {
  it('maps end_time to the day it describes', () => {
    expect(valueDate('2026-11-02T08:00:00+0000')).toBe('2026-11-01');
    expect([...valuesByDate([{ end_time: '2026-11-02T08:00:00+0000', value: 5 }, { end_time: '2026-11-03T08:00:00+0000', value: { a: 1, b: 2 } }])])
      .toEqual([['2026-11-01', 5], ['2026-11-02', 3]]);
  });

  it('splits long ranges into 90-day windows', () => {
    const chunks = chunkRange('2026-01-01', '2026-06-30');
    expect(chunks[0]).toEqual(['2026-01-01', '2026-03-31']);
    expect(chunks.at(-1)[1]).toBe('2026-06-30');
    expect(chunks).toHaveLength(3);
  });

  it('computes the previous period and deltas', () => {
    expect(previousRange('2026-10-08', '2026-11-06')).toEqual({ since: '2026-09-08', until: '2026-10-07' });
    expect(deltasOf({ views: 150 }, { views: 100 }).views).toEqual({ current: 150, previous: 100, change_pct: 50 });
    expect(deltasOf({ views: 150 }, null).views.change_pct).toBeNull();
  });
});

describe('fetchPageDaily', () => {
  it('falls back to an older metric name and reports refused metrics', async () => {
    const get = async (_path, _token, params) => {
      if (params.metric === 'page_media_view') return { error: { code: 100, message: 'invalid metric' } };
      if (params.metric === 'page_impressions') {
        return { data: { data: [{ name: 'page_impressions', values: [{ end_time: '2026-11-02T08:00:00+0000', value: 40 }] }] } };
      }
      if (params.metric === 'page_post_engagements') return { data: { data: [{ name: params.metric, values: [] }] } };
      return { error: { code: 100, message: 'invalid metric' } };
    };
    const r = await fetchPageDaily(page, '2026-11-01', '2026-11-02', { get });
    expect(r.metrics).toEqual({ views: 'page_impressions', engagements: 'page_post_engagements' });
    expect(r.rows).toEqual([{ date: '2026-11-01', views: 40, engagements: 0 }, { date: '2026-11-02', views: 0, engagements: 0 }]);
    expect(r.unavailable.map((u) => u.metric)).toContain('reach');
  });

  it('throws 401 when the token is rejected for every metric', async () => {
    const get = async () => ({ error: { code: 190, message: 'Session expired' } });
    await expect(fetchPageDaily(page, '2026-11-01', '2026-11-02', { get })).rejects.toMatchObject({ status: 401 });
  });
});

describe('fetchPagePosts', () => {
  it('adds up interactions', async () => {
    const get = async () => ({ data: { data: [{ id: '1', created_time: '2026-11-01T10:00:00+0000', reactions: { summary: { total_count: 4 } }, comments: { summary: { total_count: 2 } }, shares: { count: 1 } }] } });
    const r = await fetchPagePosts(page, '2026-11-01', '2026-11-02', { get });
    expect(r.posts[0]).toMatchObject({ reactions: 4, comments: 2, shares: 1, interactions: 7 });
  });
});

describe('fetchPageDaily batch call', () => {
  const v = (date, value) => ({ end_time: `${date}T08:00:00+0000`, value });
  it('reads every metric from one call, keeps running totals and converts watch time to minutes', async () => {
    const calls = [];
    const get = async (_path, _token, params) => {
      calls.push(params.metric);
      return { data: { data: [
        { name: 'page_media_view', values: [v('2026-11-02', 10), v('2026-11-03', 5)] },
        { name: 'page_follows', values: [v('2026-11-02', 40)] },
        { name: 'page_video_view_time', values: [v('2026-11-03', 120000)] },
        { name: 'page_actions_post_reactions_total', values: [v('2026-11-02', { like: 2, love: 1 }), v('2026-11-03', { like: 1 })] },
      ] } };
    };
    const r = await fetchPageDaily(page, '2026-11-01', '2026-11-02', { get });
    expect(calls[0].split(',').length).toBeGreaterThan(10);
    expect(r.rows[1]).toMatchObject({ views: 5, followers_total: 40, watch_minutes: 2, reactions: 1 });
    expect(r.rows[0].followers_total).toBe(40);
    expect(r.splits.reactions).toEqual({ like: 3, love: 1 });
  });
});

describe('totalsOf', () => {
  it('takes the last value for running totals', async () => {
    const { totalsOf } = await import('../services/facebookInsights.js');
    expect(totalsOf([{ followers_total: 10, views: 1 }, { followers_total: 12, views: 2 }], ['followers_total', 'views'])).toEqual({ followers_total: 12, views: 3 });
  });
});

describe('post and reel shaping', () => {
  it('reads lifetime post insights and skips day values', async () => {
    const { shapePost } = await import('../services/facebookInsights.js');
    const p = shapePost({
      id: '1', created_time: '2026-11-05T05:00:00+0000', comments: { summary: { total_count: 1 } }, reactions: { summary: { total_count: 1 } },
      insights: { data: [
        { name: 'post_media_view', id: '1/insights/post_media_view/lifetime', values: [{ value: 8 }] },
        { name: 'post_total_media_view_unique', id: '1/insights/post_total_media_view_unique/lifetime', values: [{ value: 4 }] },
        { name: 'post_total_media_view_unique', id: '1/insights/post_total_media_view_unique/day', values: [{ value: 0 }] },
        { name: 'post_clicks', id: '1/insights/post_clicks/lifetime', values: [{ value: 2 }] },
      ] },
    });
    expect(p).toMatchObject({ views: 8, reach: 4, clicks: 2, interactions: 2, engagement_rate: 100 });
  });

  it('keeps only reels inside the range and stops paging at older ones', async () => {
    const { fetchPageReels } = await import('../services/facebookInsights.js');
    let calls = 0;
    const get = async () => {
      calls += 1;
      return { data: { data: [
        { id: 'a', created_time: '2026-11-05T05:00:00+0000', permalink_url: '/reel/a/', length: 60, video_insights: { data: [{ name: 'fb_reels_total_plays', values: [{ value: 9 }] }, { name: 'post_video_social_actions', values: [{ value: { COMMENT: 2 } }] }] } },
        { id: 'b', created_time: '2026-09-01T05:00:00+0000' },
      ], paging: { next: 'x', cursors: { after: 'c' } } } };
    };
    const r = await fetchPageReels(page, '2026-11-01', '2026-11-06', { get });
    expect(calls).toBe(1);
    expect(r.reels).toHaveLength(1);
    expect(r.reels[0]).toMatchObject({ plays: 9, comments: 2, permalink: 'https://www.facebook.com/reel/a/' });
  });
});

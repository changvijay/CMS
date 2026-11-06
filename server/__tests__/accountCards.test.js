import { describe, it, expect } from 'vitest';
import { buildAccountCard, shapeCardMetrics } from '../services/accountCards.js';

describe('shapeCardMetrics', () => {
  it('turns Instagram SQL strings into numbers and computes engagement rate', () => {
    const m = shapeCardMetrics('instagram', { reach: '5000', views: '10000', interactions: '700', net_followers: '-3', link_taps: '12', likes: '400', comments: '50', saves: '30', shares: '20' });
    expect(m).toEqual({ reach: 5000, views: 10000, interactions: 700, net_followers: -3, link_taps: 12, engagement_rate: 5 });
  });

  it('computes YouTube watch hours, net subscribers and engagement', () => {
    const m = shapeCardMetrics('youtube', { views: '2000', minutes_watched: '1200', subs_gained: '50', subs_lost: '10', likes: '100', comments: '20', shares: '10', avg_view_percentage: '41.26' });
    expect(m).toMatchObject({ views: 2000, watch_hours: 20, net_subscribers: 40, interactions: 130, avg_view_percentage: 41.3, engagement_rate: 6.5 });
  });

  it('shapes a LinkedIn page card with clicks in the engagement rate', () => {
    const m = shapeCardMetrics('linkedin', { impressions: '1000', clicks: '30', likes: '15', comments: '3', shares: '2', page_views: '80', net_followers: '9' });
    expect(m).toEqual({ impressions: 1000, clicks: 30, reactions: 15, net_followers: 9, page_views: 80, engagement_rate: 5 });
  });

  it('is all zeros for an account with no stored data', () => {
    expect(shapeCardMetrics('instagram', undefined)).toEqual({ reach: 0, views: 0, interactions: 0, net_followers: 0, link_taps: 0, engagement_rate: 0 });
  });
});

describe('buildAccountCard', () => {
  it('names the account, compares with the previous period and keeps the daily series', () => {
    const card = buildAccountCard({
      platform: 'youtube',
      account: { id: 7, channel_name: 'My Channel' },
      current: { days: 30, views: '300' },
      previous: { days: 30, views: '200' },
      series: [{ views: '10' }, { views: '20' }],
    });
    expect(card).toMatchObject({ platform: 'youtube', id: 7, name: 'My Channel', days_with_data: 30, series: [10, 20] });
    expect(card.deltas.views).toEqual({ current: 300, previous: 200, change_pct: 50 });
  });

  it('shows no change percentage when there was nothing before', () => {
    const card = buildAccountCard({ platform: 'instagram', account: { id: 1, page_name: 'IG' }, current: { days: 5, views: '100' }, previous: undefined, series: [] });
    expect(card.name).toBe('IG');
    expect(card.deltas.views.change_pct).toBeNull();
  });
});

import { aggregateCardRow, buildAccountCards } from '../services/accountCards.js';
import { combineByDate } from '../routes/insights.js';

describe('aggregateCardRow', () => {
  it('sums Instagram rows the way the old SQL did, nulls counting as zero', () => {
    const rows = [
      { reach: 10, views: 100, total_interactions: 7, follower_change: 2, profile_links_taps: 1, likes: 3, comments: 1, saves: 1, shares: 1 },
      { reach: 20, views: null, total_interactions: 3, follower_change: -1, profile_links_taps: null, likes: 2, comments: 0, saves: 0, shares: 0 },
    ];
    expect(aggregateCardRow('instagram', rows)).toEqual({
      days: 2, reach: 30, views: 100, interactions: 10, net_followers: 1, link_taps: 1, likes: 5, comments: 1, saves: 1, shares: 1,
    });
  });

  it('weights YouTube average view percentage by views, only over days that report it', () => {
    const agg = aggregateCardRow('youtube', [
      { views: 100, avg_view_percentage: 40 },
      { views: 300, avg_view_percentage: 60 },
      { views: 1000, avg_view_percentage: null },
    ]);
    expect(agg.views).toBe(1400);
    expect(agg.avg_view_percentage).toBe(55);
    expect(aggregateCardRow('youtube', [{ views: 5, avg_view_percentage: null }]).avg_view_percentage).toBeNull();
  });

  it('adds organic and paid LinkedIn followers', () => {
    expect(aggregateCardRow('linkedin', [{ organic_follower_gain: 3, paid_follower_gain: null, impressions: 9 }])).toMatchObject({ net_followers: 3, impressions: 9 });
  });
});

describe('buildAccountCards', () => {
  it('builds a card per account from its own rows, including accounts with no data', () => {
    const accounts = { instagram: [{ id: 1, page_name: 'A' }, { id: 2, page_name: 'B' }], youtube: [], linkedin: [{ id: 5, page_name: 'L' }] };
    const rows = {
      instagram: [{ account_id: '1', metric_date: '2026-11-01', views: 10 }, { account_id: '1', metric_date: '2026-11-02', views: 30 }],
      linkedin: [{ account_id: '5', metric_date: '2026-11-01', impressions: 50 }],
    };
    const previous = { instagram: [{ account_id: '1', views: 20 }] };
    const cards = buildAccountCards(accounts, rows, previous);
    expect(cards.map((c) => [c.platform, c.id, c.days_with_data])).toEqual([['instagram', 1, 2], ['instagram', 2, 0], ['linkedin', 5, 1]]);
    expect(cards[0].series).toEqual([10, 30]);
    expect(cards[0].deltas.views).toEqual({ current: 40, previous: 20, change_pct: 100 });
    expect(cards[1].totals.views).toBe(0);
    expect(cards[2].series).toEqual([50]);
  });
});

describe('combineByDate', () => {
  it('adds accounts together per date with each platform\'s definition of views, interactions and followers', () => {
    expect(combineByDate('youtube', [
      { metric_date: '2026-11-02', views: 5, likes: 1, comments: null, shares: 1, subs_gained: 3, subs_lost: 1 },
      { metric_date: '2026-11-01', views: 7, likes: 0, comments: 0, shares: 0, subs_gained: 0, subs_lost: 2 },
      { metric_date: '2026-11-02', views: 1, likes: 1, comments: 1, shares: 0, subs_gained: 0, subs_lost: 0 },
    ])).toEqual([
      { date: '2026-11-01', views: 7, interactions: 0, net_followers: -2 },
      { date: '2026-11-02', views: 6, interactions: 4, net_followers: 2 },
    ]);
    expect(combineByDate('linkedin', [{ metric_date: 'd', impressions: 9, likes: 1, comments: 1, shares: 1, clicks: 2, organic_follower_gain: 1, paid_follower_gain: 1 }]))
      .toEqual([{ date: 'd', views: 9, interactions: 5, net_followers: 2 }]);
  });
});

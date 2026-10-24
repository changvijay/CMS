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

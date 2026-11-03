import { describe, it, expect } from 'vitest';
import {
  followerBreakdowns,
  mergeDaily,
  pageSections,
  postType,
  reactionCounts,
  timeIntervals,
  visitorBreakdowns,
} from '../services/linkedinApi.js';

const day = (date) => ({ start: Date.parse(`${date}T00:00:00Z`), end: Date.parse(`${date}T00:00:00Z`) + 86400000 });

describe('timeIntervals', () => {
  it('covers whole UTC days, end date included', () => {
    const start = Date.UTC(2026, 9, 1);
    expect(timeIntervals('2026-10-01', '2026-10-02')).toBe(`(timeRange:(start:${start},end:${start + 2 * 86400000}),timeGranularityType:DAY)`);
  });
});

describe('mergeDaily', () => {
  it('joins share, page and follower stats into one row per day', () => {
    const out = mergeDaily({
      share: [{ timeRange: day('2026-10-01'), totalShareStatistics: { impressionCount: 900, uniqueImpressionsCount: 600, clickCount: 30, likeCount: 20, commentCount: 4, shareCount: 2, engagement: 0.062 } }],
      page: [{ timeRange: day('2026-10-01'), totalPageStatistics: { views: { allPageViews: { pageViews: 50 }, allDesktopPageViews: { pageViews: 30 }, allMobilePageViews: { pageViews: 20 } } } }],
      follower: [
        { timeRange: day('2026-10-01'), followerGains: { organicFollowerGain: 7, paidFollowerGain: 0 } },
        { timeRange: day('2026-10-02'), followerGains: { organicFollowerGain: -1, paidFollowerGain: 0 } },
      ],
    });
    expect(out['2026-10-01']).toMatchObject({
      impressions: 900, unique_impressions: 600, clicks: 30, likes: 20, comments: 4, shares: 2,
      page_views: 50, desktop_page_views: 30, mobile_page_views: 20, organic_follower_gain: 7, paid_follower_gain: 0,
    });
    expect(out['2026-10-02']).toEqual({ organic_follower_gain: -1, paid_follower_gain: 0 });
  });
});

describe('breakdowns', () => {
  it('adds organic and paid followers and sorts largest first, dropping zeros', () => {
    const b = followerBreakdowns({
      followerCountsBySeniority: [
        { seniority: 'urn:li:seniority:3', followerCounts: { organicFollowerCount: 10, paidFollowerCount: 2 } },
        { seniority: 'urn:li:seniority:5', followerCounts: { organicFollowerCount: 40, paidFollowerCount: 0 } },
        { seniority: 'urn:li:seniority:1', followerCounts: { organicFollowerCount: 0, paidFollowerCount: 0 } },
      ],
      followerCountsByIndustryV2: [{ industryV2: 'urn:li:industry:43', followerCounts: { organicFollowerCount: 5 } }],
    });
    expect(b.seniority).toEqual([{ key: 'urn:li:seniority:5', value: 40 }, { key: 'urn:li:seniority:3', value: 12 }]);
    expect(b.industry).toEqual([{ key: 'urn:li:industry:43', value: 5 }]);
    expect(b.country).toEqual([]);
  });

  it('reads visitor page views per group', () => {
    const b = visitorBreakdowns({ pageStatisticsByFunction: [{ function: 'urn:li:function:10', pageStatistics: { views: { allPageViews: { pageViews: 33 } } } }] });
    expect(b.function).toEqual([{ key: 'urn:li:function:10', value: 33 }]);
  });

  it('lists page sections with views, biggest first', () => {
    const s = pageSections({ views: { allPageViews: { pageViews: 100 }, overviewPageViews: { pageViews: 60 }, aboutPageViews: { pageViews: 25 }, jobsPageViews: { pageViews: 0 }, allMobilePageViews: { pageViews: 70 } } });
    expect(s.sections).toEqual([{ label: 'Home', value: 60 }, { label: 'About', value: 25 }]);
    expect(s.devices).toEqual([{ label: 'Desktop', value: 0 }, { label: 'Mobile', value: 70 }]);
    expect(s.total).toBe(100);
  });
});

describe('posts', () => {
  it('detects the post type', () => {
    expect(postType({ content: { media: { id: 'urn:li:video:1' } } })).toBe('VIDEO');
    expect(postType({ content: { media: { id: 'urn:li:image:1' } } })).toBe('IMAGE');
    expect(postType({ content: { media: { id: 'urn:li:document:1' } } })).toBe('DOCUMENT');
    expect(postType({ content: { multiImage: {} } })).toBe('CAROUSEL_ALBUM');
    expect(postType({ content: { article: {} } })).toBe('ARTICLE');
    expect(postType({ content: { poll: {} } })).toBe('POLL');
    expect(postType({ commentary: 'hi' })).toBe('TEXT');
  });

  it('names every reaction type', () => {
    const r = reactionCounts({ reactionSummaries: { LIKE: { count: 12 }, PRAISE: { count: 3 }, INTEREST: { count: 1 } } });
    expect(r).toEqual({ Like: 12, Celebrate: 3, Support: 0, Love: 0, Insightful: 1, Funny: 0 });
  });
});

import { computeDeltas } from './analytics.js';

const n = (v) => (v === null || v === undefined ? 0 : Number(v));
const round1 = (v) => Math.round(v * 10) / 10;
const rate = (engagement, views) => (views > 0 ? round1((engagement / views) * 100) : 0);

/** The headline numbers for one account, from one aggregated SQL row (all values may arrive as strings). */
export function shapeCardMetrics(platform, row) {
  const r = row || {};
  if (platform === 'instagram') {
    const views = n(r.views);
    return {
      reach: n(r.reach),
      views,
      interactions: n(r.interactions),
      net_followers: n(r.net_followers),
      link_taps: n(r.link_taps),
      engagement_rate: rate(n(r.likes) + n(r.comments) + n(r.saves) + n(r.shares), views),
    };
  }
  if (platform === 'facebook') {
    const views = n(r.views);
    return {
      views,
      reach: n(r.reach),
      engagements: n(r.engagements),
      net_followers: n(r.net_followers),
      page_visits: n(r.page_visits),
      engagement_rate: rate(n(r.engagements), views),
    };
  }
  if (platform === 'linkedin') {
    const impressions = n(r.impressions);
    const interactions = n(r.likes) + n(r.comments) + n(r.shares) + n(r.clicks);
    return {
      impressions,
      clicks: n(r.clicks),
      reactions: n(r.likes),
      net_followers: n(r.net_followers),
      page_views: n(r.page_views),
      engagement_rate: rate(interactions, impressions),
    };
  }
  const views = n(r.views);
  return {
    views,
    watch_hours: round1(n(r.minutes_watched) / 60),
    net_subscribers: n(r.subs_gained) - n(r.subs_lost),
    interactions: n(r.likes) + n(r.comments) + n(r.shares),
    avg_view_percentage: round1(n(r.avg_view_percentage)),
    engagement_rate: rate(n(r.likes) + n(r.comments) + n(r.shares), views),
  };
}

export function buildAccountCard({ platform, account, current, previous, series }) {
  const totals = shapeCardMetrics(platform, current);
  const prev = shapeCardMetrics(platform, previous);
  return {
    platform,
    id: account.id,
    name: platform === 'youtube' ? account.channel_name : platform === 'facebook' ? account.name : account.page_name,
    days_with_data: n(current?.days),
    totals,
    deltas: computeDeltas(totals, prev),
    series: (series || []).map((p) => n(p.views)),
  };
}

const sum = (rows, key) => rows.reduce((acc, r) => acc + n(r[key]), 0);

/** The aggregated numbers one card needs, from that account's daily rows (stored or live). */
export function aggregateCardRow(platform, rows) {
  const base = { days: rows.length };
  if (platform === 'instagram') {
    return {
      ...base, reach: sum(rows, 'reach'), views: sum(rows, 'views'), interactions: sum(rows, 'total_interactions'),
      net_followers: sum(rows, 'follower_change'), link_taps: sum(rows, 'profile_links_taps'),
      likes: sum(rows, 'likes'), comments: sum(rows, 'comments'), saves: sum(rows, 'saves'), shares: sum(rows, 'shares'),
    };
  }
  if (platform === 'facebook') {
    return {
      ...base, views: sum(rows, 'views'), reach: sum(rows, 'reach'), engagements: sum(rows, 'engagements'),
      page_visits: sum(rows, 'page_visits'), net_followers: sum(rows, 'follows') - sum(rows, 'unfollows'),
    };
  }
  if (platform === 'linkedin') {
    return {
      ...base, impressions: sum(rows, 'impressions'), clicks: sum(rows, 'clicks'), likes: sum(rows, 'likes'),
      comments: sum(rows, 'comments'), shares: sum(rows, 'shares'), page_views: sum(rows, 'page_views'),
      net_followers: sum(rows, 'organic_follower_gain') + sum(rows, 'paid_follower_gain'),
    };
  }
  // Average view percentage is weighted by views, counting only days that report it.
  const weighted = rows.filter((r) => r.avg_view_percentage !== null && r.avg_view_percentage !== undefined);
  const weightedViews = sum(weighted, 'views');
  return {
    ...base, views: sum(rows, 'views'), minutes_watched: sum(rows, 'minutes_watched'), subs_gained: sum(rows, 'subs_gained'),
    subs_lost: sum(rows, 'subs_lost'), likes: sum(rows, 'likes'), comments: sum(rows, 'comments'), shares: sum(rows, 'shares'),
    avg_view_percentage: weightedViews > 0 ? weighted.reduce((acc, r) => acc + n(r.avg_view_percentage) * n(r.views), 0) / weightedViews : null,
  };
}

const SERIES_COLUMN = { instagram: 'views', youtube: 'views', linkedin: 'impressions', facebook: 'views' };

/**
 * One card per connected account, in the order given. Accounts with no data still get a card.
 * `rows` / `previousRows` map platform -> daily rows carrying `account_id`.
 */
export function buildAccountCards(accountsByPlatform, rows, previousRows) {
  const cards = [];
  for (const [platform, accounts] of Object.entries(accountsByPlatform)) {
    const forAccount = (list, id) => (list?.[platform] || []).filter((r) => String(r.account_id) === String(id));
    for (const account of accounts) {
      const current = forAccount(rows, account.id);
      cards.push(buildAccountCard({
        platform,
        account,
        current: current.length ? aggregateCardRow(platform, current) : undefined,
        previous: aggregateCardRow(platform, forAccount(previousRows, account.id)),
        series: current.map((r) => ({ views: r[SERIES_COLUMN[platform]] ?? 0 })),
      }));
    }
  }
  return cards;
}

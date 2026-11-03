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
    name: platform === 'youtube' ? account.channel_name : account.page_name,
    days_with_data: n(current?.days),
    totals,
    deltas: computeDeltas(totals, prev),
    series: (series || []).map((p) => n(p.views)),
  };
}

const AGG = {
  instagram: {
    table: 'ig_daily_metrics',
    select: `COUNT(*)::int AS days, SUM(reach) AS reach, SUM(views) AS views, SUM(total_interactions) AS interactions,
             SUM(follower_change) AS net_followers, SUM(profile_links_taps) AS link_taps,
             SUM(likes) AS likes, SUM(comments) AS comments, SUM(saves) AS saves, SUM(shares) AS shares`,
  },
  youtube: {
    table: 'yt_daily_metrics',
    select: `COUNT(*)::int AS days, SUM(views) AS views, SUM(minutes_watched) AS minutes_watched,
             SUM(subs_gained) AS subs_gained, SUM(subs_lost) AS subs_lost, SUM(likes) AS likes, SUM(comments) AS comments, SUM(shares) AS shares,
             SUM(avg_view_percentage * views) / NULLIF(SUM(views) FILTER (WHERE avg_view_percentage IS NOT NULL), 0) AS avg_view_percentage`,
  },
  linkedin: {
    table: 'li_daily_metrics',
    seriesColumn: 'impressions',
    select: `COUNT(*)::int AS days, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(likes) AS likes,
             SUM(comments) AS comments, SUM(shares) AS shares, SUM(page_views) AS page_views,
             SUM(COALESCE(organic_follower_gain, 0) + COALESCE(paid_follower_gain, 0)) AS net_followers`,
  },
};

/** One card per connected account, instagram accounts first. Accounts with no stored data still get a card. */
export async function loadAccountCards(pool, { igAccounts, ytAccounts, liAccounts = [], since, until, prevSince, prevUntil }) {
  const cards = [];
  for (const [platform, accounts] of [['instagram', igAccounts], ['youtube', ytAccounts], ['linkedin', liAccounts]]) {
    if (!accounts.length) continue;
    const { table, select, seriesColumn = 'views' } = AGG[platform];
    const ids = accounts.map((a) => Number(a.id));
    const aggregate = (from, to) => pool.query(
      `SELECT account_id, ${select} FROM ${table} WHERE account_id = ANY($1) AND metric_date BETWEEN $2 AND $3 GROUP BY account_id`, [ids, from, to]);
    const [cur, prev, series] = await Promise.all([
      aggregate(since, until),
      aggregate(prevSince, prevUntil),
      pool.query(`SELECT account_id, COALESCE(${seriesColumn}, 0) AS views FROM ${table} WHERE account_id = ANY($1) AND metric_date BETWEEN $2 AND $3 ORDER BY metric_date`, [ids, since, until]),
    ]);
    const by = (rows) => new Map(rows.map((r) => [String(r.account_id), r]));
    const curMap = by(cur.rows);
    const prevMap = by(prev.rows);
    for (const account of accounts) {
      cards.push(buildAccountCard({
        platform,
        account,
        current: curMap.get(String(account.id)),
        previous: prevMap.get(String(account.id)),
        series: series.rows.filter((r) => String(r.account_id) === String(account.id)),
      }));
    }
  }
  return cards;
}

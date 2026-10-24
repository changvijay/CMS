import type { DailyPoint, Platform } from '../../services/api';

export interface MetricInfo {
  key: string;
  label: string;
  /** Decreases are good news (e.g. subscribers lost). */
  lowerIsBetter?: boolean;
}

export const PLATFORM_METRICS: Record<Platform, MetricInfo[]> = {
  instagram: [
    { key: 'reach', label: 'Reach' },
    { key: 'views', label: 'Views' },
    { key: 'total_interactions', label: 'Interactions' },
    { key: 'accounts_engaged', label: 'Accounts engaged' },
    { key: 'follower_change', label: 'Net followers' },
    { key: 'profile_links_taps', label: 'Link taps' },
    { key: 'likes', label: 'Likes' },
    { key: 'comments', label: 'Comments' },
    { key: 'saves', label: 'Saves' },
    { key: 'shares', label: 'Shares' },
    { key: 'replies', label: 'Story replies' },
    { key: 'reposts', label: 'Reposts' },
  ],
  youtube: [
    { key: 'views', label: 'Views' },
    { key: 'engaged_views', label: 'Engaged views' },
    { key: 'minutes_watched', label: 'Watch time (min)' },
    { key: 'avg_view_duration', label: 'Avg view duration (sec)' },
    { key: 'avg_view_percentage', label: 'Avg % of video viewed' },
    { key: 'subs_gained', label: 'Subscribers gained' },
    { key: 'subs_lost', label: 'Subscribers lost', lowerIsBetter: true },
    { key: 'likes', label: 'Likes' },
    { key: 'dislikes', label: 'Dislikes', lowerIsBetter: true },
    { key: 'comments', label: 'Comments' },
    { key: 'shares', label: 'Shares' },
    { key: 'playlist_adds', label: 'Added to playlists' },
    { key: 'playlist_removes', label: 'Removed from playlists', lowerIsBetter: true },
    { key: 'card_impressions', label: 'Card impressions' },
    { key: 'card_clicks', label: 'Card clicks' },
    { key: 'premium_views', label: 'Premium views' },
  ],
};

export const KPI_KEYS: Record<Platform, string[]> = {
  instagram: ['reach', 'views', 'total_interactions', 'accounts_engaged', 'follower_change', 'profile_links_taps'],
  youtube: ['views', 'engaged_views', 'minutes_watched', 'avg_view_percentage', 'subs_gained', 'subs_lost', 'likes', 'comments'],
};

/** Metrics that are averages: shown as-is, never "compact" formatted and never summed. */
export const AVERAGE_METRICS = new Set(['avg_view_duration', 'avg_view_percentage']);

export const ENGAGEMENT_KEYS: Record<Platform, string[]> = {
  instagram: ['likes', 'comments', 'saves', 'shares'],
  youtube: ['likes', 'comments', 'shares'],
};

/** Fixed, per-entity colors (dark-surface steps of the validated categorical palette). */
export const METRIC_COLORS: Record<string, string> = {
  likes: 'var(--series-1)',
  comments: 'var(--series-2)',
  saves: 'var(--series-3)',
  shares: 'var(--series-4)',
};

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function metricLabel(platform: Platform, key: string): string {
  return PLATFORM_METRICS[platform].find((m) => m.key === key)?.label ?? key;
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

export function formatShortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function numericSeries(daily: DailyPoint[], key: string): number[] {
  return daily.map((d) => Number(d[key] ?? 0));
}

/** Average of `key` by weekday (0 = Sunday); null where there is no data. */
export function weekdayAverages(daily: DailyPoint[], key: string): { day: string; avg: number | null }[] {
  const sums = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
  for (const d of daily) {
    const v = d[key];
    if (typeof v !== 'number') continue;
    const idx = new Date(`${d.date}T00:00:00Z`).getUTCDay();
    sums[idx].sum += v;
    sums[idx].n += 1;
  }
  return sums.map((s, i) => ({ day: WEEKDAYS[i].slice(0, 3), avg: s.n ? Math.round(s.sum / s.n) : null }));
}

/** Plain-language explanations shown next to each metric. */
export const METRIC_HELP: Record<string, string> = {
  reach: 'Unique accounts that saw your content at least once.',
  views: 'Total times your content was played or shown. One person can count more than once.',
  total_interactions: 'Likes, comments, saves, shares and replies added together.',
  accounts_engaged: 'Unique accounts that interacted with your content in any way.',
  follower_change: 'Followers gained minus followers lost in the period.',
  profile_links_taps: 'Taps on the links in your profile, such as your website or email.',
  likes: 'Number of likes received.',
  comments: 'Number of comments received.',
  saves: 'Times people saved your posts to come back to later.',
  shares: 'Times your content was sent to someone or reshared.',
  minutes_watched: 'Total time viewers spent watching your videos.',
  subs_gained: 'New subscribers who joined your channel.',
  subs_lost: 'Subscribers who left your channel. Lower is better.',
  replies: 'Replies to your stories.',
  reposts: 'Times your content was reposted by others.',
  engaged_views: 'Views where the viewer actually started watching (past the first frame or tapped play).',
  avg_view_duration: 'Average seconds a viewer watches per view.',
  avg_view_percentage: 'On average, how much of each video viewers watch. Higher means a stronger hook and better pacing.',
  dislikes: 'Dislikes received (visible to you only).',
  playlist_adds: 'Times viewers added your videos to a playlist, including Watch Later. A sign of "I want this again".',
  playlist_removes: 'Times viewers removed your videos from playlists.',
  card_impressions: 'Times a card (the small "i" prompts) was shown on your videos.',
  card_clicks: 'Clicks on cards in your videos.',
  premium_views: 'Views from YouTube Premium members.',
  skip_rate: 'Share of reel plays skipped within the first 3 seconds. Lower is better: it measures how strong your opening is. Instagram estimates this.',
  avg_watch_time: 'Average time people spend watching your reels, in seconds.',
};

export const ENGAGEMENT_RATE_HELP =
  'Likes + comments + saves + shares, divided by views (or reach when views are unavailable). A higher rate means the audience that sees it cares about it.';

export const SKIP_RATE_HELP = METRIC_HELP.skip_rate;

export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '–';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function formatPercent(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(v) ? '–' : `${Math.round(v * 10) / 10}%`;
}

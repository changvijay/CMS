import type { StoredMedia } from '../../services/api';

/** Reactions as a percentage of the audience; null without an audience. Mirrors the server's definition. */
export function mediaEngagementRate(m: StoredMedia): number | null {
  const engagement = (m.likes ?? 0) + (m.comments ?? 0) + (m.saves ?? 0) + (m.shares ?? 0);
  const audience = m.views || m.reach || 0;
  return audience > 0 ? Math.round((engagement / audience) * 1000) / 10 : null;
}

export function typeLabel(type: string | null): string {
  if (!type) return 'Other';
  if (type === 'REEL') return 'Reels';
  if (type === 'STORY') return 'Stories';
  if (type === 'IMAGE') return 'Photo posts';
  if (type === 'CAROUSEL_ALBUM') return 'Carousels';
  if (type === 'VIDEO') return 'Videos';
  return type.charAt(0) + type.slice(1).toLowerCase();
}

export function extractHashtags(text: string | null): string[] {
  if (!text) return [];
  const tags = text.match(/#[\p{L}\p{M}\p{N}_]+/gu) ?? [];
  return [...new Set(tags.map((t) => t.toLowerCase()))];
}

const avg = (values: number[]) => Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;

/** Average engagement rate per format, best first. Only items that have an audience count. */
export function performanceByFormat(media: StoredMedia[]): { type: string; label: string; avgRate: number; count: number }[] {
  const groups = new Map<string, number[]>();
  for (const m of media) {
    const rate = mediaEngagementRate(m);
    if (rate === null) continue;
    const key = m.media_type || 'Other';
    groups.set(key, [...(groups.get(key) ?? []), rate]);
  }
  return [...groups.entries()]
    .map(([type, rates]) => ({ type, label: typeLabel(type), avgRate: avg(rates), count: rates.length }))
    .sort((a, b) => b.avgRate - a.avgRate);
}

export interface HashtagStat {
  tag: string;
  posts: number;
  avgViews: number;
  avgRate: number;
}

/** Hashtags used in at least `minPosts` items, ranked by average engagement rate. */
export function hashtagPerformance(media: StoredMedia[], minPosts = 2): HashtagStat[] {
  const groups = new Map<string, { views: number[]; rates: number[] }>();
  for (const m of media) {
    const rate = mediaEngagementRate(m);
    if (rate === null) continue;
    for (const tag of extractHashtags(m.title)) {
      const g = groups.get(tag) ?? { views: [], rates: [] };
      g.views.push(m.views ?? m.reach ?? 0);
      g.rates.push(rate);
      groups.set(tag, g);
    }
  }
  return [...groups.entries()]
    .filter(([, g]) => g.rates.length >= minPosts)
    .map(([tag, g]) => ({ tag, posts: g.rates.length, avgViews: Math.round(g.views.reduce((a, b) => a + b, 0) / g.views.length), avgRate: avg(g.rates) }))
    .sort((a, b) => b.avgRate - a.avgRate);
}

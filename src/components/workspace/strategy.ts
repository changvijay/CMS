import type { StoredMedia, YoutubeVideoAnalytics } from '../../services/api';
import { extractHashtags, mediaEngagementRate, typeLabel } from './content';

// ---------------------------------------------------------------------------
// Small statistics helpers
// ---------------------------------------------------------------------------

export const round1 = (n: number) => Math.round(n * 10) / 10;

export function mean(values: number[]): number | null {
  return values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

/** Pearson correlation; null when there is too little data or no variation. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? null : Math.round((num / Math.sqrt(dx * dy)) * 100) / 100;
}

const audienceOf = (m: StoredMedia) => m.views ?? m.reach ?? 0;
const isStory = (m: StoredMedia) => m.media_type === 'STORY';
const sum = (items: StoredMedia[], pick: (m: StoredMedia) => number | null) => items.reduce((a, m) => a + (pick(m) ?? 0), 0);

/** Group items into labelled buckets and report count + averages for each. */
function group<T>(items: T[], bucketOf: (item: T) => string | null, order: string[]): Map<string, T[]> {
  const map = new Map<string, T[]>(order.map((k) => [k, []]));
  for (const item of items) {
    const key = bucketOf(item);
    if (key && map.has(key)) map.get(key)!.push(item);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Instagram: reels
// ---------------------------------------------------------------------------

export interface ReelScorecard {
  count: number;
  weightedSkipRate: number | null;
  avgWatchSeconds: number | null;
  totalWatchHours: number | null;
  best: StoredMedia[];
  worst: StoredMedia[];
  buckets: { label: string; count: number; avgRate: number | null; avgViews: number | null }[];
  skipVsEngagement: number | null;
}

const SKIP_BUCKETS: [string, (s: number) => boolean][] = [
  ['Under 30% skipped', (s) => s < 30],
  ['30–45% skipped', (s) => s >= 30 && s < 45],
  ['45–60% skipped', (s) => s >= 45 && s < 60],
  ['60%+ skipped', (s) => s >= 60],
];

export function reelScorecard(media: StoredMedia[]): ReelScorecard | null {
  const reels = media.filter((m) => m.media_type === 'REEL' && m.skip_rate !== null);
  if (!reels.length) return null;

  const weights = reels.map((m) => Math.max(audienceOf(m), 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const weightedSkipRate = round1(reels.reduce((a, m, i) => a + (m.skip_rate ?? 0) * weights[i], 0) / totalWeight);

  const watched = reels.filter((m) => m.avg_watch_seconds !== null);
  const eligible = reels.filter((m) => audienceOf(m) >= 100);
  const bySkip = [...eligible].sort((a, b) => (a.skip_rate ?? 0) - (b.skip_rate ?? 0));
  // never list the same reel under both headings when there are only a few
  const best = bySkip.slice(0, Math.min(3, Math.ceil(bySkip.length / 2)));

  const bucketMap = group(reels, (m) => SKIP_BUCKETS.find(([, f]) => f(m.skip_rate ?? 0))?.[0] ?? null, SKIP_BUCKETS.map(([l]) => l));
  const withRate = reels.map((m) => ({ skip: m.skip_rate as number, rate: mediaEngagementRate(m) })).filter((x): x is { skip: number; rate: number } => x.rate !== null);

  return {
    count: reels.length,
    weightedSkipRate,
    avgWatchSeconds: mean(watched.map((m) => m.avg_watch_seconds as number)),
    totalWatchHours: reels.some((m) => m.total_watch_seconds !== null) ? round1(sum(reels, (m) => m.total_watch_seconds) / 3600) : null,
    best,
    worst: bySkip.slice(Math.max(best.length, bySkip.length - 3)).reverse(),
    buckets: SKIP_BUCKETS.map(([label]) => {
      const items = bucketMap.get(label) ?? [];
      return { label, count: items.length, avgRate: mean(items.map(mediaEngagementRate).filter((r): r is number => r !== null)), avgViews: mean(items.map(audienceOf)) };
    }),
    skipVsEngagement: pearson(withRate.map((x) => x.skip), withRate.map((x) => x.rate)),
  };
}

// ---------------------------------------------------------------------------
// Instagram + YouTube: formats, schedule, cadence, captions
// ---------------------------------------------------------------------------

export interface FormatRow {
  type: string;
  label: string;
  count: number;
  avgAudience: number | null;
  avgRate: number | null;
  saveRate: number | null;
  shareRate: number | null;
  followsPer1kReach: number | null;
  avgSkipRate: number | null;
}

export function formatTable(media: StoredMedia[]): FormatRow[] {
  const types = [...new Set(media.filter((m) => !isStory(m)).map((m) => m.media_type || 'Other'))];
  return types
    .map((type) => {
      const items = media.filter((m) => (m.media_type || 'Other') === type);
      const reach = sum(items, (m) => m.reach);
      const hasFollows = items.some((m) => m.follows !== null);
      const skips = items.map((m) => m.skip_rate).filter((s): s is number => s !== null);
      return {
        type,
        label: typeLabel(type),
        count: items.length,
        avgAudience: mean(items.map(audienceOf)),
        avgRate: mean(items.map(mediaEngagementRate).filter((r): r is number => r !== null)),
        saveRate: reach > 0 && items.some((m) => m.saves !== null) ? round1((sum(items, (m) => m.saves) / reach) * 100) : null,
        shareRate: reach > 0 && items.some((m) => m.shares !== null) ? round1((sum(items, (m) => m.shares) / reach) * 100) : null,
        followsPer1kReach: reach > 0 && hasFollows ? round1((sum(items, (m) => m.follows) / reach) * 1000) : null,
        avgSkipRate: mean(skips),
      };
    })
    .sort((a, b) => (b.avgRate ?? -1) - (a.avgRate ?? -1));
}

export interface ScheduleRow {
  label: string;
  count: number;
  avgAudience: number | null;
  avgRate: number | null;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const BANDS: [string, number, number][] = [['Night (12am–6am)', 0, 6], ['Morning (6am–12pm)', 6, 12], ['Afternoon (12pm–6pm)', 12, 18], ['Evening (6pm–12am)', 18, 24]];

/** Local (IST) calendar parts for a timestamp. */
function istParts(iso: string): { weekday: number; hour: number; dateKey: string } {
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000);
  return { weekday: d.getUTCDay(), hour: d.getUTCHours(), dateKey: d.toISOString().slice(0, 10) };
}

function summarizeGroup(items: StoredMedia[], label: string): ScheduleRow {
  return { label, count: items.length, avgAudience: mean(items.map(audienceOf)), avgRate: mean(items.map(mediaEngagementRate).filter((r): r is number => r !== null)) };
}

export function postingSchedule(media: StoredMedia[]) {
  const posts = media.filter((m) => !isStory(m) && m.published_at);
  const byDay = group(posts, (m) => WEEKDAY_NAMES[istParts(m.published_at as string).weekday], WEEKDAY_NAMES);
  const byBand = group(posts, (m) => BANDS.find(([, a, b]) => istParts(m.published_at as string).hour >= a && istParts(m.published_at as string).hour < b)?.[0] ?? null, BANDS.map(([l]) => l));
  const weekdays = WEEKDAY_NAMES.map((d) => summarizeGroup(byDay.get(d) ?? [], d));
  const bands = BANDS.map(([l]) => summarizeGroup(byBand.get(l) ?? [], l));
  const best = (rows: ScheduleRow[]) => rows.filter((r) => r.count >= 2 && r.avgRate !== null).sort((a, b) => (b.avgRate ?? 0) - (a.avgRate ?? 0))[0] ?? null;
  return { posts: posts.length, weekdays, bands, bestWeekday: best(weekdays), bestBand: best(bands), enough: posts.length >= 10 };
}

export function cadence(media: StoredMedia[]) {
  const times = media.filter((m) => !isStory(m) && m.published_at).map((m) => new Date(m.published_at as string).getTime()).sort((a, b) => a - b);
  if (times.length < 3) return null;
  const spanDays = (times[times.length - 1] - times[0]) / 86400000;
  const gaps = times.slice(1).map((t, i) => (t - times[i]) / 86400000).sort((a, b) => a - b);
  const medianGapDays = round1(gaps[Math.floor(gaps.length / 2)]);

  const posts = media.filter((m) => !isStory(m) && m.published_at);
  const weeks = new Map<string, StoredMedia[]>();
  for (const m of posts) {
    const { dateKey } = istParts(m.published_at as string);
    const d = new Date(`${dateKey}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
    const key = d.toISOString().slice(0, 10);
    weeks.set(key, [...(weeks.get(key) ?? []), m]);
  }
  const weekly = [...weeks.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([week, items]) => ({ week, posts: items.length, avgAudience: mean(items.map(audienceOf)) }));
  const counts = weekly.map((w) => w.posts).sort((a, b) => a - b);
  const medianPosts = counts[Math.floor(counts.length / 2)];
  const high = weekly.filter((w) => w.posts > medianPosts && w.avgAudience !== null);
  const low = weekly.filter((w) => w.posts <= medianPosts && w.avgAudience !== null);

  return {
    postsPerWeek: spanDays > 0 ? round1(((times.length - 1) / spanDays) * 7) : null,
    medianGapDays,
    weekly,
    busyWeeksAvg: mean(high.map((w) => w.avgAudience as number)),
    quietWeeksAvg: mean(low.map((w) => w.avgAudience as number)),
    busyWeeks: high.length,
  };
}

export interface BucketRow {
  label: string;
  count: number;
  avgRate: number | null;
}

export function captionAnalysis(media: StoredMedia[]): { length: BucketRow[]; hashtags: BucketRow[]; question: BucketRow[] } {
  const posts = media.filter((m) => !isStory(m));
  const rows = (items: Map<string, StoredMedia[]>, order: string[]): BucketRow[] =>
    order.map((label) => ({ label, count: items.get(label)?.length ?? 0, avgRate: mean((items.get(label) ?? []).map(mediaEngagementRate).filter((r): r is number => r !== null)) }));

  const lenOrder = ['No caption', 'Short (1–80 characters)', 'Medium (81–250)', 'Long (251+)'];
  const tagOrder = ['No hashtags', '1–3 hashtags', '4–8 hashtags', '9+ hashtags'];
  const qOrder = ['Asks a question', 'No question'];
  const len = group(posts, (m) => { const n = (m.title || '').trim().length; return n === 0 ? lenOrder[0] : n <= 80 ? lenOrder[1] : n <= 250 ? lenOrder[2] : lenOrder[3]; }, lenOrder);
  const tags = group(posts, (m) => { const n = extractHashtags(m.title).length; return n === 0 ? tagOrder[0] : n <= 3 ? tagOrder[1] : n <= 8 ? tagOrder[2] : tagOrder[3]; }, tagOrder);
  const q = group(posts, (m) => (/\?/.test(m.title || '') ? qOrder[0] : qOrder[1]), qOrder);
  return { length: rows(len, lenOrder), hashtags: rows(tags, tagOrder), question: rows(q, qOrder) };
}

// ---------------------------------------------------------------------------
// Instagram: stories
// ---------------------------------------------------------------------------

export interface StoryScorecard {
  count: number;
  avgReach: number | null;
  avgViews: number | null;
  exitRate: number | null;
  forwardTapRate: number | null;
  backTapRate: number | null;
  swipeRate: number | null;
  replies: number;
  follows: number;
  linkClicks: number;
}

export function storyScorecard(media: StoredMedia[]): StoryScorecard | null {
  const stories = media.filter(isStory);
  if (!stories.length) return null;
  const nav = (needle: string) => stories.reduce((a, s) => a + (s.extra?.breakdowns?.navigation ?? []).filter((r) => r.label.toLowerCase().includes(needle)).reduce((x, r) => x + r.value, 0), 0);
  const views = sum(stories, (s) => s.views);
  const rate = (n: number) => (views > 0 && stories.some((s) => s.extra?.breakdowns?.navigation) ? round1((n / views) * 100) : null);
  return {
    count: stories.length,
    avgReach: mean(stories.map((s) => s.reach).filter((v): v is number => v !== null)),
    avgViews: mean(stories.map((s) => s.views).filter((v): v is number => v !== null)),
    exitRate: rate(nav('exit')),
    forwardTapRate: rate(nav('tap_forward')),
    backTapRate: rate(nav('tap_back')),
    swipeRate: rate(nav('swipe')),
    replies: sum(stories, (s) => s.replies),
    follows: sum(stories, (s) => s.follows),
    linkClicks: sum(stories, (s) => s.link_clicks),
  };
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

export interface VideoBucket {
  label: string;
  count: number;
  avgViews: number | null;
  avgViewPct: number | null;
  subsPer1k: number | null;
  engagementPer1k: number | null;
}

function videoBuckets(videos: YoutubeVideoAnalytics[], order: string[], bucketOf: (v: YoutubeVideoAnalytics) => string | null): VideoBucket[] {
  const map = group(videos, bucketOf, order);
  return order.map((label) => {
    const items = map.get(label) ?? [];
    const views = items.reduce((a, v) => a + v.views, 0);
    return {
      label,
      count: items.length,
      avgViews: mean(items.map((v) => v.views)),
      // weighted by views so a tiny video can't dominate
      avgViewPct: views > 0 ? round1(items.reduce((a, v) => a + v.averageViewPercentage * v.views, 0) / views) : null,
      subsPer1k: views > 0 ? round1((items.reduce((a, v) => a + v.subscribersGained, 0) / views) * 1000) : null,
      engagementPer1k: views > 0 ? round1((items.reduce((a, v) => a + v.likes + v.comments + v.shares, 0) / views) * 1000) : null,
    };
  });
}

const DURATION_ORDER = ['Under 1 min', '1–3 min', '3–8 min', '8–15 min', '15+ min'];

export function durationBuckets(videos: YoutubeVideoAnalytics[]): VideoBucket[] {
  return videoBuckets(videos, DURATION_ORDER, (v) => {
    const s = v.duration_seconds;
    if (s === null) return null;
    return s < 60 ? DURATION_ORDER[0] : s < 180 ? DURATION_ORDER[1] : s < 480 ? DURATION_ORDER[2] : s < 900 ? DURATION_ORDER[3] : DURATION_ORDER[4];
  });
}

export function titleAnalysis(videos: YoutubeVideoAnalytics[]) {
  const lenOrder = ['Up to 40 characters', '41–60 characters', '61+ characters'];
  const numOrder = ['Has a number', 'No number'];
  const qOrder = ['Asks a question', 'Statement'];
  return {
    length: videoBuckets(videos, lenOrder, (v) => (v.title.length <= 40 ? lenOrder[0] : v.title.length <= 60 ? lenOrder[1] : lenOrder[2])),
    number: videoBuckets(videos, numOrder, (v) => (/\d/.test(v.title) ? numOrder[0] : numOrder[1])),
    question: videoBuckets(videos, qOrder, (v) => (/\?/.test(v.title) ? qOrder[0] : qOrder[1])),
  };
}

export function uploadWeekdays(videos: YoutubeVideoAnalytics[]): VideoBucket[] {
  return videoBuckets(videos, WEEKDAY_NAMES, (v) => (v.published_at ? WEEKDAY_NAMES[istParts(v.published_at).weekday] : null));
}

// ---------------------------------------------------------------------------
// Prioritised recommendations
// ---------------------------------------------------------------------------

export interface Action {
  priority: 'high' | 'medium' | 'low';
  kind: 'Double down' | 'Fix' | 'Test' | 'Keep doing';
  title: string;
  detail: string;
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

export function instagramActions(media: StoredMedia[]): Action[] {
  const out: Action[] = [];
  const posts = media.filter((m) => !isStory(m));
  const formats = formatTable(posts).filter((f) => f.count >= 3 && f.avgRate !== null);
  if (formats.length >= 2) {
    const [top, bottom] = [formats[0], formats[formats.length - 1]];
    if ((top.avgRate ?? 0) - (bottom.avgRate ?? 0) >= 1) {
      out.push({ priority: 'high', kind: 'Double down', title: `Make more ${top.label.toLowerCase()}`, detail: `${top.label} average a ${top.avgRate}% engagement rate (${top.count} posts) versus ${bottom.avgRate}% for ${bottom.label.toLowerCase()} (${bottom.count} posts).` });
    }
  }

  const reels = reelScorecard(posts);
  if (reels && reels.count >= 3) {
    if (reels.weightedSkipRate !== null && reels.weightedSkipRate >= 50) {
      out.push({ priority: 'high', kind: 'Fix', title: 'Your reel hooks are losing people in the first 3 seconds', detail: `${reels.weightedSkipRate}% of reel plays are skipped almost immediately. Open with the payoff or a bold on-screen line, and compare with your best hook: "${(reels.best[0]?.title || 'your lowest-skip reel').slice(0, 60)}" (${reels.best[0]?.skip_rate ?? '–'}% skipped).` });
    } else if (reels.weightedSkipRate !== null && reels.weightedSkipRate <= 35) {
      out.push({ priority: 'low', kind: 'Keep doing', title: 'Your reel hooks are working', detail: `Only ${reels.weightedSkipRate}% of plays are skipped in the first 3 seconds. Keep the same opening style.` });
    }
    if (reels.skipVsEngagement !== null && reels.skipVsEngagement <= -0.4) {
      out.push({ priority: 'medium', kind: 'Fix', title: 'Lower skip rate goes with higher engagement', detail: `Across your reels, the lower the skip rate the higher the engagement (correlation ${reels.skipVsEngagement}). Hook work will pay off beyond views.` });
    }
  }

  const schedule = postingSchedule(posts);
  if (schedule.enough && schedule.bestWeekday && schedule.bestWeekday.count >= 2) {
    out.push({ priority: 'medium', kind: 'Test', title: `Try publishing more on ${schedule.bestWeekday.label}s`, detail: `${schedule.bestWeekday.label} posts average a ${schedule.bestWeekday.avgRate}% engagement rate (${schedule.bestWeekday.count} posts).${schedule.bestBand ? ` ${schedule.bestBand.label} posts do best by time of day.` : ''}` });
  }

  const cad = cadence(posts);
  if (cad?.postsPerWeek !== null && cad?.postsPerWeek !== undefined) {
    if (cad.postsPerWeek < 2) {
      out.push({ priority: 'high', kind: 'Fix', title: 'Post more consistently', detail: `You average ${cad.postsPerWeek} posts a week (median gap ${cad.medianGapDays} days). Aim for at least 3 a week so the algorithm keeps testing you.` });
    } else if (cad.busyWeeksAvg !== null && cad.quietWeeksAvg !== null && cad.busyWeeks >= 2 && cad.busyWeeksAvg > cad.quietWeeksAvg * 1.15) {
      out.push({ priority: 'medium', kind: 'Test', title: 'Busier weeks perform better', detail: `Weeks with more posts averaged ${Math.round(cad.busyWeeksAvg)} views per post versus ${Math.round(cad.quietWeeksAvg)} in quieter weeks.` });
    }
  }

  const captions = captionAnalysis(posts);
  const q = captions.question;
  if (q[0].count >= 3 && q[1].count >= 3 && q[0].avgRate !== null && q[1].avgRate !== null && Math.abs(q[0].avgRate - q[1].avgRate) >= 1) {
    out.push({ priority: 'low', kind: q[0].avgRate > q[1].avgRate ? 'Double down' : 'Test', title: q[0].avgRate > q[1].avgRate ? 'Questions in captions pay off' : 'Questions in captions are not helping', detail: `Captions with a question average ${q[0].avgRate}% engagement versus ${q[1].avgRate}% without.` });
  }

  const table = formatTable(posts);
  const saves = table.filter((f) => f.saveRate !== null);
  if (saves.length) {
    const best = [...saves].sort((a, b) => (b.saveRate ?? 0) - (a.saveRate ?? 0))[0];
    if ((best.saveRate ?? 0) >= 2) {
      out.push({ priority: 'medium', kind: 'Double down', title: `${best.label} get saved a lot`, detail: `${best.saveRate}% of people reached save them. Saves signal "useful later": turn them into series, checklists and explainers.` });
    }
  }

  const growth = [...posts].filter((m) => (m.reach ?? 0) >= 500 && m.follows !== null).sort((a, b) => ((b.follows ?? 0) / (b.reach ?? 1)) - ((a.follows ?? 0) / (a.reach ?? 1)))[0];
  if (growth && (growth.follows ?? 0) > 0) {
    out.push({ priority: 'medium', kind: 'Double down', title: 'Repeat your best follower-winning post', detail: `"${(growth.title || 'Untitled').slice(0, 60)}" gained ${growth.follows} followers from ${growth.reach} reached (${round1(((growth.follows ?? 0) / (growth.reach ?? 1)) * 1000)} per 1,000).` });
  }

  const stories = storyScorecard(media);
  if (stories && stories.exitRate !== null && stories.exitRate >= 20) {
    out.push({ priority: 'low', kind: 'Fix', title: 'Stories are being exited early', detail: `${stories.exitRate}% of story views end with an exit. Shorten sequences and put the strongest frame first.` });
  }

  return out.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

export function youtubeActions(videos: YoutubeVideoAnalytics[]): Action[] {
  const out: Action[] = [];
  if (videos.length < 3) return out;
  const views = videos.reduce((a, v) => a + v.views, 0);
  const avgPct = views > 0 ? round1(videos.reduce((a, v) => a + v.averageViewPercentage * v.views, 0) / views) : null;

  if (avgPct !== null) {
    const weakest = [...videos].filter((v) => v.views >= 100).sort((a, b) => a.averageViewPercentage - b.averageViewPercentage)[0];
    if (avgPct < 35) {
      out.push({ priority: 'high', kind: 'Fix', title: 'Viewers leave early', detail: `On average only ${avgPct}% of each video is watched.${weakest ? ` Start with "${weakest.title.slice(0, 50)}" (${round1(weakest.averageViewPercentage)}% viewed): tighten the intro and get to the point faster.` : ''}` });
    } else if (avgPct >= 50) {
      out.push({ priority: 'low', kind: 'Keep doing', title: 'Strong audience retention', detail: `Viewers watch ${avgPct}% of your videos on average.` });
    }
  }

  const durations = durationBuckets(videos).filter((b) => b.count >= 2 && b.avgViewPct !== null);
  if (durations.length >= 2) {
    const best = [...durations].sort((a, b) => (b.avgViewPct ?? 0) - (a.avgViewPct ?? 0))[0];
    out.push({ priority: 'medium', kind: 'Double down', title: `${best.label} videos hold attention best`, detail: `They keep ${best.avgViewPct}% of viewers on average (${best.count} videos).` });
  }

  const converter = [...videos].filter((v) => v.views >= 200).sort((a, b) => (b.subscribersGained / b.views) - (a.subscribersGained / a.views))[0];
  if (converter && converter.subscribersGained > 0) {
    out.push({ priority: 'medium', kind: 'Double down', title: 'Repeat your best subscriber-winning video', detail: `"${converter.title.slice(0, 60)}" gained ${converter.subscribersGained} subscribers (${round1((converter.subscribersGained / converter.views) * 1000)} per 1,000 views).` });
  }

  const titles = titleAnalysis(videos);
  for (const [name, rows] of [['a number in the title', titles.number], ['a question in the title', titles.question]] as const) {
    const [a, b] = rows;
    if (a.count >= 3 && b.count >= 3 && a.engagementPer1k !== null && b.engagementPer1k !== null && a.engagementPer1k > b.engagementPer1k * 1.2) {
      out.push({ priority: 'low', kind: 'Test', title: `Videos with ${name} get more engagement`, detail: `${a.engagementPer1k} reactions per 1,000 views versus ${b.engagementPer1k} without.` });
    }
  }

  const upload = uploadWeekdays(videos).filter((b) => b.count >= 2 && b.avgViewPct !== null);
  if (upload.length >= 3) {
    const best = [...upload].sort((a, b) => (b.avgViewPct ?? 0) - (a.avgViewPct ?? 0))[0];
    out.push({ priority: 'low', kind: 'Test', title: `${best.label} uploads retain best`, detail: `Videos published on ${best.label}s keep ${best.avgViewPct}% of viewers (${best.count} videos).` });
  }

  return out.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

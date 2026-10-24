import type { HistoryResponse, Platform, StoredMedia } from '../../services/api';
import { WEEKDAYS, formatCompact, formatShortDate, metricLabel } from '../charts/viz';
import { mediaEngagementRate, typeLabel } from './content';

export interface Insight {
  tone: 'good' | 'bad' | 'neutral';
  title: string;
  text: string;
}

function rateFromTotals(t: Record<string, number>): number | null {
  const engagement = (t.likes ?? 0) + (t.comments ?? 0) + (t.saves ?? 0) + (t.shares ?? 0);
  const audience = t.views ?? 0;
  return audience > 0 ? Math.round((engagement / audience) * 1000) / 10 : null;
}

/** Plain-language takeaways, ordered by usefulness. At most six. */
export function buildInsights(platform: Platform, history: HistoryResponse, media: StoredMedia[]): Insight[] {
  const out: Insight[] = [];
  const primary = history.primary_metric;
  const label = metricLabel(platform, primary);
  const days = history.range.days;
  const verb = primary === 'views' ? 'are' : 'is';

  const d = history.deltas[primary];
  if (d && d.change_pct !== null) {
    const pct = d.change_pct;
    out.push({
      tone: pct >= 5 ? 'good' : pct <= -5 ? 'bad' : 'neutral',
      title: pct >= 5 ? `${label} ${verb} growing` : pct <= -5 ? `${label} ${verb} slowing down` : `${label} ${verb} steady`,
      text: `${formatCompact(d.current)} in the last ${days} days, ${pct >= 0 ? 'up' : 'down'} ${Math.abs(pct)}% from ${formatCompact(d.previous)} in the ${days} days before.`,
    });
  }

  const rate = rateFromTotals(history.totals);
  const prevRate = rateFromTotals(Object.fromEntries(Object.entries(history.deltas).map(([k, v]) => [k, v.previous])));
  if (rate !== null) {
    const diff = prevRate !== null ? Math.round((rate - prevRate) * 10) / 10 : null;
    out.push({
      tone: diff === null || Math.abs(diff) < 0.3 ? 'neutral' : diff > 0 ? 'good' : 'bad',
      title: `Engagement rate is ${rate}%`,
      text: diff === null ? 'Not enough earlier data to compare.' : `${diff >= 0 ? 'Up' : 'Down'} ${Math.abs(diff)} points from ${prevRate}% in the previous period.`,
    });
  }

  if (history.best_weekday !== null) {
    out.push({
      tone: 'neutral',
      title: `${WEEKDAYS[history.best_weekday]} is your strongest day`,
      text: `It has the highest average ${label.toLowerCase()}. Consider publishing your best content then.`,
    });
  }

  const lastAnomaly = [...history.anomalies].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (lastAnomaly) {
    out.push({
      tone: lastAnomaly.type === 'spike' ? 'good' : 'bad',
      title: `Unusual ${lastAnomaly.type} on ${formatShortDate(lastAnomaly.date)}`,
      text: `${formatCompact(lastAnomaly.value)} ${label.toLowerCase()} was far from your normal range. Look at what you published around then.`,
    });
  }

  const ranked = media
    .map((m) => ({ m, rate: mediaEngagementRate(m), audience: m.views || m.reach || 0 }))
    .filter((x): x is { m: StoredMedia; rate: number; audience: number } => x.rate !== null && x.audience >= 100)
    .sort((a, b) => b.rate - a.rate);
  if (ranked[0]) {
    out.push({
      tone: 'good',
      title: 'Your best performer',
      text: `"${(ranked[0].m.title || 'Untitled').slice(0, 70)}" reached a ${ranked[0].rate}% engagement rate.`,
    });
  }

  const byType = new Map<string, number[]>();
  for (const r of ranked) {
    const k = r.m.media_type || 'Other';
    byType.set(k, [...(byType.get(k) ?? []), r.rate]);
  }
  const avgs = [...byType.entries()]
    .filter(([, v]) => v.length >= 2)
    .map(([k, v]) => ({ type: k, avg: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 }))
    .sort((a, b) => b.avg - a.avg);
  if (avgs.length >= 2) {
    out.push({
      tone: 'neutral',
      title: `${typeLabel(avgs[0].type)} engage best`,
      text: `${typeLabel(avgs[0].type)} average ${avgs[0].avg}% engagement versus ${avgs[avgs.length - 1].avg}% for ${typeLabel(avgs[avgs.length - 1].type).toLowerCase()}.`,
    });
  }

  return out.slice(0, 6);
}

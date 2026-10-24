import { useMemo, useState } from 'react';
import type { HistoryResponse, Platform, StoredMedia } from '../../services/api';
import { KpiCard } from '../charts/KpiCard';
import { TrendChart } from '../charts/TrendChart';
import { EngagementStack } from '../charts/EngagementStack';
import { WeekdayBars } from '../charts/WeekdayBars';
import { AVERAGE_METRICS, ENGAGEMENT_RATE_HELP, KPI_KEYS, METRIC_HELP, PLATFORM_METRICS, SKIP_RATE_HELP, formatCompact, formatPercent, formatSeconds, metricLabel, numericSeries } from '../charts/viz';
import { buildInsights } from './insights';
import { Panel, StatTiles } from './ui';
import { reelScorecard, storyScorecard } from './strategy';

function rate(t: Record<string, number>): number | null {
  const engagement = (t.likes ?? 0) + (t.comments ?? 0) + (t.saves ?? 0) + (t.shares ?? 0);
  return t.views > 0 ? Math.round((engagement / t.views) * 1000) / 10 : null;
}

export function OverviewTab({ platform, history, media }: { platform: Platform; history: HistoryResponse; media: StoredMedia[] }) {
  const metrics = PLATFORM_METRICS[platform];
  const [metric, setMetric] = useState(history.primary_metric);
  const [showForecast, setShowForecast] = useState(true);
  const insights = useMemo(() => buildInsights(platform, history, media), [platform, history, media]);
  const reels = useMemo(() => reelScorecard(media), [media]);
  const stories = useMemo(() => storyScorecard(media), [media]);
  const shownKeys = new Set(KPI_KEYS[platform]);
  const more = metrics.filter((m) => !shownKeys.has(m.key) && history.totals[m.key] !== undefined && (history.totals[m.key] !== 0 || history.coverage.days_with_data > 0));
  const showValue = (key: string, v: number) => (key === 'avg_view_percentage' ? formatPercent(v) : key === 'avg_view_duration' ? formatSeconds(v) : formatCompact(v));

  const current = rate(history.totals);
  const previous = rate(Object.fromEntries(Object.entries(history.deltas).map(([k, v]) => [k, v.previous])));
  const rateDelta =
    current !== null && previous
      ? { current, previous, change_pct: Math.round(((current - previous) / previous) * 1000) / 10 }
      : undefined;

  return (
    <>
      <section className="kpi-grid" aria-label="Key numbers">
        {KPI_KEYS[platform].map((k) => {
          const info = metrics.find((m) => m.key === k);
          return (
            <KpiCard
              key={k}
              label={info?.label ?? k}
              value={history.totals[k] ?? 0}
              delta={history.deltas[k]}
              lowerIsBetter={info?.lowerIsBetter}
              series={numericSeries(history.daily, k)}
              help={METRIC_HELP[k]}
              display={AVERAGE_METRICS.has(k) ? showValue(k, history.totals[k] ?? 0) : undefined}
            />
          );
        })}
        {current !== null && (
          <KpiCard label="Engagement rate" value={current} display={`${current}%`} delta={rateDelta} series={[]} help={ENGAGEMENT_RATE_HELP} />
        )}
      </section>

      {reels && (
        <Panel title="Reels at a glance" sub="How your reels open and hold attention. The Strategy tab explains what to change.">
          <StatTiles items={[
            { label: 'Reels measured', value: String(reels.count) },
            { label: 'Skip rate', value: formatPercent(reels.weightedSkipRate), hint: SKIP_RATE_HELP },
            { label: 'Avg watch time', value: formatSeconds(reels.avgWatchSeconds), hint: METRIC_HELP.avg_watch_time },
            { label: 'Total watch time', value: reels.totalWatchHours === null ? '–' : `${reels.totalWatchHours} h` },
          ]} />
        </Panel>
      )}

      {stories && (
        <Panel title="Stories at a glance" sub="Captured each time you update your data.">
          <StatTiles items={[
            { label: 'Stories saved', value: String(stories.count) },
            { label: 'Avg views', value: stories.avgViews === null ? '–' : formatCompact(stories.avgViews) },
            { label: 'Exit rate', value: formatPercent(stories.exitRate) },
            { label: 'Replies', value: String(stories.replies) },
            { label: 'Link clicks', value: String(stories.linkClicks) },
          ]} />
        </Panel>
      )}

      {insights.length > 0 && (
        <section className="viz-panel">
          <h3>What your data says</h3>
          <p className="ws-sub">Plain-language takeaways from the selected period.</p>
          <ul className="insight-grid">
            {insights.map((i) => (
              <li key={i.title} className={`insight insight-${i.tone}`}>
                <b>{i.title}</b>
                <span>{i.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {more.length > 0 && (
        <Panel title="More numbers" sub="Everything else tracked for the selected dates, with the change from the previous period.">
          <dl className="stat-strip">
            {more.map((m) => {
              const d = history.deltas[m.key];
              const pct = d?.change_pct;
              return (
                <div key={m.key} title={METRIC_HELP[m.key]}>
                  <dt>{m.label}</dt>
                  <dd>
                    {showValue(m.key, history.totals[m.key])}
                    {pct !== null && pct !== undefined && <span className={`mini-delta ${((m.lowerIsBetter ? -pct : pct) >= 0) ? 'delta-good' : 'delta-bad'}`}> {pct > 0 ? '▲' : pct < 0 ? '▼' : '■'} {Math.abs(pct)}%</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </Panel>
      )}

      <section className="viz-panel">
        <div className="viz-panel-head">
          <div>
            <h3>{metricLabel(platform, metric)} over time</h3>
            <p className="ws-sub">{METRIC_HELP[metric]}</p>
          </div>
          <div className="ws-inline-controls">
            <label className="ws-select">
              <span className="sr-only">Metric</span>
              <select value={metric} onChange={(e) => setMetric(e.target.value)}>
                {metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
            <label className="ws-check">
              <input type="checkbox" checked={showForecast} onChange={(e) => setShowForecast(e.target.checked)} />
              <span>Show 7-day forecast</span>
            </label>
          </div>
        </div>
        <TrendChart history={history} metric={metric} metricLabel={metricLabel(platform, metric)} showForecast={showForecast} />
        {history.anomalies.length > 0 && metric === history.primary_metric && (
          <p className="anomaly-caption">Red dots mark days that were far outside your normal range (more than 2 standard deviations).</p>
        )}
      </section>

      <div className="viz-two-col">
        <section className="viz-panel">
          <h3>How people engage</h3>
          <p className="ws-sub">Daily likes, comments{platform === 'instagram' ? ', saves' : ''} and shares.</p>
          <EngagementStack platform={platform} daily={history.daily} />
        </section>
        <section className="viz-panel">
          <h3>Best days of the week</h3>
          <p className="ws-sub">Average {metricLabel(platform, metric).toLowerCase()} per weekday.</p>
          <WeekdayBars daily={history.daily} metric={metric} metricLabel={metricLabel(platform, metric)} />
        </section>
      </div>
    </>
  );
}

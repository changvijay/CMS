import type { MetricDelta } from '../../services/api';
import { formatCompact } from './viz';
import { InfoTip } from '../workspace/InfoTip';

interface KpiCardProps {
  label: string;
  value: number;
  delta?: MetricDelta;
  lowerIsBetter?: boolean;
  series: number[];
  help?: string;
  /** Overrides the formatted value, e.g. "7.2%". */
  display?: string;
}

export function Sparkline({ values, color = 'var(--series-1)' }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const w = 96;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function KpiCard({ label, value, delta, lowerIsBetter, series, help, display }: KpiCardProps) {
  const pct = delta?.change_pct ?? null;
  const up = pct !== null && pct > 0;
  const flat = pct === 0;
  const good = pct !== null && !flat && (lowerIsBetter ? !up : up);
  const cls = pct === null || flat ? 'delta-neutral' : good ? 'delta-good' : 'delta-bad';
  const arrow = pct === null ? '' : flat ? '■' : up ? '▲' : '▼';
  const text = pct === null ? 'no prior data' : `${up ? '+' : ''}${pct}%`;
  const title = delta ? `Previous period: ${delta.previous.toLocaleString()}` : undefined;

  return (
    <div className="kpi-card" title={title}>
      <span className="kpi-label">{label}{help && <InfoTip text={help} />}</span>
      <div className="kpi-row">
        <span className="kpi-value">{display ?? formatCompact(value)}</span>
        <Sparkline values={series} />
      </div>
      <span className={`kpi-delta ${cls}`}>
        {arrow && <span aria-hidden="true">{arrow} </span>}
        {text}
        {pct !== null && <span className="kpi-delta-sub"> vs prev period{lowerIsBetter ? (good ? ' (improving)' : '') : ''}</span>}
      </span>
    </div>
  );
}

import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { HistoryResponse } from '../../services/api';
import { formatCompact, formatShortDate } from './viz';

interface TrendChartProps {
  history: HistoryResponse;
  metric: string;
  metricLabel: string;
  showForecast: boolean;
}

interface Row {
  date: string;
  value: number | null;
  ma7: number | null;
  forecast: number | null;
  anomaly: number | null;
  anomalyType?: 'spike' | 'drop';
}

function addDay(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function movingAvg(values: number[], window = 7): number[] {
  return values.map((_, i) => {
    const s = values.slice(Math.max(0, i - window + 1), i + 1);
    return Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10;
  });
}

/** Least-squares forecast for any metric (the API only forecasts the primary one). */
function forecast(values: number[], horizon: number): number[] {
  const n = values.length;
  if (n < 3) return [];
  const xm = (n - 1) / 2;
  const ym = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - xm) * (y - ym);
    den += (x - xm) ** 2;
  });
  const slope = den === 0 ? 0 : num / den;
  const icpt = ym - slope * xm;
  return Array.from({ length: horizon }, (_, i) => Math.max(0, Math.round(icpt + slope * (n + i))));
}

function anomalies(values: number[], dates: string[]): Map<string, 'spike' | 'drop'> {
  const out = new Map<string, 'spike' | 'drop'>();
  if (values.length < 5) return out;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  if (sd === 0) return out;
  values.forEach((v, i) => {
    const z = (v - mean) / sd;
    if (Math.abs(z) > 2) out.set(dates[i], z > 0 ? 'spike' : 'drop');
  });
  return out;
}

function buildRows(history: HistoryResponse, metric: string, withForecast: boolean): Row[] {
  const daily = history.daily;
  const values = daily.map((d) => Number(d[metric] ?? 0));
  const dates = daily.map((d) => d.date);
  const ma = movingAvg(values);
  const flagged = anomalies(values, dates);

  const rows: Row[] = daily.map((d, i) => ({
    date: d.date,
    value: values[i],
    ma7: ma[i],
    forecast: withForecast && i === daily.length - 1 ? values[i] : null,
    anomaly: flagged.has(d.date) ? values[i] : null,
    anomalyType: flagged.get(d.date),
  }));

  if (withForecast && daily.length >= 3) {
    forecast(values, 7).forEach((v, i) => {
      rows.push({ date: addDay(dates[dates.length - 1], i + 1), value: null, ma7: null, forecast: v, anomaly: null });
    });
  }
  return rows;
}

interface TipProps {
  active?: boolean;
  payload?: { payload: Row }[];
  label?: string;
  metricLabel: string;
}

function ChartTooltip({ active, payload, label, metricLabel }: TipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="viz-tooltip">
      <div className="viz-tooltip-title">{label ? formatShortDate(label) : ''}</div>
      {row.value !== null && (
        <div className="viz-tooltip-row"><span className="swatch swatch-1" />{metricLabel}<b>{row.value.toLocaleString()}</b></div>
      )}
      {row.ma7 !== null && (
        <div className="viz-tooltip-row"><span className="swatch swatch-2" />7-day average<b>{row.ma7.toLocaleString()}</b></div>
      )}
      {row.value === null && row.forecast !== null && (
        <div className="viz-tooltip-row"><span className="swatch swatch-1 dashed" />Forecast<b>{row.forecast.toLocaleString()}</b></div>
      )}
      {row.anomalyType && (
        <div className="viz-tooltip-flag">{row.anomalyType === 'spike' ? 'Unusual spike' : 'Unusual drop'} (more than 2σ from mean)</div>
      )}
    </div>
  );
}

export function TrendChart({ history, metric, metricLabel, showForecast }: TrendChartProps) {
  const rows = buildRows(history, metric, showForecast);
  return (
    <div className="viz-chart" role="img" aria-label={`${metricLabel} over time with 7-day average`}>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="date" tickFormatter={formatShortDate} stroke="var(--axis)" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} minTickGap={24} />
          <YAxis tickFormatter={formatCompact} stroke="var(--axis)" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} axisLine={false} width={48} />
          <Tooltip content={<ChartTooltip metricLabel={metricLabel} />} cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} />
          <Legend verticalAlign="top" align="left" height={28} iconType="plainline" wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 12 }} />
          <Area isAnimationActive={false} type="monotone" dataKey="value" name={metricLabel} stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.12} dot={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} connectNulls={false} />
          <Line isAnimationActive={false} type="monotone" dataKey="ma7" name="7-day average" stroke="var(--series-2)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} />
          {showForecast && (
            <Line isAnimationActive={false} type="monotone" dataKey="forecast" name="Forecast (7 days)" stroke="var(--series-1)" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={false} connectNulls />
          )}
          <Line dataKey="anomaly" name="Anomaly" stroke="var(--series-8)" strokeWidth={0} legendType="none" dot={{ r: 5, fill: 'var(--series-8)', stroke: 'var(--surface)', strokeWidth: 2 }} activeDot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

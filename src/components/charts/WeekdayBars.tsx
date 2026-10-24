import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyPoint } from '../../services/api';
import { formatCompact, weekdayAverages } from './viz';

interface Props {
  daily: DailyPoint[];
  metric: string;
  metricLabel: string;
}

export function WeekdayBars({ daily, metric, metricLabel }: Props) {
  const data = weekdayAverages(daily, metric);
  return (
    <div className="viz-chart" role="img" aria-label={`Average ${metricLabel} by weekday`}>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="day" stroke="var(--axis)" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} />
          <YAxis tickFormatter={formatCompact} stroke="var(--axis)" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} axisLine={false} width={48} />
          <Tooltip
            formatter={(v) => [Number(v).toLocaleString(), `Avg ${metricLabel}`]}
            contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--grid)', borderRadius: 8, color: 'var(--text-primary)' }}
            cursor={{ fill: 'var(--grid)', opacity: 0.4 }}
          />
          <Bar isAnimationActive={false} dataKey="avg" name={`Avg ${metricLabel}`} fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

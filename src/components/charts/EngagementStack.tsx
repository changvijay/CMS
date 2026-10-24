import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyPoint, Platform } from '../../services/api';
import { ENGAGEMENT_KEYS, METRIC_COLORS, formatCompact, formatShortDate, metricLabel } from './viz';

interface Props {
  platform: Platform;
  daily: DailyPoint[];
}

export function EngagementStack({ platform, daily }: Props) {
  const keys = ENGAGEMENT_KEYS[platform];
  const data = daily.map((d) => ({ date: d.date, ...Object.fromEntries(keys.map((k) => [k, Number(d[k] ?? 0)])) }));
  return (
    <div className="viz-chart" role="img" aria-label="Daily engagement breakdown">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="date" tickFormatter={formatShortDate} stroke="var(--axis)" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} minTickGap={24} />
          <YAxis tickFormatter={formatCompact} stroke="var(--axis)" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} axisLine={false} width={48} />
          <Tooltip
            labelFormatter={(l) => formatShortDate(String(l))}
            formatter={(v, name) => [Number(v).toLocaleString(), String(name)]}
            contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--grid)', borderRadius: 8, color: 'var(--text-primary)' }}
            cursor={{ fill: 'var(--grid)', opacity: 0.4 }}
          />
          <Legend verticalAlign="top" align="left" height={28} iconType="square" wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 12 }} />
          {keys.map((k, i) => (
            <Bar
              key={k}
              isAnimationActive={false}
              dataKey={k}
              name={metricLabel(platform, k)}
              stackId="eng"
              fill={METRIC_COLORS[k]}
              stroke="var(--surface)"
              strokeWidth={2}
              radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

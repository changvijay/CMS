import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RetentionPoint } from '../../services/api';

/** Share of the audience still watching at each point of the video. Above 100% means people rewatched. */
export function RetentionChart({ points }: { points: RetentionPoint[] }) {
  const data = points.map((p) => ({ at: Math.round(p.elapsedVideoTimeRatio * 100), watching: Math.round(p.audienceWatchRatio * 1000) / 10, benchmark: Math.round(p.relativeRetentionPerformance * 100) }));
  return (
    <div className="viz-chart" role="img" aria-label="Audience retention across the video">
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="at" tickFormatter={(v) => `${v}%`} stroke="var(--axis)" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} interval={9} />
          <YAxis tickFormatter={(v) => `${v}%`} stroke="var(--axis)" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} axisLine={false} width={44} />
          <ReferenceLine y={100} stroke="var(--axis)" strokeDasharray="4 4" />
          <Tooltip
            labelFormatter={(l) => `${l}% into the video`}
            formatter={(v) => [`${v}%`, 'Still watching']}
            contentStyle={{ background: '#fff', border: '1px solid var(--grid)', borderRadius: 10 }}
          />
          <Area isAnimationActive={false} type="monotone" dataKey="watching" name="Still watching" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.12} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

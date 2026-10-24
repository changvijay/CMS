import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface Row {
  ageGroup: string;
  gender: string;
  viewerPercentage: number;
}

const GENDERS = [
  { key: 'female', label: 'Female', color: 'var(--series-1)' },
  { key: 'male', label: 'Male', color: 'var(--series-2)' },
  { key: 'user_specified', label: 'Self-described', color: 'var(--series-3)' },
];

function ageLabel(a: string): string {
  return a.replace('age', '').replace('-', '–');
}

export function Demographics({ rows }: { rows: Row[] }) {
  const ages = [...new Set(rows.map((r) => r.ageGroup))].sort();
  const data = ages.map((age) => ({
    age: ageLabel(age),
    ...Object.fromEntries(GENDERS.map((g) => [g.key, rows.find((r) => r.ageGroup === age && r.gender === g.key)?.viewerPercentage ?? 0])),
  }));
  const present = GENDERS.filter((g) => rows.some((r) => r.gender === g.key));
  return (
    <div className="viz-chart" role="img" aria-label="Viewer share by age group and gender">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="age" stroke="var(--axis)" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} />
          <YAxis tickFormatter={(v) => `${v}%`} stroke="var(--axis)" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} axisLine={false} width={44} />
          <Tooltip
            formatter={(v, name) => [`${Number(v).toFixed(1)}%`, String(name)]}
            contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--grid)', borderRadius: 8, color: 'var(--text-primary)' }}
            cursor={{ fill: 'var(--grid)', opacity: 0.4 }}
          />
          <Legend verticalAlign="top" align="left" height={28} iconType="square" wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 12 }} />
          {present.map((g) => (
            <Bar key={g.key} isAnimationActive={false} dataKey={g.key} name={g.label} fill={g.color} stroke="var(--surface)" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={22} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

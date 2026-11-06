import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  fetchLinkedInFollowers,
  fetchLinkedInVisitors,
  type LinkedInBar,
  type LinkedInDemographics,
  type LinkedInFollowers,
  type LinkedInUnavailable,
  type LinkedInVisitors,
} from '../../services/api';
import { RankedBars } from '../charts/RankedBars';
import { formatCompact, formatShortDate } from '../charts/viz';
import { errorMessage } from '../../utils/errors';
import { Panel, StatTiles } from './ui';
import { DashboardSkeleton } from '../Skeleton';

interface Props {
  token: string;
  accountId: string;
  since: string;
  until: string;
}

const isUnavailable = (v: unknown): v is LinkedInUnavailable => !!v && typeof v === 'object' && 'unavailable' in v;

const GROUPS: { key: keyof LinkedInDemographics; title: string }[] = [
  { key: 'function', title: 'Job function' },
  { key: 'seniority', title: 'Seniority' },
  { key: 'industry', title: 'Industry' },
  { key: 'company_size', title: 'Company size' },
  { key: 'country', title: 'Country' },
  { key: 'region', title: 'City / region' },
];

function Unavailable({ reason }: { reason: string }) {
  return <p className="trends-empty-inline">{reason}</p>;
}

function DemographicGrid({ data, unit }: { data: LinkedInDemographics | LinkedInUnavailable; unit: string }) {
  if (isUnavailable(data)) return <Unavailable reason={data.reason} />;
  return (
    <div className="viz-two-col">
      {GROUPS.map((g) => (
        <section key={g.key} className="viz-panel">
          <h3>{g.title}</h3>
          <RankedBars rows={data[g.key]} emptyText={`LinkedIn has no ${g.title.toLowerCase()} data yet.`} valueSuffix={unit} />
        </section>
      ))}
    </div>
  );
}

function FollowerGrowth({ growth }: { growth: LinkedInFollowers['growth'] }) {
  if (isUnavailable(growth)) return <Unavailable reason={growth.reason} />;
  if (!growth.length) return <p className="trends-empty-inline">No follower changes in this period.</p>;
  const hasPaid = growth.some((g) => g.paid !== 0);
  return (
    <div className="viz-chart" role="img" aria-label="New followers per day">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={growth} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="date" tickFormatter={formatShortDate} stroke="var(--axis)" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} stroke="var(--axis)" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            labelFormatter={(l) => formatShortDate(String(l))}
            contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--grid)', borderRadius: 8, color: 'var(--text-primary)' }}
            cursor={{ fill: 'var(--grid)', opacity: 0.4 }}
          />
          {hasPaid && <Legend verticalAlign="top" align="left" height={28} iconType="square" wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 12 }} />}
          <Bar isAnimationActive={false} dataKey="organic" name="Organic" stackId="f" fill="var(--series-1)" />
          {hasPaid && <Bar isAnimationActive={false} dataKey="paid" name="Paid" stackId="f" fill="var(--series-3)" />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrafficBars({ rows }: { rows: LinkedInBar[] }) {
  return <RankedBars rows={rows} valueSuffix=" views" singularSuffix=" view" emptyText="No page views recorded yet." />;
}

/** LinkedIn company page audience, straight from LinkedIn (works before any history is stored). */
export function LinkedInAudience({ token, accountId, since, until }: Props) {
  const [followers, setFollowers] = useState<LinkedInFollowers | null>(null);
  const [visitors, setVisitors] = useState<LinkedInVisitors | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      setFollowers(null);
      setVisitors(null);
      try {
        const [f, v] = await Promise.all([
          fetchLinkedInFollowers(token, accountId, since, until),
          fetchLinkedInVisitors(token, accountId),
        ]);
        if (cancelled) return;
        setFollowers(f);
        setVisitors(v);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Could not load LinkedIn audience data'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, accountId, since, until]);

  if (error) return <div className="error-banner" role="alert"><span>{error}</span></div>;
  if (!followers || !visitors) return <DashboardSkeleton kpis={3} label="Loading audience…" />;

  const gained = isUnavailable(followers.growth) ? null : followers.growth.reduce((a, g) => a + g.organic + g.paid, 0);
  const mobile = !isUnavailable(visitors) ? visitors.devices.find((d) => d.label === 'Mobile')?.value ?? 0 : 0;
  const mobileShare = !isUnavailable(visitors) && visitors.total > 0 ? Math.round((mobile / visitors.total) * 100) : null;

  return (
    <>
      <Panel title="Followers" sub="Your company page followers and how many you gained in the selected dates.">
        <StatTiles items={[
          { label: 'Total followers', value: followers.total === null ? '–' : formatCompact(followers.total) },
          { label: 'Gained in this period', value: gained === null ? '–' : `${gained >= 0 ? '+' : ''}${formatCompact(gained)}` },
          { label: 'Page views (all time)', value: isUnavailable(visitors) ? '–' : formatCompact(visitors.total) },
          { label: 'Visits from mobile', value: mobileShare === null ? '–' : `${mobileShare}%` },
        ]} />
        <FollowerGrowth growth={followers.growth} />
      </Panel>

      <h3 className="ws-section-title">Who follows you</h3>
      <p className="ws-sub">All current followers. LinkedIn shows the top 10 in each group.</p>
      <DemographicGrid data={followers.demographics} unit=" followers" />

      <h3 className="ws-section-title">Who visits your page</h3>
      <p className="ws-sub">Members who opened your company page, all time.</p>
      {isUnavailable(visitors) ? <Unavailable reason={visitors.reason} /> : (
        <>
          <div className="viz-two-col">
            <section className="viz-panel">
              <h3>Which sections they open</h3>
              <TrafficBars rows={visitors.sections} />
            </section>
            <section className="viz-panel">
              <h3>Desktop or mobile</h3>
              <TrafficBars rows={visitors.devices} />
            </section>
          </div>
          <DemographicGrid data={visitors.demographics} unit=" views" />
        </>
      )}
    </>
  );
}

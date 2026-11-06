import { Fragment, useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchOverview, syncNow, type SyncResult } from '../services/api';
import { STORED_MAX_AGE, invalidateLiveCache, storedDataKeys, useLive } from './workspace/useLive';
import { KpiCard } from './charts/KpiCard';
import { AccountCards } from './workspace/AccountCards';
import { formatCompact, formatShortDate } from './charts/viz';
import { lastDaysRange } from '../utils/dates';
import { downloadCsv, toCsv } from '../utils/csv';
import '../assets/css/workspace.css';

const RANGES = [7, 14, 30, 90];
const PLATFORM_COLOR = { instagram: 'var(--series-1)', youtube: 'var(--series-2)', linkedin: 'var(--series-3)' } as const;
const PLATFORM_NAME = { instagram: 'Instagram', youtube: 'YouTube', linkedin: 'LinkedIn' } as const;
const ALL_PLATFORMS = ['instagram', 'youtube', 'linkedin'] as const;
const KPI = [
  { key: 'views', label: 'Views' },
  { key: 'interactions', label: 'Interactions' },
  { key: 'net_followers', label: 'Net new followers' },
];

export default function Overview({ token }: { token: string }) {
  const [days, setDays] = useState(30);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const { since, until } = lastDaysRange(days);
  const state = useLive(() => fetchOverview(token, since, until), `overview:${since}:${until}`, true, { maxAge: STORED_MAX_AGE });
  // While another range loads, the old range's numbers are not shown as the new ones.
  const data = state.data && state.data.range.since === since && state.data.range.until === until ? state.data : null;
  const loading = !data && state.loading;
  const error = syncError ?? state.error;

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const result = await syncNow(token);
      setSyncResult(result);
      if (result.results.length) invalidateLiveCache(...storedDataKeys());
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [token]);

  const hasData = !!data && (data.coverage.instagram_days > 0 || data.coverage.youtube_days > 0 || data.coverage.linkedin_days > 0);
  // Only platforms with a connected account get a line, a slice and a column.
  const shown = data ? ALL_PLATFORMS.filter((p) => data.accounts[p] > 0) : [];
  const share = data
    ? shown.map((p) => ({ name: PLATFORM_NAME[p], platform: p, value: data.totals[p].views })).filter((s) => s.value > 0)
    : [];
  const totalViews = share.reduce((a, s) => a + s.value, 0);

  return (
    <div className="ws">
      <main className="ws-main">
        <div className="ws-pagehead">
          <div>
            <h2>Overview</h2>
            <p className="ws-sub">Instagram, YouTube and LinkedIn side by side, from your stored history. LinkedIn impressions count as views.</p>
          </div>
        </div>

        <section className="ws-toolbar">
          <div className="ws-field">
            <span className="ws-field-label">Date range</span>
            <div className="seg" role="group" aria-label="Date range">
              {RANGES.map((r) => (
                <button key={r} className={days === r ? 'active' : ''} onClick={() => setDays(r)} aria-pressed={days === r}>{r} days</button>
              ))}
            </div>
          </div>
          {hasData && (
            <button
              className="btn btn-secondary"
              onClick={() =>
                downloadCsv(
                  `overview-${data.range.since}_${data.range.until}.csv`,
                  toCsv(data.daily.map((d) => ({ date: d.date, instagram_views: d.instagram_views, youtube_views: d.youtube_views, linkedin_impressions: d.linkedin_views })))
                )
              }
            >
              Download CSV
            </button>
          )}
          {hasData && <button className="btn btn-secondary" onClick={() => window.print()}>Print / PDF</button>}
          <div className="ws-toolbar-right">
            <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>{syncing ? 'Updating…' : 'Update all data'}</button>
          </div>
        </section>

        {error && <div className="error-banner"><span>{error}</span></div>}
        {data?.errors?.map((e) => (
          <div key={`live-${e.platform}-${e.account_id}`} className="error-banner">
            <span>Could not fetch live {e.platform} numbers for account {e.account_id} (error {e.code}): {e.message}</span>
          </div>
        ))}
        {syncResult?.errors.map((e) => (
          <div key={`${e.platform}-${e.account_id}`} className="error-banner">
            <span>Could not update {e.platform} account {e.account_id} (error {e.code}{e.reason ? ` · ${e.reason}` : ''}): {e.message}</span>
          </div>
        ))}
        {loading && <div className="trends-loading"><div className="spinner" /></div>}

        {!loading && data && !hasData && (
          <div className="ws-empty ws-empty-cta">
            <h3>No data stored yet</h3>
            <p>Press <b>Update all data</b> to copy your latest numbers into your dashboard, or add accounts first.</p>
            <Link className="btn btn-secondary" to="/accounts">Manage accounts</Link>
          </div>
        )}

        {!loading && data && hasData && (
          <>
            {data.insights.length > 0 && (
              <ul className="overview-insights">
                {data.insights.map((t) => <li key={t}>{t}</li>)}
              </ul>
            )}

            <section className="kpi-grid">
              {KPI.map((k) => (
                <KpiCard
                  key={k.key}
                  label={`${k.label} (combined)`}
                  value={data.totals.combined[k.key] ?? 0}
                  delta={data.deltas.combined[k.key]}
                  series={k.key === 'views' ? data.daily.map((d) => d.instagram_views + d.youtube_views + d.linkedin_views) : []}
                />
              ))}
            </section>

            <AccountCards cards={data.account_cards} days={data.range.days} />

            <div className="viz-two-col wide-left">
              <section className="viz-panel">
                <h3>Daily views by platform</h3>
                <div className="viz-chart" role="img" aria-label="Daily views by platform">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={data.daily} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--grid)" />
                      <XAxis dataKey="date" tickFormatter={formatShortDate} stroke="var(--axis)" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} minTickGap={24} />
                      <YAxis tickFormatter={formatCompact} stroke="var(--axis)" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} axisLine={false} width={48} />
                      <Tooltip
                        labelFormatter={(l) => formatShortDate(String(l))}
                        formatter={(v, name) => [Number(v).toLocaleString(), String(name)]}
                        contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--grid)', borderRadius: 8, color: 'var(--text-primary)' }}
                        cursor={{ stroke: 'var(--axis)' }}
                      />
                      <Legend verticalAlign="top" align="left" height={28} iconType="plainline" wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 12 }} />
                      {shown.map((p) => (
                        <Area key={p} isAnimationActive={false} type="monotone" dataKey={`${p}_views`} name={PLATFORM_NAME[p]} stroke={PLATFORM_COLOR[p]} fill={PLATFORM_COLOR[p]} fillOpacity={0.12} strokeWidth={2} dot={false} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="viz-panel">
                <h3>Share of views</h3>
                <div className="viz-chart" role="img" aria-label="Share of views by platform">
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={share} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}>
                        {share.map((s) => <Cell key={s.platform} fill={PLATFORM_COLOR[s.platform]} />)}
                      </Pie>
                      <Tooltip
                        formatter={(v, name) => [`${Number(v).toLocaleString()} (${Math.round((Number(v) / totalViews) * 100)}%)`, String(name)]}
                        contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--grid)', borderRadius: 8, color: 'var(--text-primary)' }}
                      />
                      <Legend verticalAlign="bottom" iconType="square" wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </div>

            <section className="viz-panel">
              <h3>Platform comparison</h3>
              <div className="viz-table-wrap">
                <table className="viz-table">
                  <thead>
                    <tr><th>Metric</th>{shown.map((p) => <Fragment key={p}><th>{PLATFORM_NAME[p]}</th><th>vs prev</th></Fragment>)}</tr>
                  </thead>
                  <tbody>
                    {KPI.map((k) => {
                      const pct = (p: (typeof ALL_PLATFORMS)[number]) => data.deltas[p][k.key]?.change_pct;
                      const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${v > 0 ? '+' : ''}${v}%`);
                      return (
                        <tr key={k.key}>
                          <td>{k.label}</td>
                          {shown.map((p) => (
                            <Fragment key={p}>
                              <td>{data.totals[p][k.key]?.toLocaleString()}</td>
                              <td>{fmt(pct(p))}</td>
                            </Fragment>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="trends-foot">
                Net followers = Instagram follower change, YouTube subscribers gained minus lost, and LinkedIn followers gained.
                {shown.map((p) => {
                  const stored = data.coverage[`${p}_days`];
                  return stored < data.range.days ? ` ${PLATFORM_NAME[p]}: ${stored} of ${data.range.days} days stored.` : '';
                })}
              </p>
            </section>

            {data.leaderboard.length > 0 && (
              <section className="viz-panel">
                <h3>Best content by engagement rate</h3>
                <p className="ws-sub">Likes + comments + saves + shares as a share of views, for items with at least 100 views.</p>
                <ol className="media-rank">
                  {data.leaderboard.map((m) => (
                    <li key={`${m.platform}-${m.media_id}`}>
                      {m.thumbnail_url ? <img src={m.thumbnail_url} alt="" loading="lazy" /> : <div className="media-thumb-empty" />}
                      <div className="media-rank-body">
                        <a href={m.permalink ?? undefined} target="_blank" rel="noreferrer">{(m.title || 'Untitled').slice(0, 90)}</a>
                        <span className="media-rank-meta">
                          <span className="platform-chip" style={{ borderColor: PLATFORM_COLOR[m.platform] }}>{PLATFORM_NAME[m.platform]}</span>
                          {' '}{m.media_type}
                        </span>
                      </div>
                      <dl className="media-rank-stats">
                        <div><dt>Engagement</dt><dd>{m.engagement_rate}%</dd></div>
                        <div><dt>Views</dt><dd>{formatCompact(m.views ?? m.reach)}</dd></div>
                      </dl>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

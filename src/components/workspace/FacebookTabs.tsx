import { useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FacebookAudience, FacebookDaily, FacebookMetric, FacebookPageProfile, FacebookPost, FacebookReel } from '../../services/api';
import { KpiCard } from '../charts/KpiCard';
import { RankedBars } from '../charts/RankedBars';
import { formatCompact, formatPercent, formatSeconds, formatShortDate } from '../charts/viz';
import { CHARTABLE, FB_METRICS, REACTION_LABEL, WEEKDAYS, istHour, istWeekday, postTypeLabel, ratio } from './facebookMeta';
import { Panel, StatTiles } from './ui';
import { SectionSkeleton } from '../Skeleton';

const TOOLTIP_STYLE = { background: 'var(--surface-2)', border: '1px solid var(--grid)', borderRadius: 8, color: 'var(--text-primary)' };
const AXIS = { stroke: 'var(--axis)', tick: { fill: 'var(--text-muted)', fontSize: 12 }, tickLine: false } as const;

const has = (d: FacebookDaily, k: FacebookMetric) => Boolean(d.metrics[k]);
const total = (d: FacebookDaily, k: FacebookMetric) => d.totals[k] ?? 0;

function Kpi({ data, k, display }: { data: FacebookDaily; k: FacebookMetric; display?: string }) {
  const info = FB_METRICS[k];
  return (
    <KpiCard
      label={info.label}
      help={info.help}
      value={total(data, k)}
      display={display}
      delta={data.deltas[k]}
      lowerIsBetter={info.lowerIsBetter}
      series={data.daily.map((r) => Number(r[k] ?? 0))}
    />
  );
}

function netFollowerDelta(d: FacebookDaily) {
  const net = total(d, 'follows') - total(d, 'unfollows');
  const prev = (d.deltas.follows?.previous ?? 0) - (d.deltas.unfollows?.previous ?? 0);
  return { net, delta: { current: net, previous: prev, change_pct: prev > 0 ? Math.round(((net - prev) / prev) * 1000) / 10 : null } };
}

/** One metric per day, with a picker of every metric Facebook returned. */
export function DailyChart({ data, choices, initial }: { data: FacebookDaily; choices: FacebookMetric[]; initial: FacebookMetric }) {
  const available = choices.filter((k) => has(data, k));
  const [picked, setPicked] = useState<FacebookMetric>(initial);
  const metric = available.includes(picked) ? picked : available[0];
  if (!metric) return null;
  const label = FB_METRICS[metric].label;
  return (
    <Panel
      title={`${label} per day`}
      sub={FB_METRICS[metric].help}
      actions={(
        <select value={metric} onChange={(e) => setPicked(e.target.value as FacebookMetric)} aria-label="Metric">
          {available.map((k) => <option key={k} value={k}>{FB_METRICS[k].label}</option>)}
        </select>
      )}
    >
      <div className="viz-chart" role="img" aria-label={`${label} per day`}>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data.daily} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="date" tickFormatter={formatShortDate} {...AXIS} minTickGap={24} />
            <YAxis tickFormatter={(v) => formatCompact(Number(v))} {...AXIS} axisLine={false} width={44} />
            <Tooltip labelFormatter={(l) => formatShortDate(String(l))} formatter={(v) => [Number(v).toLocaleString(), label]} contentStyle={TOOLTIP_STYLE} />
            <Area isAnimationActive={false} type="monotone" dataKey={metric} stroke="var(--accent)" strokeWidth={2} fill="var(--accent)" fillOpacity={0.12} connectNulls />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function weekdayRows(daily: FacebookDaily['daily'], key: FacebookMetric) {
  const sums = Array(7).fill(0);
  const counts = Array(7).fill(0);
  for (const r of daily) {
    const wd = new Date(`${r.date}T00:00:00Z`).getUTCDay();
    sums[wd] += Number(r[key] ?? 0);
    counts[wd] += 1;
  }
  return WEEKDAYS.map((day, i) => ({ day, avg: counts[i] ? Math.round((sums[i] / counts[i]) * 10) / 10 : 0 }));
}

function SimpleBars({ data, x, y, label, height = 220 }: { data: object[]; x: string; y: string; label: string; height?: number }) {
  return (
    <div className="viz-chart" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey={x} {...AXIS} />
          <YAxis tickFormatter={(v) => formatCompact(Number(v))} {...AXIS} axisLine={false} width={44} />
          <Tooltip formatter={(v) => [Number(v).toLocaleString(), label]} contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--grid)', opacity: 0.4 }} />
          <Bar isAnimationActive={false} dataKey={y} name={label} fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–');

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function FbOverviewTab({ data, profile }: { data: FacebookDaily; profile: FacebookPageProfile | null }) {
  const { net, delta } = netFollowerDelta(data);
  const views = total(data, 'views');
  const engagementRate = ratio(total(data, 'engagements'), views);
  const reactions = Object.entries(data.breakdowns?.reactions ?? {})
    .map(([k, v]) => ({ label: REACTION_LABEL[k] ?? k, value: v }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const audience = data.breakdowns?.views_by_audience ?? null;
  const source = data.breakdowns?.views_by_source ?? null;
  const weekdays = weekdayRows(data.daily, 'views');
  const best = [...weekdays].sort((a, b) => b.avg - a.avg)[0];

  return (
    <>
      <section className="kpi-grid" aria-label="Key numbers">
        {(['views', 'reach', 'engagements', 'reactions', 'page_visits', 'actions'] as FacebookMetric[]).filter((k) => has(data, k)).map((k) => <Kpi key={k} data={data} k={k} />)}
        {has(data, 'follows') && has(data, 'unfollows') && (
          <KpiCard label="Net followers" help="New follows minus unfollows." value={net} display={`${net > 0 ? '+' : ''}${net.toLocaleString()}`} delta={delta}
            series={data.daily.map((r) => Number(r.follows ?? 0) - Number(r.unfollows ?? 0))} />
        )}
        {engagementRate !== null && (
          <KpiCard label="Engagement rate" help="Engagements as a share of views." value={engagementRate} display={formatPercent(engagementRate)} series={[]} />
        )}
        {has(data, 'new_conversations') && <Kpi data={data} k="new_conversations" />}
      </section>

      <DailyChart data={data} choices={CHARTABLE} initial="views" />

      <div className="viz-two-col">
        <Panel title="Who saw your content" sub="Views from people who follow your Page versus everyone else.">
          {audience ? (
            <>
              <RankedBars rows={[{ label: 'Followers', value: audience.followers }, { label: 'Non-followers', value: audience.non_followers }]} emptyText="No views in this period." />
              <p className="trends-foot">{pct(audience.non_followers, audience.followers + audience.non_followers)} of your views came from people who don’t follow you yet.</p>
            </>
          ) : <p className="trends-empty-inline">Facebook didn’t return this breakdown.</p>}
        </Panel>
        <Panel title="Organic vs ads" sub="Views you earned versus views from boosted posts and ads.">
          {source ? (
            <RankedBars rows={[{ label: 'Organic', value: source.organic }, { label: 'From ads', value: source.ads }]} emptyText="No views in this period." />
          ) : <p className="trends-empty-inline">Facebook didn’t return this breakdown.</p>}
        </Panel>
      </div>

      <div className="viz-two-col">
        <Panel title="Reactions by type" sub="Which reactions your posts got.">
          <RankedBars rows={reactions} emptyText="No reactions in this period." />
        </Panel>
        <Panel title="Views by weekday" sub={best && best.avg > 0 ? `${best.day} averages the most views in this period.` : 'Average views on each day of the week.'}>
          <SimpleBars data={weekdays} x="day" y="avg" label="Avg views" />
        </Panel>
      </div>

      {profile && (
        <Panel title="Page at a glance" sub="Lifetime numbers for your Page right now.">
          <StatTiles items={[
            { label: 'Followers', value: formatCompact(profile.followers) },
            { label: 'Page likes', value: formatCompact(profile.likes) },
            { label: 'Talking about this', value: formatCompact(profile.talking_about), hint: 'People who interacted with your Page in the last 7 days.' },
            { label: 'Check-ins', value: formatCompact(profile.checkins) },
            { label: 'Rating', value: profile.rating ? `${profile.rating} ★ (${profile.rating_count})` : 'No ratings' },
            { label: 'Verified', value: profile.verified === null ? '–' : profile.verified ? 'Yes' : 'No' },
          ]} />
        </Panel>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const SORTS = [
  { key: 'views', label: 'Most views' },
  { key: 'reach', label: 'Most reach' },
  { key: 'engagement_rate', label: 'Best engagement rate' },
  { key: 'interactions', label: 'Most interactions' },
  { key: 'clicks', label: 'Most clicks' },
  { key: 'created_time', label: 'Newest' },
] as const;
type SortKey = (typeof SORTS)[number]['key'];

const snippet = (text: string | null, fallback: string, max = 80) => {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return fallback;
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

const avg = (list: (number | null)[]) => {
  const xs = list.filter((x): x is number => x !== null && x !== undefined);
  return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
};

export function FbContentTab({ posts, withInsights }: { posts: FacebookPost[]; withInsights: boolean }) {
  const [sort, setSort] = useState<SortKey>('views');
  const sorted = useMemo(() => [...posts].sort((a, b) => {
    if (sort === 'created_time') return a.created_time < b.created_time ? 1 : -1;
    return (Number(b[sort] ?? -1)) - (Number(a[sort] ?? -1));
  }), [posts, sort]);

  if (!posts.length) return <p className="trends-empty-inline">No posts published in this period. Try a longer range.</p>;

  const byType = new Map<string, FacebookPost[]>();
  for (const p of posts) byType.set(postTypeLabel(p.type), [...(byType.get(postTypeLabel(p.type)) ?? []), p]);
  const types = [...byType.entries()].map(([type, list]) => ({
    type, count: list.length, views: avg(list.map((p) => p.views)), reach: avg(list.map((p) => p.reach)),
    interactions: avg(list.map((p) => p.interactions)), rate: avg(list.map((p) => p.engagement_rate)),
  })).sort((a, b) => (b.views ?? 0) - (a.views ?? 0));

  const dayAvg = WEEKDAYS.map((day, i) => ({ day, avg: avg(posts.filter((p) => istWeekday(p.created_time) === i).map((p) => p.views ?? p.interactions)) ?? 0 }));
  const hourBuckets = [
    { label: 'Night (0–6)', from: 0, to: 6 }, { label: 'Morning (6–12)', from: 6, to: 12 },
    { label: 'Afternoon (12–18)', from: 12, to: 18 }, { label: 'Evening (18–24)', from: 18, to: 24 },
  ].map((b) => {
    const list = posts.filter((p) => { const h = istHour(p.created_time); return h >= b.from && h < b.to; });
    return { label: `${b.label} · ${list.length} post${list.length === 1 ? '' : 's'}`, value: avg(list.map((p) => p.views ?? p.interactions)) ?? 0 };
  }).filter((b) => !b.label.includes('· 0 posts'));

  return (
    <>
      <section className="kpi-grid" aria-label="Post summary">
        <KpiCard label="Posts" value={posts.length} series={[]} />
        <KpiCard label="Avg views per post" value={avg(posts.map((p) => p.views)) ?? 0} series={[]} />
        <KpiCard label="Avg reach per post" value={avg(posts.map((p) => p.reach)) ?? 0} series={[]} />
        <KpiCard label="Avg engagement rate" help="Reactions, comments, shares and clicks per person reached." value={avg(posts.map((p) => p.engagement_rate)) ?? 0} display={formatPercent(avg(posts.map((p) => p.engagement_rate)))} series={[]} />
        <KpiCard label="Total clicks" value={posts.reduce((a, p) => a + p.clicks, 0)} series={[]} />
      </section>
      {!withInsights && <div className="ws-notice">Facebook didn’t share per-post views and reach, so only reactions, comments and shares are shown.</div>}

      <Panel title="Your posts" sub="Every post in this period with its own numbers." actions={(
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort posts">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      )}>
        <div className="viz-table-wrap">
          <table className="viz-table">
            <thead>
              <tr><th>Post</th><th>Type</th><th>Published</th><th>Views</th><th>Reach</th><th>Reactions</th><th>Comments</th><th>Shares</th><th>Clicks</th><th>Eng. rate</th></tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id}>
                  <td className="fb-post-cell">
                    {p.picture && <img src={p.picture} alt="" className="fb-post-thumb" loading="lazy" />}
                    {p.permalink ? <a href={p.permalink} target="_blank" rel="noreferrer">{snippet(p.message, postTypeLabel(p.type))}</a> : <span>{snippet(p.message, postTypeLabel(p.type))}</span>}
                  </td>
                  <td>{postTypeLabel(p.type)}</td>
                  <td>{formatShortDate(p.created_time.slice(0, 10))}</td>
                  <td>{formatCompact(p.views)}</td>
                  <td>{formatCompact(p.reach)}</td>
                  <td title={p.reactions_by_type ? Object.entries(p.reactions_by_type).map(([k, v]) => `${REACTION_LABEL[k] ?? k}: ${v}`).join(', ') : undefined}>{p.reactions.toLocaleString()}</td>
                  <td>{p.comments.toLocaleString()}</td>
                  <td>{p.shares.toLocaleString()}</td>
                  <td>{p.clicks.toLocaleString()}</td>
                  <td>{formatPercent(p.engagement_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="What kind of post works best" sub="Averages per post for each type.">
        <div className="viz-table-wrap">
          <table className="viz-table">
            <thead><tr><th>Type</th><th>Posts</th><th>Avg views</th><th>Avg reach</th><th>Avg interactions</th><th>Avg eng. rate</th></tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.type}>
                  <td>{t.type}</td><td>{t.count}</td><td>{formatCompact(t.views)}</td><td>{formatCompact(t.reach)}</td>
                  <td>{formatCompact(t.interactions)}</td><td>{formatPercent(t.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="viz-two-col">
        <Panel title="Best day to post" sub="Average views per post by the weekday it went out (India time).">
          <SimpleBars data={dayAvg} x="day" y="avg" label="Avg views per post" />
        </Panel>
        <Panel title="Best time to post" sub="Average views per post by the time it went out (India time).">
          <RankedBars rows={hourBuckets} emptyText="No posts in this period." />
        </Panel>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Video & Reels
// ---------------------------------------------------------------------------

export function FbVideoTab({ data, reels, reelsError }: { data: FacebookDaily; reels: FacebookReel[] | null; reelsError: string | null }) {
  const views = total(data, 'video_views');
  const avgWatch = views > 0 ? (total(data, 'watch_minutes') * 60) / views : null;
  const videoKeys: FacebookMetric[] = ['video_views', 'watch_minutes', 'video_complete_30s', 'video_repeat_views'];

  return (
    <>
      <section className="kpi-grid" aria-label="Video numbers">
        {videoKeys.filter((k) => has(data, k)).map((k) => <Kpi key={k} data={data} k={k} />)}
        {avgWatch !== null && <KpiCard label="Avg watch per view" help="Minutes watched divided by video views." value={avgWatch} display={formatSeconds(avgWatch)} series={[]} />}
        {views > 0 && has(data, 'video_complete_30s') && (
          <KpiCard label="30-second rate" help="Share of video views that lasted 30 seconds or more." value={ratio(total(data, 'video_complete_30s'), views) ?? 0}
            display={formatPercent(ratio(total(data, 'video_complete_30s'), views))} series={[]} />
        )}
      </section>

      <DailyChart data={data} choices={['video_views', 'watch_minutes', 'video_complete_30s', 'video_repeat_views', 'video_autoplayed', 'video_click_to_play', 'video_views_organic', 'video_views_paid']} initial="video_views" />

      <div className="viz-two-col">
        <Panel title="How views started" sub="Videos that played on their own in the feed versus ones people pressed play on.">
          <RankedBars rows={[{ label: 'Autoplayed', value: total(data, 'video_autoplayed') }, { label: 'Click to play', value: total(data, 'video_click_to_play') }]} emptyText="No video views in this period." />
        </Panel>
        <Panel title="Organic vs paid video views">
          <RankedBars rows={[{ label: 'Organic', value: total(data, 'video_views_organic') }, { label: 'Paid', value: total(data, 'video_views_paid') }]} emptyText="No video views in this period." />
        </Panel>
      </div>

      <Panel title="Reels" sub="Each reel published in this period. A play counts every start; replays are people watching again.">
        {reelsError ? <p className="trends-empty-inline">{reelsError}</p>
          : !reels ? <SectionSkeleton variant="table" rows={4} label="Loading reels…" />
            : !reels.length ? <p className="trends-empty-inline">No reels published in this period.</p>
              : (
                <div className="viz-table-wrap">
                  <table className="viz-table">
                    <thead>
                      <tr><th>Reel</th><th>Published</th><th>Length</th><th>Plays</th><th>Replays</th><th>Avg watch</th><th>% watched</th><th>Minutes watched</th><th>Followers gained</th><th>Reactions</th><th>Comments</th><th>Shares</th></tr>
                    </thead>
                    <tbody>
                      {[...reels].sort((a, b) => (b.plays ?? 0) - (a.plays ?? 0)).map((r) => (
                        <tr key={r.id}>
                          <td className="fb-post-cell">
                            {r.picture && <img src={r.picture} alt="" className="fb-post-thumb" loading="lazy" />}
                            {r.permalink ? <a href={r.permalink} target="_blank" rel="noreferrer">{snippet(r.description, 'Reel')}</a> : snippet(r.description, 'Reel')}
                          </td>
                          <td>{formatShortDate(r.created_time.slice(0, 10))}</td>
                          <td>{formatSeconds(r.length_seconds)}</td>
                          <td>{formatCompact(r.plays)}</td>
                          <td>{formatCompact(r.replays)}</td>
                          <td>{formatSeconds(r.avg_watch_seconds)}</td>
                          <td>{formatPercent(ratio(r.avg_watch_seconds, r.length_seconds))}</td>
                          <td>{formatCompact(r.watch_minutes)}</td>
                          <td>{formatCompact(r.followers_gained)}</td>
                          <td>{r.reactions.toLocaleString()}</td>
                          <td>{r.comments.toLocaleString()}</td>
                          <td>{r.shares.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

export function FbAudienceTab({ data, audience, audienceError, profile }: {
  data: FacebookDaily;
  audience: FacebookAudience | null;
  audienceError: string | null;
  profile: FacebookPageProfile | null;
}) {
  const { net, delta } = netFollowerDelta(data);
  const growth = data.daily.map((r) => ({ date: r.date, follows: Number(r.follows ?? 0), unfollows: -Number(r.unfollows ?? 0) }));
  const hasTotals = data.daily.some((r) => r.followers_total !== null && r.followers_total !== undefined);
  const demographicsNote = 'Facebook only shows where your followers are once your Page has about 100 followers.';

  return (
    <>
      <section className="kpi-grid" aria-label="Follower numbers">
        <KpiCard label="Followers" value={profile?.followers ?? total(data, 'followers_total')} series={data.daily.map((r) => Number(r.followers_total ?? 0))} />
        {has(data, 'follows') && <Kpi data={data} k="follows" />}
        {has(data, 'unfollows') && <Kpi data={data} k="unfollows" />}
        {has(data, 'follows') && has(data, 'unfollows') && (
          <KpiCard label="Net followers" value={net} display={`${net > 0 ? '+' : ''}${net.toLocaleString()}`} delta={delta} series={[]} />
        )}
        {profile?.talking_about !== null && profile?.talking_about !== undefined && (
          <KpiCard label="Talking about this" help="People who interacted with your Page in the last 7 days." value={profile.talking_about} series={[]} />
        )}
        {has(data, 'new_conversations') && <Kpi data={data} k="new_conversations" />}
      </section>

      <Panel title="Follows and unfollows per day" sub="New follows above the line, unfollows below.">
        <div className="viz-chart" role="img" aria-label="Follows and unfollows per day">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={growth} stackOffset="sign" margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} {...AXIS} minTickGap={24} />
              <YAxis allowDecimals={false} {...AXIS} axisLine={false} width={40} />
              <Tooltip labelFormatter={(l) => formatShortDate(String(l))} formatter={(v, n) => [Math.abs(Number(v)).toLocaleString(), String(n)]} contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--grid)', opacity: 0.4 }} />
              <Legend verticalAlign="top" align="left" height={28} iconType="square" wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 12 }} />
              <Bar isAnimationActive={false} dataKey="follows" name="Follows" stackId="f" fill="var(--series-3)" />
              <Bar isAnimationActive={false} dataKey="unfollows" name="Unfollows" stackId="f" fill="var(--series-8)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      {hasTotals && <DailyChart data={data} choices={['followers_total']} initial="followers_total" />}

      <div className="viz-two-col">
        <Panel title="Followers by country">
          {audienceError ? <p className="trends-empty-inline">{audienceError}</p>
            : !audience ? <SectionSkeleton variant="bars" />
              : <RankedBars rows={audience.country} emptyText={audience.reason ?? demographicsNote} />}
        </Panel>
        <Panel title="Followers by city">
          {audienceError ? <p className="trends-empty-inline">{audienceError}</p>
            : !audience ? <SectionSkeleton variant="bars" />
              : <RankedBars rows={audience.city} emptyText={audience.reason ?? demographicsNote} />}
        </Panel>
      </div>
    </>
  );
}

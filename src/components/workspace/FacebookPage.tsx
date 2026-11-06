import { useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, useParams, useSearchParams } from 'react-router-dom';
import {
  fetchFacebookAudience,
  fetchFacebookDaily,
  fetchFacebookPosts,
  fetchFacebookProfile,
  fetchFacebookReels,
  getFacebookPages,
  syncNow,
  type SyncResult,
} from '../../services/api';
import { errorMessage } from '../../utils/errors';
import { SyncReport } from './SyncReport';
import { timeAgo } from '../../utils/dates';
import { formatCompact } from '../charts/viz';
import { ANALYTICS_MAX_AGE, invalidateLiveCache, useLive } from './useLive';
import { RangePicker } from './RangePicker';
import { presetRange, type RangeValue } from './range';
import { LiveBlock } from './ui';
import { FB_METRICS } from './facebookMeta';
import { FbAudienceTab, FbContentTab, FbOverviewTab, FbVideoTab } from './FacebookTabs';
import '../../assets/css/workspace.css';
import { DashboardSkeleton, PageSkeleton, SectionSkeleton } from '../Skeleton';

const TABS = [
  { key: 'overview', label: 'Overview', path: '' },
  { key: 'content', label: 'Content', path: '/content' },
  { key: 'video', label: 'Video & Reels', path: '/video' },
  { key: 'audience', label: 'Audience', path: '/audience' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const PAGES_MAX_AGE = 60 * 1000;

export default function FacebookPage({ token }: { token: string }) {
  const { tab } = useParams();
  if (tab !== undefined && !TABS.some((t) => t.key === tab && t.key !== 'overview')) return <Navigate to="/facebook" replace />;
  return <Workspace token={token} tab={(tab as TabKey | undefined) ?? 'overview'} />;
}

function Workspace({ token, tab }: { token: string; tab: TabKey }) {
  const [range, setRange] = useState<RangeValue>(() => presetRange(30));
  const [searchParams] = useSearchParams();
  const [picked, setPicked] = useState<string>(searchParams.get('account') ?? '');
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const pagesState = useLive(() => getFacebookPages(token), 'accounts:facebook', true, { maxAge: PAGES_MAX_AGE });
  const pages = pagesState.data?.pages;
  const accountId = useMemo(() => {
    if (!pages?.length) return '';
    return String((pages.find((p) => String(p.id) === picked) ?? pages[0]).id);
  }, [pages, picked]);

  const ready = Boolean(accountId) && range.since <= range.until;
  // Presets read the saved days; a custom range is fetched live from Facebook (like the other platforms).
  const live = range.preset === 'custom';
  const k = `fb:${accountId}:${range.since}:${range.until}:${live ? 'live' : 'stored'}:${refreshKey}`;
  const opts = { maxAge: ANALYTICS_MAX_AGE };
  const profile = useLive(() => fetchFacebookProfile(token, accountId), `fb:profile:${accountId}:${refreshKey}`, Boolean(accountId), opts);
  const daily = useLive(() => fetchFacebookDaily(token, accountId, range.since, range.until, live), `${k}:daily`, ready, opts);
  // Each tab loads only what it shows.
  const posts = useLive(() => fetchFacebookPosts(token, accountId, range.since, range.until, live), `${k}:posts`, ready && tab === 'content', opts);
  const reels = useLive(() => fetchFacebookReels(token, accountId, range.since, range.until, live), `${k}:reels`, ready && tab === 'video', opts);
  const audience = useLive(() => fetchFacebookAudience(token, accountId), `fb:audience:${accountId}:${refreshKey}`, Boolean(accountId) && tab === 'audience', opts);

  if (pagesState.error) return <Shell><div className="error-banner" role="alert"><span>{pagesState.error}</span></div></Shell>;
  if (pages && pages.length === 0) {
    return (
      <Shell>
        <div className="ws-empty ws-empty-cta">
          <h3>Connect your Facebook Page</h3>
          <p>Press Connect Facebook on the Accounts page and tick the Pages you manage. Their insights show up here.</p>
          <Link className="btn btn-primary" to="/accounts">Connect Facebook</Link>
        </div>
      </Shell>
    );
  }

  if (!pages) return <PageSkeleton label="Loading your Facebook Page…" />;

  const page = pages.find((pg) => String(pg.id) === accountId);
  const p = profile.data;
  const title = p?.name ?? page?.name ?? 'Facebook Page';
  const avatar = p?.picture_url || page?.picture_url;
  // Saves the latest 30 days, posts and reels for this Page, then reloads what's on screen.
  const update = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const result = await syncNow(token, 'facebook', accountId);
      setSyncResult(result);
      invalidateLiveCache('fb:', 'overview:');
      setRefreshKey((n) => n + 1);
    } catch (err) {
      setSyncError(errorMessage(err, 'Update failed'));
    } finally {
      setSyncing(false);
    }
  };
  const d = daily.data;

  return (
    <Shell>
      <section className="ws-profile">
        <div className="ws-avatar" aria-hidden="true">{avatar ? <img src={avatar} alt="" /> : title.charAt(0).toUpperCase()}</div>
        <div className="ws-profile-main">
          <h2>{p?.link ? <a href={p.link} target="_blank" rel="noreferrer">{title}</a> : title}</h2>
          {(p?.username || p?.category) && <span className="ws-handle">{[p.username && `@${p.username}`, p.category].filter(Boolean).join(' · ')}</span>}
          {p?.about && <p className="ws-bio">{p.about}</p>}
          {p?.website && <p className="ws-profile-note"><a href={p.website} target="_blank" rel="noreferrer">{p.website}</a></p>}
          {profile.error && <p className="ws-profile-note">Live Page details unavailable. {profile.error}</p>}
        </div>
        {p && (
          <dl className="ws-profile-stats">
            <div><dd>{formatCompact(p.followers)}</dd><dt>Followers</dt></div>
            {p.likes !== null && <div><dd>{formatCompact(p.likes)}</dd><dt>Likes</dt></div>}
            {p.talking_about !== null && <div><dd>{formatCompact(p.talking_about)}</dd><dt>Talking about</dt></div>}
          </dl>
        )}
      </section>

      <section className="ws-toolbar" aria-label="Filters">
        {pages && pages.length > 1 && (
          <label className="ws-field">
            <span className="ws-field-label">Page</span>
            <select value={accountId} onChange={(e) => setPicked(e.target.value)}>
              {pages.map((pg) => <option key={pg.id} value={String(pg.id)}>{pg.name}</option>)}
            </select>
          </label>
        )}
        <RangePicker value={range} onChange={setRange} />
        <div className="ws-toolbar-right">
          {d?.source === 'live' && <span className="ws-updated">Live from Facebook, fetched {timeAgo(d.fetched_at)}</span>}
          {d?.source === 'stored' && d.last_synced_at && <span className="ws-updated">Data updated {timeAgo(d.last_synced_at)}</span>}
          <button className="btn btn-primary" onClick={update} disabled={syncing || !accountId}>{syncing ? 'Updating…' : 'Update data'}</button>
        </div>
      </section>

      {syncError && <div className="error-banner" role="alert"><span>{syncError}</span></div>}
      {syncResult && !syncing && <SyncReport result={syncResult} />}
      {d?.source === 'live' && !live && (
        <div className="ws-notice">Nothing was saved for this Page yet, so these numbers are live from Facebook. They’re being saved now and every night from here on.</div>
      )}

      {daily.data && (daily.data.unavailable?.length ?? 0) > 0 && (
        <div className="ws-notice">
          Facebook didn’t return {daily.data.unavailable.map((u) => FB_METRICS[u.metric]?.label.toLowerCase() ?? u.metric).join(', ')} for this Page, so {daily.data.unavailable.length === 1 ? 'it is' : 'they are'} hidden.
        </div>
      )}

      <nav className="ws-tabs" aria-label="Facebook sections">
        {TABS.map((t) => (
          <NavLink key={t.key} to={`/facebook${t.path}${accountId ? `?account=${accountId}` : ''}`} end className={({ isActive }) => `ws-tab ${isActive ? 'active' : ''}`}>
            {t.label}
          </NavLink>
        ))}
      </nav>

      <div className="ws-body">
        {tab === 'content' ? (
          <LiveBlock state={posts} skeleton={<div className="sk-card"><SectionSkeleton variant="table" rows={6} label="Loading posts…" /></div>}>
            {(r) => (r.unavailable ? <p className="trends-empty-inline">{r.reason}</p> : <FbContentTab posts={r.posts} withInsights={r.insights !== false} />)}
          </LiveBlock>
        ) : (
          <LiveBlock state={daily} skeleton={<DashboardSkeleton kpis={tab === 'audience' ? 4 : 5} />}>
            {(d) => {
              if (tab === 'video') return <FbVideoTab data={d} reels={reels.data ? (reels.data.unavailable ? [] : reels.data.reels) : null} reelsError={reels.error ?? (reels.data?.unavailable ? reels.data.reason ?? 'Facebook didn’t return your reels.' : null)} />;
              if (tab === 'audience') return <FbAudienceTab data={d} audience={audience.data ?? null} audienceError={audience.error} profile={p ?? null} />;
              return <FbOverviewTab data={d} profile={p ?? null} />;
            }}
          </LiveBlock>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="ws platform-facebook">
      <main className="ws-main">{children}</main>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, useParams, useSearchParams } from 'react-router-dom';
import {
  fetchHistory,
  fetchStoredMedia,
  getInstagramAccounts,
  getLinkedInAccounts,
  getYoutubeAccounts,
  syncNow,
  type HistoryResponse,
  type Platform,
  type StoredMedia,
  type SyncResult,
} from '../../services/api';
import { errorMessage } from '../../utils/errors';
import { timeAgo } from '../../utils/dates';
import { ProfileHeader } from './ProfileHeader';
import { RangePicker } from './RangePicker';
import { presetRange, type RangeValue } from './range';
import { OverviewTab } from './OverviewTab';
import { ContentTab } from './ContentTab';
import { AudienceTab } from './AudienceTab';
import { DataTab } from './DataTab';
import { ResearchTab } from './ResearchTab';
import { StrategyTab } from './StrategyTab';
import '../../assets/css/workspace.css';

const TABS = [
  { key: 'overview', label: 'Overview', path: '' },
  { key: 'content', label: 'Content', path: '/content' },
  { key: 'audience', label: 'Audience', path: '/audience' },
  { key: 'strategy', label: 'Strategy', path: '/strategy' },
  { key: 'research', label: 'Research', path: '/research' },
  { key: 'data', label: 'Data', path: '/data' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

interface AccountOption {
  id: string | number;
  name: string;
}

const PLATFORM_NAME: Record<Platform, string> = { instagram: 'Instagram', youtube: 'YouTube', linkedin: 'LinkedIn' };
const PLATFORMS: Platform[] = ['instagram', 'youtube', 'linkedin'];
// Strategy and Research are built around Instagram and YouTube data; LinkedIn gets the other four.
const LINKEDIN_TABS = new Set<TabKey>(['overview', 'content', 'audience', 'data']);
const tabsFor = (platform: Platform) => TABS.filter((t) => platform !== 'linkedin' || LINKEDIN_TABS.has(t.key));

export default function PlatformPage({ token }: { token: string }) {
  const { platform, tab } = useParams();
  if (!PLATFORMS.includes(platform as Platform)) return <Navigate to="/overview" replace />;
  const p = platform as Platform;
  if (tab !== undefined && !tabsFor(p).some((t) => t.key === tab && t.key !== 'overview')) return <Navigate to={`/${p}`} replace />;
  return <Workspace key={p} token={token} platform={p} tab={(tab as TabKey | undefined) ?? 'overview'} />;
}

function Workspace({ token, platform, tab }: { token: string; platform: Platform; tab: TabKey }) {
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  const [accountId, setAccountId] = useState('');
  const [range, setRange] = useState<RangeValue>(() => presetRange(30));
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [media, setMedia] = useState<StoredMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [tick, setTick] = useState(0);
  const [searchParams] = useSearchParams();
  const requestedAccount = searchParams.get('account');

  const rangeValid = range.since <= range.until;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list =
          platform === 'instagram'
            ? (await getInstagramAccounts(token)).map((a) => ({ id: a.id, name: a.page_name }))
            : platform === 'linkedin'
              ? (await getLinkedInAccounts(token)).accounts.map((a) => ({ id: a.id, name: a.name }))
              : (await getYoutubeAccounts(token)).map((a) => ({ id: a.id, name: a.channel_name }));
        if (cancelled) return;
        setAccounts(list);
        const requested = list.find((a) => String(a.id) === requestedAccount);
        setAccountId(String((requested ?? list[0])?.id ?? ''));
        if (!list.length) setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setAccounts([]);
        setError(errorMessage(err, 'Failed to load accounts'));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, token, requestedAccount]);

  useEffect(() => {
    if (!accountId || !rangeValid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [h, m] = await Promise.all([
          fetchHistory(token, platform, { accountId, since: range.since, until: range.until }),
          fetchStoredMedia(token, platform, accountId),
        ]);
        if (cancelled) return;
        setHistory(h);
        setMedia(m);
      } catch (err) {
        if (cancelled) return;
        setHistory(null);
        setMedia([]);
        setError(errorMessage(err, 'Failed to load stored data'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, platform, accountId, range.since, range.until, rangeValid, tick]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const result = await syncNow(token, platform, accountId || undefined);
      setSyncResult(result);
      if (result.results.length) setTick((t) => t + 1);
    } catch (err) {
      setError(errorMessage(err, 'Update failed'));
    } finally {
      setSyncing(false);
    }
  }, [token, platform, accountId]);

  const account = accounts?.find((a) => String(a.id) === accountId);
  const hasData = !!history && history.coverage.days_with_data > 0;
  const name = PLATFORM_NAME[platform];

  const body = useMemo(() => {
    if (!account) return null;
    const live = { token, accountId, since: range.since, until: range.until };
    // These tabs call the platform APIs directly, so they work before any history is stored.
    if (tab === 'audience') return <AudienceTab platform={platform} {...live} />;
    if (tab === 'research') return <ResearchTab platform={platform} {...live} media={media} />;
    if (tab === 'strategy' && platform === 'youtube') return <StrategyTab platform={platform} media={media} {...live} />;

    if (loading) return <div className="trends-loading"><div className="spinner large" /></div>;
    if (!history || !hasData) {
      return (
        <div className="ws-empty ws-empty-cta">
          <h3>No data stored yet for this period</h3>
          <p>
            Press <b>Update data</b> to copy your latest {name} numbers into your dashboard. It takes a few seconds, and after that
            it refreshes automatically every night.
          </p>
          <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>{syncing ? 'Updating…' : 'Update data'}</button>
        </div>
      );
    }
    if (tab === 'content') return <ContentTab platform={platform} media={media} {...live} />;
    if (tab === 'strategy') return <StrategyTab platform={platform} media={media} {...live} />;
    if (tab === 'data') return <DataTab platform={platform} history={history} />;
    return <OverviewTab platform={platform} history={history} media={media} />;
  }, [account, tab, platform, token, accountId, range.since, range.until, loading, history, hasData, media, name, handleSync, syncing]);

  if (accounts && accounts.length === 0 && !error) {
    return (
      <div className={`ws platform-${platform}`}>
        <main className="ws-main">
          <div className="ws-empty ws-empty-cta">
            <h3>Connect your {name} {platform === 'linkedin' ? 'company page' : 'account'}</h3>
            <p>
              {platform === 'linkedin'
                ? 'Press Connect LinkedIn on the Accounts page and sign in as a page admin. Every company page you manage is added.'
                : `Add your ${platform === 'instagram' ? 'Instagram professional account' : 'YouTube channel'} to start seeing your analytics here.`}
            </p>
            <Link className="btn btn-primary" to="/accounts">{platform === 'linkedin' ? 'Connect LinkedIn' : 'Add an account'}</Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={`ws platform-${platform}`}>
      <main className="ws-main">
        {account && <ProfileHeader platform={platform} token={token} accountId={accountId} accountName={account.name} />}

        <section className="ws-toolbar" aria-label="Filters">
          {accounts && accounts.length > 1 && (
            <label className="ws-field">
              <span className="ws-field-label">Account</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
              </select>
            </label>
          )}
          <RangePicker value={range} onChange={setRange} />
          <div className="ws-toolbar-right">
            {history?.last_synced_at && <span className="ws-updated">Data updated {timeAgo(history.last_synced_at)}</span>}
            <button className="btn btn-primary" onClick={handleSync} disabled={syncing || !accountId}>{syncing ? 'Updating…' : 'Update data'}</button>
          </div>
        </section>

        {error && <div className="error-banner" role="alert"><span>{error}</span></div>}
        {syncResult?.errors.map((e) => (
          <div key={`${e.platform}-${e.account_id}`} className="error-banner" role="alert">
            <span>
              Could not update {e.platform} account {e.account_id} (error {e.code}{e.reason ? ` · ${e.reason}` : ''}): {e.message}
            </span>
          </div>
        ))}
        {syncResult && syncResult.results.length > 0 && (
          <div className="ws-notice" role="status">
            Updated: {syncResult.results.map((r) => `${r.days_synced} days and ${r.media_snapshots} ${platform === 'youtube' ? 'videos' : 'posts'}`).join(', ')}.
          </div>
        )}
        {history && hasData && history.coverage.days_with_data < history.range.days && ['overview', 'data'].includes(tab) && (
          <div className="ws-notice">
            Showing {history.coverage.days_with_data} of {history.range.days} days. The rest are not stored yet
            {platform === 'instagram'
              ? ' (Instagram only provides about 30 days of daily history).'
              : platform === 'linkedin'
                ? ' (LinkedIn keeps 12 months of daily history and can lag by a day or two).'
                : '.'}
          </div>
        )}

        <nav className="ws-tabs" aria-label={`${name} sections`}>
          {tabsFor(platform).map((t) => (
            <NavLink key={t.key} to={`/${platform}${t.path}`} end className={({ isActive }) => `ws-tab ${isActive ? 'active' : ''}`}>
              {t.label}
            </NavLink>
          ))}
        </nav>

        <div className="ws-body">{body}</div>
      </main>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import {
  getInstagramAccounts,
  fetchConsolidatedInstagramDashboard,
  type User,
  type InstagramAccount,
  type ConsolidatedDashboardResponse,
} from '../services/api';

import '../assets/css/Dashboard.css';

interface DashboardProps {
  token: string;
  user: User;
  onLogout: () => void;
}

type PanelView = 'overview' | 'media' | 'raw';
type MediaFilter = 'ALL' | 'REELS' | 'FEED';

const LIMIT_OPTIONS = [7, 14, 21, 28, 35];

const WEEKLY_METRICS: { name: string; label: string; icon: React.ReactNode; subLabel: string }[] = [
  { name: 'reach', label: 'Weekly Reach', icon: <IconEye />, subLabel: 'Unique accounts reached (7D)' },
  { name: 'views', label: 'Weekly Views', icon: <IconPlay />, subLabel: 'Video impressions (7D)' },
  { name: 'total_interactions', label: 'Weekly Interactions', icon: <IconBolt />, subLabel: 'Account actions (7D)' },
  { name: 'accounts_engaged', label: 'Weekly Engaged', icon: <IconUsers />, subLabel: 'Engaged accounts (7D)' },
];

const DAILY_METRICS: { name: string; label: string; icon: React.ReactNode; subLabel: string }[] = [
  { name: 'likes', label: 'Likes', icon: <IconHeart />, subLabel: 'Likes received in the last 24 hours' },
  { name: 'comments', label: 'Comments', icon: <IconComment />, subLabel: 'Comments in the last 24 hours' },
  { name: 'saves', label: 'Saves', icon: <IconBookmark />, subLabel: 'Saves in the last 24 hours' },
  { name: 'shares', label: 'Shares', icon: <IconShare />, subLabel: 'Shares in the last 24 hours' },
  { name: 'profile_links_taps', label: 'Link taps', icon: <IconExternal />, subLabel: 'Bio link taps in the last 24 hours' },
  { name: 'follower_count', label: 'New followers', icon: <IconUsers />, subLabel: 'Net follower change in the last 24 hours' },
];

export const Dashboard: React.FC<DashboardProps> = ({ token, user, onLogout }) => {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | number>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [consolidatedData, setConsolidatedData] = useState<ConsolidatedDashboardResponse | null>(null);
  const [consolidatedLoading, setConsolidatedLoading] = useState(false);
  const [panelView, setPanelView] = useState<PanelView>('overview');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('ALL');
  const [mediaLimit, setMediaLimit] = useState<number>(7);
  const [copiedJson, setCopiedJson] = useState(false);

  const loadDashboardData = async (limitOverride?: number) => {
    setLoading(true);
    setError(null);
    try {
      const accData = await getInstagramAccounts(token);
      setAccounts(accData);
      if (accData.length > 0) {
        const initialAccountId = selectedAccountId || accData[0].id;
        setSelectedAccountId(initialAccountId);
        setConsolidatedLoading(true);
        const summary = await fetchConsolidatedInstagramDashboard(
          token,
          initialAccountId,
          '2026-08-01',
          '2026-08-31',
          limitOverride || mediaLimit
        );
        setConsolidatedData(summary);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load consolidated dashboard data');
    } finally {
      setLoading(false);
      setConsolidatedLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleAccountChange = async (accountId: string | number) => {
    setSelectedAccountId(accountId);
    setConsolidatedLoading(true);
    setError(null);
    try {
      const summary = await fetchConsolidatedInstagramDashboard(token, accountId, '2026-08-01', '2026-08-31', mediaLimit);
      setConsolidatedData(summary);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch metrics for selected account');
    } finally {
      setConsolidatedLoading(false);
    }
  };

  const handleLimitChange = async (limit: number) => {
    setMediaLimit(limit);
    if (!selectedAccountId) return;
    setConsolidatedLoading(true);
    setError(null);
    try {
      const summary = await fetchConsolidatedInstagramDashboard(token, selectedAccountId, '2026-08-01', '2026-08-31', limit);
      setConsolidatedData(summary);
    } catch (err: any) {
      setError(err.message || 'Failed to reload metrics with selected limit');
    } finally {
      setConsolidatedLoading(false);
    }
  };

  const weeklyByName = useMemo(() => {
    const map = new Map<string, any>();
    (consolidatedData?.summary?.weekly_metrics || []).forEach((m: any) => map.set(m.name, m));
    return map;
  }, [consolidatedData]);

  const dailyByName = useMemo(() => {
    const map = new Map<string, any>();
    (consolidatedData?.summary?.daily_metrics || []).forEach((m: any) => map.set(m.name, m));
    return map;
  }, [consolidatedData]);

  const followerTrend = consolidatedData?.summary?.follower_trend?.[0]?.values || [];
  const netFollowers = followerTrend.reduce((sum: number, v: any) => sum + (v.value || 0), 0);

  const filteredMedia = useMemo(() => {
    const items = consolidatedData?.summary?.media || [];
    if (mediaFilter === 'ALL') return items;
    return items.filter((item: any) => item.media_product_type === mediaFilter || item.media_type === mediaFilter);
  }, [consolidatedData, mediaFilter]);

  const handleCopyJson = () => {
    if (!consolidatedData) return;
    navigator.clipboard.writeText(JSON.stringify(consolidatedData, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };
  const todayFollowerDelta =
    followerTrend.length > 0 ? followerTrend[followerTrend.length - 1]?.value ?? 0 : undefined;

  return (
    <div className="dashboard-container">
      {/* Top Navbar */}
      <header className="navbar">
        <div className="nav-brand">
          <div className="brand-icon-wrapper">
            <IconSparkles />
          </div>
          <span className="brand-title">CMS Analytics Studio</span>
        </div>

        <div className="nav-user">
          <div className="user-badge">
            <div className="avatar-circle">{user.username.charAt(0).toUpperCase()}</div>
            <div className="user-meta">
              <span className="user-name">@{user.username}</span>
              <span className="user-email">{user.email_address}</span>
            </div>
          </div>
          <button onClick={onLogout} className="logout-btn" title="Sign Out">
            <IconLogOut />
            Logout
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="dashboard-main">
        {/* Error Banner */}
        {error && (
          <div className="error-banner">
            <IconAlert />
            <span>{error}</span>
          </div>
        )}

        {/* Account Selector Ribbon */}
        <section className="account-selector-ribbon">
          <div className="ribbon-info">
            <h2>Active Instagram Account</h2>
            <p>Select connected account to stream live Graph API analytics</p>
          </div>

          {loading ? (
            <div className="spinner" />
          ) : accounts.length === 0 ? (
            <p className="empty-subtext">No accounts connected.</p>
          ) : (
            <div className="account-select-wrapper">
              <select
                id="account-dropdown"
                className="account-dropdown-select"
                value={selectedAccountId}
                onChange={(e) => handleAccountChange(e.target.value)}
                disabled={consolidatedLoading}
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    📸 {acc.page_name} (ID: {acc.page_id})
                  </option>
                ))}
              </select>
              <div className="select-icon-arrow">
                <IconChevron />
              </div>
            </div>
          )}
        </section>

        {/* Executive KPI Metric Tiles: BOTH Weekly & Daily Metrics */}
        <section className="kpi-executive-section">
          {/* Weekly Metrics Group */}
          <div className="kpi-group">
            <div className="kpi-group-header">
              <span className="kpi-group-title">📅 Weekly Executive Metrics (7D)</span>
              <span className="metric-tile__badge indigo">Weekly 7D</span>
            </div>
            <div className="metric-row">
              {WEEKLY_METRICS.map(({ name, label, icon, subLabel }) => {
                const metric = weeklyByName.get(name);
                const val = metric?.total_value?.value;
                const dailyVal = dailyByName.get(name)?.total_value?.value;
                return (
                  <div className="metric-tile metric-tile--weekly" key={`weekly-${name}`}>
                    <div className="metric-tile__head">
                      <div className="metric-tile__icon">{icon}</div>
                      <span className="metric-tile__badge indigo">7D</span>
                    </div>
                    <div className="metric-tile__value">{formatNumber(val)}</div>
                    <div className="metric-tile__footer">
                      <div className="metric-tile__label">{label}</div>
                      <span className="empty-subtext">{subLabel}</span>

                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Daily Metrics Group */}
          <div className="kpi-group" style={{ marginTop: '24px' }}>
            <div className="kpi-group-header">
              <span className="kpi-group-title">
                <IconBolt />
                Daily snapshot
              </span>
              <span className="kpi-group-badge">Last 24h</span>
            </div>
            <div className="daily-kpi-grid">
              {DAILY_METRICS.map(({ name, label, icon, subLabel }) => {
                const val =
                  name === 'follower_count' ? todayFollowerDelta : dailyByName.get(name)?.total_value?.value;
                return (
                  <div className="daily-tile" key={`daily-${name}`} title={subLabel}>
                    <div className="daily-tile__icon">{icon}</div>
                    <div className="daily-tile__value">{formatNumber(val)}</div>
                    <div className="daily-tile__label">{label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Main Analytics Panel */}
        {accounts.length > 0 && (
          <section className="db-panel">
            <div className="db-panel__header">
              <div className="panel-title-group">
                <h2>
                  {consolidatedData?.account?.page_name || 'Instagram Analytics'}
                  <span className="live-badge">
                    <span className="dot" /> Synchronized
                  </span>
                </h2>
                <p className="db-panel__sub">
                  {consolidatedData?.fetched_at
                    ? `Last updated ${formatRelativeTime(consolidatedData.fetched_at)}`
                    : 'Awaiting data stream...'}
                </p>
              </div>

              {/* Segmented Control Tabs */}
              <div className="db-tabs" role="tablist">
                {(['overview', 'media', 'raw'] as PanelView[]).map((v) => (
                  <button
                    key={v}
                    role="tab"
                    aria-selected={panelView === v}
                    className={`db-tab ${panelView === v ? 'is-active' : ''}`}
                    onClick={() => setPanelView(v)}
                  >
                    {v === 'overview' && <IconChartBar />}
                    {v === 'media' && <IconCamera />}
                    {v === 'raw' && <IconCode />}
                    {v === 'overview' ? 'Overview' : v === 'media' ? `Media (${consolidatedData?.summary?.media?.length || 0})` : 'Raw JSON'}
                  </button>
                ))}
              </div>
            </div>

            {consolidatedLoading ? (
              <div className="loading-state">
                <div className="spinner large" />
                <p>Fetching real-time analytics from Instagram Graph API...</p>
              </div>
            ) : panelView === 'overview' ? (
              <>
                <div className="db-row">
                  {/* Follower Growth Analytics */}
                  <div className="trend-card">
                    <div className="trend-card__head">
                      <div>
                        <h3>Follower Growth Velocity</h3>
                        <p className="db-panel__sub">Daily net follower changes over 30 days</p>
                      </div>
                      <div className="trend-card__total">
                        {netFollowers >= 0 ? '+' : ''}
                        {netFollowers}
                        <span className="trend-card__period">net total</span>
                      </div>
                    </div>
                    {followerTrend.length > 0 ? (
                      <FollowerBars values={followerTrend} />
                    ) : (
                      <p className="empty-subtext">No historical follower trend available.</p>
                    )}
                  </div>

                  {/* Engagement Breakdown */}
                  <div className="engagement-card">
                    <div>
                      <h3>Audience Engagement Matrix</h3>
                      <p className="db-panel__sub">Key action breakdowns</p>
                    </div>
                    <ul className="engagement-list">
                      {DAILY_METRICS.slice(0, 4).map(({ name, label, icon }) => {
                        const val = dailyByName.get(name)?.total_value?.value;
                        return (
                          <li key={name} className="engagement-item">
                            <div className="engagement-item__icon">{icon}</div>
                            <div className="engagement-item__info">
                              <span className="engagement-item__label">{label}</span>
                              <span className="engagement-item__value">{formatNumber(val)}</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </>
            ) : panelView === 'media' ? (
              <div className="media-section-wrapper">
                {/* Media Control Toolbar */}
                <div className="media-toolbar">
                  <div className="media-filter-bar">
                    <span className="empty-subtext">Type:</span>
                    {(['ALL', 'REELS', 'FEED'] as MediaFilter[]).map((f) => (
                      <button
                        key={f}
                        className={`filter-chip ${mediaFilter === f ? 'active' : ''}`}
                        onClick={() => setMediaFilter(f)}
                      >
                        {f}
                      </button>
                    ))}
                  </div>

                  {/* Dynamic Limit Selector */}
                  <div className="media-limit-bar">
                    <span className="empty-subtext">Fetch Limit:</span>
                    {LIMIT_OPTIONS.map((lim) => (
                      <button
                        key={lim}
                        className={`limit-chip ${mediaLimit === lim ? 'active' : ''}`}
                        onClick={() => handleLimitChange(lim)}
                        disabled={consolidatedLoading}
                      >
                        {lim} items
                      </button>
                    ))}
                  </div>
                </div>

                {/* Media Grid Cards */}
                <div className="media-list-grid">
                  {filteredMedia.length > 0 ? (
                    filteredMedia.map((item: any) => <MediaRow key={item.id} item={item} />)
                  ) : (
                    <p className="empty-subtext">No media content found matching current filter.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="api-result-box">
                <div className="result-header">
                  <span>GET /api/instagram/dashboard-summary?accountId={selectedAccountId}&limit={mediaLimit}</span>
                  <button onClick={handleCopyJson} className="copy-json-btn">
                    <IconCopy />
                    {copiedJson ? 'Copied to Clipboard!' : 'Copy Solidified JSON'}
                  </button>
                </div>
                <pre className="json-display">{JSON.stringify(consolidatedData, null, 2)}</pre>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
};

// ---------- Subcomponents ----------

function MediaRow({ item }: { item: any }) {
  const { text, tags } = splitCaption(item.caption || '');
  const typeLabel = item.media_product_type === 'REELS' ? 'Reel' : item.media_product_type === 'FEED' ? 'Post' : item.media_type || 'Post';
  const posterUrl = item.thumbnail_url || (item.media_type !== 'VIDEO' ? item.media_url : null);

  return (
    <article className="media-card-luxury">
      <div className="media-card-thumb-container">
        {posterUrl ? (
          <img src={posterUrl} alt="Post preview" className="media-card-img" loading="lazy" />
        ) : (
          <div className="media-card-placeholder">
            <IconCamera />
          </div>
        )}
        <div className="media-card-type-tag">{typeLabel}</div>
      </div>

      <div className="media-card-content">
        <div className="media-card-header">
          <span className="media-card-shortcode">#{item.shortcode || item.id}</span>
          <span className="media-card-time">{formatRelativeTime(item.timestamp)}</span>
        </div>

        <p className="media-card-caption">{truncate(text, 140)}</p>

        {tags.length > 0 && (
          <div className="media-card-tags">
            {tags.slice(0, 4).map((t) => (
              <span key={t} className="tag-chip">
                #{t}
              </span>
            ))}
            {tags.length > 4 && <span className="tag-chip tag-chip--muted">+{tags.length - 4}</span>}
          </div>
        )}

        <div className="media-card-footer">
          <div className="media-stats-group">
            <span className="media-stat-pill" title="Likes">
              <IconHeart /> {formatNumber(item.like_count || 0)}
            </span>
            <span className="media-stat-pill" title="Comments">
              <IconComment /> {formatNumber(item.comments_count || 0)}
            </span>
            {item.is_comment_enabled !== undefined && (
              <span className={`comment-status-pill ${item.is_comment_enabled ? 'enabled' : 'disabled'}`}>
                {item.is_comment_enabled ? 'Comments On' : 'Comments Off'}
              </span>
            )}
          </div>

          {item.permalink && (
            <a href={item.permalink} target="_blank" rel="noreferrer" className="media-row__link" title="Open on Instagram">
              View Post <IconExternal />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function FollowerBars({ values }: { values: { value: number; end_time: string }[] }) {
  const max = Math.max(1, ...values.map((v) => v.value));
  return (
    <div className="follower-bars-wrapper">
      <div className="follower-bars">
        {values.map((v, i) => (
          <div
            key={i}
            className="follower-bars__bar"
            style={{ height: `${Math.max(8, (v.value / max) * 100)}%` }}
            title={`${new Date(v.end_time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: +${v.value}`}
          />
        ))}
      </div>
      <div className="chart-axis">
        <span>30 Days Ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}

// ---------- Helpers ----------

function formatNumber(n: number | undefined | null) {
  if (n === undefined || n === null) return '0';
  return new Intl.NumberFormat().format(n);
}

function formatRelativeTime(iso: string) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffH = Math.round((now - then) / 3.6e6);
  if (diffH < 1) return 'just now';
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function truncate(text: string, max: number) {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max).trim()}…` : clean;
}

function splitCaption(caption: string): { text: string; tags: string[] } {
  const tags = Array.from(caption.matchAll(/#(\w+)/g)).map((m) => m[1]);
  const text = caption.replace(/#\w+/g, '').replace(/\n{2,}/g, '\n').trim();
  return { text, tags };
}

// ---------- Icons ----------

function IconSparkles() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
    </svg>
  );
}
function IconEye() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconPlay() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5v7l6-3.5-6-3.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconBolt() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3" />
      <path d="M2 20c0-3.3 3-6 7-6s7 2.7 7 6" />
      <path d="M16 4.5c1.7.4 3 2 3 3.9 0 1.9-1.3 3.5-3 3.9" />
      <path d="M22 20c0-2.8-2.2-5.1-5-5.8" />
    </svg>
  );
}
function IconHeart() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 20.5s-7.5-4.6-9.6-9C.9 7.8 2.6 4 6.4 4c2 0 3.6 1.2 5.6 3.3C14 5.2 15.6 4 17.6 4c3.8 0 5.5 3.8 4 7.5-2.1 4.4-9.6 9-9.6 9Z" />
    </svg>
  );
}
function IconComment() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 12a8 8 0 1 1-3.3-6.4L21 4l-1 3.9A7.9 7.9 0 0 1 21 12Z" />
    </svg>
  );
}
function IconBookmark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 3h12v18l-6-4-6 4V3Z" />
    </svg>
  );
}
function IconShare() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.3 10.7 15.7 6.5M8.3 13.3l7.4 4.2" />
    </svg>
  );
}
function IconCamera() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 8h3l2-2h6l2 2h3v11H4V8Z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  );
}
function IconChartBar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  );
}
function IconCode() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}
function IconChevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
function IconExternal() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}
function IconAlert() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 9v5M12 17h.01" />
    </svg>
  );
}
function IconCopy() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function IconLogOut() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
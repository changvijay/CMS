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
  onLogout?: () => void;
  onSwitchPlatform?: (platform: 'instagram' | 'youtube') => void;
  currentPlatform?: 'instagram' | 'youtube';
}

type PanelView = 'overview' | 'media' | 'raw';
type MediaFilter = 'ALL' | 'REELS' | 'FEED' | 'TOP_PERFORMERS';

const LIMIT_OPTIONS = [7, 10, 14, 21, 28, 35];

const getMetricsArray = (rawMetrics: any): any[] => {
  if (Array.isArray(rawMetrics)) return rawMetrics;
  if (Array.isArray(rawMetrics?.data)) return rawMetrics.data;
  return [];
};

const getMetricValue = (metricItem: any): number | undefined => {
  if (!metricItem) return undefined;
  if (typeof metricItem.total_value?.value === 'number') return metricItem.total_value.value;
  if (typeof metricItem.value === 'number') return metricItem.value;
  if (Array.isArray(metricItem.values) && metricItem.values.length > 0) {
    const lastVal = metricItem.values[metricItem.values.length - 1];
    if (typeof lastVal?.value === 'number') return lastVal.value;
    if (typeof lastVal === 'number') return lastVal;
  }
  return undefined;
};

const WEEKLY_METRICS: { name: string; label: string; icon: React.ReactNode; subLabel: string }[] = [
  { name: 'reach', label: 'Reach', icon: <IconEye />, subLabel: 'Unique accounts reached' },
  { name: 'views', label: 'Views', icon: <IconPlay />, subLabel: 'Video impressions' },
  { name: 'total_interactions', label: 'Interactions', icon: <IconBolt />, subLabel: 'Account actions' },
  { name: 'accounts_engaged', label: 'Engaged', icon: <IconUsers />, subLabel: 'Engaged accounts' },
];

const DAILY_METRICS: { name: string; label: string; icon: React.ReactNode; subLabel: string }[] = [
  { name: 'reach', label: 'Reach', icon: <IconEye />, subLabel: 'Daily accounts reached' },
  { name: 'views', label: 'Views', icon: <IconPlay />, subLabel: 'Daily content views' },
  { name: 'total_interactions', label: 'Interactions', icon: <IconBolt />, subLabel: 'Daily content interactions' },
  { name: 'accounts_engaged', label: 'Engaged', icon: <IconUsers />, subLabel: 'Daily engaged accounts' },
  { name: 'likes', label: 'Likes', icon: <IconHeart />, subLabel: 'Likes received in the last 24 hours' },
  { name: 'comments', label: 'Comments', icon: <IconComment />, subLabel: 'Comments in the last 24 hours' },
  { name: 'saves', label: 'Saves', icon: <IconBookmark />, subLabel: 'Saves in the last 24 hours' },
  { name: 'shares', label: 'Shares', icon: <IconShare />, subLabel: 'Shares in the last 24 hours' },
  { name: 'profile_links_taps', label: 'Link taps', icon: <IconExternal />, subLabel: 'Bio link taps in the last 24 hours' },
  { name: 'follower_count', label: 'New followers', icon: <IconUsers />, subLabel: 'Net follower change in the last 24 hours' },
];

export const Dashboard: React.FC<DashboardProps> = ({
  token,
}) => {
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
  const getInitialDateRange = () => {
    const untilObj = new Date();
    const sinceObj = new Date();
    sinceObj.setDate(untilObj.getDate() - 30);
    const formatDate = (d: Date) => d.toISOString().split('T')[0];
    return {
      since: formatDate(sinceObj),
      until: formatDate(untilObj),
    };
  };

  const initialDates = useMemo(() => getInitialDateRange(), []);
  const [sinceDate, setSinceDate] = useState<string>(initialDates.since);
  const [untilDate, setUntilDate] = useState<string>(initialDates.until);

  const loadDashboardData = async (limitOverride?: number, customSince?: string, customUntil?: string) => {
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
          customSince ?? sinceDate,
          customUntil ?? untilDate,
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
      const summary = await fetchConsolidatedInstagramDashboard(
        token,
        accountId,
        sinceDate,
        untilDate,
        mediaLimit,
        mediaFilter === 'TOP_PERFORMERS'
      );
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
      const summary = await fetchConsolidatedInstagramDashboard(
        token,
        selectedAccountId,
        sinceDate,
        untilDate,
        limit,
        mediaFilter === 'TOP_PERFORMERS'
      );
      setConsolidatedData(summary);
    } catch (err: any) {
      setError(err.message || 'Failed to reload metrics with selected limit');
    } finally {
      setConsolidatedLoading(false);
    }
  };

  const handleFilterChange = async (filter: MediaFilter) => {
    setMediaFilter(filter);
    if (!selectedAccountId) return;
    setConsolidatedLoading(true);
    setError(null);
    try {
      const summary = await fetchConsolidatedInstagramDashboard(
        token,
        selectedAccountId,
        sinceDate,
        untilDate,
        filter === 'TOP_PERFORMERS' ? 10 : mediaLimit,
        filter === 'TOP_PERFORMERS'
      );
      setConsolidatedData(summary);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch metrics for selected filter');
    } finally {
      setConsolidatedLoading(false);
    }
  };

  const handleDateChange = async (newSince: string, newUntil: string) => {
    setSinceDate(newSince);
    setUntilDate(newUntil);
    if (!selectedAccountId) return;
    setConsolidatedLoading(true);
    setError(null);
    try {
      const summary = await fetchConsolidatedInstagramDashboard(
        token,
        selectedAccountId,
        newSince,
        newUntil,
        mediaFilter === 'TOP_PERFORMERS' ? 10 : mediaLimit,
        mediaFilter === 'TOP_PERFORMERS'
      );
      setConsolidatedData(summary);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch metrics for selected date range');
    } finally {
      setConsolidatedLoading(false);
    }
  };

  const weeklyByName = useMemo(() => {
    const map = new Map<string, any>();
    getMetricsArray(consolidatedData?.summary?.weekly_metrics).forEach((m: any) => {
      if (m?.name) map.set(m.name, m);
    });

    const mediaItems = consolidatedData?.summary?.media || [];
    if (mediaItems.length > 0) {
      const mediaTotals: Record<string, number> = {
        reach: 0,
        views: 0,
        total_interactions: 0,
      };

      mediaItems.forEach((item: any) => {
        const insightsList = getMetricsArray(item?.insights);
        const getVal = (metricKey: string) => {
          const found = insightsList.find((m: any) => m.name === metricKey || (metricKey === 'saves' && m.name === 'saved'));
          return getMetricValue(found);
        };
        const r = getVal('reach') ?? 0;
        const v = getVal('views') ?? 0;
        const l = item.like_count ?? getVal('likes') ?? 0;
        const c = item.comments_count ?? getVal('comments') ?? 0;
        const s = getVal('saves') ?? 0;
        const sh = getVal('shares') ?? 0;

        mediaTotals.reach += r;
        mediaTotals.views += v;
        mediaTotals.total_interactions += (l + c + s + sh);
      });

      Object.entries(mediaTotals).forEach(([key, totalVal]) => {
        const existingVal = getMetricValue(map.get(key));
        if (existingVal === undefined || existingVal === 0) {
          if (totalVal > 0) {
            map.set(key, { name: key, total_value: { value: totalVal } });
          }
        }
      });
    }

    return map;
  }, [consolidatedData]);

  const dailyByName = useMemo(() => {
    const map = new Map<string, any>();
    getMetricsArray(consolidatedData?.summary?.daily_metrics).forEach((m: any) => {
      if (m?.name) map.set(m.name, m);
    });

    const mediaItems = consolidatedData?.summary?.media || [];
    if (mediaItems.length > 0) {
      const mediaTotals: Record<string, number> = {
        likes: 0,
        comments: 0,
        saves: 0,
        shares: 0,
        reach: 0,
        views: 0,
      };

      mediaItems.forEach((item: any) => {
        const insightsList = getMetricsArray(item?.insights);
        const getVal = (metricKey: string) => {
          const found = insightsList.find((m: any) => m.name === metricKey || (metricKey === 'saves' && m.name === 'saved'));
          return getMetricValue(found);
        };
        mediaTotals.likes += item.like_count ?? getVal('likes') ?? 0;
        mediaTotals.comments += item.comments_count ?? getVal('comments') ?? 0;
        mediaTotals.saves += getVal('saves') ?? 0;
        mediaTotals.shares += getVal('shares') ?? 0;
        mediaTotals.reach += getVal('reach') ?? 0;
        mediaTotals.views += getVal('views') ?? 0;
      });

      Object.entries(mediaTotals).forEach(([key, totalVal]) => {
        const existingVal = getMetricValue(map.get(key));
        if (existingVal === undefined || existingVal === 0) {
          if (totalVal > 0) {
            map.set(key, { name: key, total_value: { value: totalVal } });
          }
        }
      });
    }

    return map;
  }, [consolidatedData]);

  const followerTrend = useMemo(() => {
    const trend = consolidatedData?.summary?.follower_trend;
    if (!trend) return [];
    if (Array.isArray(trend)) {
      if (trend[0]?.values && Array.isArray(trend[0].values)) return trend[0].values;
      return trend;
    }
    if (Array.isArray((trend as any)?.data)) {
      const list = (trend as any).data;
      if (list[0]?.values && Array.isArray(list[0].values)) return list[0].values;
      return list;
    }
    return [];
  }, [consolidatedData]);

  const netFollowers = followerTrend.reduce((sum: number, v: any) => sum + (v.value || 0), 0);

  const filteredMedia = useMemo(() => {
    const items = [...(consolidatedData?.summary?.media || [])];
    if (mediaFilter === 'TOP_PERFORMERS') {
      items.sort((a: any, b: any) => getPerformanceScore(b) - getPerformanceScore(a));
      return items.slice(0, 10);
    }
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
      {/* Main Content Area */}
      <main className="dashboard-main">
        {/* Error Banner */}
        {error && (
          <div className="error-banner">
            <IconAlert />
            <span>{error}</span>
          </div>
        )}

        {/* Account Selector & Date Range Ribbon */}
        <section className="account-selector-ribbon">
          <div className="ribbon-info">
            <h2>Active Instagram Account & Date Window</h2>
            <p>Select connected account and custom date range for live Graph API analytics</p>
          </div>

          <div className="ribbon-controls">
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

            <div className="date-picker-wrapper">
              <span className="date-picker-label">From:</span>
              <input
                type="date"
                className="date-input"
                value={sinceDate}
                onChange={(e) => handleDateChange(e.target.value, untilDate)}
                disabled={consolidatedLoading}
                title="Start Date (since)"
              />
              <span className="date-picker-label">To:</span>
              <input
                type="date"
                className="date-input"
                value={untilDate}
                onChange={(e) => handleDateChange(sinceDate, e.target.value)}
                disabled={consolidatedLoading}
                title="End Date (until)"
              />
            </div>
          </div>
        </section>

        {/* Executive KPI Metric Tiles: BOTH Weekly & Daily Metrics */}
        <section className="kpi-executive-section">
          {/* Weekly Metrics Group */}
          <div className="kpi-group">
            <div className="kpi-group-header">
              <span className="kpi-group-title">📅 Last 28 Days Executive Metrics (7D)</span>
              <span className="metric-tile__badge indigo">Last 28 Days</span>
            </div>
            <div className="metric-row">
              {WEEKLY_METRICS.map(({ name, label, icon, subLabel }) => {
                const metric = weeklyByName.get(name);
                const val = getMetricValue(metric);
                return (
                  <div className="metric-tile metric-tile--weekly" key={`weekly-${name}`}>
                    <div className="metric-tile__head">
                      <div className="metric-tile__icon">{icon}</div>
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
                  name === 'follower_count' ? todayFollowerDelta : getMetricValue(dailyByName.get(name));
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
                        const val = getMetricValue(dailyByName.get(name));
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
                    <span className="empty-subtext">Filter:</span>
                    {(['ALL', 'REELS', 'FEED', 'TOP_PERFORMERS'] as MediaFilter[]).map((f) => (
                      <button
                        key={f}
                        className={`filter-chip ${mediaFilter === f ? 'active' : ''} ${f === 'TOP_PERFORMERS' ? 'top-performers-chip' : ''}`}
                        onClick={() => handleFilterChange(f)}
                        disabled={consolidatedLoading}
                      >
                        {f === 'TOP_PERFORMERS' ? '🔥 Top 10 Performers' : f}
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
                    filteredMedia.map((item: any, index: number) => (
                      <MediaRow
                        key={item.id}
                        item={item}
                        rank={mediaFilter === 'TOP_PERFORMERS' ? index + 1 : undefined}
                      />
                    ))
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

function getInsightValue(insights: any, metricName: string): number | undefined {
  if (!insights) return undefined;
  const list = Array.isArray(insights) ? insights : Array.isArray(insights?.data) ? insights.data : null;
  if (!list) return undefined;

  const item = list.find((m: any) => m.name === metricName || (metricName === 'saved' && m.name === 'saves'));
  if (!item) return undefined;

  if (typeof item.values?.[0]?.value === 'number') {
    return item.values[0].value;
  }
  if (typeof item.value === 'number') {
    return item.value;
  }
  return undefined;
}

function getPerformanceScore(item: any): number {
  if (!item) return 0;
  const reach = getInsightValue(item.insights, 'reach') || 0;
  const views = getInsightValue(item.insights, 'views') || 0;
  const likes = getInsightValue(item.insights, 'likes') ?? item.like_count ?? 0;
  const comments = getInsightValue(item.insights, 'comments') ?? item.comments_count ?? 0;
  const saved = getInsightValue(item.insights, 'saved') ?? getInsightValue(item.insights, 'saves') ?? 0;
  const shares = getInsightValue(item.insights, 'shares') || 0;
  return reach + views + likes * 2 + comments * 3 + saved * 4 + shares * 5;
}

function MediaRow({ item, rank }: { item: any; rank?: number }) {
  const { text, tags } = splitCaption(item.caption || '');
  const typeLabel = item.media_product_type === 'REELS' ? 'Reel' : item.media_product_type === 'FEED' ? 'Post' : item.media_type || 'Post';
  const posterUrl = item.thumbnail_url || (item.media_type !== 'VIDEO' ? item.media_url : null);

  const reach = getInsightValue(item.insights, 'reach');
  const views = getInsightValue(item.insights, 'views');
  const likes = getInsightValue(item.insights, 'likes') ?? item.like_count;
  const comments = getInsightValue(item.insights, 'comments') ?? item.comments_count;
  const saved = getInsightValue(item.insights, 'saved');
  const shares = getInsightValue(item.insights, 'shares');

  return (
    <article className="media-card">
      <div className="media-card-thumb">
        {posterUrl ? (
          <img src={posterUrl} alt="Post preview" className="media-card-img" loading="lazy" />
        ) : (
          <div className="media-card-placeholder" aria-hidden="true">
            <IconCamera />
          </div>
        )}
        <span className="media-card-type-tag">{typeLabel}</span>
        {rank && <span className="media-card-rank-tag">#{rank} Top</span>}

        {/* Primary metric lives on the thumbnail, Instagram-style */}
        {(reach !== undefined || views !== undefined) && (
          <span className="media-card-primary-stat">
            <IconPlay />
            {formatNumber(views ?? reach)}
          </span>
        )}
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
            {tags.length > 4 && (
              <span className="tag-chip tag-chip--muted">+{tags.length - 4}</span>
            )}
          </div>
        )}

        <div className="media-card-footer">
          <ul className="media-stats-group" aria-label="Post metrics">
            {reach !== undefined && (
              <li className="media-stat" aria-label={`${formatNumber(reach)} reach`}>
                <IconEye aria-hidden="true" /> {formatNumber(reach)}
              </li>
            )}
            <li className="media-stat" aria-label={`${formatNumber(likes)} likes`}>
              <IconHeart aria-hidden="true" /> {formatNumber(likes)}
            </li>
            <li className="media-stat" aria-label={`${formatNumber(comments)} comments`}>
              <IconComment aria-hidden="true" /> {formatNumber(comments)}
            </li>
            {saved !== undefined && (
              <li className="media-stat" aria-label={`${formatNumber(saved)} saves`}>
                <IconBookmark aria-hidden="true" /> {formatNumber(saved)}
              </li>
            )}
            {shares !== undefined && (
              <li className="media-stat" aria-label={`${formatNumber(shares)} shares`}>
                <IconShare aria-hidden="true" /> {formatNumber(shares)}
              </li>
            )}
          </ul>

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
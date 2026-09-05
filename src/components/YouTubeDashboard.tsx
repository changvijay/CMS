import React, { useEffect, useMemo, useState } from 'react';
import {
  getYoutubeAccounts,
  fetchConsolidatedYoutubeDashboard,
  type User,
  type YoutubeAccount,
  type ConsolidatedYoutubeDashboardResponse,
} from '../services/api';

import '../assets/css/Dashboard.css';

interface YouTubeDashboardProps {
  token: string;
  user: User;
  onLogout?: () => void;
  onSwitchPlatform?: (platform: 'instagram' | 'youtube') => void;
  currentPlatform?: 'instagram' | 'youtube';
}

type PanelView = 'overview' | 'videos' | 'raw';

export const YouTubeDashboard: React.FC<YouTubeDashboardProps> = ({
  token,
}) => {
  const [accounts, setAccounts] = useState<YoutubeAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | number>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [consolidatedData, setConsolidatedData] = useState<ConsolidatedYoutubeDashboardResponse | null>(null);
  const [consolidatedLoading, setConsolidatedLoading] = useState(false);
  const [panelView, setPanelView] = useState<PanelView>('overview');
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

  const loadDashboardData = async (customSince?: string, customUntil?: string) => {
    setLoading(true);
    setError(null);
    try {
      const accData = await getYoutubeAccounts(token, 'Youtube_accounts');
      setAccounts(accData);
      if (accData.length > 0) {
        const initialAccountId = selectedAccountId || accData[0].id;
        setSelectedAccountId(initialAccountId);
        setConsolidatedLoading(true);
        const summary = await fetchConsolidatedYoutubeDashboard(
          token,
          initialAccountId,
          customSince ?? sinceDate,
          customUntil ?? untilDate,
          7
        );
        setConsolidatedData(summary);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load YouTube analytics dashboard data');
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
      const summary = await fetchConsolidatedYoutubeDashboard(
        token,
        accountId,
        sinceDate,
        untilDate,
        7
      );
      setConsolidatedData(summary);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch YouTube metrics for selected channel');
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
      const summary = await fetchConsolidatedYoutubeDashboard(
        token,
        selectedAccountId,
        newSince,
        newUntil,
        7
      );
      setConsolidatedData(summary);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch YouTube metrics for selected date range');
    } finally {
      setConsolidatedLoading(false);
    }
  };

  const handleCopyJson = () => {
    if (!consolidatedData) return;
    navigator.clipboard.writeText(JSON.stringify(consolidatedData, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const formatNumber = (num?: number) => {
    if (num === undefined || num === null) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const getArrayData = (data: any): any[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.rows) && Array.isArray(data?.columnHeaders)) {
      const headers = data.columnHeaders.map((h: any) => h.name || h);
      return data.rows.map((row: any[]) => {
        const obj: Record<string, any> = {};
        headers.forEach((h: string, idx: number) => {
          obj[h] = row[idx];
        });
        return obj;
      });
    }
    if (Array.isArray(data?.items)) return data.items;
    return [];
  };

  const summary = useMemo(() => {
    const rawSum = consolidatedData?.summary_report;
    if (!rawSum) return null;
    if (typeof rawSum.views === 'number' || typeof rawSum.estimatedMinutesWatched === 'number') {
      return rawSum;
    }
    const rows = getArrayData(rawSum);
    if (rows.length > 0) return rows[0];
    return null;
  }, [consolidatedData]);

  const dailyGraph = useMemo(() => {
    const arr = getArrayData(consolidatedData?.daily_graph);
    return Array.isArray(arr) ? arr : [];
  }, [consolidatedData]);

  const topVideos = useMemo(() => {
    const arr = getArrayData(consolidatedData?.top_videos_report);
    return Array.isArray(arr) ? arr : [];
  }, [consolidatedData]);

  const maxDailyViews = useMemo(() => {
    if (!Array.isArray(dailyGraph) || dailyGraph.length === 0) return 100;
    return Math.max(...dailyGraph.map((d: any) => Number(d?.views) || 0), 100);
  }, [dailyGraph]);

  return (
    <div className="dashboard-container youtube-theme">
      {/* Main Content */}
      <main className="dashboard-main">
        {/* Error Banner */}
        {error && (
          <div className="error-banner">
            <IconAlert />
            <span>{error}</span>
          </div>
        )}

        {/* Google API Response Warning Banner */}
        {consolidatedData && (consolidatedData as any).error_details && (
          <div className="error-banner" style={{ background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.4)', color: '#fca5a5' }}>
            <IconAlert />
            <span>
              Google YouTube API Error ({(consolidatedData as any).error_details?.code || 401}): {(consolidatedData as any).error_details?.message || 'Invalid or expired access token in Youtube_accounts table.'}
            </span>
          </div>
        )}

        {/* Account Selector Ribbon */}
        <section className="account-selector-ribbon youtube-ribbon">
          <div className="ribbon-info">
            <div className="table-badge-tag">DATABASE TABLE: Youtube_accounts</div>
            <h2>Active YouTube Channel & Date Range</h2>
            <p>Stream analytics from YouTube Data API v3 & YouTube Analytics API v2</p>
          </div>

          <div className="ribbon-controls">
            {loading ? (
              <div className="spinner" />
            ) : accounts.length === 0 ? (
              <p className="empty-subtext">No YouTube accounts found in table Youtube_accounts.</p>
            ) : (
              <div className="account-select-wrapper">
                <select
                  id="youtube-account-dropdown"
                  className="account-dropdown-select youtube-select"
                  value={selectedAccountId}
                  onChange={(e) => handleAccountChange(e.target.value)}
                  disabled={consolidatedLoading}
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      ▶️ {acc.channel_name} (Playlist: {acc.playlist_id.substring(0, 10)}...)
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

        {/* Executive KPI Metric Group */}
        <section className="kpi-executive-section">
          <div className="kpi-group">
            <div className="kpi-group-header">
              <span className="kpi-group-title">▶️ Channel Executive Performance Reports</span>
              <span className="metric-tile__badge red-badge">Dynamic Date Window</span>
            </div>

            <div className="metric-row">
              <div className="metric-tile metric-tile--yt">
                <div className="metric-tile__head">
                  <div className="metric-tile__icon yt-icon"><IconEye /></div>
                  <span className="metric-tile__badge red-badge">Views</span>
                </div>
                <div className="metric-tile__value">{formatNumber(summary?.views)}</div>
                <div className="metric-tile__footer">
                  <div className="metric-tile__label">Total Views</div>
                  <span className="empty-subtext">YouTube Analytics v2 Report</span>
                </div>
              </div>

              <div className="metric-tile metric-tile--yt">
                <div className="metric-tile__head">
                  <div className="metric-tile__icon yt-icon"><IconClock /></div>
                  <span className="metric-tile__badge red-badge">Watch Time</span>
                </div>
                <div className="metric-tile__value">
                  {formatNumber(summary ? Math.floor(summary.estimatedMinutesWatched / 60) : 0)} hrs
                </div>
                <div className="metric-tile__footer">
                  <div className="metric-tile__label">Estimated Watch Time</div>
                  <span className="empty-subtext">{formatNumber(summary?.estimatedMinutesWatched)} mins total</span>
                </div>
              </div>

              <div className="metric-tile metric-tile--yt">
                <div className="metric-tile__head">
                  <div className="metric-tile__icon yt-icon"><IconPlay /></div>
                  <span className="metric-tile__badge red-badge">Avg Duration</span>
                </div>
                <div className="metric-tile__value">{formatDuration(summary?.averageViewDuration)}</div>
                <div className="metric-tile__footer">
                  <div className="metric-tile__label">Average View Duration</div>
                  <span className="empty-subtext">Minutes & seconds per view</span>
                </div>
              </div>

              <div className="metric-tile metric-tile--yt">
                <div className="metric-tile__head">
                  <div className="metric-tile__icon yt-icon"><IconUserPlus /></div>
                  <span className="metric-tile__badge red-badge">Subscribers</span>
                </div>
                <div className="metric-tile__value">
                  {summary?.netSubscribers && summary.netSubscribers >= 0 ? '+' : ''}
                  {formatNumber(summary?.netSubscribers)}
                </div>
                <div className="metric-tile__footer">
                  <div className="metric-tile__label">Net Subscriber Change</div>
                  <span className="empty-subtext">
                    +{formatNumber(summary?.subscribersGained)} / -{formatNumber(summary?.subscribersLost)}
                  </span>
                </div>
              </div>
            </div>

            {/* Daily Breakdown Grid */}
            <div className="daily-kpi-grid" style={{ marginTop: '16px' }}>
              <div className="daily-tile">
                <div className="daily-tile__icon"><IconHeart /></div>
                <div className="daily-tile__value">{formatNumber(summary?.likes)}</div>
                <div className="daily-tile__label">Likes</div>
              </div>
              <div className="daily-tile">
                <div className="daily-tile__icon"><IconComment /></div>
                <div className="daily-tile__value">{formatNumber(summary?.comments)}</div>
                <div className="daily-tile__label">Comments</div>
              </div>
              <div className="daily-tile">
                <div className="daily-tile__icon"><IconShare /></div>
                <div className="daily-tile__value">{formatNumber(summary?.shares)}</div>
                <div className="daily-tile__label">Shares</div>
              </div>
              <div className="daily-tile">
                <div className="daily-tile__icon"><IconUserPlus /></div>
                <div className="daily-tile__value">+{formatNumber(summary?.subscribersGained)}</div>
                <div className="daily-tile__label">Gained Subs</div>
              </div>
              <div className="daily-tile">
                <div className="daily-tile__icon"><IconUserMinus /></div>
                <div className="daily-tile__value">-{formatNumber(summary?.subscribersLost)}</div>
                <div className="daily-tile__label">Lost Subs</div>
              </div>
            </div>
          </div>
        </section>

        {/* Analytics Panel */}
        {accounts.length > 0 && (
          <section className="db-panel">
            <div className="db-panel__header">
              <div className="panel-title-group">
                <h2>
                  ▶️ {consolidatedData?.channel?.title || 'YouTube Channel Analytics'}
                  <span className="live-badge yt-badge">
                    <span className="dot yt-dot" /> Channel Connected
                  </span>
                </h2>
                <p className="db-panel__sub">
                  {consolidatedData?.fetched_at
                    ? `Data report generated ${new Date(consolidatedData.fetched_at).toLocaleTimeString()}`
                    : 'Fetching YouTube API streams...'}
                </p>
              </div>

              {/* Navigation Tabs */}
              <div className="db-tabs" role="tablist">
                {(['overview', 'videos', 'raw'] as PanelView[]).map((v) => (
                  <button
                    key={v}
                    role="tab"
                    aria-selected={panelView === v}
                    className={`db-tab ${panelView === v ? 'is-active yt-tab-active' : ''}`}
                    onClick={() => setPanelView(v)}
                  >
                    {v === 'overview' && <IconChartBar />}
                    {v === 'videos' && <IconPlay />}
                    {v === 'raw' && <IconCode />}
                    {v === 'overview'
                      ? 'Overview'
                      : v === 'videos'
                      ? `Videos (${topVideos.length})`
                      : 'Raw API JSON'}
                  </button>
                ))}
              </div>
            </div>

            {consolidatedLoading ? (
              <div className="loading-state">
                <div className="spinner large" />
                <p>Fetching real-time data from Google YouTube Analytics API v2...</p>
              </div>
            ) : panelView === 'overview' ? (
              <div className="db-row">
                {/* Views & Watch Time Velocity Graph */}
                <div className="trend-card">
                  <div className="trend-card__head">
                    <div>
                      <h3>Daily View Velocity & Subscriber Trend</h3>
                      <p className="db-panel__sub">Daily performance breakdown (dimensions=day)</p>
                    </div>
                    <div className="trend-card__total">
                      {formatNumber(summary?.views)} <span className="trend-card__period">views total</span>
                    </div>
                  </div>

                  <div className="follower-bars-wrapper">
                    <div className="follower-bars">
                      {dailyGraph.map((item, idx) => {
                        const pct = Math.max(12, Math.round(((item.views || 0) / maxDailyViews) * 100));
                        return (
                          <div
                            key={item.day || idx}
                            className="follower-bars__bar yt-bar"
                            style={{ height: `${pct}%` }}
                            title={`${item.day}: ${formatNumber(item.views)} views | +${item.subscribersGained} subs`}
                          />
                        );
                      })}
                    </div>
                    <div className="chart-axis">
                      <span>{dailyGraph[0]?.day || sinceDate}</span>
                      <span>{dailyGraph[Math.floor(dailyGraph.length / 2)]?.day || ''}</span>
                      <span>{dailyGraph[dailyGraph.length - 1]?.day || untilDate}</span>
                    </div>
                  </div>
                </div>

                {/* Audience Action Breakdown */}
                <div className="engagement-card">
                  <div>
                    <h3>Engagement Breakdown</h3>
                    <p className="db-panel__sub">Key action metrics</p>
                  </div>
                  <ul className="engagement-list">
                    <li className="engagement-item">
                      <div className="engagement-item__icon yt-gold"><IconHeart /></div>
                      <div className="engagement-item__info">
                        <span className="engagement-item__label">Likes</span>
                        <span className="engagement-item__value">{formatNumber(summary?.likes)}</span>
                      </div>
                    </li>
                    <li className="engagement-item">
                      <div className="engagement-item__icon yt-gold"><IconComment /></div>
                      <div className="engagement-item__info">
                        <span className="engagement-item__label">Comments</span>
                        <span className="engagement-item__value">{formatNumber(summary?.comments)}</span>
                      </div>
                    </li>
                    <li className="engagement-item">
                      <div className="engagement-item__icon yt-gold"><IconShare /></div>
                      <div className="engagement-item__info">
                        <span className="engagement-item__label">Shares</span>
                        <span className="engagement-item__value">{formatNumber(summary?.shares)}</span>
                      </div>
                    </li>
                    <li className="engagement-item">
                      <div className="engagement-item__icon yt-gold"><IconClock /></div>
                      <div className="engagement-item__info">
                        <span className="engagement-item__label">Avg View Duration</span>
                        <span className="engagement-item__value">{formatDuration(summary?.averageViewDuration)}</span>
                      </div>
                    </li>
                  </ul>
                </div>
              </div>
            ) : panelView === 'videos' ? (
              <div className="media-section-wrapper">
                <div className="media-list-grid">
                  {topVideos.map((video) => (
                    <article className="media-card-luxury yt-video-card" key={video.id}>
                      <div className="media-card-thumb-container">
                        <img
                          src={video.thumbnailUrl}
                          alt={video.title}
                          className="media-card-img"
                          loading="lazy"
                        />
                        <span className="media-card-type-tag yt-tag">Video</span>
                        <span className="media-card-rank-tag">{formatDuration(video.averageViewDuration)} avg</span>
                      </div>

                      <div className="media-card-content">
                        <div className="media-card-header">
                          <span className="media-card-shortcode">ID: {video.id}</span>
                          <span className="media-card-time">{new Date(video.publishedAt).toLocaleDateString()}</span>
                        </div>

                        <h4 className="yt-video-title">{video.title}</h4>
                        <p className="media-card-caption">{video.description}</p>

                        <div className="media-card-footer">
                          <div className="media-stats-group">
                            <span className="media-stat-pill" title="Views"><IconEye /> {formatNumber(video.views)}</span>
                            <span className="media-stat-pill" title="Likes"><IconHeart /> {formatNumber(video.likes)}</span>
                            <span className="media-stat-pill" title="Comments"><IconComment /> {formatNumber(video.comments)}</span>
                          </div>

                          <a
                            href={`https://www.youtube.com/watch?v=${video.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="media-card-link yt-link"
                          >
                            Watch <IconExternal />
                          </a>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <div className="api-result-box">
                <div className="raw-json-header">
                  <span className="empty-subtext">Google YouTube API Payload (channels, playlistItems, videos, reports)</span>
                  <button onClick={handleCopyJson} className="copy-json-btn">
                    <IconCopy /> {copiedJson ? 'Copied!' : 'Copy JSON'}
                  </button>
                </div>
                <pre className="raw-json-block">
                  {JSON.stringify(consolidatedData, null, 2)}
                </pre>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
};

/* SVG Icons */

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

function IconClock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconUserPlus() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="17" y1="11" x2="23" y2="11" />
    </svg>
  );
}

function IconUserMinus() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="17" y1="11" x2="23" y2="11" />
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



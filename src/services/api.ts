export interface User {
  id: string | number;
  username: string;
  email_address: string;
  phone_number?: string;
  is_active: boolean;
  created_at: string;
}

export interface InstagramAccount {
  id: string | number;
  user_id: string | number;
  page_name: string;
  page_id: string;
  created_at: string;
}

export interface YoutubeAccount {
  id: string | number;
  user_id: string | number;
  channel_name: string;
  playlist_id: string;
  created_at: string;
}

const API_BASE = '/api';

export async function loginUser(username: string, password: string): Promise<{ token: string; user: User }> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Authentication failed');
  }

  return data;
}

export async function getCurrentUser(token: string): Promise<User> {
  const response = await fetch(`${API_BASE}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch user session');
  }

  return data.user;
}

export async function getInstagramAccounts(token: string): Promise<InstagramAccount[]> {
  const response = await fetch(`${API_BASE}/instagram-accounts`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch Instagram accounts');
  }

  return data.accounts;
}


// ============================================================================
// CONSOLIDATED SINGLE METHOD INSTAGRAM DASHBOARD CALLER
// ============================================================================

export async function getYoutubeAccounts(token: string, tableName = 'Youtube_accounts'): Promise<YoutubeAccount[]> {
  const response = await fetch(`${API_BASE}/youtube-accounts?tableName=${tableName}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch YouTube accounts from table ' + tableName);
  }

  return data.accounts;
}

// ---------------------------------------------------------------------------
// Stored history / trends
// ---------------------------------------------------------------------------

export type Platform = 'instagram' | 'youtube';

export interface DailyPoint {
  date: string;
  [metric: string]: number | string | null;
}

export interface MetricDelta {
  current: number;
  previous: number;
  change_pct: number | null;
}

export interface HistoryResponse {
  platform: Platform;
  account: { id: string | number; name: string };
  range: { since: string; until: string; days: number; previous_since: string; previous_until: string };
  coverage: { days_with_data: number; previous_days_with_data: number };
  primary_metric: string;
  daily: DailyPoint[];
  totals: Record<string, number>;
  deltas: Record<string, MetricDelta>;
  anomalies: { date: string; value: number; z_score: number; type: 'spike' | 'drop' }[];
  forecast: { slope: number; predictions: number[] };
  best_weekday: number | null;
  last_synced_at: string | null;
}

export interface StoredMedia {
  media_id: string;
  title: string | null;
  media_type: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  reposts: number | null;
  total_interactions: number | null;
  profile_visits: number | null;
  follows: number | null;
  replies: number | null;
  link_clicks: number | null;
  /** Percent of reel plays skipped in the first 3 seconds. Lower is better. */
  skip_rate: number | null;
  avg_watch_seconds: number | null;
  total_watch_seconds: number | null;
  duration_seconds: number | null;
  extra: {
    breakdowns?: Record<string, { label: string; value: number }[]>;
    metric_errors?: { metric: string; code: number; message: string }[];
    tags?: string[];
    [key: string]: unknown;
  } | null;
}

export interface SyncResult {
  results: { platform: Platform; account_id: string | number; days_synced: number; media_snapshots: number; stories?: number }[];
  errors: { platform: Platform; account_id: string | number; code: number; reason?: string; message: string }[];
}

export async function fetchHistory(
  token: string,
  platform: Platform,
  opts: { accountId?: string | number; since?: string; until?: string } = {}
): Promise<HistoryResponse> {
  const params = new URLSearchParams();
  if (opts.accountId) params.append('accountId', String(opts.accountId));
  if (opts.since) params.append('since', opts.since);
  if (opts.until) params.append('until', opts.until);
  const response = await fetch(`${API_BASE}/history/${platform}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`History error ${response.status}: ${data.error || 'Failed to load stored history'}`);
  return data;
}

export async function fetchStoredMedia(
  token: string,
  platform: Platform,
  accountId?: string | number
): Promise<StoredMedia[]> {
  const params = new URLSearchParams();
  if (accountId) params.append('accountId', String(accountId));
  const response = await fetch(`${API_BASE}/history/${platform}/media?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Media error ${response.status}: ${data.error || 'Failed to load stored media'}`);
  return data.media;
}

/** Runs a sync. Returns per-account results AND errors; only throws when the server gives no per-account detail. */
export async function syncNow(token: string, platform?: Platform, accountId?: string | number): Promise<SyncResult> {
  const response = await fetch(`${API_BASE}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ platform, accountId }),
  });
  const data = await response.json();
  if (!Array.isArray(data.results) && !Array.isArray(data.errors)) {
    throw new Error(`Sync error ${response.status}: ${data.error || 'Sync failed'}`);
  }
  return { results: data.results || [], errors: data.errors || [] };
}

// ---------------------------------------------------------------------------
// Account management
// ---------------------------------------------------------------------------

export interface NewInstagramAccount {
  page_name: string;
  page_id: string;
  access_token: string;
}

export interface NewYoutubeAccount {
  channel_name: string;
  playlist_id: string;
  access_token: string;
}

const ACCOUNT_PATH: Record<Platform, string> = { instagram: 'instagram-accounts', youtube: 'youtube-accounts' };

async function accountRequest(token: string, method: string, path: string, body?: unknown): Promise<void> {
  const response = await fetch(`${API_BASE}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (data.error) message = data.error;
    } catch {
      // no JSON body
    }
    throw new Error(`Error ${response.status}: ${message}`);
  }
}

export function createAccount(token: string, platform: Platform, body: NewInstagramAccount | NewYoutubeAccount) {
  return accountRequest(token, 'POST', ACCOUNT_PATH[platform], body);
}

export function updateAccountToken(token: string, platform: Platform, id: string | number, accessToken: string) {
  return accountRequest(token, 'PATCH', `${ACCOUNT_PATH[platform]}/${id}`, { access_token: accessToken });
}

export function deleteAccount(token: string, platform: Platform, id: string | number) {
  return accountRequest(token, 'DELETE', `${ACCOUNT_PATH[platform]}/${id}`);
}

// ---------------------------------------------------------------------------
// Audience insights & overview
// ---------------------------------------------------------------------------

export interface ApiErrorDetails {
  code: number;
  message: string;
  reason?: string;
}

export interface BestTimeResponse {
  account_id: string | number;
  matrix: (number | null)[][];
  hourly_avg: (number | null)[];
  top_slots: { weekday: number; hour: number; value: number }[];
  days_sampled: number;
}

export type ReportResult<T> = { rows: T[]; error?: undefined } | { rows?: undefined; error: ApiErrorDetails };

type Rows<T> = ReportResult<T>;
type ViewsRow = { views: number; estimatedMinutesWatched: number; engagedViews?: number };

export interface YoutubeBreakdowns {
  account_id: string | number;
  range: { since: string; until: string };
  // overview group
  channel_totals?: Rows<Record<string, number>>;
  cards?: Rows<Record<string, number>>;
  content_types?: Rows<{ creatorContentType: string } & Record<string, number | string>>;
  subscribed_status?: Rows<{ subscribedStatus: string } & Record<string, number | string>>;
  // audience group
  countries?: Rows<{ country: string; views: number; estimatedMinutesWatched: number; averageViewDuration?: number; averageViewPercentage?: number }>;
  cities?: Rows<{ city: string; views: number; estimatedMinutesWatched: number; averageViewDuration?: number; averageViewPercentage?: number; engagedViews?: number }>;
  devices?: Rows<ViewsRow & { deviceType: string }>;
  operating_systems?: Rows<ViewsRow & { operatingSystem: string }>;
  demographics?: Rows<{ ageGroup: string; gender: string; viewerPercentage: number }>;
  // acquisition group
  traffic_sources?: Rows<ViewsRow & { insightTrafficSourceType: string }>;
  search_terms?: Rows<ViewsRow & { insightTrafficSourceDetail: string }>;
  external_sites?: Rows<ViewsRow & { insightTrafficSourceDetail: string }>;
  related_videos?: Rows<ViewsRow & { insightTrafficSourceDetail: string; title?: string; thumbnail_url?: string | null }>;
  playback_locations?: Rows<ViewsRow & { insightPlaybackLocationType: string }>;
  embedded_sites?: Rows<ViewsRow & { insightPlaybackLocationDetail: string }>;
  sharing_services?: Rows<{ sharingService: string; shares: number }>;
}

export type YoutubeGroup = 'overview' | 'audience' | 'acquisition';

export interface YoutubeVideoAnalytics {
  video: string;
  creatorContentType?: string;
  title: string;
  thumbnail_url: string | null;
  published_at: string | null;
  duration_seconds: number | null;
  tags: string[];
  lifetime_views: number | null;
  views: number;
  engagedViews: number;
  comments: number;
  likes: number;
  dislikes: number;
  shares: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number;
  averageViewPercentage: number;
  subscribersGained: number;
  subscribersLost: number;
  videosAddedToPlaylists: number;
  videosRemovedFromPlaylists: number;
}

export interface RetentionPoint {
  elapsedVideoTimeRatio: number;
  audienceWatchRatio: number;
  relativeRetentionPerformance: number;
  startedWatching?: number;
  stoppedWatching?: number;
}

export interface YoutubeRevenue {
  range: { since: string; until: string };
  totals: Rows<Record<string, number>>;
  daily: Rows<{ day: string; estimatedRevenue: number }>;
  top_videos: Rows<{ video: string; title?: string; estimatedRevenue: number; views: number }>;
}

export interface YoutubePlaylist {
  id: string;
  title: string;
  item_count: number | null;
  thumbnail_url: string | null;
  stats: ({ error: ApiErrorDetails } & Record<string, never>) | Record<string, number> | null;
}

export interface CommentAnalysis {
  total: number;
  questions: number;
  question_share: number;
  top_words: { word: string; count: number }[];
  top_comments: { text: string; like_count: number; author: string | null }[];
}

export interface InstagramAccountInsights {
  account_id: string | number;
  range: { since: string; until: string };
  totals: Record<string, number>;
  total_errors: Record<string, ApiErrorDetails>;
  breakdowns: Record<string, { rows: { label: string; value: number }[]; error?: undefined } | { rows?: undefined; error: ApiErrorDetails }>;
}

export interface InstagramStory {
  media_id: string;
  permalink: string;
  thumbnail_url: string | null;
  media_type: string;
  published_at: string;
  caption: string;
  reach: number | null;
  views: number | null;
  replies: number | null;
  shares: number | null;
  follows: number | null;
  profile_visits: number | null;
  link_clicks: number | null;
  total_interactions: number | null;
  breakdowns: Record<string, { label: string; value: number }[]>;
  errors: { metric: string; code: number; message: string }[];
}

export interface BenchmarkSummary {
  username: string;
  name: string | null;
  biography: string;
  followers_count: number;
  follows_count: number | null;
  media_count: number | null;
  sampled_posts: number;
  avg_likes: number;
  avg_comments: number;
  engagement_rate: number | null;
  posts_per_week: number | null;
  format_mix: Record<string, number>;
  top_posts: { caption: string; media_type: string; likes: number; comments: number; permalink: string; timestamp: string }[];
}

export interface HashtagResult {
  hashtag: string;
  hashtag_id: string;
  top: { id: string; caption?: string; media_type?: string; like_count?: number; comments_count?: number; permalink?: string; timestamp?: string }[];
  recent: HashtagResult['top'];
  top_error: ApiErrorDetails | null;
  recent_error: ApiErrorDetails | null;
}

export interface AccountCard {
  platform: Platform;
  id: string | number;
  name: string;
  days_with_data: number;
  totals: Record<string, number>;
  deltas: Record<string, MetricDelta>;
  /** Daily views over the selected range, oldest first. */
  series: number[];
}

export interface OverviewResponse {
  range: { since: string; until: string; days: number; previous_since: string; previous_until: string };
  accounts: { instagram: number; youtube: number };
  coverage: { instagram_days: number; youtube_days: number };
  totals: Record<'instagram' | 'youtube' | 'combined', Record<string, number>>;
  deltas: Record<'instagram' | 'youtube' | 'combined', Record<string, MetricDelta>>;
  daily: { date: string; instagram_views: number; youtube_views: number }[];
  account_cards: AccountCard[];
  leaderboard: {
    platform: Platform;
    media_id: string;
    title: string | null;
    media_type: string | null;
    permalink: string | null;
    thumbnail_url: string | null;
    published_at: string | null;
    views: number | null;
    reach: number | null;
    engagement_rate: number;
  }[];
  insights: string[];
}

async function getJsonOrThrow<T>(token: string, path: string, label: string): Promise<T> {
  const response = await fetch(`${API_BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json();
  if (!response.ok) {
    const d = data.error_details as ApiErrorDetails | undefined;
    if (d) throw new Error(`${label} error ${d.code}${d.reason ? ` [${d.reason}]` : ''}: ${d.message}`);
    throw new Error(`${label} error ${response.status}: ${data.error || 'Request failed'}`);
  }
  return data;
}

export function fetchBestTime(token: string, accountId?: string | number): Promise<BestTimeResponse> {
  const q = accountId ? `?accountId=${accountId}` : '';
  return getJsonOrThrow(token, `instagram/best-time${q}`, 'Instagram');
}

export function fetchYoutubeBreakdowns(
  token: string,
  opts: { accountId?: string | number; since?: string; until?: string }
): Promise<YoutubeBreakdowns> {
  const params = new URLSearchParams();
  if (opts.accountId) params.append('accountId', String(opts.accountId));
  if (opts.since) params.append('since', opts.since);
  if (opts.until) params.append('until', opts.until);
  return getJsonOrThrow(token, `youtube/breakdowns?${params.toString()}`, 'YouTube');
}

export function fetchOverview(token: string, since?: string, until?: string): Promise<OverviewResponse> {
  const params = new URLSearchParams();
  if (since) params.append('since', since);
  if (until) params.append('until', until);
  return getJsonOrThrow(token, `overview?${params.toString()}`, 'Overview');
}

// ---------------------------------------------------------------------------
// Profile cards & Instagram demographics
// ---------------------------------------------------------------------------

export interface InstagramProfile {
  username?: string;
  name?: string;
  biography?: string;
  website?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  account_type?: string;
}

export interface YoutubeChannelInfo {
  title: string;
  description: string;
  custom_url: string | null;
  country: string | null;
  published_at: string | null;
  thumbnail_url: string | null;
  subscriber_count: number | null;
  view_count: number;
  video_count: number;
}

export type DemographicResult = { rows: { label: string; value: number }[]; error?: undefined } | { rows?: undefined; error: ApiErrorDetails };

export interface InstagramDemographics {
  account_id: string | number;
  age: DemographicResult;
  gender: DemographicResult;
  country: DemographicResult;
  city: DemographicResult;
}

export async function fetchInstagramProfile(token: string, accountId?: string | number): Promise<InstagramProfile> {
  const q = accountId ? `?accountId=${accountId}` : '';
  return (await getJsonOrThrow<{ profile: InstagramProfile }>(token, `instagram/profile${q}`, 'Instagram')).profile;
}

export async function fetchYoutubeChannel(token: string, accountId?: string | number): Promise<YoutubeChannelInfo> {
  const q = accountId ? `?accountId=${accountId}` : '';
  return (await getJsonOrThrow<{ channel: YoutubeChannelInfo }>(token, `youtube/channel${q}`, 'YouTube')).channel;
}

export function fetchInstagramDemographics(token: string, accountId?: string | number, type: 'follower' | 'engaged' = 'follower'): Promise<InstagramDemographics> {
  const params = new URLSearchParams({ type });
  if (accountId) params.append('accountId', String(accountId));
  return getJsonOrThrow(token, `instagram/demographics?${params.toString()}`, 'Instagram');
}

// ---------------------------------------------------------------------------
// Deep insights (live calls; each endpoint reports its own errors)
// ---------------------------------------------------------------------------

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.append(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function fetchYoutubeGroups(token: string, opts: { accountId?: string | number; since?: string; until?: string; groups: YoutubeGroup[] }): Promise<YoutubeBreakdowns> {
  return getJsonOrThrow(token, `youtube/breakdowns${qs({ accountId: opts.accountId, since: opts.since, until: opts.until, groups: opts.groups.join(',') })}`, 'YouTube');
}

export async function fetchYoutubeVideos(token: string, opts: { accountId?: string | number; since?: string; until?: string }): Promise<YoutubeVideoAnalytics[]> {
  return (await getJsonOrThrow<{ videos: YoutubeVideoAnalytics[] }>(token, `youtube/videos${qs(opts)}`, 'YouTube')).videos;
}

export async function fetchYoutubeRetention(token: string, videoId: string, accountId?: string | number): Promise<RetentionPoint[]> {
  return (await getJsonOrThrow<{ points: RetentionPoint[] }>(token, `youtube/retention${qs({ videoId, accountId })}`, 'YouTube')).points;
}

export function fetchYoutubeRevenue(token: string, opts: { accountId?: string | number; since?: string; until?: string }): Promise<YoutubeRevenue> {
  return getJsonOrThrow(token, `youtube/revenue${qs(opts)}`, 'YouTube');
}

export async function fetchYoutubePlaylists(token: string, opts: { accountId?: string | number; since?: string; until?: string }): Promise<YoutubePlaylist[]> {
  return (await getJsonOrThrow<{ playlists: YoutubePlaylist[] }>(token, `youtube/playlists${qs(opts)}`, 'YouTube')).playlists;
}

export async function fetchYoutubeComments(token: string, videoId: string, accountId?: string | number): Promise<{ analysis: CommentAnalysis; sample_size: number }> {
  return getJsonOrThrow(token, `youtube/comments${qs({ videoId, accountId })}`, 'YouTube');
}

export function fetchInstagramAccountInsights(token: string, opts: { accountId?: string | number; since?: string; until?: string }): Promise<InstagramAccountInsights> {
  return getJsonOrThrow(token, `instagram/account-insights${qs(opts)}`, 'Instagram');
}

export async function fetchInstagramStories(token: string, accountId?: string | number): Promise<InstagramStory[]> {
  return (await getJsonOrThrow<{ stories: InstagramStory[] }>(token, `instagram/stories${qs({ accountId })}`, 'Instagram')).stories;
}

export function fetchInstagramComments(token: string, mediaId: string, accountId?: string | number): Promise<{ analysis: CommentAnalysis }> {
  return getJsonOrThrow(token, `instagram/comments${qs({ mediaId, accountId })}`, 'Instagram');
}

export async function fetchInstagramTags(token: string, accountId?: string | number): Promise<HashtagResult['top']> {
  return (await getJsonOrThrow<{ tags: HashtagResult['top'] }>(token, `instagram/tags${qs({ accountId })}`, 'Instagram')).tags;
}

export function fetchPublishingLimit(token: string, accountId?: string | number): Promise<{ quota_usage: number | null; quota_total: number | null; quota_duration_seconds: number | null }> {
  return getJsonOrThrow(token, `instagram/publishing-limit${qs({ accountId })}`, 'Instagram');
}

export function fetchBenchmark(token: string, username: string, accountId?: string | number): Promise<BenchmarkSummary> {
  return getJsonOrThrow(token, `instagram/benchmark${qs({ username, accountId })}`, 'Instagram');
}

export function fetchHashtag(token: string, q: string, accountId?: string | number): Promise<HashtagResult> {
  return getJsonOrThrow(token, `instagram/hashtag${qs({ q, accountId })}`, 'Instagram');
}

// ---------------------------------------------------------------------------
// Instagram auto-replies
// ---------------------------------------------------------------------------

export type AutomationTrigger = 'comment' | 'dm';
export type MatchType = 'exact' | 'starts_with' | 'contains';
/** Which content a rule covers. Anything but `all` only answers comments. */
export type AutomationScope = 'all' | 'reels' | 'posts' | 'specific';

export interface AutomationRule {
  id: string | number;
  account_id: string | number;
  account_name?: string;
  name: string;
  is_active: boolean;
  triggers: AutomationTrigger[];
  keywords: string[];
  match_type: MatchType;
  scope: AutomationScope;
  media_id: string | null;
  media_label: string | null;
  media_permalink: string | null;
  reply_text: string;
  link_url: string;
  comment_reply_text: string | null;
  disclose_automation: boolean;
  cooldown_hours: number;
  created_at: string;
  /** How many replies this rule has sent. */
  sent_count?: number;
}

export interface AutomationRuleInput {
  account_id: string | number;
  name: string;
  is_active: boolean;
  triggers: AutomationTrigger[];
  keywords: string[];
  match_type: MatchType;
  scope: AutomationScope;
  media_id: string;
  media_label: string;
  media_permalink: string;
  reply_text: string;
  link_url: string;
  comment_reply_text: string;
  disclose_automation: boolean;
  cooldown_hours: number;
}

export interface AutomationEvent {
  id: string | number;
  source: AutomationTrigger;
  status: 'sent' | 'failed' | 'skipped' | 'dry_run' | 'processing' | 'ignored';
  skip_reason: string | null;
  error_code: number | null;
  error_message: string | null;
  sender_username: string | null;
  sender_id: string | null;
  trigger_text: string | null;
  message_text: string | null;
  note: string | null;
  created_at: string;
  rule_name: string | null;
  account_name: string;
}

export interface AutomationStatus {
  app_secret_configured: boolean;
  verify_token_configured: boolean;
  dry_run: boolean;
  callback_url: string;
  is_https: boolean;
  fields: string;
  accounts: {
    id: string | number;
    name: string;
    token_ok: boolean;
    token_error: ApiErrorDetails | null;
    subscribed: boolean;
    subscribed_fields: string[];
    subscription_error: ApiErrorDetails | null;
  }[];
}

export interface RuleTestResult {
  matched: boolean;
  rule_id?: string | number;
  rule_name?: string;
  scope?: AutomationScope;
  media_label?: string | null;
  keyword?: string;
  message?: string;
  public_reply?: string | null;
}

async function sendJson<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) {
    const d = data.error_details as ApiErrorDetails | undefined;
    if (d) throw new Error(`Instagram error ${d.code}${d.reason ? ` [${d.reason}]` : ''}: ${d.message}`);
    throw new Error(`Error ${response.status}: ${data.error || 'Request failed'}`);
  }
  return data as T;
}

export async function fetchAutomationRules(token: string): Promise<AutomationRule[]> {
  return (await sendJson<{ rules: AutomationRule[] }>(token, 'GET', 'automation/rules')).rules;
}

export function saveAutomationRule(token: string, input: AutomationRuleInput, id?: string | number): Promise<{ rule: AutomationRule }> {
  return sendJson(token, id === undefined ? 'POST' : 'PATCH', id === undefined ? 'automation/rules' : `automation/rules/${id}`, input);
}

export function setAutomationRuleActive(token: string, id: string | number, isActive: boolean): Promise<{ rule: AutomationRule }> {
  return sendJson(token, 'PATCH', `automation/rules/${id}`, { is_active: isActive });
}

export function deleteAutomationRule(token: string, id: string | number): Promise<void> {
  return sendJson(token, 'DELETE', `automation/rules/${id}`);
}

export async function fetchAutomationLog(token: string): Promise<AutomationEvent[]> {
  return (await sendJson<{ events: AutomationEvent[] }>(token, 'GET', 'automation/log?limit=50')).events;
}

export function fetchAutomationStatus(token: string): Promise<AutomationStatus> {
  return sendJson(token, 'GET', 'automation/status');
}

export function subscribeAutomationAccount(token: string, accountId: string | number): Promise<{ success: boolean }> {
  return sendJson(token, 'POST', 'automation/subscribe', { accountId });
}

export interface AutomationMedia {
  id: string;
  type: 'reel' | 'post';
  product_type: string | null;
  caption: string;
  thumbnail_url: string | null;
  permalink: string | null;
  timestamp: string | null;
}

export async function fetchAutomationMedia(token: string, accountId: string | number): Promise<AutomationMedia[]> {
  return (await sendJson<{ media: AutomationMedia[] }>(token, 'GET', `automation/media?accountId=${accountId}`)).media;
}

export function testAutomation(
  token: string,
  body: { accountId: string | number; source: AutomationTrigger; text: string; mediaId?: string; mediaProductType?: string }
): Promise<RuleTestResult> {
  return sendJson(token, 'POST', 'automation/test', body);
}

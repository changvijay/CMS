import type { Platform as PublishPlatform, PublishAccount, WizardState } from '../components/publish/types';
import { oauthLog } from './oauthDebug';

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
  ig_user_id?: string | null;
  profile_picture_url?: string | null;
  /** Automatic renewal state. `expired` only when renewal failed and the token no longer works. */
  token?: { status: 'ok' | 'expired'; auto_refresh?: boolean; expires_at?: string | null; message: string | null };
}

export interface YoutubeAccount {
  id: string | number;
  user_id: string | number;
  channel_name: string;
  playlist_id: string;
  created_at: string;
  channel_id?: string | null;
  picture_url?: string | null;
  /** `expired` when Google refuses the stored refresh token; can_upload null = unknown (token pasted by hand). */
  token?: { status: 'ok' | 'expired'; message: string | null; can_upload: boolean | null };
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

export interface WaitlistSignup {
  email: string;
  phone: string;
  instagram: number;
  facebook: number;
  linkedin: number;
  youtube: number;
  links: string;
  website?: string; // hidden spam trap, always empty for people
}

/** Thrown when the server rejects some fields; `fields` maps each field to its message. */
export class WaitlistError extends Error {
  fields: Record<string, string>;
  constructor(message: string, fields: Record<string, string> = {}) {
    super(message);
    this.fields = fields;
  }
}

export async function joinWaitlist(signup: WaitlistSignup): Promise<{ updated: boolean }> {
  const response = await fetch(`${API_BASE}/waitlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signup),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new WaitlistError(data.error || 'Your details could not be saved. Please try again.', data.fields || {});
  return { updated: Boolean(data.updated) };
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

export type Platform = 'instagram' | 'youtube' | 'linkedin';
/** Platforms on the combined Overview. Facebook is read live and has no stored history or platform workspace. */
export type OverviewPlatform = Platform | 'facebook';
/** Platforms whose accounts are added by pasting a token (LinkedIn uses its own Connect button). */
export type ManualPlatform = 'instagram' | 'youtube';

export interface DailyPoint {
  date: string;
  [metric: string]: number | string | null;
}

export interface MetricDelta {
  current: number;
  previous: number;
  change_pct: number | null;
}

/** `stored`: read from the database (last 30 days). `live`: fetched from the platform for this request. */
export type DataSource = 'stored' | 'live';

export interface HistoryResponse {
  platform: Platform;
  source?: DataSource;
  fetched_at?: string | null;
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
  platform?: Platform;
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
  results: { platform: OverviewPlatform; account_id: string | number; name?: string | null; days_synced: number; media_snapshots: number; stories?: number; reels?: number; live?: boolean }[];
  /** `auth`: the account is logged out or its access stopped working; reconnecting fixes it. */
  errors: { platform: OverviewPlatform; account_id: string | number | null; name?: string | null; code: number; reason?: string; message: string; auth?: boolean }[];
}

export async function fetchHistory(
  token: string,
  platform: Platform,
  opts: { accountId?: string | number; since?: string; until?: string; live?: boolean } = {}
): Promise<HistoryResponse> {
  const params = new URLSearchParams();
  if (opts.accountId) params.append('accountId', String(opts.accountId));
  if (opts.since) params.append('since', opts.since);
  if (opts.until) params.append('until', opts.until);
  if (opts.live) params.append('live', '1');
  const response = await fetch(`${API_BASE}/history/${platform}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`History error ${response.status}: ${data.error || 'Failed to load history'}`);
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
export async function syncNow(token: string, platform?: OverviewPlatform, accountId?: string | number): Promise<SyncResult> {
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

const ACCOUNT_PATH: Record<ManualPlatform, string> = { instagram: 'instagram-accounts', youtube: 'youtube-accounts' };

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

export function createAccount(token: string, platform: ManualPlatform, body: NewInstagramAccount | NewYoutubeAccount) {
  return accountRequest(token, 'POST', ACCOUNT_PATH[platform], body);
}

export function updateAccountToken(token: string, platform: ManualPlatform, id: string | number, accessToken: string) {
  return accountRequest(token, 'PATCH', `${ACCOUNT_PATH[platform]}/${id}`, { access_token: accessToken });
}

export function deleteAccount(token: string, platform: ManualPlatform, id: string | number) {
  return accountRequest(token, 'DELETE', `${ACCOUNT_PATH[platform]}/${id}`);
}

// ---------------------------------------------------------------------------
// LinkedIn (connected through LinkedIn's own sign-in, tokens refreshed on the server)
// ---------------------------------------------------------------------------

export interface LinkedInAccount {
  id: string | number;
  name: string;
  organization_urn: string;
  account_type?: 'organization' | 'person';
  vanity_name: string | null;
  status: 'ok' | 'refresh' | 'expired';
  access_token_expires_at: string;
  refresh_token_expires_at: string | null;
  auto_refresh: boolean;
  last_refresh_error: string | null;
  created_at: string;
}

async function linkedinJson<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${API_BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}

export function getLinkedInAccounts(token: string) {
  return linkedinJson<{ configured: boolean; accounts: LinkedInAccount[] }>(token, 'linkedin-accounts');
}

export async function getLinkedInConnectUrl(token: string): Promise<string> {
  const origin = encodeURIComponent(window.location.origin);
  const data = await linkedinJson<{ url: string }>(token, `linkedin/connect-url?origin=${origin}`);
  return data.url;
}

export function deleteLinkedInAccount(token: string, id: string | number) {
  return accountRequest(token, 'DELETE', `linkedin-accounts/${id}`);
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
  platform: OverviewPlatform;
  id: string | number;
  name: string;
  days_with_data: number;
  totals: Record<string, number>;
  deltas: Record<string, MetricDelta>;
  /** Daily views over the selected range, oldest first. */
  series: number[];
}

export interface OverviewResponse {
  source?: DataSource;
  /** Accounts whose live numbers could not be fetched; the rest of the page still shows. */
  errors?: SyncResult['errors'];
  range: { since: string; until: string; days: number; previous_since: string; previous_until: string };
  accounts: Record<OverviewPlatform, number>;
  coverage: Record<`${OverviewPlatform}_days`, number>;
  totals: Record<OverviewPlatform | 'combined', Record<string, number>>;
  deltas: Record<OverviewPlatform | 'combined', Record<string, MetricDelta>>;
  daily: ({ date: string } & Record<`${OverviewPlatform}_views`, number>)[];
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

// LinkedIn company page insights (live from LinkedIn)

export interface LinkedInBar {
  label: string;
  value: number;
}

export interface LinkedInUnavailable {
  unavailable: true;
  reason: string;
}

export type LinkedInDemographics = Record<'function' | 'seniority' | 'industry' | 'company_size' | 'country' | 'region', LinkedInBar[]>;

export interface LinkedInProfile {
  id: string | number;
  name: string;
  vanity_name: string | null;
  description: string | null;
  website: string | null;
  staff_count: string | null;
  followers: number | null;
}

export interface LinkedInFollowers {
  total: number | null;
  growth: { date: string; organic: number; paid: number }[] | LinkedInUnavailable;
  demographics: LinkedInDemographics | LinkedInUnavailable;
}

export type LinkedInVisitors =
  | { sections: LinkedInBar[]; devices: LinkedInBar[]; total: number; demographics: LinkedInDemographics }
  | LinkedInUnavailable;

const liQuery = (accountId: string, extra: Record<string, string> = {}) => new URLSearchParams({ accountId, ...extra }).toString();

export function fetchLinkedInProfile(token: string, accountId: string) {
  return linkedinJson<LinkedInProfile>(token, `linkedin/profile?${liQuery(accountId)}`);
}

export function fetchLinkedInFollowers(token: string, accountId: string, since: string, until: string) {
  return linkedinJson<LinkedInFollowers>(token, `linkedin/followers?${liQuery(accountId, { since, until })}`);
}

export function fetchLinkedInVisitors(token: string, accountId: string) {
  return linkedinJson<LinkedInVisitors>(token, `linkedin/visitors?${liQuery(accountId)}`);
}

// ---------------------------------------------------------------------------
// Social Post (publishing)
// ---------------------------------------------------------------------------

async function publishJson<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status})`), { errors: data.errors as string[] | undefined, status: response.status });
  return data as T;
}

export interface PublishConfig { storage: boolean; instagram: boolean; facebook: boolean; linkedin: boolean; google: boolean }
export const getPublishConfig = (token: string) => publishJson<PublishConfig>(token, 'GET', 'publish/config');
export const getPublishPlatforms = (token: string) => publishJson<{ platforms: { platform: PublishPlatform; accounts: number }[] }>(token, 'GET', 'publish/platforms');
export const getPublishAccounts = (token: string, platforms: PublishPlatform[]) =>
  publishJson<{ accounts: Partial<Record<PublishPlatform, PublishAccount[]>> }>(token, 'GET', `publish/accounts?platforms=${platforms.join(',')}`);

export const startUpload = (token: string, file: { fileName: string; mime: string; bytes: number }) =>
  publishJson<{ id: string; uploadUrl: string; publicUrl: string }>(token, 'POST', 'publish/uploads', file);
export const completeUpload = (token: string, id: string, meta: { width?: number | null; height?: number | null; duration?: number | null }) =>
  publishJson<{ asset: { id: string; public_url: string; bytes: number } }>(token, 'POST', `publish/uploads/${id}/complete`, meta);

export interface Place { id: string; name: string; detail?: string }
export const searchPlaces = (token: string, q: string) => publishJson<{ places: Place[] }>(token, 'GET', `publish/instagram/locations?q=${encodeURIComponent(q)}`);
export const searchProducts = (token: string, accountId: string, q: string) =>
  publishJson<{ shop: boolean; products: { id: string; name: string; image?: string; review?: string }[] }>(token, 'GET', `publish/instagram/products?accountId=${encodeURIComponent(accountId)}&q=${encodeURIComponent(q)}`);
export const getYoutubeCategories = (token: string, accountId: string, region = 'IN') =>
  publishJson<{ categories: { id: string; title: string }[] }>(token, 'GET', `publish/youtube/categories?accountId=${encodeURIComponent(accountId)}&region=${region}`);
export const getYoutubePlaylists = (token: string, accountId: string) =>
  publishJson<{ playlists: { id: string; title: string }[] }>(token, 'GET', `publish/youtube/playlists?accountId=${encodeURIComponent(accountId)}`);

export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'done' | 'partial' | 'failed';
export type TargetStatus = 'pending' | 'scheduled' | 'publishing' | 'done' | 'failed';
export interface PostSummary { id: string; status: PostStatus; schedule_at: string | null; created_at: string; updated_at: string; title: string | null; targets: { platform: PublishPlatform; status: TargetStatus; permalink: string | null }[] }
export interface PostTarget {
  id: string; platform: PublishPlatform; account_id: string; post_type: string; status: TargetStatus; step: string | null; schedule_at: string | null;
  native_scheduled: boolean; external_id: string | null; permalink: string | null; error_code: number | null; error_message: string | null; note: string | null; attempts: number; updated_at: string;
}
export interface AutoReplyLogRow {
  id: string; rule_id: string; comment_id: string | null; event_key: string; sender_username: string | null; keyword_matched: string | null; trigger_text: string | null;
  message_text: string | null; public_reply_text: string | null; status: string; skip_reason: string | null; error_code: number | null; error_message: string | null; note: string | null; created_at: string;
}
export interface PostDetail {
  post: { id: string; status: PostStatus; wizard_state: WizardState; schedule_at: string | null; timezone: string | null; created_at: string; updated_at: string };
  targets: PostTarget[];
  autoReplies: { id: string; post_target_id: string; is_active: boolean; keywords: string[]; match_type: string; media_id: string | null }[];
  autoReplyLog: AutoReplyLogRow[];
}
export interface SubmitTarget { platform: PublishPlatform; accountId: string; postType: string; fields: Record<string, unknown> }

export const listPosts = (token: string) => publishJson<{ posts: PostSummary[] }>(token, 'GET', 'publish/posts');
export const createDraft = (token: string, wizard: WizardState) => publishJson<{ post: { id: string } }>(token, 'POST', 'publish/posts', { wizard });
export const saveDraft = (token: string, id: string, wizard: WizardState) => publishJson<{ post: { id: string } }>(token, 'PATCH', `publish/posts/${id}`, { wizard });
export const deletePost = (token: string, id: string) => publishJson<void>(token, 'DELETE', `publish/posts/${id}`);
export const getPost = (token: string, id: string) => publishJson<PostDetail>(token, 'GET', `publish/posts/${id}`);
export const submitPost = (token: string, id: string, body: { targets: SubmitTarget[]; scheduleAt: string | null; timezone: string; autoReply: unknown; wizard: WizardState }) =>
  publishJson<{ id: string; scheduled: boolean }>(token, 'POST', `publish/posts/${id}/submit`, body);
export const retryTarget = (token: string, targetId: string) => publishJson<{ ok: true }>(token, 'POST', `publish/targets/${targetId}/retry`);

/** Sign-in pages for connecting (or reconnecting) a platform; you come back to `returnTo` afterwards. */
export async function getConnectUrl(token: string, kind: 'instagram' | 'facebook' | 'youtube' | 'linkedin' | 'linkedin_person', returnTo: string): Promise<string> {
  const origin = encodeURIComponent(window.location.origin);
  const back = encodeURIComponent(returnTo);
  const path = kind === 'instagram' ? 'instagram/connect-url'
    : kind === 'facebook' ? 'facebook/connect-url'
    : kind === 'youtube' ? 'google/connect-url'
      : 'linkedin/connect-url';
  const extra = kind === 'linkedin_person' ? '&type=person' : '';
  oauthLog('connect_url.request', { kind, origin: window.location.origin, returnTo, endpoint: `${API_BASE}/${path}` });
  try {
    const data = await publishJson<{ url: string; flowId?: string }>(token, 'GET', `${path}?origin=${origin}&returnTo=${back}${extra}`);
    const u = new URL(data.url);
    const sent = {
      flowId: data.flowId, host: u.host, path: u.pathname,
      client_id: u.searchParams.get('client_id'), redirect_uri: u.searchParams.get('redirect_uri'),
      scope: u.searchParams.get('scope'), config_id: u.searchParams.get('config_id'),
    };
    oauthLog('connect_url.received', sent);
    if (kind === 'instagram' || kind === 'facebook') {
      rememberFlow(kind, data.flowId);
      sendOAuthStep(token, kind, 'leaving_for_meta', { ...sent, page: window.location.href }, data.flowId);
    }
    return data.url;
  } catch (err) {
    const failed = { kind, error: err instanceof Error ? err.message : String(err), status: (err as { status?: number }).status };
    oauthLog('connect_url.failed', failed);
    if (kind === 'instagram' || kind === 'facebook') sendOAuthStep(token, kind, 'connect_url_failed', { ...failed, page: window.location.href });
    throw err;
  }
}

/** One step of a Connect Instagram / Connect Facebook attempt, as stored on the server (shown in the Connection log). */
export interface OAuthLogEntry {
  id: number; flow_id: string; platform: 'instagram' | 'facebook'; seq: number; step: string;
  details: Record<string, unknown> | null; server: string | null; created_at: string;
}
export const getOAuthLog = (token: string) => publishJson<{ entries: OAuthLogEntry[] }>(token, 'GET', 'oauth-log');
export const clearOAuthLog = (token: string) => publishJson<void>(token, 'DELETE', 'oauth-log');

const FLOW_KEY = 'oauthLastFlow';
function rememberFlow(platform: string, flowId?: string) {
  try { if (flowId) localStorage.setItem(FLOW_KEY, JSON.stringify({ platform, flowId })); } catch { /* storage blocked */ }
}
/** The attempt that was in progress before Meta sent the browser back, so the "returned" step joins it. */
export function lastFlowId(platform: string): string | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(FLOW_KEY) || 'null');
    return v?.platform === platform ? v.flowId : undefined;
  } catch { return undefined; }
}

/** Adds a browser-side step to the server log. Never throws: logging must not break the Connect button. */
export function sendOAuthStep(token: string, platform: 'instagram' | 'facebook', step: string, details: unknown, flowId?: string) {
  fetch(`${API_BASE}/oauth-log`, {
    method: 'POST',
    keepalive: true, // the page is about to leave for Meta
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform, step, details, flowId }),
  }).catch(() => {});
}

export interface FacebookPage { id: string; page_id: string; name: string; picture_url: string | null; ig_user_id: string | null; created_at: string }
export const getFacebookPages = (token: string) => publishJson<{ configured: boolean; pages: FacebookPage[] }>(token, 'GET', 'facebook-pages');
export const deleteFacebookPage = (token: string, id: string) => publishJson<void>(token, 'DELETE', `facebook-pages/${id}`);

export interface FacebookTokenResult {
  kind: 'page' | 'user';
  pages: { page_id: string; name: string; ig_user_id: string | null }[];
  /** null = never expires */
  expires_at: string | null;
  made_long_lived: boolean;
  /** The token was made by another Meta app (e.g. Graph API Explorer's): fine for posting, not for webhooks. */
  other_app: boolean;
}
/** Adds Pages with a Page or User access token pasted by hand (e.g. from Graph API Explorer). */
export const addFacebookPageToken = (token: string, pageToken: string) =>
  publishJson<FacebookTokenResult>(token, 'POST', 'facebook-pages/token', { token: pageToken });

// ---------------------------------------------------------------------------
// Facebook Page insights (live from the Graph API)
// ---------------------------------------------------------------------------

export type FacebookMetric =
  | 'views' | 'reach' | 'engagements' | 'reactions' | 'follows' | 'unfollows' | 'followers_total' | 'page_visits' | 'actions'
  | 'new_conversations' | 'video_views' | 'video_views_organic' | 'video_views_paid' | 'video_autoplayed' | 'video_click_to_play'
  | 'video_complete_30s' | 'video_repeat_views' | 'watch_minutes';

export interface FacebookPageProfile {
  id: string;
  page_id: string;
  name: string;
  username: string | null;
  about: string | null;
  category: string | null;
  link: string;
  website: string | null;
  followers: number | null;
  likes: number | null;
  talking_about: number | null;
  checkins: number | null;
  rating_count: number | null;
  rating: number | null;
  verified: boolean | null;
  picture_url: string | null;
  cover_url: string | null;
}

export type FacebookDailyRow = { date: string } & Partial<Record<FacebookMetric, number | null>>;

export interface FacebookDaily {
  account_id: string;
  /** `stored`: read from the saved days (preset ranges). `live`: fetched from Facebook for this request. */
  source: 'stored' | 'live';
  last_synced_at: string | null;
  range: { since: string; until: string; days: number; previous_since: string; previous_until: string };
  fetched_at: string;
  /** Which Graph metric name answered for each of our metrics (missing = unavailable). */
  metrics: Partial<Record<FacebookMetric, string>>;
  unavailable: { metric: FacebookMetric; code: number; message: string }[];
  totals: Partial<Record<FacebookMetric, number>>;
  deltas: Partial<Record<FacebookMetric, MetricDelta>>;
  breakdowns: {
    reactions: Record<string, number> | null;
    views_by_audience: { followers: number; non_followers: number } | null;
    views_by_source: { organic: number; ads: number } | null;
  };
  daily: FacebookDailyRow[];
}

export interface FacebookPost {
  id: string;
  message: string | null;
  created_time: string;
  permalink: string | null;
  picture: string | null;
  type: string | null;
  views: number | null;
  reach: number | null;
  clicks: number;
  reactions: number;
  reactions_by_type: Record<string, number> | null;
  comments: number;
  shares: number;
  interactions: number;
  video_views: number | null;
  avg_watch_seconds: number | null;
  engagement_rate: number | null;
}

export interface FacebookReel {
  id: string;
  description: string | null;
  created_time: string;
  permalink: string | null;
  picture: string | null;
  length_seconds: number | null;
  plays: number | null;
  initial_plays: number | null;
  replays: number | null;
  avg_watch_seconds: number | null;
  watch_minutes: number | null;
  followers_gained: number | null;
  reactions: number;
  comments: number;
  shares: number;
}

export interface FacebookAudience {
  country: { label: string; value: number }[];
  city: { label: string; value: number }[];
  unavailable?: boolean;
  reason?: string;
}

const fbQuery = (accountId: string, extra: Record<string, string> = {}) => new URLSearchParams({ accountId, ...extra }).toString();

export const fetchFacebookProfile = (token: string, accountId: string) =>
  publishJson<FacebookPageProfile>(token, 'GET', `facebook/insights/profile?${fbQuery(accountId)}`);
/** `live`: fetch from Facebook instead of the saved days (custom ranges). */
const fbRange = (accountId: string, since: string, until: string, live: boolean) => fbQuery(accountId, live ? { since, until, live: '1' } : { since, until });
export const fetchFacebookDaily = (token: string, accountId: string, since: string, until: string, live = false) =>
  publishJson<FacebookDaily>(token, 'GET', `facebook/insights/daily?${fbRange(accountId, since, until, live)}`);
export const fetchFacebookPosts = (token: string, accountId: string, since: string, until: string, live = false) =>
  publishJson<{ posts: FacebookPost[]; insights?: boolean; unavailable?: boolean; reason?: string; source?: 'stored' | 'live' }>(token, 'GET', `facebook/insights/posts?${fbRange(accountId, since, until, live)}`);
export const fetchFacebookReels = (token: string, accountId: string, since: string, until: string, live = false) =>
  publishJson<{ reels: FacebookReel[]; unavailable?: boolean; reason?: string; source?: 'stored' | 'live' }>(token, 'GET', `facebook/insights/reels?${fbRange(accountId, since, until, live)}`);
export const fetchFacebookAudience = (token: string, accountId: string) =>
  publishJson<FacebookAudience>(token, 'GET', `facebook/insights/audience?${fbQuery(accountId)}`);

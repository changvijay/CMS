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
  access_token: string;
  page_id: string;
  created_at: string;
}

export interface YoutubeAccount {
  id: string | number;
  user_id: string | number;
  channel_name: string;
  access_token: string;
  playlist_id: string;
  created_at: string;
}

export interface ConsolidatedYoutubeDashboardResponse {
  account: {
    id: string | number;
    user_id: string | number;
    channel_name: string;
    playlist_id: string;
    table_name: string;
  };
  channel: {
    title: string;
    subscriber_count: number;
    total_views: number;
    video_count: number;
    playlist_id: string;
  };
  summary_report: {
    views: number;
    estimatedMinutesWatched: number;
    averageViewDuration: number;
    likes: number;
    comments: number;
    shares: number;
    subscribersGained: number;
    subscribersLost: number;
    netSubscribers: number;
  };
  daily_graph: Array<{
    day: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    estimatedMinutesWatched: number;
    subscribersGained: number;
    subscribersLost: number;
  }>;
  top_videos_report: Array<{
    id: string;
    title: string;
    description: string;
    publishedAt: string;
    thumbnailUrl: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    estimatedMinutesWatched: number;
    averageViewDuration: number;
    subscribersGained: number;
    subscribersLost: number;
    duration: string;
  }>;
  playlist_items: any[];
  raw: any;
  fetched_at: string;
}

export interface HealthStatus {
  status: string;
  timestamp: string;
  database: {
    connected: boolean;
    mode: string;
    config: {
      host: string;
      port: string;
      database: string;
    };
  };
}

export interface ConsolidatedDashboardResponse {
  account: {
    id: string | number;
    user_id: string | number;
    page_name: string;
    page_id: string;
  };
  summary: {
    media: any[];
    weekly_metrics: any[];
    daily_metrics: any[];
    follower_trend: any[];
    online_followers: any[];
  };
  raw: {
    media: any;
    weekly_insights: any;
    daily_insights: any;
    followers_trend: any;
    online_followers: any;
  };
  fetched_at: string;
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

export async function fetchConsolidatedInstagramDashboard(
  token: string,
  accountId?: string | number,
  since?: string,
  until?: string,
  limit = 7,
  topPerformers = false
): Promise<ConsolidatedDashboardResponse> {
  const params = new URLSearchParams();
  if (accountId) params.append('accountId', String(accountId));
  if (since) params.append('since', since);
  if (until) params.append('until', until);
  params.append('limit', String(limit));
  if (topPerformers) params.append('topPerformers', 'true');

  const response = await fetch(`${API_BASE}/instagram/dashboard-summary?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load consolidated Instagram dashboard summary');
  }
  return data;
}

// ============================================================================
// YOUTUBE DASHBOARD API CALLERS
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

export async function fetchConsolidatedYoutubeDashboard(
  token: string,
  accountId?: string | number,
  since?: string,
  until?: string,
  limit = 7
): Promise<ConsolidatedYoutubeDashboardResponse> {
  const params = new URLSearchParams();
  if (accountId) params.append('accountId', String(accountId));
  if (since) params.append('since', since);
  if (until) params.append('until', until);
  params.append('limit', String(limit));

  const response = await fetch(`${API_BASE}/youtube/dashboard-summary?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load YouTube analytics summary');
  }
  return data;
}

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
  since = '2026-08-01',
  until = '2026-08-31',
  limit = 7
): Promise<ConsolidatedDashboardResponse> {
  const params = new URLSearchParams();
  if (accountId) params.append('accountId', String(accountId));
  params.append('since', since);
  params.append('until', until);
  params.append('limit', String(limit));

  const response = await fetch(`${API_BASE}/instagram/dashboard-summary?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load consolidated Instagram dashboard summary');
  }
  return data;
}

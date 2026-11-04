import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import swaggerUi from 'swagger-ui-express';
import { canUpload, getGoogleAccessTokenFromRefreshToken } from './services/googleAuth.js';
import { createHistoryRouter } from './routes/history.js';
import { createAccountsRouter } from './routes/accounts.js';
import { createLinkedInRouter } from './routes/linkedin.js';
import { createLinkedInInsightsRouter } from './routes/linkedinInsights.js';
import { createInsightsRouter } from './routes/insights.js';
import { createDeepRouter } from './routes/deep.js';
import { createWebhooksRouter } from './routes/webhooks.js';
import { createAutomationRouter } from './routes/automation.js';
import { createFacebookRouter } from './routes/facebook.js';
import { createGoogleRouter } from './routes/google.js';
import { createInstagramRouter } from './routes/instagram.js';
import { createPublishRouter } from './routes/publish.js';
import { createOAuthLogRouter, startOAuthLogSink } from './routes/oauthLog.js';
import { startPublishSchedule } from './jobs/publishQueue.js';
import { tokenStatus } from './services/instagramAuth.js';
import { checkToken as checkInstagramToken } from './services/instagramMessaging.js';
import { startSnapshotSchedule } from './jobs/snapshot.js';
import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  initDb,
  getDbStatus,
  findUserByUsernameOrEmail,
  findUserById,
  updateUserPassword,
  getInstagramAccountsByUserId,
  getYoutubeAccountsByUserId,
  getDataFromTable,
} from './db.js';

dotenv.config();

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception thrown:', err);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, '../dist');

const app = express();
const PORT = parseInt(process.env.PORT || '8080', 10);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_SECRET is not set. Refusing to start without a signing secret.');
  process.exit(1);
}

const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : undefined));
// Cloud Run (and most hosts) terminate TLS in front of us; trust the forwarded protocol/host.
app.set('trust proxy', true);
// Keep the raw body: Instagram's webhook signature is computed over the exact bytes it sent.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
// index.html is never cached, so after a deploy the browser picks up the new file names straight away.
// Hashed files under /assets never change, so they can be cached for good.
app.use(express.static(distPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    else if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
}));

// Initialize Database connection on boot
initDb();

// Swagger / OpenAPI Setup
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'CMS Instagram Auth & Accounts API',
      version: '1.0.0',
      description: 'Node.js Express + PostgreSQL authentication and Instagram Graph API v24.0 integration',
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: 'Local Express Backend Server',
      },
      {
        url: 'http://localhost:5173',
        description: 'Vite Frontend Proxy Server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            username: { type: 'string', example: 'john_doe' },
            email_address: { type: 'string', example: 'user@example.com' },
            phone_number: { type: 'string', example: '+1234567890' },
            is_active: { type: 'boolean', example: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        InstagramAccount: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            user_id: { type: 'integer', example: 1 },
            page_name: { type: 'string', example: 'Sample Instagram Page' },
            access_token: { type: 'string', example: 'EAAGm0PXza10BO7...' },
            page_id: { type: 'string', example: '100000000000000' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
  apis: ['./server/index.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required. Please login.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired session token.' });
    }
    req.user = decoded;
    next();
  });
}

// Helper to get selected or primary instagram account with token for authenticated user
async function getAccountForUser(userId, accountId) {
  const accounts = await getInstagramAccountsByUserId(userId);
  if (!accounts || accounts.length === 0) {
    return null;
  }
  if (accountId) {
    const found = accounts.find((a) => String(a.id) === String(accountId));
    if (found) return found;
  }
  return accounts[0];
}

app.get('/api/health', (req, res) => {
  const status = getDbStatus();
  const host = req.get('host');
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: status,
    swagger: `${protocol}://${host}/api-docs`,
  });
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username/Email and Password are required.' });
    }

    const user = await findUserByUsernameOrEmail(username.trim());

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials. User not found. try again' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Please contact support.' });
    }

    // Verify Password using bcrypt hash or string match
    let isValidPassword = false;
    let isPlaintextMatch = false;

    if (user.password_hash.startsWith('$2a$') || user.password_hash.startsWith('$2b$')) {
      isValidPassword = await bcrypt.compare(password, user.password_hash);
    } else {
      isValidPassword = user.password_hash === password;
      isPlaintextMatch = isValidPassword;
    }

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Upgrade unhashed password to bcrypt hash in database
    if (isPlaintextMatch) {
      try {
        const hashed = await bcrypt.hash(password, 10);
        await updateUserPassword(user.id, hashed);
      } catch (hashErr) {
        console.error('Password hash upgrade error:', hashErr.message);
      }
    }

    // Generate JWT Token
    const tokenPayload = {
      userId: user.id,
      username: user.username,
      email: user.email_address,
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

    const userProfile = {
      id: user.id,
      username: user.username,
      email_address: user.email_address,
      phone_number: user.phone_number,
      is_active: user.is_active,
      created_at: user.created_at,
    };

    return res.json({
      message: 'Login successful',
      token,
      user: userProfile,
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Server error during login authentication.' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await findUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found.' });
    }
    return res.json({ user });
  } catch (error) {
    console.error('Error fetching profile:', error);
    return res.status(500).json({ error: 'Server error fetching user profile.' });
  }
});

app.get('/api/instagram-accounts', authenticateToken, async (req, res) => {
  try {
    const rows = await getInstagramAccountsByUserId(req.user.userId);
    // Only when renewing failed do we spend an API call to see whether the token still works.
    const accounts = await Promise.all(rows.map(async ({ access_token, last_refresh_failed_at, ...safe }) => {
      const liveOk = safe.last_refresh_error ? !(await checkInstagramToken({ ...safe, access_token })).error : null;
      return { ...safe, token: tokenStatus(safe, liveOk) };
    }));
    return res.json({ accounts });
  } catch (error) {
    console.error('Error fetching instagram accounts:', error);
    return res.status(500).json({ error: 'Server error fetching Instagram accounts.' });
  }
});

app.get('/api/youtube-accounts', authenticateToken, async (req, res) => {
  try {
    const tableName = req.query.tableName || 'Youtube_accounts';
    const rows = await getDataFromTable(tableName, req.user.userId);
    // Google refresh tokens don't expire on a schedule, so a real exchange is the only honest status check.
    const accounts = await Promise.all(rows.map(async ({ access_token, ...safe }) => {
      let status = 'ok';
      let message = null;
      try {
        await getGoogleAccessTokenFromRefreshToken(access_token);
      } catch (err) {
        status = 'expired';
        message = err.message;
      }
      return { ...safe, token: { status, message, can_upload: canUpload(safe.scope) } };
    }));
    return res.json({ table_name: tableName, accounts });
  } catch (error) {
    console.error('Error fetching youtube accounts:', error);
    return res.status(500).json({ error: 'Server error fetching YouTube accounts from Youtube_accounts table.' });
  }
});

// ============================================================================
// INSTAGRAM GRAPH API v24.0 ENDPOINTS (Using DB Access Token)
// ============================================================================

function getIstMidnightSeconds(dateObj = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const istDateStr = formatter.format(dateObj); // "YYYY-MM-DD"
  const istMidnightIso = `${istDateStr}T00:00:00+05:30`;
  return Math.floor(new Date(istMidnightIso).getTime() / 1000);
}

function getIstWindowTimestamps(sinceQuery, untilQuery) {
  const parseVal = (val, defaultSec) => {
    if (!val) return defaultSec;
    if (/^\d+$/.test(String(val))) return parseInt(val, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(val))) {
      return Math.floor(new Date(`${val}T00:00:00+05:30`).getTime() / 1000);
    }
    return Math.floor(new Date(val).getTime() / 1000);
  };

  const now = new Date();
  const untilSec = parseVal(untilQuery, getIstMidnightSeconds(now));
  // 30 days prior in seconds
  const defaultSinceSec = untilSec - 30 * 24 * 60 * 60;
  const sinceSec = parseVal(sinceQuery, defaultSinceSec);

  return { sinceSec, untilSec };
}

function getInsightMetricVal(insights, metricName) {
  if (!insights) return undefined;
  const list = Array.isArray(insights) ? insights : Array.isArray(insights?.data) ? insights.data : null;
  if (!list) return undefined;

  const item = list.find((m) => m.name === metricName || (metricName === 'saved' && m.name === 'saves'));
  if (!item) return undefined;

  if (typeof item.values?.[0]?.value === 'number') {
    return item.values[0].value;
  }
  if (typeof item.value === 'number') {
    return item.value;
  }
  return undefined;
}

function calcMediaPerformance(mediaItem) {
  if (!mediaItem) return 0;
  const reach = getInsightMetricVal(mediaItem.insights, 'reach') || 0;
  const views = getInsightMetricVal(mediaItem.insights, 'views') || 0;
  const likes = getInsightMetricVal(mediaItem.insights, 'likes') ?? mediaItem.like_count ?? 0;
  const comments = getInsightMetricVal(mediaItem.insights, 'comments') ?? mediaItem.comments_count ?? 0;
  const saved = getInsightMetricVal(mediaItem.insights, 'saved') ?? getInsightMetricVal(mediaItem.insights, 'saves') ?? 0;
  const shares = getInsightMetricVal(mediaItem.insights, 'shares') || 0;
  return reach + views + likes * 2 + comments * 3 + saved * 4 + shares * 5;
}

async function fetchDailyInsightsSafely(pageId, tokenEncoded, sinceSec, untilSec) {
  const extendedMetrics = 'reach,views,likes,comments,saves,shares,replies,total_interactions,accounts_engaged,profile_links_taps';
  const coreMetrics = 'reach,views,likes,comments,saves,shares,total_interactions,accounts_engaged';
  const basicMetrics = 'reach,likes,comments,shares';

  try {
    const url = `https://graph.instagram.com/v24.0/${pageId}/insights?metric=${extendedMetrics}&period=day&metric_type=total_value&access_token=${tokenEncoded}`;
    const res = await fetch(url).then((r) => r.json());
    if (Array.isArray(res?.data) && res.data.length > 0) return res;
  } catch (e) { }

  try {
    const url = `https://graph.instagram.com/v24.0/${pageId}/insights?metric=${coreMetrics}&period=day&metric_type=total_value&access_token=${tokenEncoded}`;
    const res = await fetch(url).then((r) => r.json());
    if (Array.isArray(res?.data) && res.data.length > 0) return res;
  } catch (e) { }

  try {
    const url = `https://graph.instagram.com/v24.0/${pageId}/insights?metric=${basicMetrics}&period=day&access_token=${tokenEncoded}`;
    const res = await fetch(url).then((r) => r.json());
    if (Array.isArray(res?.data) && res.data.length > 0) return res;
  } catch (e) { }

  return { data: [] };
}

async function fetchWeeklyInsightsSafely(pageId, tokenEncoded, sinceSec, untilSec) {
  try {
    const url = `https://graph.instagram.com/v24.0/${pageId}/insights?metric=reach,views,total_interactions,accounts_engaged&period=days_28&metric_type=total_value&since=${sinceSec}&until=${untilSec}&access_token=${tokenEncoded}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en-US' } }).then((r) => r.json());
    if (Array.isArray(res?.data) && res.data.length > 0) return res;
  } catch (e) { }

  try {
    const url = `https://graph.instagram.com/v24.0/${pageId}/insights?metric=reach,total_interactions&period=days_28&since=${sinceSec}&until=${untilSec}&access_token=${tokenEncoded}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en-US' } }).then((r) => r.json());
    if (Array.isArray(res?.data) && res.data.length > 0) return res;
  } catch (e) { }

  return { data: [] };
}

app.get('/api/instagram/dashboard-summary', authenticateToken, async (req, res) => {
  try {
    const account = await getAccountForUser(req.user.userId, req.query.accountId);
    if (!account) {
      return res.status(404).json({ error: 'No connected Instagram account found in database for user.' });
    }

    const { sinceSec, untilSec } = getIstWindowTimestamps(req.query.since, req.query.until);
    const tokenEncoded = encodeURIComponent(account.access_token);

    const isTopPerformers = req.query.topPerformers === 'true';
    const limit = isTopPerformers ? 50 : (parseInt(req.query.limit, 10) || 7);
    const mediaUrl = `https://graph.instagram.com/v24.0/me/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,permalink,like_count,comments_count,shortcode,is_comment_enabled&limit=${limit}&access_token=${tokenEncoded}`;
    const trendUrl = `https://graph.instagram.com/v24.0/${account.page_id}/insights?metric=follower_count&period=day&since=${sinceSec}&until=${untilSec}&access_token=${tokenEncoded}`;
    const onlineUrl = `https://graph.instagram.com/v24.0/${account.page_id}/insights?metric=online_followers&period=lifetime&access_token=${tokenEncoded}`;

    const [mediaRes, weeklyRes, dailyRes, trendRes, onlineRes] = await Promise.allSettled([
      fetch(mediaUrl).then((r) => r.json()),
      fetchWeeklyInsightsSafely(account.page_id, tokenEncoded, sinceSec, untilSec),
      fetchDailyInsightsSafely(account.page_id, tokenEncoded, sinceSec, untilSec),
      fetch(trendUrl).then((r) => r.json()),
      fetch(onlineUrl).then((r) => r.json()),
    ]);
    const getValue = (settled) => (settled.status === 'fulfilled' ? settled.value : { error: settled.reason?.message || 'Request failed' });

    const mediaData = getValue(mediaRes);
    const weeklyData = getValue(weeklyRes);
    const dailyData = getValue(dailyRes);
    const trendData = getValue(trendRes);
    const onlineData = getValue(onlineRes);

    let rawMediaItems = mediaData?.data || [];
    if (Array.isArray(rawMediaItems) && rawMediaItems.length > 0) {
      rawMediaItems = await Promise.all(
        rawMediaItems.map(async (mediaItem) => {
          if (!mediaItem?.id) return mediaItem;
          try {
            const insightsUrl = `https://graph.instagram.com/v24.0/${mediaItem.id}/insights?metric=reach,views,likes,comments,saved,shares&access_token=${tokenEncoded}`;
            const insightsRes = await fetch(insightsUrl, {
              headers: { 'Accept-Language': 'en-US' },
            });
            const insightsJson = await insightsRes.json();
            return {
              ...mediaItem,
              insights: insightsJson?.data || insightsJson,
            };
          } catch (err) {
            return {
              ...mediaItem,
              insights: { error: err.message || 'Failed to fetch media insights' },
            };
          }
        })
      );
    }

    if (isTopPerformers && Array.isArray(rawMediaItems)) {
      rawMediaItems.sort((a, b) => calcMediaPerformance(b) - calcMediaPerformance(a));
      rawMediaItems = rawMediaItems.slice(0, 10);
    }

    const consolidatedJSON = {
      account: {
        id: account.id,
        user_id: account.user_id,
        page_name: account.page_name,
        page_id: account.page_id,
      },
      summary: {
        media: rawMediaItems,
        weekly_metrics: weeklyData?.data || [],
        daily_metrics: dailyData?.data || [],
        follower_trend: trendData?.data || [],
        online_followers: onlineData?.data || [],
      },
      fetched_at: new Date().toISOString(),
    };

    return res.json(consolidatedJSON);
  } catch (error) {
    console.error('Error fetching consolidated Instagram summary:', error);
    return res.status(500).json({ error: 'Failed to generate consolidated Instagram dashboard summary.' });
  }
});

app.get('/api/instagram/media', authenticateToken, async (req, res) => {
  try {
    const account = await getAccountForUser(req.user.userId, req.query.accountId);
    if (!account) {
      return res.status(404).json({ error: 'No connected Instagram account found for this user.' });
    }

    const limit = req.query.limit || 7;
    const tokenEncoded = encodeURIComponent(account.access_token);
    const url = `https://graph.instagram.com/v24.0/me/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,permalink,like_count,comments_count,shortcode,is_comment_enabled&limit=${limit}&access_token=${tokenEncoded}`;

    const response = await fetch(url);
    const data = await response.json();

    if (Array.isArray(data?.data)) {
      data.data = await Promise.all(
        data.data.map(async (mediaItem) => {
          if (!mediaItem?.id) return mediaItem;
          try {
            const insightsUrl = `https://graph.instagram.com/v24.0/${mediaItem.id}/insights?metric=reach,views,likes,comments,saved,shares&access_token=${tokenEncoded}`;
            const insightsRes = await fetch(insightsUrl, {
              headers: { 'Accept-Language': 'en-US' },
            });
            const insightsJson = await insightsRes.json();
            return {
              ...mediaItem,
              insights: insightsJson?.data || insightsJson,
            };
          } catch (err) {
            return {
              ...mediaItem,
              insights: { error: err.message || 'Failed to fetch media insights' },
            };
          }
        })
      );
    }

    return res.status(response.status).json({
      account_id: account.id,
      page_name: account.page_name,
      graph_response: data,
    });
  } catch (error) {
    console.error('Error fetching Instagram media:', error);
    return res.status(500).json({ error: 'Failed to call Instagram Graph API for media.' });
  }
});

app.get('/api/instagram/insights/weekly', authenticateToken, async (req, res) => {
  try {
    const account = await getAccountForUser(req.user.userId, req.query.accountId);
    if (!account) {
      return res.status(404).json({ error: 'No connected Instagram account found for this user.' });
    }

    const { sinceSec, untilSec } = getIstWindowTimestamps(req.query.since, req.query.until);
    const tokenEncoded = encodeURIComponent(account.access_token);
    const url = `https://graph.instagram.com/v24.0/${account.page_id}/insights?metric=reach,views,total_interactions,accounts_engaged&period=days_28&metric_type=total_value&since=${sinceSec}&until=${untilSec}&access_token=${tokenEncoded}`;

    const response = await fetch(url, {
      headers: { 'Accept-Language': 'en-US' },
    });
    const data = await response.json();
    return res.status(response.status).json({
      account_id: account.id,
      page_id: account.page_id,
      since: sinceSec,
      until: untilSec,
      graph_response: data,
    });
  } catch (error) {
    console.error('Error fetching weekly insights:', error);
    return res.status(500).json({ error: 'Failed to call Instagram Graph API for weekly insights.' });
  }
});

app.get('/api/instagram/insights/daily', authenticateToken, async (req, res) => {
  try {
    const account = await getAccountForUser(req.user.userId, req.query.accountId);
    if (!account) {
      return res.status(404).json({ error: 'No connected Instagram account found for this user.' });
    }

    const metrics = 'reach,views,likes,comments,saves,shares,replies,total_interactions,accounts_engaged,profile_links_taps,follower_count';
    const url = `https://graph.instagram.com/v24.0/${account.page_id}/insights?metric=${metrics}&period=day&metric_type=total_value&access_token=${encodeURIComponent(account.access_token)}`;

    const response = await fetch(url);
    const data = await response.json();
    return res.status(response.status).json({
      account_id: account.id,
      page_id: account.page_id,
      graph_response: data,
    });
  } catch (error) {
    console.error('Error fetching daily insights:', error);
    return res.status(500).json({ error: 'Failed to call Instagram Graph API for daily insights.' });
  }
});

app.get('/api/instagram/insights/followers-trend', authenticateToken, async (req, res) => {
  try {
    const account = await getAccountForUser(req.user.userId, req.query.accountId);
    if (!account) {
      return res.status(404).json({ error: 'No connected Instagram account found for this user.' });
    }

    const { sinceSec, untilSec } = getIstWindowTimestamps(req.query.since, req.query.until);

    const url = `https://graph.instagram.com/v24.0/${account.page_id}/insights?metric=follower_count&period=day&since=${sinceSec}&until=${untilSec}&access_token=${encodeURIComponent(account.access_token)}`;

    const response = await fetch(url);
    const data = await response.json();
    return res.status(response.status).json({
      account_id: account.id,
      page_id: account.page_id,
      since: sinceSec,
      until: untilSec,
      graph_response: data,
    });
  } catch (error) {
    console.error('Error fetching follower trend insights:', error);
    return res.status(500).json({ error: 'Failed to call Instagram Graph API for follower trend.' });
  }
});

app.get('/api/instagram/insights/online-followers', authenticateToken, async (req, res) => {
  try {
    const account = await getAccountForUser(req.user.userId, req.query.accountId);
    if (!account) {
      return res.status(404).json({ error: 'No connected Instagram account found for this user.' });
    }

    const url = `https://graph.instagram.com/v24.0/${account.page_id}/insights?metric=online_followers&period=lifetime&access_token=${encodeURIComponent(account.access_token)}`;

    const response = await fetch(url);
    const data = await response.json();
    return res.status(response.status).json({
      account_id: account.id,
      page_id: account.page_id,
      graph_response: data,
    });
  } catch (error) {
    console.error('Error fetching online followers insights:', error);
    return res.status(500).json({ error: 'Failed to call Instagram Graph API for online followers.' });
  }
});

// ============================================================================
// YOUTUBE DATA API v3 & YOUTUBE ANALYTICS API v2 ENDPOINTS
// ============================================================================

async function getYoutubeAccountForUser(userId, accountId) {
  const accounts = await getYoutubeAccountsByUserId(userId);
  if (!accounts || accounts.length === 0) {
    return null;
  }
  if (accountId) {
    const found = accounts.find((a) => String(a.id) === String(accountId));
    if (found) return found;
  }
  return accounts[0];
}

function youtubeErrorResponse(res, account, status, errorDetails, extra = {}) {
  const httpStatus = Number.isInteger(status) && status >= 400 && status < 600 ? status : 502;
  return res.status(httpStatus).json({
    account: {
      id: account.id,
      user_id: account.user_id,
      channel_name: account.channel_name,
      playlist_id: account.playlist_id,
      table_name: 'Youtube_accounts',
    },
    is_live_api: false,
    error_details: errorDetails,
    ...extra,
    fetched_at: new Date().toISOString(),
  });
}

app.get('/api/youtube/dashboard-summary', authenticateToken, async (req, res) => {
  try {
    const account = await getYoutubeAccountForUser(req.user.userId, req.query.accountId);
    if (!account) {
      return res.status(404).json({ error: 'No connected YouTube account found in Youtube_accounts table for user.' });
    }

    const { sinceSec, untilSec } = getIstWindowTimestamps(req.query.since, req.query.until);
    const startDateStr = req.query.since || new Date(sinceSec * 1000).toISOString().split('T')[0];
    const endDateStr = req.query.until || new Date(untilSec * 1000).toISOString().split('T')[0];
    const limit = parseInt(req.query.limit, 10) || 7;

    // Check if token is present (not empty, not dummy placeholder '******')
    const rawToken = account.access_token ? account.access_token.trim() : '';

    if (rawToken && rawToken !== '******') {
      let token = '';
      try {
        token = await getGoogleAccessTokenFromRefreshToken(rawToken);
      } catch (tokenErr) {
        console.warn('Google OAuth Token Refresh failed:', tokenErr.message);
        return youtubeErrorResponse(res, account, tokenErr.status || 401, {
          code: tokenErr.status || 401,
          message: tokenErr.message,
          reason: tokenErr.reason,
        });
      }

      try {
        const authHeaders = {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        };

        const encodedToken = encodeURIComponent(token);
        const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&mine=true&access_token=${encodedToken}`;
        const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${account.playlist_id}&maxResults=${limit}&access_token=${encodedToken}`;
        const summaryAnalyticsUrl = `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${startDateStr}&endDate=${endDateStr}&metrics=views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscribersGained,subscribersLost&access_token=${encodedToken}`;
        const dailyAnalyticsUrl = `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${startDateStr}&endDate=${endDateStr}&dimensions=day&metrics=views,likes,comments,shares,estimatedMinutesWatched,subscribersGained,subscribersLost&sort=day&access_token=${encodedToken}`;

        const [chanRes, playRes, sumRes, dailyRes] = await Promise.allSettled([
          fetch(channelUrl, { headers: authHeaders }).then((r) => r.json()),
          fetch(playlistUrl, { headers: authHeaders }).then((r) => r.json()),
          fetch(summaryAnalyticsUrl, { headers: authHeaders }).then((r) => r.json()),
          fetch(dailyAnalyticsUrl, { headers: authHeaders }).then((r) => r.json()),
        ]);

        const chanData = chanRes.status === 'fulfilled' ? chanRes.value : {};
        const playData = playRes.status === 'fulfilled' ? playRes.value : {};
        const sumData = sumRes.status === 'fulfilled' ? sumRes.value : {};
        const dailyData = dailyRes.status === 'fulfilled' ? dailyRes.value : {};

        // Extract video IDs from playlist items and call videos API
        let videosData = {};
        const videoIdsArr = (playData?.items || [])
          .map((i) => i.snippet?.resourceId?.videoId || i.contentDetails?.videoId)
          .filter(Boolean);

        if (videoIdsArr.length > 0) {
          const videoIdsStr = videoIdsArr.join(',');
          const videosUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${encodeURIComponent(videoIdsStr)}&access_token=${encodedToken}`;
          try {
            const vRes = await fetch(videosUrl, { headers: authHeaders });
            videosData = await vRes.json();
          } catch (vErr) {
            console.warn('Failed to fetch video details from Google API:', vErr.message);
          }
        }

        // Check for Google API error objects (e.g. 401 Token Expired / Invalid Credentials)
        const apiError = chanData.error || playData.error || sumData.error || dailyData.error || videosData.error;
        if (apiError && (!chanData.items || chanData.items.length === 0)) {
          console.warn('Google YouTube API Returned Error:', apiError);
          return youtubeErrorResponse(res, account, apiError.code || 502, apiError, {
            google_api_errors: {
              channels: chanData.error || null,
              playlist_items: playData.error || null,
              videos: videosData.error || null,
              summary_analytics: sumData.error || null,
              daily_analytics: dailyData.error || null,
            },
            raw: {
              channels_api: chanData,
              playlist_items_api: playData,
              videos_api: videosData,
              summary_analytics_api: sumData,
              daily_analytics_api: dailyData,
            },
          });
        }

        if (chanData.items && chanData.items.length > 0) {
          const topVideos = (videosData.items || []).map((v) => ({
            id: v.id,
            title: v.snippet?.title || 'Untitled Video',
            description: v.snippet?.description || '',
            thumbnailUrl: v.snippet?.thumbnails?.high?.url || v.snippet?.thumbnails?.medium?.url || '',
            publishedAt: v.snippet?.publishedAt || '',
            views: parseInt(v.statistics?.viewCount || '0', 10),
            likes: parseInt(v.statistics?.likeCount || '0', 10),
            comments: parseInt(v.statistics?.commentCount || '0', 10),
            duration: v.contentDetails?.duration || '',
          }));

          return res.json({
            account: {
              id: account.id,
              user_id: account.user_id,
              channel_name: account.channel_name,
              playlist_id: account.playlist_id,
              table_name: 'Youtube_accounts',
            },
            is_live_api: true,
            channel: chanData.items[0],
            summary_report: sumData,
            daily_graph: dailyData,
            top_videos_report: topVideos.length > 0 ? topVideos : (playData?.items || []),
            playlist_items: playData?.items || [],
            videos_api: videosData,
            raw: {
              channels_api: chanData,
              playlist_items_api: playData,
              videos_api: videosData,
              summary_report: sumData,
              daily_report: dailyData,
            },
            fetched_at: new Date().toISOString(),
          });
        }

        return youtubeErrorResponse(res, account, 404, {
          code: 404,
          message: 'YouTube returned no channel for this token. Re-authorize the channel and try again.',
        });
      } catch (liveErr) {
        console.warn('Live YouTube API fetch error:', liveErr.message);
        return youtubeErrorResponse(res, account, 502, {
          code: 502,
          message: `Failed to reach the YouTube API: ${liveErr.message}`,
        });
      }
    }

    return youtubeErrorResponse(res, account, 400, {
      code: 400,
      message: 'No refresh token stored for this YouTube account. Add one in Youtube_accounts.access_token.',
    });
  } catch (error) {
    console.error('Error fetching YouTube summary:', error);
    return res.status(500).json({ error: 'Failed to generate YouTube dashboard summary.' });
  }
});

app.use('/api', createAccountsRouter(authenticateToken));
app.use('/api', createLinkedInRouter(authenticateToken, JWT_SECRET));
app.use('/api', createLinkedInInsightsRouter(authenticateToken));
app.use('/api', createHistoryRouter(authenticateToken));
app.use('/api', createInsightsRouter(authenticateToken));
app.use('/api', createDeepRouter(authenticateToken));
app.use('/api', createWebhooksRouter());
app.use('/api', createAutomationRouter(authenticateToken));
app.use('/api', createFacebookRouter(authenticateToken, JWT_SECRET));
app.use('/api', createGoogleRouter(authenticateToken, JWT_SECRET));
app.use('/api', createInstagramRouter(authenticateToken, JWT_SECRET));
app.use('/api', createOAuthLogRouter(authenticateToken));
startOAuthLogSink();
app.use('/api', createPublishRouter(authenticateToken));

// SPA Fallback: Serve index.html for non-API routes when frontend build is present
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/api-docs')) {
    return next();
  }
  // A missing script or style (e.g. an old file name from before a deploy) is a 404, not the HTML page:
  // HTML in place of a script gives the browser "Expected a JavaScript module script ... text/html".
  if (req.path.startsWith('/assets/') || /\.(js|mjs|css|map|wasm)$/.test(req.path)) {
    return res.status(404).type('text/plain').send('Not found');
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) {
      next();
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Express server running on port ${PORT}`);
  startSnapshotSchedule();
  startPublishSchedule();
});

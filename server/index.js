import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import {
  initDb,
  getDbStatus,
  findUserByUsernameOrEmail,
  findUserById,
  updateUserPassword,
  getInstagramAccountsByUserId,
} from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || 'default_secure_jwt_secret_key';

app.use(cors());
app.use(express.json());

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

/**
 * @openapi
 * /api/health:
 *   get:
 *     summary: Health Check & Database Connection Status
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Database connectivity status and server timestamp.
 */
app.get('/api/health', (req, res) => {
  const status = getDbStatus();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: status,
    swagger: `http://localhost:${PORT}/api-docs`,
  });
});

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: User Login
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *                 example: john_doe
 *               password:
 *                 type: string
 *                 example: password123
 *     responses:
 *       200:
 *         description: Authentication successful, returns JWT token and user profile.
 *       400:
 *         description: Missing username or password.
 *       401:
 *         description: Invalid credentials.
 */
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

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     summary: Fetch Logged In User Profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile details.
 *       401:
 *         description: Access token missing or invalid.
 */
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

/**
 * @openapi
 * /api/instagram-accounts:
 *   get:
 *     summary: Get Linked Instagram Accounts for Logged In User
 *     tags: [Instagram Accounts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of Instagram accounts.
 *       401:
 *         description: Unauthorized. Token required.
 */
app.get('/api/instagram-accounts', authenticateToken, async (req, res) => {
  try {
    const accounts = await getInstagramAccountsByUserId(req.user.userId);
    return res.json({ accounts });
  } catch (error) {
    console.error('Error fetching instagram accounts:', error);
    return res.status(500).json({ error: 'Server error fetching Instagram accounts.' });
  }
});

// ============================================================================
// INSTAGRAM GRAPH API v24.0 ENDPOINTS (Using DB Access Token)
// ============================================================================

/**
 * @openapi
 * /api/instagram/dashboard-summary:
 *   get:
 *     summary: Consolidated Instagram Single-Page Dashboard Summary
 *     description: Calls all 5 Instagram Graph API v24.0 endpoints concurrently on the server using DB access token and returns a consolidated solidified JSON object.
 *     tags: [Instagram Graph API v24.0]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: accountId
 *         schema:
 *           type: string
 *       - in: query
 *         name: since
 *         schema:
 *           type: string
 *         example: 2026-08-01
 *       - in: query
 *         name: until
 *         schema:
 *           type: string
 *         example: 2026-08-31
 *     responses:
 *       200:
 *         description: Consolidated JSON containing Media, Weekly Insights, Daily Insights, Follower Trend, and Online Followers.
 */
app.get('/api/instagram/dashboard-summary', authenticateToken, async (req, res) => {
  try {
    const account = await getAccountForUser(req.user.userId, req.query.accountId);
    if (!account) {
      return res.status(404).json({ error: 'No connected Instagram account found in database for user.' });
    }

    const since = req.query.since || '2026-08-01';
    const until = req.query.until || '2026-08-31';
    const tokenEncoded = encodeURIComponent(account.access_token);

    const limit = parseInt(req.query.limit, 10) || 7;
    const mediaUrl = `https://graph.instagram.com/v24.0/me/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,permalink,like_count,comments_count,shortcode,is_comment_enabled&limit=${limit}&access_token=${tokenEncoded}`;
    const weeklyUrl = `https://graph.instagram.com/v24.0/${account.page_id}/insights?metric=reach,views,total_interactions,accounts_engaged&period=week&metric_type=total_value&access_token=${tokenEncoded}`;
    const dailyMetrics = 'reach,views,likes,comments,saves,shares,replies,total_interactions,accounts_engaged,profile_links_taps,follower_count';
    const dailyUrl = `https://graph.instagram.com/v24.0/${account.page_id}/insights?metric=${dailyMetrics}&period=day&metric_type=total_value&access_token=${tokenEncoded}`;
    const trendUrl = `https://graph.instagram.com/v24.0/${account.page_id}/insights?metric=follower_count&period=day&since=${since}&until=${until}&access_token=${tokenEncoded}`;
    const onlineUrl = `https://graph.instagram.com/v24.0/${account.page_id}/insights?metric=online_followers&period=lifetime&access_token=${tokenEncoded}`;

    const [mediaRes, weeklyRes, dailyRes, trendRes, onlineRes] = await Promise.allSettled([
      fetch(mediaUrl).then((r) => r.json()),
      fetch(weeklyUrl, { headers: { 'Accept-Language': 'en-US' } }).then((r) => r.json()),
      fetch(dailyUrl).then((r) => r.json()),
      fetch(trendUrl).then((r) => r.json()),
      fetch(onlineUrl).then((r) => r.json()),
    ]);

    const getValue = (settled) => (settled.status === 'fulfilled' ? settled.value : { error: settled.reason?.message || 'Request failed' });

    const mediaData = getValue(mediaRes);
    const weeklyData = getValue(weeklyRes);
    const dailyData = getValue(dailyRes);
    const trendData = getValue(trendRes);
    const onlineData = getValue(onlineRes);

    const consolidatedJSON = {
      account: {
        id: account.id,
        user_id: account.user_id,
        page_name: account.page_name,
        page_id: account.page_id,
      },
      summary: {
        media: mediaData?.data || [],
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

/**
 * @openapi
 * /api/instagram/media:
 *   get:
 *     summary: Fetch Media (Graph API v24.0)
 *     tags: [Instagram Graph API v24.0]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: accountId
 *         schema:
 *           type: string
 *         description: Optional ID of linked Instagram account in DB
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 7
 *     responses:
 *       200:
 *         description: Media items list from Instagram.
 */
app.get('/api/instagram/media', authenticateToken, async (req, res) => {
  try {
    const account = await getAccountForUser(req.user.userId, req.query.accountId);
    if (!account) {
      return res.status(404).json({ error: 'No connected Instagram account found for this user.' });
    }

    const limit = req.query.limit || 7;
    const url = `https://graph.instagram.com/v24.0/me/media?fields=id,caption,media_type,media_product_type,timestamp,permalink&limit=${limit}&access_token=${encodeURIComponent(account.access_token)}`;

    const response = await fetch(url);
    const data = await response.json();
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

/**
 * @openapi
 * /api/instagram/insights/weekly:
 *   get:
 *     summary: Fetch Weekly Insights (Graph API v24.0)
 *     tags: [Instagram Graph API v24.0]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: accountId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Weekly reach, views, total_interactions, and accounts_engaged metrics.
 */
app.get('/api/instagram/insights/weekly', authenticateToken, async (req, res) => {
  try {
    const account = await getAccountForUser(req.user.userId, req.query.accountId);
    if (!account) {
      return res.status(404).json({ error: 'No connected Instagram account found for this user.' });
    }

    const url = `https://graph.instagram.com/v24.0/${account.page_id}/insights?metric=reach,views,total_interactions,accounts_engaged&period=week&metric_type=total_value&access_token=${encodeURIComponent(account.access_token)}`;

    const response = await fetch(url, {
      headers: { 'Accept-Language': 'en-US' },
    });
    const data = await response.json();
    return res.status(response.status).json({
      account_id: account.id,
      page_id: account.page_id,
      graph_response: data,
    });
  } catch (error) {
    console.error('Error fetching weekly insights:', error);
    return res.status(500).json({ error: 'Failed to call Instagram Graph API for weekly insights.' });
  }
});

/**
 * @openapi
 * /api/instagram/insights/daily:
 *   get:
 *     summary: Fetch Daily Insights (Graph API v24.0)
 *     tags: [Instagram Graph API v24.0]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: accountId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Daily engagement, views, likes, comments, taps & follower metrics.
 */
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

/**
 * @openapi
 * /api/instagram/insights/followers-trend:
 *   get:
 *     summary: Fetch Follower Count Trend by Date Range (Graph API v24.0)
 *     tags: [Instagram Graph API v24.0]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: since
 *         schema:
 *           type: string
 *         example: 2026-08-01
 *       - in: query
 *         name: until
 *         schema:
 *           type: string
 *         example: 2026-08-31
 *       - in: query
 *         name: accountId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Daily follower count trend for specified date range.
 */
app.get('/api/instagram/insights/followers-trend', authenticateToken, async (req, res) => {
  try {
    const account = await getAccountForUser(req.user.userId, req.query.accountId);
    if (!account) {
      return res.status(404).json({ error: 'No connected Instagram account found for this user.' });
    }

    const since = req.query.since || '2026-08-01';
    const until = req.query.until || '2026-08-31';

    const url = `https://graph.instagram.com/v24.0/${account.page_id}/insights?metric=follower_count&period=day&since=${since}&until=${until}&access_token=${encodeURIComponent(account.access_token)}`;

    const response = await fetch(url);
    const data = await response.json();
    return res.status(response.status).json({
      account_id: account.id,
      page_id: account.page_id,
      since,
      until,
      graph_response: data,
    });
  } catch (error) {
    console.error('Error fetching follower trend insights:', error);
    return res.status(500).json({ error: 'Failed to call Instagram Graph API for follower trend.' });
  }
});

/**
 * @openapi
 * /api/instagram/insights/online-followers:
 *   get:
 *     summary: Fetch Online Followers (Lifetime Period) (Graph API v24.0)
 *     tags: [Instagram Graph API v24.0]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: accountId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Online followers distribution by hour.
 */
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

app.listen(PORT, () => {
  console.log(`🚀 Express server running at http://localhost:${PORT}`);
  console.log(`📚 Swagger UI API Docs available at http://localhost:${PORT}/api-docs`);
});

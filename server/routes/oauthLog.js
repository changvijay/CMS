import express from 'express';
import os from 'node:os';
import { pool, isDbReady } from '../db.js';
import { redact, setOAuthLogSink } from '../utils/oauthLog.js';

const KEEP_DAYS = 14;
// Which server wrote a line: tells "started on my laptop, finished on the live site" apart.
const SERVER = process.env.K_SERVICE ? `${process.env.K_SERVICE} (${process.env.K_REVISION || 'cloud'})` : os.hostname();

/** Save every Instagram/Facebook sign-in step in the database, so the Accounts page can show the whole attempt. */
export function startOAuthLogSink() {
  setOAuthLogSink(async ({ flowId, platform, userId, seq, step, details, ms }) => {
    if (!isDbReady()) return;
    const uid = /^\d+$/.test(String(userId ?? '')) ? String(userId) : null;
    await pool.query(
      'INSERT INTO oauth_log (flow_id, platform, user_id, seq, step, details, server) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [String(flowId).slice(0, 32), platform, uid, seq, step, details === null ? null : JSON.stringify({ ...wrap(details), _ms: ms }), SERVER],
    );
  });
}

const wrap = (d) => (d && typeof d === 'object' && !Array.isArray(d) ? d : { value: d });

export function createOAuthLogRouter(authenticateToken) {
  const router = express.Router();

  // Your last sign-in attempts, oldest step first.
  router.get('/oauth-log', authenticateToken, async (req, res) => {
    if (!isDbReady()) return res.status(503).json({ error: 'Database is not connected, so the log cannot be read.' });
    try {
      await pool.query(`DELETE FROM oauth_log WHERE created_at < NOW() - INTERVAL '${KEEP_DAYS} days'`);
      const { rows } = await pool.query(
        `SELECT id, flow_id, platform, seq, step, details, server, created_at FROM (
           SELECT * FROM oauth_log WHERE user_id = $1 ORDER BY id DESC LIMIT 500
         ) t ORDER BY id ASC`,
        [req.user.userId],
      );
      return res.json({ entries: rows });
    } catch (err) {
      console.error('Error reading oauth log:', err.message);
      return res.status(500).json({ error: 'Failed to read the connection log.' });
    }
  });

  router.delete('/oauth-log', authenticateToken, async (req, res) => {
    if (!isDbReady()) return res.status(503).json({ error: 'Database is not connected.' });
    await pool.query('DELETE FROM oauth_log WHERE user_id = $1', [req.user.userId]);
    return res.status(204).end();
  });

  // Steps that happen in the browser (clicking Connect, leaving for Meta, coming back), added to the same attempt.
  router.post('/oauth-log', authenticateToken, async (req, res) => {
    if (!isDbReady()) return res.status(204).end();
    const { flowId, platform, step, details } = req.body || {};
    if (!['instagram', 'facebook'].includes(platform) || typeof step !== 'string') return res.status(400).json({ error: 'platform and step are required.' });
    const fid = typeof flowId === 'string' && /^[\w-]{1,32}$/.test(flowId) ? flowId : `${platform === 'instagram' ? 'ig' : 'fb'}-web`;
    try {
      const { rows } = await pool.query('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM oauth_log WHERE flow_id = $1 AND user_id = $2', [fid, req.user.userId]);
      await pool.query(
        'INSERT INTO oauth_log (flow_id, platform, user_id, seq, step, details, server) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [fid, platform, req.user.userId, rows[0].next, `browser.${step.slice(0, 80)}`, JSON.stringify(wrap(redact(details ?? {}))), 'browser'],
      );
      return res.status(204).end();
    } catch (err) {
      console.error('Error saving browser oauth step:', err.message);
      return res.status(500).json({ error: 'Failed to save the step.' });
    }
  });

  return router;
}

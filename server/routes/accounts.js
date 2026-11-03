import express from 'express';
import { pool, isDbReady } from '../db.js';

const KINDS = {
  instagram: {
    path: 'instagram-accounts',
    table: 'instagram_accounts',
    required: ['page_name', 'page_id', 'access_token'],
    columns: ['page_name', 'page_id', 'access_token'],
    returning: 'id, user_id, page_name, page_id, created_at',
    // A newly pasted token starts its renewal schedule over.
    onTokenChange: ', token_refreshed_at = NULL, token_expires_at = NULL, last_refresh_error = NULL, last_refresh_failed_at = NULL',
  },
  youtube: {
    path: 'youtube-accounts',
    table: 'Youtube_accounts',
    required: ['channel_name', 'playlist_id', 'access_token'],
    columns: ['channel_name', 'playlist_id', 'access_token'],
    returning: 'id, user_id, channel_name, playlist_id, created_at',
  },
};

export function createAccountsRouter(authenticateToken) {
  const router = express.Router();

  for (const kind of Object.values(KINDS)) {
    router.post(`/${kind.path}`, authenticateToken, async (req, res) => {
      if (!isDbReady()) return res.status(503).json({ error: 'Database is not connected.' });
      const body = req.body || {};
      const missing = kind.required.filter((f) => !String(body[f] ?? '').trim());
      if (missing.length) return res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}` });
      try {
        const values = kind.columns.map((c) => String(body[c]).trim());
        const { rows } = await pool.query(
          `INSERT INTO ${kind.table} (user_id, ${kind.columns.join(', ')})
           VALUES ($1, ${kind.columns.map((_, i) => `$${i + 2}`).join(', ')})
           RETURNING ${kind.returning}`,
          [req.user.userId, ...values]
        );
        return res.status(201).json({ account: rows[0] });
      } catch (error) {
        console.error(`Error creating ${kind.table} row:`, error.message);
        return res.status(500).json({ error: 'Failed to save account.' });
      }
    });

    // Update any subset of fields (mainly used to rotate an expired token)
    router.patch(`/${kind.path}/:id`, authenticateToken, async (req, res) => {
      if (!isDbReady()) return res.status(503).json({ error: 'Database is not connected.' });
      const body = req.body || {};
      const fields = kind.columns.filter((c) => String(body[c] ?? '').trim());
      if (!fields.length) return res.status(400).json({ error: 'No updatable fields provided.' });
      try {
        const { rows } = await pool.query(
          `UPDATE ${kind.table} SET ${fields.map((f, i) => `${f} = $${i + 3}`).join(', ')}${fields.includes('access_token') ? kind.onTokenChange ?? '' : ''}
            WHERE id = $1 AND user_id = $2 RETURNING ${kind.returning}`,
          [req.params.id, req.user.userId, ...fields.map((f) => String(body[f]).trim())]
        );
        if (!rows.length) return res.status(404).json({ error: 'Account not found.' });
        return res.json({ account: rows[0] });
      } catch (error) {
        console.error(`Error updating ${kind.table} row:`, error.message);
        return res.status(500).json({ error: 'Failed to update account.' });
      }
    });

    router.delete(`/${kind.path}/:id`, authenticateToken, async (req, res) => {
      if (!isDbReady()) return res.status(503).json({ error: 'Database is not connected.' });
      try {
        const result = await pool.query(`DELETE FROM ${kind.table} WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.userId]);
        if (!result.rowCount) return res.status(404).json({ error: 'Account not found.' });
        return res.status(204).end();
      } catch (error) {
        console.error(`Error deleting ${kind.table} row:`, error.message);
        return res.status(500).json({ error: 'Failed to delete account.' });
      }
    });
  }

  return router;
}

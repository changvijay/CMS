import express from 'express';
import { pool, isDbReady } from '../db.js';
import { createRateLimiter } from '../utils/rateLimit.js';
import { validateWaitlist } from '../services/waitlistValidation.js';

/**
 * Public waiting list sign-up: POST /api/waitlist. No login needed.
 * Signing up again with the same email updates that row instead of adding a second one.
 */
export function createWaitlistRouter({ db = pool, isReady = isDbReady, limiter } = {}) {
  const router = express.Router();
  const perClient = limiter ?? createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });

  router.post('/waitlist', async (req, res) => {
    const body = req.body || {};

    // Hidden "website" field: people never see it, form-filling bots do. Pretend it worked.
    if (typeof body.website === 'string' && body.website.trim()) {
      return res.status(201).json({ ok: true });
    }

    const limit = perClient.hit(req.ip || 'unknown');
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many sign-ups from this connection. Please try again in an hour.' });
    }

    const check = validateWaitlist(body);
    if (!check.ok) {
      return res.status(400).json({ error: 'Some details need fixing.', fields: check.errors });
    }

    if (!isReady()) {
      return res.status(503).json({ error: 'The waiting list is unavailable right now. Please try again in a few minutes.' });
    }

    const v = check.value;
    try {
      const { rows } = await db.query(
        `INSERT INTO waitlist (email_address, phone_number, instagram_accounts, facebook_pages, linkedin_pages, youtube_channels, profile_links)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (email_address) DO UPDATE SET
           phone_number = EXCLUDED.phone_number,
           instagram_accounts = EXCLUDED.instagram_accounts,
           facebook_pages = EXCLUDED.facebook_pages,
           linkedin_pages = EXCLUDED.linkedin_pages,
           youtube_channels = EXCLUDED.youtube_channels,
           profile_links = EXCLUDED.profile_links,
           updated_at = CURRENT_TIMESTAMP
         RETURNING (xmax = 0) AS created`,
        [v.email, v.phone, v.instagram, v.facebook, v.linkedin, v.youtube, v.links],
      );
      const created = rows[0]?.created !== false;
      return res.status(created ? 201 : 200).json({ ok: true, updated: !created });
    } catch (err) {
      console.error('Error saving waiting list sign-up:', err.message);
      return res.status(500).json({ error: 'Your details could not be saved. Please try again.' });
    }
  });

  return router;
}

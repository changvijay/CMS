import express from 'express';
import { pool, isDbReady } from '../db.js';
import { processPayload } from '../services/automationEngine.js';
import { createAutomationDb } from '../services/automationDb.js';
import { sender, checkToken } from '../services/instagramMessaging.js';
import { verifySignature } from '../services/webhookEvents.js';

/**
 * Public endpoint Instagram calls. It is protected by Meta's request signature, not by a login.
 * Replies are sent BEFORE answering 200: on Cloud Run the CPU is throttled once a response is sent,
 * so background work could stall. Duplicates from Meta's retries are absorbed by the event table.
 */
export function createWebhooksRouter({ env = process.env, processor = processPayload, dbFactory = () => createAutomationDb(pool, { checkToken }), isReady = isDbReady } = {}) {
  const router = express.Router();

  // One-time handshake when the webhook is saved in the Meta dashboard
  router.get('/webhooks/instagram', (req, res) => {
    const expected = env.WEBHOOK_VERIFY_TOKEN;
    if (expected && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === expected) {
      return res.status(200).type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
    }
    return res.sendStatus(403);
  });

  router.post('/webhooks/instagram', async (req, res) => {
    if (!env.META_APP_SECRET) {
      console.error('Webhook received but META_APP_SECRET is not set; refusing to process unsigned events.');
      return res.status(503).json({ error: 'META_APP_SECRET is not configured.' });
    }
    if (!verifySignature(req.rawBody, req.get('x-hub-signature-256'), env.META_APP_SECRET)) {
      console.error('Webhook rejected: signature does not match META_APP_SECRET.');
      return res.sendStatus(403);
    }
    if (!isReady()) return res.sendStatus(503); // Meta will retry later

    try {
      const results = await processor(req.body, { db: dbFactory(), sender, dryRun: env.AUTOMATION_DRY_RUN === 'true' });
      if (results.length) console.log('Webhook:', results.map((r) => `${r.source}:${r.status}${r.reason ? `[${r.reason}]` : ''}${r.error ? `(${r.error.code})` : ''}`).join(', '));
      else console.log('Webhook received with no comment or message events.');
      return res.sendStatus(200);
    } catch (error) {
      console.error('Webhook processing error:', error);
      return res.sendStatus(500); // lets Meta retry; the event table prevents double replies
    }
  });

  return router;
}

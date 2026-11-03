import cron from 'node-cron';
import { isDbReady, pool } from '../db.js';
import { refreshPostStatus, runTargets } from '../services/publishRunner.js';
import { retryQueued } from '../services/automationEngine.js';
import { createAutomationDb } from '../services/automationDb.js';
import { sender } from '../services/instagramMessaging.js';

const STUCK_MINUTES = 30;
let running = false;

/**
 * One tick of the publishing queue:
 * - posts whose scheduled time has come (and automatic retries) are published,
 * - targets that were left "pending" (the server restarted before starting them) are picked up,
 * - a target stuck "publishing" for 30 minutes is marked failed instead of being posted again blindly,
 * - auto-replies that hit a rate limit are re-sent.
 */
export async function runPublishQueue() {
  if (!isDbReady() || running) return;
  running = true;
  try {
    const stuck = await pool.query(
      `UPDATE post_targets SET status = 'failed', error_code = 504,
              error_message = 'Publishing was interrupted (the server restarted mid-way). Check the platform to see if it posted before retrying.', updated_at = NOW()
        WHERE status = 'publishing' AND updated_at < NOW() - ($1 || ' minutes')::interval RETURNING post_id`,
      [String(STUCK_MINUTES)]
    );
    for (const postId of new Set(stuck.rows.map((r) => r.post_id))) await refreshPostStatus(postId);

    const due = await pool.query(
      `SELECT id FROM post_targets
        WHERE (status = 'scheduled' AND COALESCE(next_attempt_at, schedule_at) <= NOW())
           OR (status = 'pending' AND updated_at < NOW() - INTERVAL '2 minutes')
        ORDER BY COALESCE(next_attempt_at, schedule_at) NULLS FIRST LIMIT 20`
    );
    if (due.rows.length) {
      const results = await runTargets(due.rows.map((r) => r.id));
      console.log(`Publish queue: ran ${results.length} target(s)`);
    }

    const replies = await retryQueued({ db: createAutomationDb(pool), sender });
    if (replies.length) console.log(`Auto-reply retries: ${replies.map((r) => `${r.id}:${r.status}`).join(', ')}`);
  } catch (err) {
    console.error('Publish queue crashed:', err);
  } finally {
    running = false;
  }
}

export function startPublishSchedule() {
  if (process.env.DISABLE_PUBLISH_CRON === 'true') return;
  cron.schedule('* * * * *', () => { runPublishQueue(); });
}

import { pool } from '../db.js';
import { loadCredentials } from './publishAccounts.js';
import { publishInstagram } from './publishers/instagram.js';
import { publishFacebook } from './publishers/facebook.js';
import { publishLinkedIn } from './publishers/linkedin.js';
import { publishYoutube } from './publishers/youtube.js';

export const PUBLISHERS = { instagram: publishInstagram, facebook: publishFacebook, linkedin: publishLinkedIn, youtube: publishYoutube };
export const MAX_ATTEMPTS = 3;

/** Wait before retry n (1-based): 2, 8, 18 minutes. */
export const backoffMs = (attempt) => attempt * attempt * 2 * 60 * 1000;

/**
 * The post's overall status from its targets. Pure.
 * Anything still running wins, then anything waiting for its time, then the final mix of done and failed.
 */
export function overallStatus(statuses) {
  if (!statuses.length) return 'draft';
  if (statuses.some((s) => s === 'publishing' || s === 'pending')) return 'publishing';
  if (statuses.some((s) => s === 'scheduled')) return statuses.some((s) => s === 'done' || s === 'failed') ? 'publishing' : 'scheduled';
  if (statuses.every((s) => s === 'done')) return 'done';
  if (statuses.every((s) => s === 'failed')) return 'failed';
  return 'partial';
}

export async function refreshPostStatus(postId) {
  const { rows } = await pool.query('SELECT status FROM post_targets WHERE post_id = $1', [postId]);
  const status = overallStatus(rows.map((r) => r.status));
  await pool.query('UPDATE posts SET status = $2, updated_at = NOW() WHERE id = $1', [postId, status]);
  return status;
}

/**
 * Publishes one target. Only a target that is waiting (pending/scheduled) or failed can be claimed, and the
 * claim is a single UPDATE, so two workers can never post the same thing twice.
 */
export async function runTarget(targetId, { publishers = PUBLISHERS, now = () => Date.now() } = {}) {
  const claimed = await pool.query(
    `UPDATE post_targets t SET status = 'publishing', step = 'upload', attempts = attempts + 1, error_code = NULL, error_message = NULL, updated_at = NOW()
       FROM posts p
      WHERE t.id = $1 AND p.id = t.post_id AND t.status IN ('pending','scheduled','failed')
      RETURNING t.*, p.user_id`,
    [targetId]
  );
  const target = claimed.rows[0];
  if (!target) return null;

  const setStep = (step) => pool.query('UPDATE post_targets SET step = $2, updated_at = NOW() WHERE id = $1', [target.id, step]).catch(() => {});
  try {
    const creds = await loadCredentials(target.platform, target.user_id, target.account_id);
    // Only Facebook and YouTube hold a schedule themselves; anything else reaching here is due now.
    const scheduleAt = target.native_scheduled && target.schedule_at && new Date(target.schedule_at).getTime() > now() ? target.schedule_at : null;
    const result = await publishers[target.platform]({ postType: target.post_type, fields: target.fields, scheduleAt }, creds, setStep);

    await pool.query(
      `UPDATE post_targets SET status = 'done', step = 'done', external_id = $2, permalink = $3, note = $4, native_scheduled = $5, next_attempt_at = NULL, updated_at = NOW()
        WHERE id = $1`,
      [target.id, result.externalId, result.permalink, result.note || null, Boolean(result.nativeScheduled)]
    );
    // An auto-reply made for this post starts answering as soon as Instagram gives us the post's id.
    if (target.platform === 'instagram' && result.externalId) {
      await pool.query(
        `UPDATE automation_rules SET media_id = $2, media_permalink = $3, is_active = TRUE, updated_at = NOW() WHERE post_target_id = $1`,
        [target.id, result.externalId, result.permalink]
      );
    }
  } catch (err) {
    const code = Number(err.code) || 500;
    const retry = Boolean(err.retryable) && target.attempts < MAX_ATTEMPTS;
    if (retry) {
      const at = new Date(now() + backoffMs(target.attempts));
      await pool.query(
        // schedule_at is left alone: for Facebook/YouTube it is the time the platform should publish at.
        `UPDATE post_targets SET status = 'scheduled', next_attempt_at = $2, error_code = $3, error_message = $4, step = NULL, updated_at = NOW() WHERE id = $1`,
        [target.id, at, code, `${err.message} (retrying automatically at ${at.toISOString()})`]
      );
    } else {
      await pool.query(
        `UPDATE post_targets SET status = 'failed', error_code = $2, error_message = $3, step = COALESCE($4, step), updated_at = NOW() WHERE id = $1`,
        [target.id, code, err.message, err.step || null]
      );
    }
  } finally {
    await refreshPostStatus(target.post_id).catch(() => {});
  }
  return target.id;
}

/** Runs several targets side by side; one failing never stops the others. */
export function runTargets(ids, opts) {
  return Promise.allSettled(ids.map((id) => runTarget(id, opts)));
}

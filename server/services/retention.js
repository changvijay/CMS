import { pool, isDbReady } from '../db.js';
import { addDays, istDateString } from '../utils/dates.js';

/** How many complete days of daily insights are kept in the database. Older ranges are fetched live. */
export const INSIGHTS_RETENTION_DAYS = (() => {
  const n = parseInt(process.env.INSIGHTS_RETENTION_DAYS || '', 10);
  return Number.isFinite(n) && n >= 7 ? n : 30;
})();

/** The oldest date still stored (inclusive). Syncs store [today - retention, yesterday]. */
export function retentionStart(today = istDateString()) {
  return addDays(today, -INSIGHTS_RETENTION_DAYS);
}

/** True when every day of [since, until] lies inside the stored window. */
export function isStoredRange(since, until, today = istDateString()) {
  return since >= retentionStart(today) && until < today;
}

const DAILY_TABLES = ['ig_daily_metrics', 'yt_daily_metrics', 'li_daily_metrics', 'fb_daily_metrics'];
const ACCOUNT_TABLES = { instagram: 'instagram_accounts', youtube: 'Youtube_accounts', linkedin: 'linkedin_accounts', facebook: 'facebook_pages' };

/**
 * Deletes insights older than the retention window.
 * Post snapshots keep only the newest capture of each post once it is older than the window,
 * so the Content tab still lists older posts with their last known numbers.
 * Snapshots of disconnected accounts are removed too (that table has no foreign key).
 */
export async function pruneInsights({ db = pool, today = istDateString() } = {}) {
  const cutoff = retentionStart(today);
  const deleted = {};
  for (const table of DAILY_TABLES) {
    const r = await db.query(`DELETE FROM ${table} WHERE metric_date < $1`, [cutoff]);
    deleted[table] = r.rowCount;
  }
  const snapshots = await db.query(
    `DELETE FROM media_snapshots s
      WHERE s.captured_on < $1
        AND EXISTS (SELECT 1 FROM media_snapshots n
                     WHERE n.platform = s.platform AND n.account_id = s.account_id
                       AND n.media_id = s.media_id AND n.captured_on > s.captured_on)`,
    [cutoff]
  );
  deleted.media_snapshots = snapshots.rowCount;
  let orphans = 0;
  for (const [platform, table] of Object.entries(ACCOUNT_TABLES)) {
    const r = await db.query(
      `DELETE FROM media_snapshots s WHERE s.platform = $1 AND NOT EXISTS (SELECT 1 FROM ${table} a WHERE a.id = s.account_id)`,
      [platform]
    );
    orphans += r.rowCount;
  }
  deleted.orphaned_snapshots = orphans;
  const logs = await db.query(`DELETE FROM oauth_log WHERE created_at < NOW() - INTERVAL '14 days'`);
  deleted.oauth_log = logs.rowCount;
  return { cutoff, deleted };
}

export async function runRetentionJob() {
  if (!isDbReady()) return null;
  const result = await pruneInsights();
  const total = Object.values(result.deleted).reduce((a, b) => a + b, 0);
  if (total) console.log(`Retention: removed ${total} rows older than ${result.cutoff}`, result.deleted);
  return result;
}

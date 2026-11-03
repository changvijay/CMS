import cron from 'node-cron';
import { getAllInstagramAccounts, getAllLinkedInAccounts, getAllYoutubeAccounts, isDbReady } from '../db.js';
import { refreshAllLinkedInTokens } from '../services/linkedinAuth.js';
import { refreshAllInstagramTokens } from '../services/instagramAuth.js';
import { syncInstagramAccount, syncInstagramStories, syncLinkedInAccount, syncYoutubeAccount } from '../services/syncService.js';

export async function runSnapshotJob() {
  if (!isDbReady()) {
    console.warn('Snapshot job skipped: database not connected.');
    return;
  }
  for (const account of await getAllInstagramAccounts()) {
    try {
      const r = await syncInstagramAccount(account, { days: 7 });
      console.log(`Snapshot instagram#${account.id}: ${r.days_synced} days, ${r.media_snapshots} media`);
    } catch (err) {
      console.warn(`Snapshot instagram#${account.id} failed: ${err.message}`);
    }
  }
  for (const account of await getAllYoutubeAccounts()) {
    try {
      const r = await syncYoutubeAccount(account, { days: 7 });
      console.log(`Snapshot youtube#${account.id}: ${r.days_synced} days, ${r.media_snapshots} videos`);
    } catch (err) {
      console.warn(`Snapshot youtube#${account.id} failed: ${err.message}`);
    }
  }
  for (const account of await getAllLinkedInAccounts()) {
    try {
      const r = await syncLinkedInAccount(account, { days: 7 });
      console.log(`Snapshot linkedin#${account.id}: ${r.days_synced} days, ${r.media_snapshots} posts`);
    } catch (err) {
      console.warn(`Snapshot linkedin#${account.id} failed: ${err.message}`);
    }
  }
}

/** Stories last 24 hours, so catching them only once a day would lose most of them. */
export async function runStoriesJob() {
  if (!isDbReady()) return;
  for (const account of await getAllInstagramAccounts()) {
    try {
      const r = await syncInstagramStories(account);
      if (r.stories) console.log(`Stories instagram#${account.id}: captured ${r.stories}`);
    } catch (err) {
      console.warn(`Stories instagram#${account.id} failed: ${err.message}`);
    }
  }
}

/** Runs daily at 02:30 IST, after both platforms have finalised the previous day. */
export function startSnapshotSchedule() {
  if (process.env.DISABLE_SNAPSHOT_CRON === 'true') return;
  cron.schedule('30 2 * * *', () => {
    runSnapshotJob().catch((err) => console.error('Snapshot job crashed:', err));
  }, { timezone: 'Asia/Kolkata' });
  // LinkedIn tokens are topped up well before they expire, so nobody has to reconnect.
  cron.schedule('0 3 * * *', () => {
    refreshAllLinkedInTokens().catch((err) => console.error('LinkedIn refresh job crashed:', err));
    refreshAllInstagramTokens().catch((err) => console.error('Instagram refresh job crashed:', err));
  }, { timezone: 'Asia/Kolkata' });
  cron.schedule('0 */6 * * *', () => {
    runStoriesJob().catch((err) => console.error('Stories job crashed:', err));
  }, { timezone: 'Asia/Kolkata' });
}

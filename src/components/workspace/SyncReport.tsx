import { Link } from 'react-router-dom';
import type { OverviewPlatform, SyncResult } from '../../services/api';

const NAME: Record<OverviewPlatform, string> = { instagram: 'Instagram', youtube: 'YouTube', linkedin: 'LinkedIn', facebook: 'Facebook' };

function doneText(r: SyncResult['results'][number]) {
  if (r.live) return 'Fresh numbers fetched.';
  const unit = r.platform === 'youtube' ? 'videos' : 'posts';
  return `${r.days_synced} days and ${r.media_snapshots} ${unit} updated${r.stories ? `, ${r.stories} stories` : ''}${r.reels ? `, ${r.reels} reels` : ''}.`;
}

/**
 * What "Update data" did, one line per account: updated, logged out (reconnect), or failed for another reason.
 * Accounts are updated at the same time and separately, so one problem never hides the others' results.
 */
export function SyncReport({ result }: { result: SyncResult }) {
  const { results, errors } = result;
  if (!results.length && !errors.length) {
    return <div className="ws-notice" role="status">No connected accounts to update. Add one on the Accounts page.</div>;
  }
  const loggedOut = errors.filter((e) => e.auth).length;
  const failed = errors.length - loggedOut;
  const summary = [
    results.length ? `${results.length} updated` : null,
    loggedOut ? `${loggedOut} logged out` : null,
    failed ? `${failed} failed` : null,
  ].filter(Boolean).join(' · ');

  return (
    <section className={`sync-report ${errors.length ? 'has-problems' : 'all-ok'}`} role="status" aria-label="Update results">
      <p className="sync-report-head">{errors.length ? 'Update finished with problems' : 'Everything is up to date'} <span>{summary}</span></p>
      <ul>
        {errors.map((e) => (
          <li key={`e-${e.platform}-${e.account_id}`} className={e.auth ? 'sync-auth' : 'sync-fail'}>
            <span className="sync-icon" aria-hidden="true">{e.auth ? '!' : '×'}</span>
            <div>
              <b>{NAME[e.platform]}{e.name ? ` · ${e.name}` : ''}</b>
              {e.auth ? (
                <p>
                  {NAME[e.platform]} is not able to get data. This account is logged out or its access has expired.{' '}
                  <Link to="/accounts">Reconnect it on the Accounts page →</Link>
                </p>
              ) : (
                <p>Could not update{e.code ? ` (error ${e.code})` : ''}: {e.message}</p>
              )}
              {e.auth && <p className="sync-detail">{NAME[e.platform]} said: {e.message}</p>}
            </div>
          </li>
        ))}
        {results.map((r) => (
          <li key={`r-${r.platform}-${r.account_id}`} className="sync-ok">
            <span className="sync-icon" aria-hidden="true">✓</span>
            <div>
              <b>{NAME[r.platform]}{r.name ? ` · ${r.name}` : ''}</b>
              <p>{doneText(r)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

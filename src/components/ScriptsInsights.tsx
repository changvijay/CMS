import { Link } from 'react-router-dom';
import { getDashboard, listFolders } from '../services/scriptsApi';
import { useInView } from '../hooks/useInView';
import { useLive } from './workspace/useLive';
import { formatShortDate } from './charts/viz';
import { SectionSkeleton } from './Skeleton';

/** Same cache key as the Scripts dashboard, so opening either page reuses the other's data. */
const DASHBOARD_KEY = 'scripts:dashboard';
const FOLDERS_KEY = 'scripts:folders';
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** A summary of the Scripts workspace for the Overview page: what's in progress, what's due, and goal progress. */
export function ScriptsInsights({ token }: { token: string }) {
  // Sits at the bottom of Overview: only fetched once it scrolls near the screen.
  const [ref, inView] = useInView<HTMLElement>();
  const state = useLive(() => getDashboard(token), DASHBOARD_KEY, inView);
  const folders = useLive(() => listFolders(token), FOLDERS_KEY, inView);
  const d = state.data;
  const folderList = folders.data?.folders ?? [];

  return (
    <section className="viz-panel scripts-insights" ref={ref} aria-labelledby="scripts-insights-title">
      <div className="viz-panel-head">
        <div>
          <h3 id="scripts-insights-title">Scripts</h3>
          <p className="ws-sub">Your writing pipeline: what's in progress, what's due and how your goals are going.</p>
        </div>
        <Link className="btn btn-secondary" to="/scripts">Open Scripts</Link>
      </div>

      {state.error && <div className="error-banner" role="alert"><span>{state.error}</span></div>}
      {!d && !state.error && <SectionSkeleton variant="list" rows={3} label="Loading scripts…" />}

      {d && d.counts.scripts_total === 0 && (
        <p className="trends-empty-inline">
          No scripts yet. <Link to="/scripts">Capture your first idea</Link> and it will show up here.
        </p>
      )}

      {d && d.counts.scripts_total > 0 && (
        <>
          <dl className="si-stats">
            <Stat label="Total scripts" value={d.counts.scripts_total} />
            <Stat label="Done" value={d.counts.scripts_done} note={`${pct(d.counts.scripts_done, d.counts.scripts_total)}%`} tone="good" />
            <Stat label="Overdue" value={d.counts.scripts_overdue} tone={d.counts.scripts_overdue ? 'bad' : undefined} />
            <Stat label="Pending this week" value={d.counts.scripts_due_week} />
            <Stat label="In progress" value={d.counts.scripts_in_progress} />
            <Stat label="Not started" value={d.counts.scripts_not_started ?? d.counts.scripts_total - d.counts.scripts_done - d.counts.scripts_in_progress} />
            <Stat label="Folders" value={d.counts.folders_total ?? folderList.length} />
            <Stat label="Open to-dos" value={d.counts.todos_total - d.counts.todos_done} note={d.counts.todos_overdue ? `${d.counts.todos_overdue} overdue` : undefined} tone={d.counts.todos_overdue ? 'bad' : undefined} />
            {d.counts.goals_total !== undefined && (
              <Stat label="Goals reached" value={d.counts.goals_done ?? 0} note={`of ${d.counts.goals_total}`} />
            )}
          </dl>

          {folderList.length > 0 && (
            <div className="si-folders">
              <h4>By folder</h4>
              <div className="viz-table-wrap">
                <table className="viz-table">
                  <thead>
                    <tr><th>Folder</th><th>Scripts</th><th>Done</th><th>In progress</th><th>Overdue</th><th>Next deadline</th></tr>
                  </thead>
                  <tbody>
                    {folderList.map((f) => (
                      <tr key={f.id}>
                        <td className="viz-table-title">
                          <span className="si-dot" style={{ background: f.color }} aria-hidden="true" />
                          <Link to={`/scripts/library?folder=${f.id}`}>{f.name}</Link>
                        </td>
                        <td>{f.script_count}</td>
                        <td>{f.done_count}<small className="si-muted"> ({pct(f.done_count, f.script_count)}%)</small></td>
                        <td>{f.in_progress_count}</td>
                        <td className={f.overdue_count ? 'si-alert' : undefined}>{f.overdue_count}</td>
                        <td>{f.next_deadline ? formatShortDate(f.next_deadline.slice(0, 10)) : '–'}</td>
                      </tr>
                    ))}
                    {folders.data && folders.data.unfiled.script_count > 0 && (
                      <tr>
                        <td className="viz-table-title si-muted">Not in a folder</td>
                        <td>{folders.data.unfiled.script_count}</td>
                        <td>{folders.data.unfiled.done_count}<small className="si-muted"> ({pct(folders.data.unfiled.done_count, folders.data.unfiled.script_count)}%)</small></td>
                        <td>–</td><td>–</td><td>–</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="si-cols">
            <div>
              <h4>Due this week</h4>
              {d.due_this_week.length === 0 ? (
                <p className="trends-empty-inline">Nothing due in the next 7 days.</p>
              ) : (
                <ul className="si-list">
                  {d.due_this_week.slice(0, 5).map((s) => (
                    <li key={s.id}>
                      <Link to={`/scripts/library/${s.id}`}>{s.title || 'Untitled'}</Link>
                      {s.deadline && <span className={s.deadline < d.today ? 'si-alert' : undefined}>{formatShortDate(s.deadline.slice(0, 10))}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h4>Goals</h4>
              {d.goals.length === 0 ? (
                <p className="trends-empty-inline"><Link to="/scripts/goals">Set a goal</Link>, like “Publish 12 reels this month”.</p>
              ) : (
                <ul className="si-list">
                  {d.goals.slice(0, 4).map((g) => (
                    <li key={g.id} className="si-goal">
                      <span className="si-goal-row">
                        <span>{g.title}</span>
                        <span>{g.current_progress} / {g.target_value}</span>
                      </span>
                      <span className="si-bar" role="progressbar" aria-label={g.title} aria-valuemin={0} aria-valuemax={g.target_value} aria-valuenow={g.current_progress}>
                        <span style={{ width: `${Math.min(100, pct(g.current_progress, g.target_value))}%` }} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: number; note?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={tone === 'bad' ? 'si-alert' : tone === 'good' ? 'si-good' : undefined}>
      <dt>{label}</dt>
      <dd>{value}{note ? <small> {note}</small> : null}</dd>
    </div>
  );
}

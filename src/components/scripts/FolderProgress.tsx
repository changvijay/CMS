import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarBlank, Folder, FolderOpen, FolderPlus, Warning } from '@phosphor-icons/react';
import type { FolderList, ScriptFolder } from '../../services/scriptsApi';
import { ProgressRing, SkeletonRows } from './shared';
import { deadlineLabel, timeAgo } from './util';

const SHOWN = 6;

const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

/** Nearest deadline first (overdue ones are the earliest, so they lead); folders with no open deadline go last. */
const byDeadline = (a: ScriptFolder, b: ScriptFolder) =>
  (a.earliest_deadline ?? '9999-12-31').localeCompare(b.earliest_deadline ?? '9999-12-31') || a.name.localeCompare(b.name);

/** Dashboard: how many folders, and how far along each one is. */
export default function FolderProgress({ data, loading }: { data: FolderList | null; loading: boolean }) {
  const [all, setAll] = useState(false);
  const folders = useMemo(() => [...(data?.folders ?? [])].sort(byDeadline), [data]);

  if (loading && !data) return <section className="sv-card"><SkeletonRows rows={3} /></section>;
  if (!data) return null;

  const total = folders.reduce((n, f) => n + f.script_count, 0);
  const done = folders.reduce((n, f) => n + f.done_count, 0);
  const inProgress = folders.reduce((n, f) => n + f.in_progress_count, 0);
  const finished = folders.filter((f) => f.script_count > 0 && f.done_count === f.script_count).length;
  const attention = folders.filter((f) => f.overdue_count > 0).length;
  const shown = all ? folders : folders.slice(0, SHOWN);

  return (
    <section className="sv-card" aria-labelledby="sv-folders-title">
      <div className="sv-card-head">
        <h2 id="sv-folders-title" className="title-2"><FolderOpen size={20} weight="duotone" aria-hidden="true" /> Folders</h2>
        <Link className="sv-link" to="/scripts/library">Open library <ArrowRight size={14} aria-hidden="true" /></Link>
      </div>

      {folders.length === 0 ? (
        <div className="sv-fp-empty">
          <FolderPlus size={24} weight="duotone" aria-hidden="true" />
          <p className="body-6">Working on several projects at once? Create a folder for each one, for example one per movie, and track each folder’s progress here.</p>
          <Link className="sv-btn sv-btn-ghost sv-btn-sm" to="/scripts/library">Create a folder</Link>
        </div>
      ) : (
        <>
          <div className="sv-fp-summary">
            <div className="sv-fp-overall">
              <ProgressRing percent={pct(done, total)} size={64} stroke={7} label={`${pct(done, total)}% of scripts in folders completed`} />
              <span>
                <span className="title-3">{pct(done, total)}% completed</span>
                <span className="caption-5 sv-soft">{done} of {total} script{total === 1 ? '' : 's'} across all folders</span>
              </span>
            </div>
            <dl className="sv-fp-stats">
              <div><dt className="caption-5 sv-soft">Folders</dt><dd className="heading-6 sv-num">{folders.length}</dd></div>
              <div><dt className="caption-5 sv-soft">In progress</dt><dd className="heading-6 sv-num">{inProgress}</dd></div>
              <div><dt className="caption-5 sv-soft">Folders finished</dt><dd className="heading-6 sv-num">{finished}</dd></div>
              <div className={attention ? 'bad' : ''}><dt className="caption-5 sv-soft">Need attention</dt><dd className="heading-6 sv-num">{attention}</dd></div>
            </dl>
          </div>

          <p className="caption-4 sv-soft">Each folder, nearest deadline first</p>

          <ul className="sv-fp-list">
            {shown.map((f) => <FolderRow key={f.id} f={f} />)}
          </ul>

          <div className="sv-row-between sv-wrap">
            {folders.length > SHOWN
              ? <button type="button" className="sv-link caption-3" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${folders.length} folders`}</button>
              : <span />}
            {data.unfiled.script_count > 0 && (
              <Link to="/scripts/library" className="caption-5 sv-soft sv-fp-loose">
                Plus {data.unfiled.script_count} script{data.unfiled.script_count === 1 ? '' : 's'} outside folders · {pct(data.unfiled.done_count, data.unfiled.script_count)}% done
              </Link>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function FolderRow({ f }: { f: ScriptFolder }) {
  const p = pct(f.done_count, f.script_count);
  const notStarted = f.script_count - f.done_count - f.in_progress_count;
  const w = (n: number) => `${f.script_count ? (n / f.script_count) * 100 : 0}%`;
  return (
    <li className="sv-fp-row" style={{ ['--folder' as string]: f.color }}>
      <Link to={`/scripts/library?folder=${f.id}`} className="sv-fp-link">
        <Folder size={24} weight="fill" className="sv-folder-tint" aria-hidden="true" />
        <span className="sv-fp-main">
          <span className="sv-row-between">
            <span className="title-4 sv-ellipsis">{f.name}</span>
            <span className={`title-4 sv-num ${p === 100 ? 'sv-fp-done' : ''}`}>{f.script_count ? `${p}%` : 'Empty'}</span>
          </span>
          <span className="sv-stackbar" role="img"
            aria-label={`${f.done_count} completed, ${f.in_progress_count} in progress, ${notStarted} not started`}>
            {f.done_count > 0 && <span className="done" style={{ width: w(f.done_count) }} />}
            {f.in_progress_count > 0 && <span className="doing" style={{ width: w(f.in_progress_count) }} />}
            {notStarted > 0 && <span className="todo" style={{ width: w(notStarted) }} />}
          </span>
          <span className="sv-fp-meta caption-5">
            <span><i className="dot done" />{f.done_count} done</span>
            <span><i className="dot doing" />{f.in_progress_count} in progress</span>
            <span><i className="dot todo" />{notStarted} not started</span>
            {f.overdue_count > 0 && <span className="sv-fp-late"><Warning size={14} weight="fill" aria-hidden="true" />{f.overdue_count} overdue</span>}
            {f.overdue_count === 0 && f.next_deadline && <span><CalendarBlank size={14} aria-hidden="true" />Next due: {deadlineLabel(f.next_deadline)}</span>}
            {f.last_modified && <span className="sv-soft sv-fp-edited">Edited {timeAgo(f.last_modified)}</span>}
          </span>
        </span>
      </Link>
    </li>
  );
}

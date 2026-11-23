import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, CheckCircle, Circle, ClockCountdown, Folder, Lightning, ListChecks, NotePencil, Plus, Sparkle, Target, Warning,
} from '@phosphor-icons/react';
import type { User } from '../../services/api';
import { createScript, getDashboard, incrementGoal, updateScript, type Dashboard as DashboardData, type Script, type ScriptCategory, type ScriptFolder } from '../../services/scriptsApi';
import { errorMessage } from '../../utils/errors';
import { useLive } from '../workspace/useLive';
import FolderProgress from './FolderProgress';
import MonthCalendar from './MonthCalendar';
import { CategoryChips, DeadlineChip, GoalBar, ProgressRing, SkeletonRows, StatusSelect } from './shared';
import { KEY, greeting, refreshScripts, timeAgo, toast, useAiSettings, useCategories, useFolders } from './util';

const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

export default function Dashboard({ token, user }: { token: string; user: User | null }) {
  const state = useLive(() => getDashboard(token), `${KEY}dashboard`);
  const cats = useCategories(token);
  const categories = cats.data?.categories ?? [];
  const foldersState = useFolders(token);
  const folders = foldersState.data?.folders ?? [];

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      refreshScripts();
      if (done) toast(done);
    } catch (err) {
      toast(errorMessage(err, 'Could not save. Try again.'), 'error');
    }
  };

  const d = state.data;
  return (
    <div className="sv-stack">
      <section className="sv-hero">
        <div>
          <h1 className="heading-4">{greeting()}{user?.username ? `, ${user.username}` : ''}</h1>
          <p className="body-6 sv-soft">{d ? summary(d) : 'Loading your week…'}</p>
        </div>
        <QuickCapture token={token} />
      </section>

      {state.error && <div className="sv-banner error" role="alert"><Warning size={18} weight="fill" /> {state.error}</div>}
      {!d && !state.error && <SkeletonRows rows={3} tall />}

      {d && (
        <>
          <Setup token={token} d={d} />
          {(d.counts.scripts_overdue > 0 || d.counts.todos_overdue > 0) && (
            <div className="sv-banner warn" role="status">
              <Warning size={18} weight="fill" aria-hidden="true" />
              <span className="body-5">
                {[d.counts.scripts_overdue && `${d.counts.scripts_overdue} script${d.counts.scripts_overdue > 1 ? 's are' : ' is'} past the deadline`,
                  d.counts.todos_overdue && `${d.counts.todos_overdue} to-do${d.counts.todos_overdue > 1 ? 's are' : ' is'} overdue`].filter(Boolean).join(' and ')}
              </span>
              <Link className="sv-link" to={d.counts.scripts_overdue ? '/scripts/library' : '/scripts/todos'}>Review</Link>
            </div>
          )}

          <div className="sv-stats">
            <Stat to="/scripts/library" icon={<NotePencil size={20} />} tone="blue" value={d.counts.scripts_in_progress} label="In progress" />
            <Stat to="/scripts/library" icon={<ClockCountdown size={20} />} tone="amber" value={d.counts.scripts_due_week} label="Due in 7 days" />
            <Stat to="/scripts/todos" icon={<ListChecks size={20} />} tone="violet" value={d.counts.todos_total - d.counts.todos_done} label="Open to-dos"
              hint={d.counts.todos_high ? `${d.counts.todos_high} high priority` : undefined} />
            <Link to="/scripts/library" className="sv-stat sv-stat-ring">
              <ProgressRing percent={pct(d.counts.scripts_done, d.counts.scripts_total)} size={56} stroke={6} label={`${pct(d.counts.scripts_done, d.counts.scripts_total)}% of scripts completed`} />
              <span>
                <span className="heading-6">{d.counts.scripts_done}<span className="sv-soft body-6"> / {d.counts.scripts_total}</span></span>
                <span className="caption-2 sv-soft">Scripts completed</span>
              </span>
            </Link>
          </div>

          <FolderProgress data={foldersState.data} loading={foldersState.loading} />

          <div className="sv-dash-grid">
            <MonthCalendar token={token} categories={categories} />
            <div className="sv-stack">
              <UpNext d={d} categories={categories} folders={folders} onStatus={(s, status) => act(() => updateScript(token, s.id, { status }), status === 'completed' ? `“${s.title}” marked completed` : undefined)} />
              <section className="sv-card">
                <div className="sv-card-head">
                  <h2 className="title-2"><Target size={20} weight="duotone" aria-hidden="true" /> Goals</h2>
                  <Link className="sv-link" to="/scripts/goals">All goals <ArrowRight size={14} /></Link>
                </div>
                {d.goals.length === 0 ? (
                  <p className="body-6 sv-soft">Set a target like “Publish 12 reels this month”. Scripts you link to it count automatically. <Link className="sv-link" to="/scripts/goals">Add a goal</Link></p>
                ) : (
                  <ul className="sv-goal-mini">
                    {d.goals.map((g) => (
                      <li key={g.id}>
                        <div className="sv-row-between">
                          <span className="title-4 sv-ellipsis">{g.title}</span>
                          <span className="sv-row">
                            <span className="caption-4 sv-soft sv-num">{g.current_progress} / {g.target_value}</span>
                            <button type="button" className="sv-icon-btn sv-plus1" aria-label={`Add 1 to ${g.title}`}
                              onClick={() => act(() => incrementGoal(token, g.id), g.current_progress + 1 >= g.target_value ? `Goal reached: ${g.title}` : undefined)}>+1</button>
                          </span>
                        </div>
                        <GoalBar goal={g} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function summary(d: DashboardData): string {
  const c = d.counts;
  if (!c.scripts_total) return 'Your vault is empty. Capture your first idea below and shape it into a script.';
  const parts = [`${c.scripts_in_progress} script${c.scripts_in_progress === 1 ? '' : 's'} in progress`];
  if (c.scripts_due_week) parts.push(`${c.scripts_due_week} due this week`);
  if (c.todos_total - c.todos_done) parts.push(`${c.todos_total - c.todos_done} open to-do${c.todos_total - c.todos_done === 1 ? '' : 's'}`);
  return `${parts.join(' · ')}.`;
}

function Stat({ to, icon, tone, value, label, hint }: { to: string; icon: ReactNode; tone: string; value: number; label: string; hint?: string }) {
  return (
    <Link to={to} className="sv-stat">
      <span className={`sv-stat-icon ${tone}`} aria-hidden="true">{icon}</span>
      <span>
        <span className="heading-5 sv-num">{value}</span>
        <span className="caption-2 sv-soft">{label}</span>
        {hint && <span className="caption-4 sv-hint">{hint}</span>}
      </span>
    </Link>
  );
}

/** Type a title, press Enter: the script exists. Open it later to write. */
function QuickCapture({ token }: { token: string }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    try {
      const s = await createScript(token, { title: t });
      setTitle('');
      refreshScripts();
      toast(`Saved “${t}”`, 'ok', { label: 'Open', run: () => navigate(`/scripts/library/${s.id}`) });
    } catch (err) {
      toast(errorMessage(err, 'Could not save the idea.'), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="sv-capture" onSubmit={submit}>
      <Lightning size={20} weight="duotone" className="sv-capture-icon" aria-hidden="true" />
      <input type="text" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Capture a script idea and press Enter" aria-label="New script idea" />
      <button type="submit" className="sv-btn sv-btn-primary" disabled={busy || !title.trim()}><Plus size={16} weight="bold" aria-hidden="true" /> Save idea</button>
    </form>
  );
}

/** A short checklist until the workspace is set up, then it disappears. */
function Setup({ token, d }: { token: string; d: DashboardData }) {
  const ai = useAiSettings(token);
  if (!ai.data) return null;
  const steps = [
    { done: d.counts.scripts_total > 0, label: 'Write or capture your first script', to: '/scripts/library/new' },
    { done: Boolean(ai.data.active_provider), label: 'Connect an AI provider with your own key', to: '/scripts/settings?section=ai' },
    { done: d.counts.niches_total > 0, label: 'Describe your niche and audience language', to: '/scripts/settings?section=niches' },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (!left) return null;
  return (
    <section className="sv-card sv-setup">
      <div className="sv-card-head">
        <h2 className="title-2"><Sparkle size={20} weight="duotone" aria-hidden="true" /> Get set up</h2>
        <span className="caption-3 sv-soft">{steps.length - left} of {steps.length} done</span>
      </div>
      <ol className="sv-steps">
        {steps.map((s) => (
          <li key={s.label} className={s.done ? 'done' : ''}>
            {s.done ? <CheckCircle size={20} weight="fill" aria-hidden="true" /> : <Circle size={20} aria-hidden="true" />}
            {s.done ? <span className="body-6">{s.label}</span> : <Link to={s.to} className="body-5">{s.label} <ArrowRight size={14} aria-hidden="true" /></Link>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function UpNext({ d, categories, folders, onStatus }: { d: DashboardData; categories: ScriptCategory[]; folders: ScriptFolder[]; onStatus: (s: Script, status: Script['status']) => void }) {
  const [tab, setTab] = useState<'due' | 'recent'>(d.due_this_week.length ? 'due' : 'recent');
  const list = tab === 'due' ? d.due_this_week : d.recent;
  return (
    <section className="sv-card">
      <div className="sv-card-head">
        <h2 className="title-2">Up next</h2>
        <div className="sv-seg" role="tablist" aria-label="Which scripts">
          <button type="button" role="tab" aria-selected={tab === 'due'} className={tab === 'due' ? 'active' : ''} onClick={() => setTab('due')}>Due soon</button>
          <button type="button" role="tab" aria-selected={tab === 'recent'} className={tab === 'recent' ? 'active' : ''} onClick={() => setTab('recent')}>Recent</button>
        </div>
      </div>
      {list.length === 0 ? (
        <p className="body-6 sv-soft">{tab === 'due' ? 'Nothing due in the next 7 days.' : 'No scripts yet.'} <Link className="sv-link" to="/scripts/library/new">Write one</Link></p>
      ) : (
        <ul className="sv-rows">
          {list.map((s) => (
            <li key={s.id}>
              <Link to={`/scripts/library/${s.id}`} className="sv-row-main">
                <span className="title-4 sv-ellipsis">{s.title}</span>
                <span className="sv-meta">
                  {(() => { const f = folders.find((x) => x.id === s.folder_id); return f ? <span className="sv-folder-tag caption-4" style={{ ['--folder' as string]: f.color }}><Folder size={14} weight="fill" aria-hidden="true" />{f.name}</span> : null; })()}
                  {s.deadline ? <DeadlineChip date={s.deadline} done={s.status === 'completed'} /> : <span className="caption-5 sv-soft">Edited {timeAgo(s.modified_at)}</span>}
                  <CategoryChips ids={s.category_ids} categories={categories} max={2} />
                </span>
              </Link>
              <StatusSelect value={s.status} onChange={(st) => onStatus(s, st)} label={`Status of ${s.title}`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

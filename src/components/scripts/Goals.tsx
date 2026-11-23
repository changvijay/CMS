import { useState, type FormEvent } from 'react';
import { CalendarBlank, Plus, Target, Trophy } from '@phosphor-icons/react';
import { deleteGoal, incrementGoal, localToday, saveGoal, type ScriptGoal } from '../../services/scriptsApi';
import { errorMessage } from '../../utils/errors';
import { Modal } from '../workspace/ui';
import { EmptyState, ProgressRing, SkeletonRows } from './shared';
import { confirmDialog, deadlineLabel, goalPercent, isOverdue, refreshScripts, toast, useGoals } from './util';

const TEMPLATES = [
  { title: 'Complete 10 scripts this month', target: 10 },
  { title: 'Finish 3 scripts this week', target: 3 },
  { title: 'Write for 30 minutes every day', target: 30 },
  { title: 'Complete 5 scripts in progress', target: 5 },
];

export default function Goals({ token }: { token: string }) {
  const state = useGoals(token);
  const [editing, setEditing] = useState<ScriptGoal | 'new' | null>(null);
  const [bumped, setBumped] = useState<string | null>(null);

  const bump = async (g: ScriptGoal) => {
    setBumped(g.id);
    setTimeout(() => setBumped(null), 600);
    try {
      const { goal } = await incrementGoal(token, g.id);
      refreshScripts();
      if (goal.completed) toast(`Goal reached: ${goal.title}`);
    } catch (err) {
      toast(errorMessage(err, 'Could not update the goal.'), 'error');
    }
  };

  const goals = state.data;
  const active = goals?.filter((g) => !g.completed) ?? [];
  const done = goals?.filter((g) => g.completed) ?? [];

  return (
    <div className="sv-stack">
      <div className="sv-row-between sv-wrap">
        <p className="body-6 sv-soft">Scripts linked to a goal count toward it automatically. Use +1 for everything else.</p>
        <button type="button" className="sv-btn sv-btn-primary" onClick={() => setEditing('new')}><Plus size={16} weight="bold" aria-hidden="true" /> New goal</button>
      </div>

      {!goals ? (state.error ? <div className="sv-banner error">{state.error}</div> : <SkeletonRows rows={3} tall />) : goals.length === 0 ? (
        <EmptyState icon={<Target size={28} weight="duotone" />} title="Set your first goal" body="A clear target keeps you posting. Pick a template or write your own.">
          {TEMPLATES.slice(0, 2).map((t) => (
            <button key={t.title} type="button" className="sv-btn sv-btn-ghost" onClick={() => saveGoal(token, { title: t.title, target_value: t.target }).then(() => { refreshScripts(); toast('Goal added'); }).catch((e) => toast(errorMessage(e, 'Could not add the goal.'), 'error'))}>
              {t.title}
            </button>
          ))}
          <button type="button" className="sv-btn sv-btn-primary" onClick={() => setEditing('new')}>Write my own</button>
        </EmptyState>
      ) : (
        <>
          {active.length > 0 && (
            <section aria-label="Active goals">
              <h2 className="caption-3 sv-group-title">Active <span className="sv-count">{active.length}</span></h2>
              <ul className="sv-goals">{active.map((g) => <GoalCard key={g.id} g={g} bumped={bumped === g.id} onEdit={() => setEditing(g)} onBump={() => bump(g)} />)}</ul>
            </section>
          )}
          {done.length > 0 && (
            <section aria-label="Completed goals">
              <h2 className="caption-3 sv-group-title">Reached <span className="sv-count">{done.length}</span></h2>
              <ul className="sv-goals">{done.map((g) => <GoalCard key={g.id} g={g} bumped={false} onEdit={() => setEditing(g)} onBump={() => bump(g)} />)}</ul>
            </section>
          )}
        </>
      )}
      {editing && <GoalModal goal={editing === 'new' ? null : editing} token={token} onClose={() => setEditing(null)} />}
    </div>
  );
}

function GoalCard({ g, bumped, onEdit, onBump }: { g: ScriptGoal; bumped: boolean; onEdit: () => void; onBump: () => void }) {
  const left = Math.max(0, g.target_value - g.current_progress);
  return (
    <li className={`sv-goal ${g.completed ? 'done' : ''} ${bumped ? 'bumped' : ''}`}>
      <ProgressRing percent={goalPercent(g) * 100} size={64} stroke={7} label={`${g.current_progress} of ${g.target_value}`}>
        {g.completed ? <Trophy size={24} weight="fill" /> : `${Math.round(goalPercent(g) * 100)}%`}
      </ProgressRing>
      <button type="button" className="sv-goal-main" onClick={onEdit}>
        <span className="title-3">{g.title}</span>
        <span className="caption-2 sv-soft">{g.completed ? `Reached ${g.current_progress} of ${g.target_value}` : `${g.current_progress} of ${g.target_value} · ${left} to go`}</span>
        {g.deadline && <span className={`sv-chip-date ${isOverdue(g.deadline, g.completed) ? 'late' : ''}`}><CalendarBlank size={14} aria-hidden="true" />{deadlineLabel(g.deadline, g.completed)}</span>}
      </button>
      {!g.completed && <button type="button" className="sv-btn sv-btn-ghost sv-plus" onClick={onBump} aria-label={`Add 1 to ${g.title}`}>+1</button>}
    </li>
  );
}

function GoalModal({ goal, token, onClose }: { goal: ScriptGoal | null; token: string; onClose: () => void }) {
  const today = localToday();
  const [title, setTitle] = useState(goal?.title ?? '');
  const [target, setTarget] = useState(String(goal?.target_value ?? 10));
  const [progress, setProgress] = useState(String(goal?.current_progress ?? 0));
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('Give the goal a title.'); return; }
    if (!(Number(target) >= 1)) { setError('The target must be at least 1.'); return; }
    setBusy(true);
    setError('');
    try {
      await saveGoal(token, { title: title.trim(), target_value: Math.round(Number(target)), current_progress: Math.max(0, Math.round(Number(progress) || 0)), deadline: deadline || null }, goal?.id);
      refreshScripts();
      toast(goal ? 'Goal updated' : 'Goal added');
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the goal.'));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!goal || !(await confirmDialog({ title: 'Delete this goal?', body: 'Linked scripts stay, they just stop counting.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await deleteGoal(token, goal.id);
      refreshScripts();
      toast('Goal deleted');
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not delete the goal.'));
    }
  };

  return (
    <Modal title={goal ? 'Edit goal' : 'New goal'} onClose={onClose}>
      <form className="sv-form" onSubmit={submit} noValidate>
        {!goal && (
          <div className="sv-field">
            <span className="caption-3">Start from a template</span>
            <div className="sv-chiprow">
              {TEMPLATES.map((t) => <button key={t.title} type="button" className={`sv-chip ${title === t.title ? 'active' : ''}`} onClick={() => { setTitle(t.title); setTarget(String(t.target)); }}>{t.title}</button>)}
            </div>
          </div>
        )}
        <label className="sv-field"><span className="caption-3">Goal</span><input type="text" className="sv-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Publish 12 reels this month" autoFocus={!goal} /></label>
        <div className="sv-form-row">
          <label className="sv-field"><span className="caption-3">Target</span><input type="number" className="sv-input" min={1} value={target} onChange={(e) => setTarget(e.target.value)} /></label>
          <label className="sv-field"><span className="caption-3">Done so far</span><input type="number" className="sv-input" min={0} value={progress} onChange={(e) => setProgress(e.target.value)} /></label>
          <label className="sv-field"><span className="caption-3">Deadline</span><input type="date" className="sv-input" value={deadline} min={deadline && deadline < today ? undefined : today} onChange={(e) => setDeadline(e.target.value)} /></label>
        </div>
        {error && <div className="sv-banner error" role="alert">{error}</div>}
        <div className="sv-actions">
          <button type="submit" className="sv-btn sv-btn-primary" disabled={busy}>{busy ? 'Saving…' : goal ? 'Save goal' : 'Add goal'}</button>
          <button type="button" className="sv-btn sv-btn-ghost" onClick={onClose}>Cancel</button>
          {goal && <button type="button" className="sv-btn sv-btn-ghost sv-danger-text sv-push" onClick={remove}>Delete goal</button>}
        </div>
      </form>
    </Modal>
  );
}

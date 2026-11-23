import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarBlank, CaretDown, Check, ListChecks, MagnifyingGlass, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { clearDoneTodos, deleteTodo, listTodos, localToday, saveTodo, type Priority, type ScriptTodo } from '../../services/scriptsApi';
import { errorMessage } from '../../utils/errors';
import { useLive } from '../workspace/useLive';
import { Modal } from '../workspace/ui';
import { EmptyState, SkeletonRows } from './shared';
import {
  KEY, PRIORITIES, PRIORITY_LABEL, TODO_GROUP_LABEL, confirmDialog, deadlineLabel, isOverdue, refreshScripts, sortTodos, toast, todoGroup, type TodoGroup,
} from './util';

const GROUPS: TodoGroup[] = ['overdue', 'today', 'week', 'later', 'someday'];

export default function Todos({ token }: { token: string }) {
  const state = useLive(() => listTodos(token), `${KEY}todos`);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<ScriptTodo | null>(null);

  const act = async (fn: () => Promise<unknown>, done?: string, undo?: () => Promise<unknown>) => {
    try {
      await fn();
      refreshScripts();
      if (done) toast(done, 'ok', undo ? { label: 'Undo', run: () => { undo().then(refreshScripts).catch(() => toast('Could not undo.', 'error')); } } : undefined);
    } catch (err) {
      toast(errorMessage(err, 'Could not save.'), 'error');
    }
  };

  const all = useMemo(() => state.data ?? [], [state.data]);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => sortTodos(all.filter((t) => !q || t.text.toLowerCase().includes(q))), [all, q]);
  const grouped = useMemo(() => {
    const m = new Map<TodoGroup, ScriptTodo[]>();
    for (const t of matches) m.set(todoGroup(t), [...(m.get(todoGroup(t)) ?? []), t]);
    return m;
  }, [matches]);
  const done = grouped.get('done') ?? [];
  const open = all.filter((t) => !t.completed).length;

  const remove = (t: ScriptTodo) => act(() => deleteTodo(token, t.id), 'Task deleted', () => saveTodo(token, { text: t.text, priority: t.priority, due_date: t.due_date, completed: t.completed }));
  const clearDone = async () => {
    if (!(await confirmDialog({ title: `Clear ${done.length} finished task${done.length > 1 ? 's' : ''}?`, body: 'They will be deleted.', confirmLabel: 'Clear', danger: true }))) return;
    act(() => clearDoneTodos(token), 'Finished tasks cleared');
  };

  return (
    <div className="sv-stack sv-narrow">
      <QuickAdd token={token} prefill={params.get('new')} onUsedPrefill={() => setParams({}, { replace: true })} />

      <div className="sv-row-between sv-wrap">
        <p className="body-6 sv-soft">{open} open{done.length ? ` · ${done.length} done` : ''}</p>
        {all.length > 4 && (
          <label className="sv-search sv-search-sm">
            <MagnifyingGlass size={16} aria-hidden="true" />
            <input type="search" placeholder="Search tasks" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search tasks" />
          </label>
        )}
      </div>

      {!state.data ? (state.error ? <div className="sv-banner error">{state.error}</div> : <SkeletonRows rows={4} />) : all.length === 0 ? (
        <EmptyState icon={<ListChecks size={28} weight="duotone" />} title="Nothing on your list" body="Add the next small step: research a topic, record a take, edit a reel. Press Enter to add it." />
      ) : (
        <>
          {GROUPS.filter((g) => grouped.get(g)?.length).map((g) => (
            <section key={g} className="sv-todo-group" aria-label={TODO_GROUP_LABEL[g]}>
              <h2 className={`caption-3 sv-group-title ${g === 'overdue' ? 'late' : ''}`}>{TODO_GROUP_LABEL[g]} <span className="sv-count">{grouped.get(g)!.length}</span></h2>
              <ul className="sv-todos">
                {grouped.get(g)!.map((t) => <TodoRow key={t.id} t={t} onToggle={() => act(() => saveTodo(token, { completed: !t.completed }, t.id), t.completed ? undefined : 'Task done')} onEdit={() => setEditing(t)} onDelete={() => remove(t)} />)}
              </ul>
            </section>
          ))}
          {matches.length === done.length && !showDone && <p className="body-6 sv-soft">{q ? 'No open tasks match.' : 'All clear. Every task is done.'}</p>}
          {done.length > 0 && (
            <section className="sv-todo-group">
              <div className="sv-row-between">
                <button type="button" className="sv-disclose caption-3" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
                  <CaretDown size={14} className={showDone ? 'open' : ''} aria-hidden="true" /> Done <span className="sv-count">{done.length}</span>
                </button>
                <button type="button" className="sv-link caption-3" onClick={clearDone}>Clear done</button>
              </div>
              {showDone && (
                <ul className="sv-todos">
                  {done.map((t) => <TodoRow key={t.id} t={t} onToggle={() => act(() => saveTodo(token, { completed: false }, t.id))} onEdit={() => setEditing(t)} onDelete={() => remove(t)} />)}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      {editing && <TodoModal todo={editing} onClose={() => setEditing(null)} onSave={async (input) => {
        await saveTodo(token, input, editing.id);
        refreshScripts();
        setEditing(null);
        toast('Task updated');
      }} />}
    </div>
  );
}

function TodoRow({ t, onToggle, onEdit, onDelete }: { t: ScriptTodo; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <li className={`sv-todo ${t.completed ? 'done' : ''}`}>
      <button type="button" role="checkbox" aria-checked={t.completed} className={`sv-tick sv-pri-${t.priority}`} onClick={onToggle} aria-label={`Mark “${t.text}” ${t.completed ? 'not done' : 'done'}`}>
        <Check size={14} weight="bold" aria-hidden="true" />
      </button>
      <button type="button" className="sv-todo-main" onClick={onEdit}>
        <span className="body-5 sv-todo-text">{t.text}</span>
        <span className="sv-meta">
          <span className={`sv-badge sv-pri-${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
          {t.due_date && <span className={`sv-chip-date ${isOverdue(t.due_date, t.completed) ? 'late' : ''}`}><CalendarBlank size={14} aria-hidden="true" />{deadlineLabel(t.due_date, t.completed)}</span>}
        </span>
      </button>
      <span className="sv-row-actions">
        <button type="button" className="sv-icon-btn" onClick={onEdit} aria-label={`Edit “${t.text}”`}><PencilSimple size={16} /></button>
        <button type="button" className="sv-icon-btn sv-danger-btn" onClick={onDelete} aria-label={`Delete “${t.text}”`}><Trash size={16} /></button>
      </span>
    </li>
  );
}

/** Type, pick priority and date if you like, press Enter. */
function QuickAdd({ token, prefill, onUsedPrefill }: { token: string; prefill: string | null; onUsedPrefill: () => void }) {
  const today = localToday();
  const [text, setText] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [due, setDue] = useState(prefill ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await saveTodo(token, { text: text.trim(), priority, due_date: due || null });
      setText('');
      if (prefill) onUsedPrefill();
      refreshScripts();
    } catch (err) {
      toast(errorMessage(err, 'Could not add the task.'), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="sv-quickadd" onSubmit={submit}>
      <Plus size={20} className="sv-soft" aria-hidden="true" />
      <input type="text" className="sv-quickadd-input" value={text} maxLength={500} onChange={(e) => setText(e.target.value)}
        placeholder="Add a task, e.g. Record the Diwali sale reel" aria-label="New task" autoFocus={Boolean(prefill)} />
      <div className="sv-quickadd-opts">
        <div className="sv-seg sv-seg-sm" role="radiogroup" aria-label="Priority">
          {PRIORITIES.map((p) => <button key={p} type="button" role="radio" aria-checked={priority === p} className={`${priority === p ? 'active' : ''} sv-pri-${p}`} onClick={() => setPriority(p)}>{PRIORITY_LABEL[p]}</button>)}
        </div>
        <input type="date" className="sv-input sv-input-sm" value={due} min={today} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
        <button type="submit" className="sv-btn sv-btn-primary sv-btn-sm" disabled={busy || !text.trim()}>Add</button>
      </div>
    </form>
  );
}

function TodoModal({ todo: t, onSave, onClose }: { todo: ScriptTodo; onSave: (i: { text: string; priority: Priority; due_date: string | null }) => Promise<void>; onClose: () => void }) {
  const today = localToday();
  const [text, setText] = useState(t.text);
  const [priority, setPriority] = useState<Priority>(t.priority);
  const [due, setDue] = useState(t.due_date ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) { setError('Write the task.'); return; }
    setBusy(true);
    try {
      await onSave({ text: text.trim(), priority, due_date: due || null });
    } catch (err) {
      setError(errorMessage(err, 'Could not save the task.'));
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit task" onClose={onClose}>
      <form className="sv-form" onSubmit={submit} noValidate>
        <label className="sv-field"><span className="caption-3">Task</span><input type="text" className="sv-input" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} autoFocus /></label>
        <div className="sv-field">
          <span className="caption-3">Priority</span>
          <div className="sv-seg" role="radiogroup" aria-label="Priority">
            {PRIORITIES.map((p) => <button key={p} type="button" role="radio" aria-checked={priority === p} className={`${priority === p ? 'active' : ''} sv-pri-${p}`} onClick={() => setPriority(p)}>{PRIORITY_LABEL[p]}</button>)}
          </div>
        </div>
        <label className="sv-field">
          <span className="caption-3">Due date</span>
          <span className="sv-row"><input type="date" className="sv-input" value={due} min={due && due < today ? undefined : today} onChange={(e) => setDue(e.target.value)} />{due && <button type="button" className="sv-link" onClick={() => setDue('')}>Clear</button>}</span>
        </label>
        {error && <div className="sv-banner error" role="alert">{error}</div>}
        <div className="sv-actions">
          <button type="submit" className="sv-btn sv-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          <button type="button" className="sv-btn sv-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CaretLeft, CaretRight, CheckSquare, NotePencil, Plus } from '@phosphor-icons/react';
import { getCalendar, localToday, type CalendarData, type ScriptCategory } from '../../services/scriptsApi';
import { useLive } from '../workspace/useLive';
import { StatusDot } from './shared';
import { KEY, PRIORITY_LABEL, STATUS_LABEL, formatDay } from './util';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 86_400_000;

const toDate = (s: string) => new Date(`${s}T00:00:00`);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfWeek = (d: Date) => addDays(d, -d.getDay());

/** Week or month grid (weeks start on Sunday). Picking a day shows its scripts and to-dos underneath. */
export default function MonthCalendar({ token, categories }: { token: string; categories: ScriptCategory[] }) {
  const today = localToday();
  const [view, setView] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(() => toDate(today));
  const [picked, setPicked] = useState(today);

  const { days, from, to, label } = useMemo(() => {
    if (view === 'week') {
      const start = startOfWeek(anchor);
      const list = Array.from({ length: 7 }, (_, i) => addDays(start, i));
      const fmt = (d: Date) => d.toLocaleDateString([], { day: 'numeric', month: 'short' });
      return { days: list, from: list[0], to: list[6], label: `${fmt(list[0])} to ${fmt(list[6])}` };
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = startOfWeek(first);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const count = Math.ceil((last.getTime() - start.getTime()) / DAY_MS + 1);
    const list = Array.from({ length: Math.ceil(count / 7) * 7 }, (_, i) => addDays(start, i));
    return { days: list, from: list[0], to: list[list.length - 1], label: first.toLocaleDateString([], { month: 'long', year: 'numeric' }) };
  }, [view, anchor]);

  const fromStr = localToday(from);
  const toStr = localToday(to);
  const state = useLive(() => getCalendar(token, fromStr, toStr), `${KEY}calendar:${fromStr}:${toStr}`);

  const byDay = useMemo(() => {
    const m = new Map<string, { scripts: number; todos: number }>();
    const bump = (day: string, k: 'scripts' | 'todos') => {
      const c = m.get(day) ?? { scripts: 0, todos: 0 };
      c[k] += 1;
      m.set(day, c);
    };
    for (const s of state.data?.scripts ?? []) if (s.deadline) bump(s.deadline, 'scripts');
    for (const t of state.data?.todos ?? []) if (t.due_date && !t.completed) bump(t.due_date, 'todos');
    return m;
  }, [state.data]);

  const step = (dir: number) => setAnchor((a) => (view === 'week' ? addDays(a, dir * 7) : new Date(a.getFullYear(), a.getMonth() + dir, 1)));
  const showsToday = days.some((d) => localToday(d) === today) && (view === 'week' || anchor.getMonth() === toDate(today).getMonth());

  return (
    <section className="sv-card sv-cal">
      <div className="sv-card-head">
        <div className="sv-row">
          <button type="button" className="sv-icon-btn" onClick={() => step(-1)} aria-label={`Previous ${view}`}><CaretLeft size={16} weight="bold" /></button>
          <h2 className="title-2 sv-cal-label" aria-live="polite">{label}</h2>
          <button type="button" className="sv-icon-btn" onClick={() => step(1)} aria-label={`Next ${view}`}><CaretRight size={16} weight="bold" /></button>
          {!showsToday && <button type="button" className="sv-link" onClick={() => { setAnchor(toDate(today)); setPicked(today); }}>Today</button>}
        </div>
        <div className="sv-seg" role="group" aria-label="Calendar view">
          <button type="button" className={view === 'week' ? 'active' : ''} aria-pressed={view === 'week'} onClick={() => setView('week')}>Week</button>
          <button type="button" className={view === 'month' ? 'active' : ''} aria-pressed={view === 'month'} onClick={() => setView('month')}>Month</button>
        </div>
      </div>

      <div className={`sv-cal-grid ${view}`} role="grid" aria-label={label} aria-busy={state.loading}>
        {WEEKDAYS.map((w) => <div key={w} className="sv-cal-wd caption-3" role="columnheader">{w}</div>)}
        {days.map((d) => {
          const key = localToday(d);
          const c = byDay.get(key);
          const outside = view === 'month' && d.getMonth() !== anchor.getMonth();
          const past = key < today;
          return (
            <button key={key} type="button" role="gridcell" aria-selected={picked === key}
              className={`sv-cal-day ${key === today ? 'today' : ''} ${picked === key ? 'picked' : ''} ${outside ? 'outside' : ''} ${past ? 'past' : ''}`}
              aria-label={`${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}${c ? `, ${c.scripts} scripts, ${c.todos} to-dos` : ''}`}
              onClick={() => setPicked(key)}>
              <span className="sv-cal-num">{d.getDate()}</span>
              <span className="sv-cal-marks" aria-hidden="true">
                {c?.scripts ? <i className={`s ${past ? 'late' : ''}`}>{c.scripts}</i> : null}
                {c?.todos ? <i className={`t ${past ? 'late' : ''}`}>{c.todos}</i> : null}
              </span>
            </button>
          );
        })}
      </div>
      <p className="sv-cal-legend caption-5">
        <span className="lg s">Script deadline</span><span className="lg t">Open to-do</span><span className="lg late">Past due</span>
      </p>

      <Agenda day={picked} today={today} categories={categories} data={state.data} />
    </section>
  );
}

function Agenda({ day, today, categories, data }: { day: string; today: string; categories: ScriptCategory[]; data: CalendarData | null }) {
  const scripts = (data?.scripts ?? []).filter((s) => s.deadline === day);
  const todos = (data?.todos ?? []).filter((t) => t.due_date === day);
  const title = day === today ? 'Today' : formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' });
  const canAdd = day >= today;
  return (
    <div className="sv-agenda">
      <div className="sv-row-between">
        <h3 className="title-3">{title}</h3>
        {canAdd && (
          <span className="sv-row">
            <Link className="sv-btn sv-btn-ghost sv-btn-sm" to={`/scripts/library/new?date=${day}`}><Plus size={14} weight="bold" aria-hidden="true" /> Script</Link>
            <Link className="sv-btn sv-btn-ghost sv-btn-sm" to={`/scripts/todos?new=${day}`}><Plus size={14} weight="bold" aria-hidden="true" /> To-do</Link>
          </span>
        )}
      </div>
      {scripts.length + todos.length === 0 ? (
        <p className="body-6 sv-soft">{canAdd ? 'Nothing planned. A free day to write.' : 'Nothing was planned for this day.'}</p>
      ) : (
        <ul className="sv-agenda-list">
          {scripts.map((s) => {
            const cat = categories.find((c) => s.category_ids.includes(c.id));
            return (
              <li key={`s${s.id}`}>
                <NotePencil size={16} className="sv-agenda-icon s" aria-hidden="true" />
                <Link to={`/scripts/library/${s.id}`} className="body-5 sv-ellipsis">{s.title}</Link>
                {cat && <span className="sv-cat" style={{ ['--cat' as string]: cat.color }}>{cat.name}</span>}
                <span className={`sv-badge sv-st-${s.status}`}><StatusDot status={s.status} />{STATUS_LABEL[s.status]}</span>
              </li>
            );
          })}
          {todos.map((t) => (
            <li key={`t${t.id}`} className={t.completed ? 'done' : ''}>
              <CheckSquare size={16} weight={t.completed ? 'fill' : 'regular'} className="sv-agenda-icon t" aria-hidden="true" />
              <Link to="/scripts/todos" className="body-5 sv-ellipsis">{t.text}</Link>
              <span className={`sv-badge sv-pri-${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

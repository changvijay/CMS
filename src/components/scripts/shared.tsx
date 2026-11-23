import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarBlank, CaretDown, CheckCircle, Info, WarningCircle, X } from '@phosphor-icons/react';
import type { ScriptCategory, ScriptGoal, ScriptStatus } from '../../services/scriptsApi';
import { STATUSES, STATUS_LABEL, deadlineLabel, goalPercent, goalTone, isOverdue, type ConfirmEvent, type ToastEvent } from './util';

export function StatusDot({ status }: { status: ScriptStatus }) {
  return <span className={`sv-dot sv-st-${status}`} aria-hidden="true" />;
}

/** A status picker styled as a coloured pill. */
export function StatusSelect({ value, onChange, disabled, label = 'Status' }: { value: ScriptStatus; onChange: (s: ScriptStatus) => void; disabled?: boolean; label?: string }) {
  return (
    <span className={`sv-pill-select sv-st-${value}`}>
      <StatusDot status={value} />
      <select value={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.value as ScriptStatus)} onClick={(e) => e.stopPropagation()}>
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
      <CaretDown size={12} weight="bold" aria-hidden="true" />
    </span>
  );
}

export function CategoryChips({ ids, categories, max = 3 }: { ids: string[]; categories: ScriptCategory[]; max?: number }) {
  const shown = categories.filter((c) => ids.includes(c.id));
  if (!shown.length) return null;
  return (
    <span className="sv-cats">
      {shown.slice(0, max).map((c) => (
        <span key={c.id} className="sv-cat" style={{ ['--cat' as string]: c.color }}>{c.name}</span>
      ))}
      {shown.length > max && <span className="sv-cat sv-cat-more">+{shown.length - max}</span>}
    </span>
  );
}

export function DeadlineChip({ date, done }: { date: string | null; done: boolean }) {
  if (!date) return null;
  const late = isOverdue(date, done);
  return (
    <span className={`sv-chip-date ${late ? 'late' : ''}`}>
      <CalendarBlank size={14} weight={late ? 'fill' : 'regular'} aria-hidden="true" />
      {deadlineLabel(date, done)}
    </span>
  );
}

/** Circular percentage, starting at 12 o'clock. */
export function ProgressRing({ percent, size = 72, stroke = 8, label, children }: { percent: number; size?: number; stroke?: number; label?: string; children?: ReactNode }) {
  const p = Math.max(0, Math.min(100, percent));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="sv-ring" style={{ width: size, height: size }} role="img" aria-label={label ?? `${Math.round(p)}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="sv-ring-track" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={`sv-ring-value ${p >= 100 ? 'full' : ''}`} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="sv-ring-label">{children ?? `${Math.round(p)}%`}</span>
    </span>
  );
}

export function GoalBar({ goal }: { goal: ScriptGoal }) {
  return (
    <div className={`sv-bar sv-bar-${goalTone(goal)}`} role="progressbar" aria-valuemin={0} aria-valuemax={goal.target_value} aria-valuenow={goal.current_progress} aria-label={goal.title}>
      <span style={{ transform: `scaleX(${goalPercent(goal)})` }} />
    </div>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <nav className="sv-pager" aria-label="Pages">
      <button type="button" className="sv-btn sv-btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span className="caption-2">Page {page} of {pages}</span>
      <button type="button" className="sv-btn sv-btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </nav>
  );
}

/** Grey placeholder rows shaped like the list that is loading. */
export function SkeletonRows({ rows = 4, tall = false }: { rows?: number; tall?: boolean }) {
  return (
    <div className="sv-skel-list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`sv-skel-row ${tall ? 'tall' : ''}`}>
          <span className="sv-skel sv-skel-dot" />
          <span className="sv-skel-lines"><span className="sv-skel" style={{ width: `${60 - i * 7}%` }} /><span className="sv-skel short" /></span>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="sv-empty">
      <span className="sv-empty-icon" aria-hidden="true">{icon}</span>
      <h3 className="title-1">{title}</h3>
      <p className="body-6">{body}</p>
      {children && <div className="sv-empty-actions">{children}</div>}
    </div>
  );
}

/** Toasts and the confirm dialog for the whole Scripts workspace (see toast() and confirmDialog() in util.ts). */
export function FeedbackHost() {
  const [toasts, setToasts] = useState<ToastEvent[]>([]);
  const [ask, setAsk] = useState<ConfirmEvent | null>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onToast = (e: Event) => {
      const t = (e as CustomEvent<ToastEvent>).detail;
      setToasts((list) => [...list.slice(-2), t]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), t.action ? 6000 : 3500);
    };
    const onConfirm = (e: Event) => setAsk((e as CustomEvent<ConfirmEvent>).detail);
    window.addEventListener('sv-toast', onToast);
    window.addEventListener('sv-confirm', onConfirm);
    return () => {
      window.removeEventListener('sv-toast', onToast);
      window.removeEventListener('sv-confirm', onConfirm);
    };
  }, []);

  useEffect(() => {
    if (!ask) return;
    const opener = document.activeElement as HTMLElement | null;
    confirmBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { ask.resolve(false); setAsk(null); } };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener?.focus?.(); };
  }, [ask]);

  const answer = (ok: boolean) => { ask?.resolve(ok); setAsk(null); };

  return (
    <>
      <div className="sv-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`sv-toast ${t.tone}`}>
            {t.tone === 'error' ? <WarningCircle size={20} weight="fill" /> : t.tone === 'info' ? <Info size={20} weight="fill" /> : <CheckCircle size={20} weight="fill" />}
            <span className="body-5">{t.text}</span>
            {t.action && <button type="button" className="sv-toast-action" onClick={() => { t.action?.run(); setToasts((l) => l.filter((x) => x.id !== t.id)); }}>{t.action.label}</button>}
            <button type="button" className="sv-toast-close" aria-label="Dismiss" onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))}><X size={14} /></button>
          </div>
        ))}
      </div>
      {ask && (
        <div className="sv-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) answer(false); }}>
          <div className="sv-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sv-dialog-title">
            <h3 id="sv-dialog-title" className="heading-6">{ask.title}</h3>
            {ask.body && <p className="body-6">{ask.body}</p>}
            <div className="sv-dialog-actions">
              <button type="button" className="sv-btn sv-btn-ghost" onClick={() => answer(false)}>Cancel</button>
              <button ref={confirmBtn} type="button" className={`sv-btn ${ask.danger ? 'sv-btn-danger' : 'sv-btn-primary'}`} onClick={() => answer(true)}>{ask.confirmLabel ?? 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

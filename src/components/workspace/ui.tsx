import { useEffect, useRef, type ReactNode } from 'react';
import type { ApiErrorDetails, ReportResult } from '../../services/api';
import type { LiveState } from './useLive';
import { isPermissionError } from '../../utils/errors';

export function ErrorLine({ error, label }: { error: ApiErrorDetails; label: string }) {
  // The saved Google token simply doesn't cover this report: that is not a failure worth a red banner.
  if (isPermissionError(error)) return <p className="trends-empty-inline">This report isn’t available for this channel.</p>;
  return (
    <div className="error-banner">
      <span>
        {label} error {error.code}
        {error.reason ? ` [${error.reason}]` : ''}: {error.message}
      </span>
    </div>
  );
}

/** Spinner / error / content for a live request. */
export function LiveBlock<T>({ state, children }: { state: LiveState<T>; children: (data: T) => ReactNode }) {
  if (state.loading) return <div className="trends-loading"><div className="spinner" /></div>;
  if (state.error) return <div className="error-banner"><span>{state.error}</span></div>;
  if (!state.data) return null;
  return <>{children(state.data)}</>;
}

/** One report from a multi-report response: its own error, or its rows (an empty set shows `empty`). */
export function ReportBody<T>({ report, label, empty = 'No data for this range.', children }: {
  report: ReportResult<T> | undefined;
  label: string;
  empty?: string;
  children: (rows: T[]) => ReactNode;
}) {
  if (!report) return <p className="trends-empty-inline">Not requested.</p>;
  if (report.error) return <ErrorLine error={report.error} label={label} />;
  if (report.rows.length === 0) return <p className="trends-empty-inline">{empty}</p>;
  return <>{children(report.rows)}</>;
}

export function Panel({ title, sub, children, actions, bare }: { title: string; sub?: string; children: ReactNode; actions?: ReactNode; bare?: boolean }) {
  return (
    <section className={bare ? 'viz-panel viz-panel-bare' : 'viz-panel'}>
      <div className="viz-panel-head">
        <div>
          <h3>{title}</h3>
          {sub && <p className="ws-sub">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Label / value tiles, used for small summaries inside panels. */
export function StatTiles({ items }: { items: { label: string; value: string; hint?: string }[] }) {
  return (
    <dl className="stat-strip">
      {items.map((i) => (
        <div key={i.label} title={i.hint}>
          <dt>{i.label}</dt>
          <dd>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A dialog over the page. Closes on Esc or a click outside, keeps the page from scrolling, and gives focus back when closed. */
export function Modal({ title, onClose, tabs, activeTab, onTab, children }: {
  title: string;
  onClose: () => void;
  tabs?: { id: string; label: string }[];
  activeTab?: string;
  onTab?: (id: string) => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  // Callers pass fresh closures on every render; keeping the latest in a ref stops focus and scroll-lock resetting while they type.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const scrollY = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = scrollY;
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={dialog} tabIndex={-1}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {tabs && (
          <div className="modal-tabs" role="tablist" aria-label={title}>
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={activeTab === t.id} aria-controls="modal-panel"
                className={activeTab === t.id ? 'active' : ''} onClick={() => onTab?.(t.id)}>{t.label}</button>
            ))}
          </div>
        )}
        <div className="modal-body" id="modal-panel" role={tabs ? 'tabpanel' : undefined} aria-labelledby={tabs && activeTab ? `tab-${activeTab}` : undefined}>{children}</div>
      </div>
    </div>
  );
}

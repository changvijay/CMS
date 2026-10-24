import type { ReactNode } from 'react';
import type { ApiErrorDetails, ReportResult } from '../../services/api';
import type { LiveState } from './useLive';

export function ErrorLine({ error, label }: { error: ApiErrorDetails; label: string }) {
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

export function Panel({ title, sub, children, actions }: { title: string; sub?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="viz-panel">
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

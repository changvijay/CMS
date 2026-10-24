import { formatCompact } from './viz';

interface RankedBarsProps {
  rows: { label: string; value: number }[];
  valueSuffix?: string;
  /** Used instead of valueSuffix when a value is exactly 1 ("1 post", not "1 posts"). */
  singularSuffix?: string;
  emptyText?: string;
}

/** Horizontal ranked bars. One hue, labels and values in text ink; bar length carries magnitude. */
export function RankedBars({ rows, valueSuffix = '', singularSuffix, emptyText = 'No data for this range.' }: RankedBarsProps) {
  if (!rows.length) return <p className="trends-empty-inline">{emptyText}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <ul className="ranked-bars">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${r.value.toLocaleString()}${valueSuffix} (${total ? Math.round((r.value / total) * 100) : 0}%)`}>
          <span className="ranked-label">{r.label}</span>
          <span className="ranked-track">
            <span className="ranked-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="ranked-value">{formatCompact(r.value)}{r.value === 1 && singularSuffix !== undefined ? singularSuffix : valueSuffix}</span>
        </li>
      ))}
    </ul>
  );
}

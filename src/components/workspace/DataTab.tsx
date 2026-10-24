import type { HistoryResponse, Platform } from '../../services/api';
import { PLATFORM_METRICS, formatShortDate } from '../charts/viz';
import { downloadCsv, toCsv } from '../../utils/csv';

export function DataTab({ platform, history }: { platform: Platform; history: HistoryResponse }) {
  const metrics = PLATFORM_METRICS[platform];
  return (
    <section className="viz-panel">
      <div className="viz-panel-head">
        <div>
          <h3>Daily numbers</h3>
          <p className="ws-sub">One row per day, exactly as stored. Use the download to open it in Excel or Google Sheets.</p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() =>
            downloadCsv(
              `${platform}-${history.range.since}_${history.range.until}.csv`,
              toCsv(history.daily.map((d) => Object.fromEntries(Object.entries(d)) as Record<string, string | number | null>))
            )
          }
        >
          Download CSV
        </button>
      </div>
      <div className="viz-table-wrap tall">
        <table className="viz-table">
          <thead>
            <tr>
              <th>Date</th>
              {metrics.map((m) => <th key={m.key}>{m.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {history.daily.map((d) => (
              <tr key={d.date}>
                <td>{formatShortDate(d.date)}</td>
                {metrics.map((m) => (
                  <td key={m.key}>{typeof d[m.key] === 'number' ? (d[m.key] as number).toLocaleString() : '–'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ws-note">
        How this works: pressing <b>Update data</b> copies the latest daily numbers from {platform === 'instagram' ? 'Instagram' : 'YouTube'} into
        your own database, and a scheduled job repeats that every night. That history is what makes period comparisons, forecasts and trends possible.
        {platform === 'instagram' && ' Instagram only exposes about 30 days of daily history, so older days appear as you keep syncing.'}
      </p>
    </section>
  );
}

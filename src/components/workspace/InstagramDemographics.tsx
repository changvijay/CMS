import { useEffect, useState, type ReactNode } from 'react';
import { fetchInstagramDemographics, type DemographicResult, type InstagramDemographics } from '../../services/api';
import { RankedBars } from '../charts/RankedBars';
import { errorMessage } from '../../utils/errors';

function Panel({ title, result, children }: { title: string; result: DemographicResult; children: (rows: { label: string; value: number }[]) => ReactNode }) {
  return (
    <section className="viz-panel">
      <h3>{title}</h3>
      {result.error ? (
        <div className="error-banner">
          <span>Instagram error {result.error.code}{result.error.reason ? ` [${result.error.reason}]` : ''}: {result.error.message}</span>
        </div>
      ) : result.rows.length === 0 ? (
        <p className="trends-empty-inline">No data. Instagram needs at least 100 followers to share demographics.</p>
      ) : (
        children(result.rows)
      )}
    </section>
  );
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

function countryName(code: string): string {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function InstagramDemographicsPanel({ token, accountId, type = 'follower' }: { token: string; accountId: string; type?: 'follower' | 'engaged' }) {
  const [data, setData] = useState<InstagramDemographics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchInstagramDemographics(token, accountId, type);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) {
          setData(null);
          setError(errorMessage(err, 'Failed to load demographics'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, accountId, type]);

  if (loading) return <div className="trends-loading"><div className="spinner" /></div>;
  if (error) return <div className="error-banner"><span>{error}</span></div>;
  if (!data) return null;

  const ageRows = (rows: { label: string; value: number }[]) => [...rows].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const total = (rows: { value: number }[]) => rows.reduce((a, r) => a + r.value, 0);

  return (
    <>
      <div className="viz-two-col">
        <Panel title={type === 'engaged' ? 'Engaged audience age' : 'Follower age'} result={data.age}>
          {(rows) => <RankedBars rows={ageRows(rows).map((r) => ({ label: r.label, value: r.value }))} valueSuffix={type === 'engaged' ? ' engaged accounts' : ' followers'} />}
        </Panel>
        <Panel title={type === 'engaged' ? 'Engaged audience gender' : 'Follower gender'} result={data.gender}>
          {(rows) => (
            <RankedBars
              rows={rows.map((r) => ({ label: `${r.label} (${Math.round((r.value / (total(rows) || 1)) * 100)}%)`, value: r.value }))}
              valueSuffix={type === 'engaged' ? ' engaged accounts' : ' followers'}
            />
          )}
        </Panel>
      </div>
      <div className="viz-two-col">
        <Panel title={type === 'engaged' ? 'Engaged audience countries' : 'Top countries'} result={data.country}>
          {(rows) => <RankedBars rows={rows.slice(0, 8).map((r) => ({ label: countryName(r.label), value: r.value }))} valueSuffix={type === 'engaged' ? ' engaged accounts' : ' followers'} />}
        </Panel>
        <Panel title={type === 'engaged' ? 'Engaged audience cities' : 'Top cities'} result={data.city}>
          {(rows) => <RankedBars rows={rows.slice(0, 8)} valueSuffix={type === 'engaged' ? ' engaged accounts' : ' followers'} />}
        </Panel>
      </div>
    </>
  );
}

import { useEffect, useState } from 'react';
import { fetchBestTime, type BestTimeResponse } from '../services/api';
import { Heatmap } from './charts/Heatmap';
import { WEEKDAYS } from './charts/viz';
import { SectionSkeleton } from './Skeleton';

function hourText(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
}

export function InstagramAudience({ token, accountId }: { token: string; accountId: string }) {
  const [data, setData] = useState<BestTimeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchBestTime(token, accountId);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) {
          setData(null);
          setError(err instanceof Error ? err.message : 'Failed to load follower activity');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, accountId]);

  return (
    <section className="viz-panel">
      <h3>Best time to post</h3>
      <p className="ws-sub">When your followers are online, averaged by weekday and hour (hours as reported by Instagram).</p>
      {loading && <SectionSkeleton variant="chart" />}
      {error && <div className="error-banner"><span>{error}</span></div>}
      {!loading && data && data.days_sampled === 0 && (
        <p className="trends-empty-inline">Instagram returned no follower-activity data. This metric needs an account with at least 100 followers.</p>
      )}
      {!loading && data && data.days_sampled > 0 && (
        <>
          <ol className="slot-list">
            {data.top_slots.map((s, i) => (
              <li key={`${s.weekday}-${s.hour}`}>
                <b>#{i + 1}</b> {WEEKDAYS[s.weekday]} at {hourText(s.hour)} <span>~{s.value.toLocaleString()} followers online</span>
              </li>
            ))}
          </ol>
          <Heatmap matrix={data.matrix} unit="followers online" />
          <p className="trends-foot">Based on {data.days_sampled} day{data.days_sampled > 1 ? 's' : ''} of data.</p>
        </>
      )}
    </section>
  );
}

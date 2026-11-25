import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { errorMessage } from '../../utils/errors';
import { getVideoAiCapabilities, getVideoReport, getVideoReportById, updateVideoReport, type VideoPlatform } from '../../services/videoAiApi';
import { invalidateLiveCache, useLive } from '../workspace/useLive';
import { SectionSkeleton } from '../Skeleton';
import { ReportView } from './ReportView';
import '../../assets/css/workspace.css';
import './videoAi.css';

const PLATFORMS: VideoPlatform[] = ['instagram', 'youtube', 'facebook', 'linkedin'];
const NAME: Record<VideoPlatform, string> = { instagram: 'Instagram', youtube: 'YouTube', facebook: 'Facebook', linkedin: 'LinkedIn' };

/**
 * One published video's AI report. Opening it shows the last saved report (no AI call);
 * Update pulls the newest numbers from the platform, stores them and asks the AI for a fresh report.
 */
export default function AnalysisPage({ token }: { token: string }) {
  const { platform = '', accountId = '', mediaId = '' } = useParams();
  const valid = PLATFORMS.includes(platform as VideoPlatform);
  const p = platform as VideoPlatform;
  const key = `videoai:report:${platform}:${accountId}:${mediaId}`;
  const state = useLive(() => getVideoReport(token, p, accountId, mediaId), key, PLATFORMS.includes(platform as VideoPlatform));
  const caps = useLive(() => getVideoAiCapabilities(token), 'videoai:caps');
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!valid) return <main className="va-page"><div className="error-banner"><span>Unknown platform.</span></div></main>;

  const history = state.data?.history ?? [];
  const latest = state.data?.report ?? null;
  const shownId = picked ?? latest?.id ?? null;

  const update = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await updateVideoReport(token, p, accountId, mediaId, caps.data?.provider ?? undefined);
      if (res.sync_error) setNotice(`Couldn't refresh from ${NAME[p]} (${res.sync_error.message}). The report uses the last stored numbers.`);
      setPicked(null);
      invalidateLiveCache(key, 'videoai:recent');
    } catch (err) {
      setError(errorMessage(err, 'The analysis failed.'));
    } finally {
      setBusy(false);
    }
  };

  const noProvider = caps.data && !caps.data.provider;
  const title = latest?.title ?? latest?.metrics_used?.video?.title ?? 'This video';

  return (
    <main className="va-page">
      <Link to="/analysis" className="va-meta">← All video reports</Link>
      <header className="va-page-head">
        {latest?.thumbnail_url ? <img src={latest.thumbnail_url} alt="" /> : <div className="va-thumb-empty" />}
        <div className="va-head-text">
          <h2>{title}</h2>
          <span className="va-meta">
            {NAME[p]} · AI performance report
            {latest?.metrics_used?.video?.permalink && <> · <a href={latest.metrics_used.video.permalink} target="_blank" rel="noreferrer">Open on {NAME[p]}</a></>}
          </span>
        </div>
        <div className="va-actions">
          <button type="button" className="btn btn-primary" onClick={update} disabled={busy || !!noProvider}>
            {busy ? 'Updating & analysing…' : latest ? 'Update' : 'Analyse with AI'}
          </button>
        </div>
      </header>

      {noProvider && (
        <div className="ws-notice">Add an AI provider first: <Link to="/scripts/settings?section=ai">Scripts › Settings › AI providers</Link>. Your key is used for these reports.</div>
      )}
      {busy && <div className="ws-notice">Fetching the latest numbers from {NAME[p]}, then asking {caps.data?.provider ?? 'the AI'}. This takes up to a minute.</div>}
      {error && <div className="error-banner" role="alert"><span>{error}</span></div>}
      {notice && <div className="ws-notice">{notice}</div>}

      {history.length > 1 && (
        <div className="va-history" role="group" aria-label="Earlier reports">
          {history.map((h) => (
            <button key={h.id} type="button" className={h.id === shownId ? 'active' : ''} aria-pressed={h.id === shownId} onClick={() => setPicked(h.id === latest?.id ? null : h.id)}>
              <b>{h.score ?? '–'}</b> {new Date(h.created_at).toLocaleDateString()}
            </button>
          ))}
        </div>
      )}

      {state.error && <div className="error-banner" role="alert"><span>{state.error}</span></div>}
      {!state.data && !state.error && <SectionSkeleton variant="text" label="Loading the report…" />}
      {state.data && !latest && !busy && (
        <section className="va-card va-empty">
          <h3>No report yet</h3>
          <p>Press <b>Analyse with AI</b>. It pulls this video's latest numbers from {NAME[p]}, compares them with your recent videos, and explains what worked and what to change next time.</p>
        </section>
      )}
      {latest && !picked && <ReportView report={latest} />}
      {picked && <EarlierReport token={token} id={picked} />}
    </main>
  );
}

/** An older report of the same video, picked from the score history. */
function EarlierReport({ token, id }: { token: string; id: string }) {
  const state = useLive(() => getVideoReportById(token, id), `videoai:byid:${id}`);
  if (state.error) return <div className="error-banner" role="alert"><span>{state.error}</span></div>;
  if (!state.data) return <SectionSkeleton variant="text" label="Loading the report…" />;
  return <ReportView report={state.data} />;
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listRecentReports, reportPath, type RecentReport } from '../../services/videoAiApi';
import { useLive } from '../workspace/useLive';
import { SectionSkeleton } from '../Skeleton';
import { ScoreRing } from './ReportView';
import { PreUploadPanel } from './PreUploadPanel';
import '../../assets/css/workspace.css';
import './videoAi.css';

const NAME: Record<string, string> = { instagram: 'Instagram', youtube: 'YouTube', facebook: 'Facebook', linkedin: 'LinkedIn' };

/** The Video AI dashboard: recent reports for published videos and pre-upload checks, with the average score. */
export default function VideoAiHome({ token }: { token: string }) {
  const state = useLive(() => listRecentReports(token), 'videoai:recent');
  const [openId, setOpenId] = useState<string | null>(null);
  const reports = state.data ?? [];
  const published = reports.filter((r) => r.kind === 'published' && r.score !== null);
  const avg = published.length ? Math.round(published.reduce((s, r) => s + (r.score ?? 0), 0) / published.length) : null;
  const checks = reports.filter((r) => r.kind === 'preupload');

  const row = (r: RecentReport) => {
    const inner = (
      <>
        {r.thumbnail_url ? <img src={r.thumbnail_url} alt="" loading="lazy" /> : <div className="va-thumb-empty" />}
        <span className="va-list-text">
          <b>{r.title || (r.kind === 'preupload' ? 'Video checked before upload' : 'Untitled')}</b>
          <span>{[r.platform ? NAME[r.platform] : null, new Date(r.created_at).toLocaleDateString(), r.verdict].filter(Boolean).join(' · ')}</span>
        </span>
        <ScoreRing score={r.score} size={44} />
      </>
    );
    return (
      <li key={r.id}>
        {r.kind === 'published' && r.platform && r.account_id && r.media_id
          ? <Link to={reportPath(r.platform, r.account_id, r.media_id)}>{inner}</Link>
          : <button type="button" onClick={() => setOpenId(r.id)}>{inner}</button>}
      </li>
    );
  };

  return (
    <main className="va-page">
      <header className="va-page-head">
        <div className="va-head-text">
          <h2>Video AI</h2>
          <span className="va-meta">Reports from your own AI provider. Open a video from any platform page and press <b>AI analysis</b>, or check a video before posting in Social Post.</span>
        </div>
        <div className="va-actions">
          <Link className="btn btn-secondary" to="/publish">Check a video before posting</Link>
        </div>
      </header>

      {state.error && <div className="error-banner" role="alert"><span>{state.error}</span></div>}
      {!state.data && !state.error && <SectionSkeleton variant="list" rows={4} label="Loading reports…" />}

      {state.data && reports.length === 0 && (
        <section className="va-card va-empty">
          <h3>No reports yet</h3>
          <p>Go to <Link to="/instagram/content">Instagram</Link>, <Link to="/youtube/content">YouTube</Link> or <Link to="/facebook/content">Facebook</Link>, pick a video and press <b>AI analysis</b>.</p>
        </section>
      )}

      {published.length > 0 && (
        <section className="va-card va-avg">
          <ScoreRing score={avg} size={72} label="Average score" />
          <div>
            <h4>Average score of your analysed videos</h4>
            <p className="va-meta">{published.length} published {published.length === 1 ? 'video' : 'videos'} · 50 means typical for you</p>
          </div>
        </section>
      )}

      {reports.some((r) => r.kind === 'published') && (
        <section className="va-card">
          <h4>Published videos</h4>
          <ul className="va-list">{reports.filter((r) => r.kind === 'published').map(row)}</ul>
        </section>
      )}
      {checks.length > 0 && (
        <section className="va-card">
          <h4>Checked before upload</h4>
          <ul className="va-list">{checks.map(row)}</ul>
        </section>
      )}

      {openId && <PreUploadPanel token={token} reportId={openId} onClose={() => setOpenId(null)} />}
    </main>
  );
}

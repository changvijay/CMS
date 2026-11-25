import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../utils/errors';
import { analyzeBeforeUpload, getVideoAiCapabilities, getVideoReportById, type Frame, type VideoPlatform, type VideoReport } from '../../services/videoAiApi';
import { invalidateLiveCache, useLive } from '../workspace/useLive';
import { SectionSkeleton } from '../Skeleton';
import { extractFrames, videoAsBase64 } from './frames';
import { ReportView } from './ReportView';
import './videoAi.css';

export interface PreUploadSource {
  /** A URL the browser can read: the local preview of the picked file (preferred) or the stored file. */
  src: string;
  name: string;
  title?: string;
  caption?: string;
  platforms?: VideoPlatform[];
}

type Phase = 'idle' | 'frames' | 'sending' | 'done' | 'error';

/**
 * Side panel that checks a video before it is posted: frames are taken in the browser (and the whole file is sent
 * when the provider can watch video and it is small enough), then the AI report is shown. Or, with `reportId`,
 * shows a check saved earlier.
 */
export function PreUploadPanel({ token, source, reportId, onClose }: { token: string; source?: PreUploadSource; reportId?: string; onClose: () => void }) {
  const caps = useLive(() => getVideoAiCapabilities(token), 'videoai:caps');
  const saved = useLive(() => getVideoReportById(token, reportId ?? ''), `videoai:byid:${reportId}`, Boolean(reportId));
  const [phase, setPhase] = useState<Phase>('idle');
  const [frames, setFrames] = useState<Frame[]>([]);
  const [report, setReport] = useState<VideoReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const c = caps.data;
  const canSee = c ? c.sees_images.length > 0 : false;
  // The provider that will run: the default one when it can see frames, else the first that can.
  const provider = c ? (c.provider && c.sees_images.includes(c.provider) ? c.provider : c.sees_images[0]) : undefined;
  const watches = Boolean(provider && c?.watches_video.includes(provider));

  const run = async () => {
    if (!source || !c) return;
    setError(null);
    setReport(null);
    try {
      setPhase('frames');
      const shot = await extractFrames(source.src);
      setFrames(shot.frames);
      const video = watches ? await videoAsBase64(source.src, c.max_video_mb).catch(() => null) : null;
      setPhase('sending');
      const r = await analyzeBeforeUpload(token, {
        frames: shot.frames, video, durationSec: shot.duration, width: shot.width, height: shot.height,
        title: source.title, caption: source.caption, platforms: source.platforms, fileName: source.name, provider,
      });
      setReport(r);
      setPhase('done');
      invalidateLiveCache('videoai:recent');
    } catch (err) {
      setError(errorMessage(err, 'The analysis failed.'));
      setPhase('error');
    }
  };

  const shown = report ?? saved.data ?? null;
  const busy = phase === 'frames' || phase === 'sending';

  return (
    <>
      <div className="va-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="va-drawer" role="dialog" aria-modal="true" aria-labelledby="va-drawer-title">
        <div className="va-drawer-head">
          <div>
            <h3 id="va-drawer-title">{reportId ? 'Pre-upload check' : 'Check before posting'}</h3>
            {source && <span className="va-meta">{source.name}</span>}
          </div>
          <button type="button" className="va-close" aria-label="Close" onClick={onClose}>×</button>
        </div>

        {source && c && !c.provider && (
          <div className="ws-notice">Add an AI provider first: <Link to="/scripts/settings?section=ai" onClick={onClose}>Scripts › Settings › AI providers</Link>.</div>
        )}
        {source && c && c.provider && !canSee && (
          <div className="ws-notice">Your AI provider can't look at images. Add Gemini, Claude or OpenRouter in <Link to="/scripts/settings?section=ai" onClick={onClose}>AI settings</Link> to check videos.</div>
        )}

        {source && canSee && !shown && (
          <section className="va-card">
            <p>
              The AI looks at {watches ? <>the <b>whole video, including the audio</b> (files up to {c?.max_video_mb} MB), plus</> : null} still frames from the first 5 seconds and across the rest,
              with your title and caption. It scores the hook, opening, pacing, captions and storytelling, and says what to fix.
              {!watches && ' It can’t hear the audio with this provider; Gemini can.'} Nothing is saved except the report.
            </p>
            <button type="button" className="btn btn-primary" onClick={run} disabled={busy}>
              {phase === 'frames' ? 'Reading frames…' : phase === 'sending' ? `Asking ${provider}…` : 'Analyse this video'}
            </button>
          </section>
        )}

        {frames.length > 0 && !reportId && (
          <div className="va-frames" aria-label="Frames sent to the AI">
            {frames.map((f) => (
              <figure key={f.t}><img src={`data:${f.mime};base64,${f.data}`} alt={`Frame at ${f.t}s`} /><figcaption>{f.t}s</figcaption></figure>
            ))}
          </div>
        )}

        {error && <div className="error-banner" role="alert"><span>{error}</span></div>}
        {phase === 'sending' && <SectionSkeleton variant="text" label="The AI is reviewing your video…" />}
        {reportId && !saved.data && !saved.error && <SectionSkeleton variant="text" label="Loading the report…" />}
        {saved.error && <div className="error-banner" role="alert"><span>{saved.error}</span></div>}
        {shown && <ReportView report={shown} />}
        {shown && source && <button type="button" className="btn btn-secondary" onClick={run} disabled={busy}>Analyse again</button>}
      </aside>
    </>
  );
}

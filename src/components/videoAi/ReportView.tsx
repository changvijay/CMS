import { useState, type ReactNode } from 'react';
import type { Correction, VideoReport } from '../../services/videoAiApi';
import { formatCompact } from '../charts/viz';
import './videoAi.css';

/** Plain-language labels for the metric keys the server sends. */
const METRIC_LABEL: Record<string, string> = {
  views: 'Views', reach: 'Reach', likes: 'Likes', comments: 'Comments', shares: 'Shares', saves: 'Saves', reposts: 'Reposts',
  total_interactions: 'Interactions', follows: 'Follows', profile_visits: 'Profile visits', link_clicks: 'Link clicks',
  skip_rate_pct: 'Skip rate (first 3s)', avg_watch_seconds: 'Avg watch time', total_watch_seconds: 'Total watch time',
  duration_seconds: 'Length', engagement_rate_pct: 'Engagement rate', avg_watched_pct: 'Avg % watched',
};

const isPct = (k: string) => k.endsWith('_pct');
const isSeconds = (k: string) => k.endsWith('_seconds');

function fmtMetric(key: string, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  if (isPct(key)) return `${Math.round(v * 10) / 10}%`;
  if (isSeconds(key)) return v >= 120 ? `${Math.round(v / 6) / 10} min` : `${Math.round(v * 10) / 10}s`;
  return formatCompact(v);
}

/** Score colour band: the number is always shown too, so colour is never the only signal. */
const band = (s: number | null) => (s === null ? 'none' : s >= 70 ? 'good' : s >= 40 ? 'mid' : 'low');

export function ScoreRing({ score, size = 96, label = 'Score' }: { score: number | null; size?: number; label?: string }) {
  const stroke = Math.max(6, Math.round(size / 11));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = score ?? 0;
  return (
    <span className={`va-ring va-${band(score)}`} style={{ width: size, height: size }} role="img" aria-label={`${label}: ${score ?? 'not scored'} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="va-ring-track" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="va-ring-value" strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="va-ring-label" style={{ fontSize: size * 0.28 }}>{score ?? '–'}</span>
    </span>
  );
}

function Items({ title, items, tone }: { title: string; items?: string[]; tone?: 'good' | 'bad' }) {
  if (!items?.length) return null;
  return (
    <section className={`va-card${tone ? ` va-${tone}` : ''}`}>
      <h4>{title}</h4>
      <ul>{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </section>
  );
}

function Prose({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="va-card">
      <div className="va-card-head"><h4>{title}</h4>{aside}</div>
      {children}
    </section>
  );
}

const AREA_LABEL: Record<string, string> = {
  hook: 'Hook', opening: 'Opening', caption: 'Caption', title: 'Title', thumbnail: 'Thumbnail', pacing: 'Pacing', storytelling: 'Storytelling',
  cta: 'Call to action', audio: 'Audio', visuals: 'Visuals', length: 'Length', hashtags: 'Hashtags', posting: 'Posting',
};

function CorrectionCard({ c, n }: { c: Correction; n: number }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(c.example);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the text can still be selected */
    }
  };
  return (
    <li className="va-fix">
      <div className="va-fix-head">
        <span className="va-fix-n">{n}</span>
        {c.area && <span className="tag">{AREA_LABEL[c.area] ?? c.area}</span>}
      </div>
      {c.wrong && <p className="va-fix-wrong"><b>What's wrong:</b> {c.wrong}</p>}
      {c.why && <p className="va-fix-why"><b>Why it hurts:</b> {c.why}</p>}
      {c.fix && <p className="va-fix-how"><b>How to fix:</b> {c.fix}</p>}
      {c.example && (
        <figure className="va-fix-example">
          <figcaption>
            <span>Use this instead</span>
            <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          </figcaption>
          <blockquote>{c.example}</blockquote>
        </figure>
      )}
    </li>
  );
}

/** One report: score and verdict, what worked and didn't, hook, retention, comparison, and what to do next. */
export function ReportView({ report }: { report: VideoReport }) {
  const r = report.report;
  const m = report.metrics_used;
  const published = report.kind === 'published';
  const vs = m?.comparison?.vs_median ?? {};
  const unavailable = (m?.unavailable ?? []).filter((u) => !['duration_seconds', 'reposts', 'link_clicks', 'replies'].includes(u.metric));

  return (
    <div className="va-report">
      <section className="va-hero">
        <ScoreRing score={r.score} />
        <div className="va-hero-text">
          <span className="va-eyebrow">{published ? 'Performance score' : 'Likely to perform'} · vs your usual videos</span>
          <p className="va-verdict">{r.verdict || 'No summary returned.'}</p>
          <span className="va-meta">
            {new Date(report.created_at).toLocaleString()} · {report.provider} ({report.model}){r.watched_video ? ' · watched the full video' : !published ? ' · from still frames' : ''}
          </span>
        </div>
        {r.hook?.score !== undefined && r.hook?.score !== null && (
          <div className="va-hook-score"><ScoreRing score={r.hook.score} size={64} label="Hook score" /><span>Hook</span></div>
        )}
      </section>

      {r.corrections && r.corrections.length > 0 && (
        <section className={`va-card va-fixes${(r.score ?? 100) < 60 ? ' va-fixes-urgent' : ''}`}>
          <div className="va-card-head">
            <h4>{(r.score ?? 100) < 60 ? 'Fix these first' : 'What to correct'}</h4>
            <span className="va-meta">What's wrong, how to fix it, and a sample you can use</span>
          </div>
          <ol className="va-fix-list">{r.corrections.map((c, i) => <CorrectionCard key={i} c={c} n={i + 1} />)}</ol>
        </section>
      )}

      {!r.parsed && <p className="va-note">The AI didn't return a structured report this time. Press Update to try again.</p>}

      {published && m?.metrics && (
        <section className="va-card">
          <div className="va-card-head">
            <h4>The numbers used</h4>
            {m.comparison && <span className="va-meta">Compared with your last {m.comparison.compared_with} {m.comparison.compared_with === 1 ? 'video' : 'videos'}{m.comparison.rank_by_views ? ` · #${m.comparison.rank_by_views} by views` : ''}</span>}
          </div>
          <div className="viz-table-wrap">
            <table className="viz-table va-metrics">
              <thead><tr><th>Metric</th><th>This video</th><th>Your median</th></tr></thead>
              <tbody>
                {Object.entries(m.metrics).filter(([, v]) => v !== null).map(([k, v]) => {
                  const med = vs[k]?.median;
                  const better = med !== undefined && v !== null ? (k === 'skip_rate_pct' ? v < med : v > med) : null;
                  return (
                    <tr key={k}>
                      <td>{METRIC_LABEL[k] ?? k}</td>
                      <td className={better === null ? '' : better ? 'va-up' : 'va-down'}>{fmtMetric(k, v)}{better === null ? '' : better ? ' ▲' : ' ▼'}</td>
                      <td>{med === undefined ? '–' : fmtMetric(k, med)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {m.retention_curve_pct && (
            <div className="va-curve" aria-label="Audience still watching">
              {Object.entries(m.retention_curve_pct).map(([at, v]) => (
                <div key={at} className="va-curve-col">
                  <span className="va-curve-bar"><span style={{ height: `${Math.min(100, v ?? 0)}%` }} /></span>
                  <small>{at}</small>
                  <b>{v === null ? '–' : `${Math.round(v)}%`}</b>
                </div>
              ))}
            </div>
          )}
          {unavailable.length > 0 && (
            <details className="va-unavailable">
              <summary>{unavailable.length} {unavailable.length === 1 ? 'metric was' : 'metrics were'} not available</summary>
              <ul>{unavailable.slice(0, 12).map((u, i) => <li key={i}><b>{METRIC_LABEL[u.metric] ?? u.metric}</b>: {u.reason}</li>)}</ul>
            </details>
          )}
        </section>
      )}

      <Items title="Key highlights" items={r.highlights} />
      <div className="va-two">
        <Items title="What worked" items={r.worked} tone="good" />
        <Items title="What didn't work" items={r.didnt_work} tone="bad" />
      </div>

      {r.first_seconds && (
        <section className="va-card">
          <h4>Before you post</h4>
          <dl className="va-fs">
            {([['hook', 'Hook'], ['opening', 'First 3–5 seconds'], ['pacing', 'Pacing'], ['captions', 'Captions & on-screen text'], ['storytelling', 'Storytelling'], ['quality', 'Quality']] as const)
              .filter(([k]) => r.first_seconds?.[k]).map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{r.first_seconds?.[k]}</dd></div>)}
          </dl>
        </section>
      )}

      <div className="va-two">
        {r.hook?.notes && <Prose title="Hook effectiveness"><p>{r.hook.notes}</p></Prose>}
        {r.retention?.summary && (
          <Prose title={published ? 'Retention & watch time' : 'Retention (prediction)'} aside={!r.retention.available ? <span className="va-meta">limited data</span> : undefined}>
            <p>{r.retention.summary}</p>
          </Prose>
        )}
      </div>
      <div className="va-two">
        {r.engagement?.summary && <Prose title="Audience engagement"><p>{r.engagement.summary}</p>{r.engagement.rate_note && <p className="va-meta">{r.engagement.rate_note}</p>}</Prose>}
        {r.comparison?.summary && (
          <Prose title={published ? 'Compared with your previous videos' : 'Compared with your usual (prediction)'}>
            <p>{r.comparison.summary}</p>
            {r.comparison.vs_median.length > 0 && <ul>{r.comparison.vs_median.map((t, i) => <li key={i}>{t}</li>)}</ul>}
          </Prose>
        )}
      </div>

      <Items title="Possible reasons it underperformed" items={r.reasons_underperformed} />
      <Items title="For your next video" items={r.next_video} />

      {r.action_steps && Object.values(r.action_steps).some((v) => v.length) && (
        <section className="va-card">
          <h4>Action steps</h4>
          <div className="va-steps">
            {([['views', 'More views'], ['reach', 'More reach'], ['engagement', 'More engagement'], ['growth', 'Audience growth']] as const)
              .filter(([k]) => r.action_steps?.[k]?.length).map(([k, label]) => (
                <div key={k}><h5>{label}</h5><ul>{r.action_steps?.[k].map((t, i) => <li key={i}>{t}</li>)}</ul></div>
              ))}
          </div>
        </section>
      )}

      <p className="va-disclaimer">AI analysis of the numbers above. It suggests what to change; it can't guarantee views or reach.</p>
    </div>
  );
}

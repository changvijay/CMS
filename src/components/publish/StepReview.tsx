import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPost, retryTarget, type PostDetail, type PostTarget } from '../../services/api';
import { Issues } from './fields';
import { Preview } from './Previews';
import { PlatformIcon } from './PlatformIcon';
import { PLATFORM_LABEL, nativelyScheduled, postTypeInfo } from './platforms';
import { buildFields, emptyDraft } from './mapping';
import { validateAutoReply, validateDraft, validateSchedule } from './validate';
import type { AutoReplySettings, Platform, PlatformDraft, PostType, PublishAccount, SharedFields } from './types';

const LABELS: Record<string, string> = {
  caption: 'Caption', message: 'Message', commentary: 'Text', title: 'Title', description: 'Description', link: 'Link', tags: 'Tags',
  media: 'Media', cover_url: 'Cover', thumbnail: 'Thumbnail', location_id: 'Location', place: 'Place', collaborators: 'Collaborators',
  product_tags: 'Products', thumb_offset: 'Cover frame (ms)', share_to_feed: 'Show in feed', audio_name: 'Audio name', trial: 'Trial reel',
  trial_graduation: 'After trial', published: 'Published', targeting: 'Audience', feed_targeting: 'Feed targeting', visibility: 'Visibility',
  reshare_disabled: 'Reposts off', lifecycle: 'Save as', document_title: 'Document title', article: 'Article', poll: 'Poll', category_id: 'Category',
  privacy: 'Privacy', made_for_kids: 'Made for kids', embeddable: 'Embeddable', license: 'License', public_stats_viewable: 'Public view count',
  default_language: 'Language', playlist_id: 'Playlist', notify_subscribers: 'Notify subscribers',
};

function show(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) {
    if (!v.length) return null;
    if (typeof v[0] === 'object') return `${v.length} item${v.length === 1 ? '' : 's'}`;
    return v.join(', ');
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('url' in o && typeof o.url === 'string') return o.url ? 'Set' : null;
    if ('question' in o) return `${o.question} (${((o.options as string[]) || []).filter(Boolean).join(' / ')})`;
    const parts = Object.entries(o).map(([k, x]) => [k, show(x)]).filter(([, x]) => x);
    return parts.length ? parts.map(([k, x]) => `${k}: ${x}`).join('; ') : null;
  }
  const s = String(v);
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

export function StepReview({ platforms, shared, drafts, accounts, selected, autoReply }: {
  platforms: Platform[];
  shared: SharedFields;
  drafts: Partial<Record<Platform, PlatformDraft>>;
  accounts: Partial<Record<Platform, PublishAccount[]>>;
  selected: Partial<Record<Platform, string[]>>;
  autoReply: AutoReplySettings;
}) {
  const when = shared.scheduleAt ? new Date(shared.scheduleAt).toLocaleString() : null;
  return (
    <div className="pf-review">
      <p className={`pf-note${when ? '' : ' ok'}`}>{when ? `Scheduled for ${when}.` : 'Publishes as soon as you click Publish now.'}</p>
      {platforms.map((p) => {
        const draft = drafts[p] ?? emptyDraft(p);
        const fields = buildFields(p, draft, shared);
        const chosen = (accounts[p] ?? []).filter((a) => (selected[p] ?? []).includes(a.id));
        const issues = [...validateDraft(p, draft, shared), ...validateSchedule(shared.scheduleAt, [{ platform: p, postType: draft.postType }])];
        return (
          <section key={p} className="viz-panel pf-review-card">
            <div className="viz-panel-head">
              <h3><PlatformIcon platform={p} size={18} /> {PLATFORM_LABEL[p]} · {postTypeInfo(p, draft.postType as PostType).label}</h3>
              {when && <span className="pf-badge">{nativelyScheduled(p, draft.postType) ? `Scheduled on ${PLATFORM_LABEL[p]}` : 'Posted by this app at that time'}</span>}
            </div>
            <div className="pf-review-body">
              <div>
                <p className="pf-hint">Accounts: {chosen.map((a) => a.name).join(', ') || 'none'}</p>
                <dl className="pf-summary">
                  {Object.entries(fields).map(([k, v]) => {
                    const s = show(v);
                    return s ? <div key={k}><dt>{LABELS[k] ?? k}</dt><dd>{s}</dd></div> : null;
                  })}
                </dl>
                {p === 'instagram' && autoReply.enabled && (
                  <div className="pf-summary-reply">
                    <b>Auto-reply</b>
                    <span>{autoReply.trigger === 'any' ? 'Any comment' : `Comments with: ${autoReply.keywords.join(', ')}`}</span>
                    <span>Public reply: {autoReply.public_replies.filter(Boolean).length} variant(s) · DM: {autoReply.send_dm ? 'yes' : 'no'}{autoReply.require_follow ? ' (follow first)' : ''}</span>
                    <Issues items={validateAutoReply(autoReply)} />
                  </div>
                )}
                <Issues items={issues} />
              </div>
              <Preview platform={p} draft={draft} shared={shared} account={chosen[0]} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

const STEPS = ['upload', 'container', 'poll', 'publish'];
const STEP_LABEL: Record<string, string> = { upload: 'Upload', container: 'Create', poll: 'Processing', publish: 'Publish' };

function TargetRow({ t, name, onRetry }: { t: PostTarget; name: string; onRetry: () => void }) {
  const at = STEPS.indexOf(t.step || '');
  return (
    <li className={`pf-target ${t.status}`}>
      <div className="pf-target-head">
        <PlatformIcon platform={t.platform} size={20} />
        <b>{PLATFORM_LABEL[t.platform]}</b>
        <span className="pf-hint">{name} · {postTypeInfo(t.platform, t.post_type as PostType).label}</span>
        <span className={`pf-status ${t.status}`}>{
          t.status === 'done' ? (t.native_scheduled ? `Scheduled on ${PLATFORM_LABEL[t.platform]}` : 'Published')
            : t.status === 'scheduled' ? `Waiting until ${t.schedule_at ? new Date(t.schedule_at).toLocaleString() : 'its time'}`
              : t.status === 'publishing' ? 'Publishing…' : t.status === 'failed' ? 'Failed' : 'Starting…'
        }</span>
      </div>
      {(t.status === 'publishing' || t.status === 'failed' || t.status === 'done') && (
        <ol className="pf-steps-progress">
          {STEPS.map((s, i) => (
            <li key={s} className={t.status === 'done' || i < at ? 'done' : i === at ? (t.status === 'failed' ? 'failed' : 'current') : ''}>{STEP_LABEL[s]}</li>
          ))}
        </ol>
      )}
      {t.permalink && <a href={t.permalink} target="_blank" rel="noreferrer" className="pf-link">{t.permalink}</a>}
      {t.note && <p className="pf-hint">{t.note}</p>}
      {t.error_message && (
        <div className={t.status === 'failed' ? 'error-banner' : 'ws-notice'}>
          <span>{t.platform} error{t.error_code ? ` ${t.error_code}` : ''}: {t.error_message}</span>
          {t.status === 'failed' && <button type="button" className="btn btn-secondary" onClick={onRetry}>Retry {PLATFORM_LABEL[t.platform]}</button>}
        </div>
      )}
    </li>
  );
}

/** The submitted post: live progress per platform, links, errors with Retry, and the auto-reply log. */
export function PostProgress({ token, postId }: { token: string; postId: string }) {
  const [data, setData] = useState<PostDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  const loaded = data !== null;
  const active = data?.targets.some((t) => t.status === 'publishing' || t.status === 'pending');
  const waiting = data?.targets.some((t) => t.status === 'scheduled');
  const hasReplies = Boolean(data?.autoReplies.length);

  useEffect(() => {
    let cancelled = false;
    getPost(token, postId)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the post'); });
    return () => { cancelled = true; };
  }, [token, postId, tick]);

  // Fast while publishing, slower while waiting for a schedule or watching auto-replies, stopped when all is final.
  useEffect(() => {
    const ms = active || !loaded ? 2000 : waiting || hasReplies ? 20000 : 0;
    if (!ms) return;
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [active, waiting, hasReplies, loaded]);
  const load = () => setTick((n) => n + 1);

  if (error && !data) return <div className="error-banner"><span>{error}</span></div>;
  if (!data) return <div className="trends-loading"><div className="spinner" /></div>;
  const names = data.post.wizard_state?.accountNames ?? {};
  const retry = async (id: string) => {
    try {
      await retryTarget(token, id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    }
  };

  return (
    <div className="pf-progress-page">
      {error && <div className="error-banner"><span>{error}</span></div>}
      <ul className="pf-targets">
        {data.targets.map((t) => <TargetRow key={t.id} t={t} name={names[`${t.platform}:${t.account_id}`] ?? `Account ${t.account_id}`} onRetry={() => retry(t.id)} />)}
      </ul>

      {data.autoReplies.length > 0 && (
        <section className="viz-panel">
          <div className="viz-panel-head">
            <div>
              <h3>Instagram auto-reply</h3>
              <p className="ws-sub">{data.autoReplies.every((r) => r.is_active) ? 'Active: answering comments on this post.' : 'Waits for Instagram to publish the post, then starts answering.'}</p>
            </div>
            <Link className="btn btn-secondary" to="/automation">All auto-replies</Link>
          </div>
          {data.autoReplyLog.length === 0 ? <p className="trends-empty-inline">No comments handled yet.</p> : (
            <div className="viz-table-wrap">
              <table className="viz-table">
                <thead><tr><th>When</th><th>User</th><th>Comment</th><th>Keyword</th><th>Reply sent</th><th>Status</th></tr></thead>
                <tbody>
                  {data.autoReplyLog.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.created_at).toLocaleString()}</td>
                      <td>{e.sender_username ? `@${e.sender_username}` : '—'}<br /><small className="pf-hint">{e.comment_id || e.event_key}</small></td>
                      <td>{e.trigger_text}</td>
                      <td>{e.keyword_matched || (e.status === 'sent' ? 'any' : '—')}</td>
                      <td>{[e.public_reply_text && `Public: ${e.public_reply_text}`, e.message_text && `DM: ${e.message_text}`].filter(Boolean).join(' · ') || '—'}</td>
                      <td><span className={`pf-status ${e.status}`}>{e.status}</span>{e.skip_reason && <small> ({e.skip_reason})</small>}{e.error_message && <small className="pf-error"><br />{e.error_code}: {e.error_message}</small>}{e.note && <small className="pf-hint"><br />{e.note}</small>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

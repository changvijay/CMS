import { useState } from 'react';
import { fetchInstagramComments, fetchYoutubeComments, type CommentAnalysis, type Platform } from '../../services/api';
import { isPermissionMessage } from '../../utils/errors';
import { useLive } from './useLive';

function Analysis({ a }: { a: CommentAnalysis }) {
  if (a.total === 0) return <p className="trends-empty-inline">No comments to analyse yet.</p>;
  return (
    <div className="comment-insights">
      <p>
        <b>{a.total}</b> recent comments · <b>{a.question_share}%</b> ask a question ({a.questions}). Questions are content ideas your audience is asking for.
      </p>
      {a.top_words.length > 0 && (
        <div className="chip-row" aria-label="Most mentioned words">
          {a.top_words.map((w) => <span key={w.word} className="tag">{w.word} · {w.count}</span>)}
        </div>
      )}
      {a.top_comments.length > 0 && (
        <ul className="comment-list">
          {a.top_comments.map((c, i) => (
            <li key={i}>“{c.text}” <span>{c.like_count > 0 ? `· ${c.like_count} likes` : ''}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Loaded({ platform, token, accountId, id }: { platform: Platform; token: string; accountId: string; id: string }) {
  const state = useLive<CommentAnalysis>(
    async () => (platform === 'instagram' ? (await fetchInstagramComments(token, id, accountId)).analysis : (await fetchYoutubeComments(token, id, accountId)).analysis),
    `${platform}:${accountId}:${id}`
  );
  if (state.loading) return <div className="spinner" />;
  // A saved token without the comments permission isn't a failure worth a red banner.
  if (state.error && isPermissionMessage(state.error)) return <p className="trends-empty-inline">Comment insights aren’t available for this channel.</p>;
  if (state.error) return <div className="error-banner"><span>{state.error}</span></div>;
  return state.data ? <Analysis a={state.data} /> : null;
}

/** "What are people saying?" for one post or video. Loads only when opened. */
export function CommentInsights({ platform, token, accountId, id }: { platform: Platform; token: string; accountId: string; id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="comment-block">
      <button className="content-link as-button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'Hide comment insights' : 'Comment insights'}
      </button>
      {open && <Loaded platform={platform} token={token} accountId={accountId} id={id} />}
    </div>
  );
}

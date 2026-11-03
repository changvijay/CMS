import { mediaSrc } from './helpers';
import { getValue, mediaForType } from './mapping';
import type { MediaItem, Platform, PlatformDraft, PublishAccount, SharedFields } from './types';

/** Live previews styled like each platform. They show the exact text and media that will be sent. */
interface Props { platform: Platform; draft: PlatformDraft; shared: SharedFields; account?: PublishAccount }

function Visual({ items, tall }: { items: MediaItem[]; tall?: boolean }) {
  const first = items[0];
  if (!first) return null;
  return (
    <div className={`pv-media${tall ? ' tall' : ''}`}>
      {first.kind === 'video'
        ? <video src={mediaSrc(first)} muted playsInline controls preload="metadata" />
        : first.kind === 'document'
          ? <div className="pv-doc">📄 {first.name}</div>
          : <img src={mediaSrc(first)} alt="" />}
      {items.length > 1 && <span className="pv-count">1 / {items.length}</span>}
    </div>
  );
}

function Avatar({ account, fallback }: { account?: PublishAccount; fallback: string }) {
  return account?.avatar ? <img className="pv-avatar" src={account.avatar} alt="" /> : <span className="pv-avatar">{(account?.name || fallback).charAt(0)}</span>;
}

/** Text with #hashtags and @mentions highlighted, cut like the platform cuts it before "more". */
function RichText({ text, cut }: { text: string; cut?: number }) {
  const shown = cut && [...text].length > cut ? `${[...text].slice(0, cut).join('')}…` : text;
  return (
    <p className="pv-text">
      {shown.split(/(\s+)/).map((w, i) => (/^[#@][\p{L}\p{N}_.]+/u.test(w) ? <span key={i} className="pv-tag">{w}</span> : w))}
      {cut && [...text].length > cut && <span className="pv-more"> more</span>}
    </p>
  );
}

export function Preview({ platform, draft, shared, account }: Props) {
  const v = <T,>(k: string) => getValue<T>(platform, draft, shared, k);
  const media = mediaForType(platform, draft.postType, v<MediaItem[]>('media') || []);
  const name = account?.name || 'Your account';

  if (platform === 'instagram') {
    const story = draft.postType === 'story';
    const reel = draft.postType === 'reel';
    return (
      <div className={`pv pv-ig${story || reel ? ' vertical' : ''}`}>
        <div className="pv-head"><Avatar account={account} fallback="I" /><b>{account?.handle?.replace('@', '') || name}</b>{v<{ name: string } | null>('location') && !story && <small>{v<{ name: string }>('location').name}</small>}</div>
        <Visual items={media} tall={story || reel} />
        {!story && <div className="pv-actions">♡ 💬 ➤ <span className="pv-save">🔖</span></div>}
        {!story && <RichText text={`${account?.handle?.replace('@', '') || name} ${v<string>('caption') || ''}`} cut={125} />}
      </div>
    );
  }
  if (platform === 'facebook') {
    return (
      <div className="pv pv-fb">
        <div className="pv-head"><Avatar account={account} fallback="F" /><div><b>{name}</b><small>{shared.scheduleAt ? 'Scheduled' : 'Just now'} · 🌐</small></div></div>
        {draft.postType !== 'story' && <RichText text={v<string>('message') || ''} cut={480} />}
        {draft.postType === 'link' && v<string>('link') && <div className="pv-linkcard"><small>{safeHost(v<string>('link'))}</small><b>{shared.title || v<string>('link')}</b></div>}
        <Visual items={media} tall={draft.postType === 'reel' || draft.postType === 'story'} />
        <div className="pv-actions fb">👍 Like · 💬 Comment · ↪ Share</div>
      </div>
    );
  }
  if (platform === 'linkedin') {
    const poll = v<{ question: string; options: string[] }>('poll');
    return (
      <div className="pv pv-li">
        <div className="pv-head"><Avatar account={account} fallback="L" /><div><b>{name}</b><small>{account?.type === 'Personal' ? 'Personal profile' : 'Company page'} · now · 🌐</small></div></div>
        <RichText text={v<string>('commentary') || ''} cut={210} />
        {draft.postType === 'article' && (
          <div className="pv-linkcard li">
            {v<MediaItem | null>('article_thumbnail') && <img src={mediaSrc(v<MediaItem>('article_thumbnail'))} alt="" />}
            <b>{v<string>('article_title') || v<string>('article_url')}</b><small>{safeHost(v<string>('article_url'))}</small>
          </div>
        )}
        {draft.postType === 'poll' && (
          <div className="pv-poll"><b>{poll?.question || 'Your question'}</b>{(poll?.options || []).filter(Boolean).map((o) => <span key={o}>{o}</span>)}</div>
        )}
        {draft.postType === 'document' && v<string>('document_title') && <p className="pv-doc-title">{v<string>('document_title')}</p>}
        <Visual items={media} />
        <div className="pv-actions li">👍 Like · 💬 Comment · 🔁 Repost · ➤ Send</div>
      </div>
    );
  }
  const thumb = v<MediaItem | null>('thumbnail');
  return (
    <div className="pv pv-yt">
      <div className="pv-media yt">
        {thumb ? <img src={mediaSrc(thumb)} alt="" /> : media[0] ? <video src={mediaSrc(media[0])} muted playsInline preload="metadata" /> : <div className="pv-empty">No video yet</div>}
        {media[0]?.duration ? <span className="pv-duration">{Math.floor(media[0].duration / 60)}:{String(Math.round(media[0].duration % 60)).padStart(2, '0')}</span> : null}
      </div>
      <div className="pv-yt-row">
        <Avatar account={account} fallback="Y" />
        <div><b className="pv-yt-title">{v<string>('title') || 'Video title'}</b><small>{name} · {shared.scheduleAt ? 'Premieres when scheduled' : String(v('privacy'))}</small></div>
      </div>
      <RichText text={v<string>('description') || ''} cut={160} />
    </div>
  );
}

function safeHost(url: string) {
  try {
    return new URL(url).host.toUpperCase();
  } catch {
    return '';
  }
}

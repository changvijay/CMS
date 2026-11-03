import { LIMITS, defaultPostType } from './platforms';
import type { MediaItem, Platform, PlatformDraft, SharedFields } from './types';

/**
 * How the shared fields flow into each platform tab ("type it once").
 * A synced field is derived from the shared fields every render, so there is nothing to keep in step. Editing it
 * on a tab copies the value into the draft and unlinks it for that platform only; "Reset to shared" links it again.
 */

/** Fields that come from the shared section, per platform. */
export const SYNCED: Record<Platform, string[]> = {
  instagram: ['caption', 'media', 'cover', 'location'],
  facebook: ['message', 'link', 'media', 'thumbnail', 'place', 'title', 'description'],
  linkedin: ['commentary', 'media', 'thumbnail', 'title', 'article_url', 'article_title', 'article_description'],
  youtube: ['title', 'description', 'tags', 'media', 'thumbnail'],
};

/** Starting values for the fields only one platform has. */
export function defaultValues(platform: Platform): Record<string, unknown> {
  const audience = { countries: [] as string[], age_min: '', age_max: '', locales: [] as number[] };
  switch (platform) {
    case 'instagram':
      return { collaborators: [], product_tags: [], share_to_feed: true, thumb_offset: '', audio_name: '', trial: false, trial_graduation: 'MANUAL' };
    case 'facebook':
      return { published: true, tags: [], targeting: { ...audience }, feed_targeting: { ...audience } };
    case 'linkedin':
      return { visibility: 'PUBLIC', reshare_disabled: false, lifecycle: 'PUBLISHED', document_title: '', article_thumbnail: null, poll: { question: '', options: ['', ''], duration: 'THREE_DAYS' } };
    case 'youtube':
      return { category_id: '22', privacy: 'public', made_for_kids: null, embeddable: true, license: 'youtube', public_stats_viewable: true, default_language: '', playlist_id: '', notify_subscribers: true };
  }
}

export const emptyDraft = (platform: Platform): PlatformDraft => ({ postType: defaultPostType(platform), values: {}, unlinked: [], perMedia: {} });

// ---------- text helpers ----------

/** Counts characters the way the platforms do (an emoji is one character, not two UTF-16 units). */
export const charCount = (s: unknown) => [...String(s ?? '')].length;
export const countHashtags = (s: unknown) => (String(s ?? '').match(/#[\p{L}\p{N}_]+/gu) || []).length;
export const countMentions = (s: unknown) => (String(s ?? '').match(/(^|[^\w])@[\w.]+/g) || []).length;

/** "#stock market" / "stock market" -> "#stockmarket". Empty when nothing usable is left. */
export function toHashtag(raw: string): string {
  const word = String(raw).replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
  return word ? `#${word}` : '';
}

/** Hashtags first, then keywords, without duplicates (case-insensitive). */
export function allTags(shared: Pick<SharedFields, 'hashtags' | 'keywords'>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...shared.hashtags, ...shared.keywords].map(toHashtag).filter(Boolean)) {
    const k = t.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

/** Cuts text to `limit` characters, at a word break when one is close. */
export function trimTo(text: string, limit: number): { value: string; trimmed: boolean } {
  const chars = [...text];
  if (chars.length <= limit) return { value: text, trimmed: false };
  let cut = chars.slice(0, limit).join('');
  const space = cut.search(/\s\S*$/);
  if (space > limit - 40 && space > 0) cut = cut.slice(0, space);
  return { value: cut.trimEnd(), trimmed: true };
}

const join = (...parts: (string | undefined | null)[]) => parts.map((p) => String(p ?? '').trim()).filter(Boolean).join('\n\n');

export interface Derived {
  value: unknown;
  warning?: string;
}

function text(value: string, limit: number, label: string): Derived {
  const t = trimTo(value, limit);
  return t.trimmed ? { value: t.value, warning: `Shortened to ${label}'s ${limit.toLocaleString()}-character limit.` } : { value: t.value };
}

/** The value a synced field gets from the shared fields. */
export function deriveShared(platform: Platform, key: string, shared: SharedFields): Derived {
  const tags = allTags(shared);
  if (key === 'media') return { value: shared.media };
  if (key === 'thumbnail' || key === 'cover') return { value: shared.thumbnail };
  if (key === 'location' || key === 'place') return { value: shared.location };
  if (key === 'link' || key === 'article_url') return { value: shared.link };

  if (platform === 'instagram' && key === 'caption') {
    const kept = tags.slice(0, LIMITS.igHashtags);
    const d = text(join(shared.title, shared.description, kept.join(' ')), LIMITS.igCaption, 'Instagram');
    if (tags.length > kept.length) return { ...d, warning: [`Only the first ${LIMITS.igHashtags} hashtags were kept (Instagram's limit).`, d.warning].filter(Boolean).join(' ') };
    return d;
  }
  if (platform === 'facebook') {
    if (key === 'message') return text(join(shared.title, shared.description, tags.join(' ')), LIMITS.fbMessage, 'Facebook');
    if (key === 'title') return { value: shared.title };
    if (key === 'description') return { value: shared.description };
  }
  if (platform === 'linkedin') {
    if (key === 'commentary') return text(join(shared.title, shared.description, tags.join(' ')), LIMITS.liCommentary, 'LinkedIn');
    if (key === 'title' || key === 'article_title') return text(shared.title, LIMITS.liArticleTitle, 'LinkedIn');
    if (key === 'article_description') return text(shared.description, LIMITS.liArticleDescription, 'LinkedIn');
  }
  if (platform === 'youtube') {
    if (key === 'title') return text(shared.title, LIMITS.ytTitle, 'YouTube title');
    if (key === 'description') return text(join(shared.description, shared.link, tags.join(' ')), LIMITS.ytDescription, 'YouTube description');
    if (key === 'tags') {
      const plain = tags.map((t) => t.slice(1));
      const kept = fitYoutubeTags(plain);
      return kept.length < plain.length ? { value: kept, warning: `${plain.length - kept.length} tag(s) left out to stay under YouTube's ${LIMITS.ytTags}-character total.` } : { value: kept };
    }
  }
  return { value: undefined };
}

/** YouTube counts each tag's length, +2 for quotes around tags with spaces, +1 per comma, toward 500. */
export const youtubeTagCost = (tags: string[]) => tags.reduce((n, t) => n + charCount(t) + (t.includes(' ') ? 2 : 0), 0) + Math.max(0, tags.length - 1);

export function fitYoutubeTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    if (youtubeTagCost([...out, t]) > LIMITS.ytTags) break;
    out.push(t);
  }
  return out;
}

// ---------- reading and editing a tab ----------

export interface FieldState<T = unknown> {
  value: T;
  synced: boolean;
  /** True when this field can follow the shared fields (whether or not it currently does). */
  syncable: boolean;
  warning?: string;
}

export function fieldState<T = unknown>(platform: Platform, draft: PlatformDraft, shared: SharedFields, key: string): FieldState<T> {
  const syncable = SYNCED[platform].includes(key);
  if (syncable && !draft.unlinked.includes(key)) {
    const d = deriveShared(platform, key, shared);
    return { value: d.value as T, synced: true, syncable, warning: d.warning };
  }
  const value = key in draft.values ? draft.values[key] : defaultValues(platform)[key];
  return { value: value as T, synced: false, syncable };
}

export const getValue = <T = unknown>(platform: Platform, draft: PlatformDraft, shared: SharedFields, key: string) => fieldState<T>(platform, draft, shared, key).value;

/** Editing a field on a tab: a synced field is unlinked for this platform only. */
export function setField(platform: Platform, draft: PlatformDraft, key: string, value: unknown): PlatformDraft {
  const unlinked = SYNCED[platform].includes(key) && !draft.unlinked.includes(key) ? [...draft.unlinked, key] : draft.unlinked;
  return { ...draft, values: { ...draft.values, [key]: value }, unlinked };
}

/** "Reset to shared": follow the shared fields again. */
export function resetField(draft: PlatformDraft, key: string): PlatformDraft {
  const values = { ...draft.values };
  delete values[key];
  return { ...draft, values, unlinked: draft.unlinked.filter((k) => k !== key) };
}

// ---------- the payload sent to the server ----------

const ready = (items: unknown): MediaItem[] => (Array.isArray(items) ? (items as MediaItem[]).filter((m) => m && m.status === 'ready' && m.url) : []);
const asFile = (m: MediaItem | null | undefined) => (m && m.status === 'ready' && m.url ? { url: m.url, mime: m.mime } : null);

function mediaPayload(items: MediaItem[], draft: PlatformDraft) {
  return items.map((m) => ({
    url: m.url,
    mime: m.mime,
    kind: m.kind,
    bytes: m.bytes,
    alt_text: draft.perMedia[m.id]?.alt_text || undefined,
    user_tags: draft.perMedia[m.id]?.user_tags?.length ? draft.perMedia[m.id].user_tags : undefined,
  }));
}

/** Only the media the post type takes (an image post ignores videos in the shared list, and so on). */
export function mediaForType(platform: Platform, postType: string, items: MediaItem[]): MediaItem[] {
  const images = items.filter((m) => m.kind === 'image');
  const videos = items.filter((m) => m.kind === 'video');
  const docs = items.filter((m) => m.kind === 'document');
  switch (`${platform}:${postType}`) {
    case 'instagram:image': case 'facebook:photo': case 'linkedin:image': return images.slice(0, 1);
    case 'instagram:carousel': return items.filter((m) => m.kind !== 'document').slice(0, 10);
    case 'instagram:reel': case 'facebook:video': case 'facebook:reel': case 'linkedin:video': case 'youtube:video': return videos.slice(0, 1);
    case 'instagram:story': case 'facebook:story': return items.filter((m) => m.kind !== 'document').slice(0, 1);
    case 'facebook:multi_photo': return images.slice(0, 30);
    case 'linkedin:multi_image': return images.slice(0, 20);
    case 'linkedin:document': return docs.slice(0, 1);
    default: return [];
  }
}

/** The `fields` object for one platform target, in the shape the server's publishers expect. */
export function buildFields(platform: Platform, draft: PlatformDraft, shared: SharedFields): Record<string, unknown> {
  const v = (key: string) => getValue(platform, draft, shared, key);
  const media = mediaPayload(mediaForType(platform, draft.postType, ready(v('media'))), draft);

  if (platform === 'instagram') {
    const story = draft.postType === 'story';
    const product = (v('product_tags') as { product_id: string }[]) || [];
    return {
      caption: story ? undefined : v('caption'),
      media,
      cover_url: draft.postType === 'reel' ? asFile(v('cover') as MediaItem)?.url : undefined,
      location_id: story ? undefined : (v('location') as { id: string } | null)?.id,
      collaborators: story ? [] : v('collaborators'),
      // Feed images need a tag position; the middle of the image is used unless one was chosen.
      product_tags: story ? [] : product.map((p) => (draft.postType === 'image' ? { x: 0.5, y: 0.5, ...p } : p)),
      ...(draft.postType === 'reel'
        ? { thumb_offset: v('thumb_offset'), share_to_feed: v('share_to_feed'), audio_name: v('audio_name'), trial: v('trial'), trial_graduation: v('trial_graduation') }
        : {}),
    };
  }
  if (platform === 'facebook') {
    return {
      message: v('message'),
      link: draft.postType === 'link' ? v('link') : undefined,
      place: (v('place') as { id: string } | null)?.id,
      media,
      thumbnail: draft.postType === 'video' ? asFile(v('thumbnail') as MediaItem) : null,
      title: ['video', 'reel'].includes(draft.postType) ? v('title') : undefined,
      description: draft.postType === 'video' ? v('description') : undefined,
      tags: v('tags'),
      published: v('published'),
      targeting: v('targeting'),
      feed_targeting: v('feed_targeting'),
    };
  }
  if (platform === 'linkedin') {
    return {
      commentary: v('commentary'),
      media,
      visibility: v('visibility'),
      reshare_disabled: v('reshare_disabled'),
      lifecycle: v('lifecycle'),
      title: draft.postType === 'video' ? v('title') : undefined,
      thumbnail: draft.postType === 'video' ? asFile(v('thumbnail') as MediaItem) : null,
      document_title: draft.postType === 'document' ? v('document_title') : undefined,
      article: draft.postType === 'article'
        ? { url: v('article_url'), title: v('article_title'), description: v('article_description'), thumbnail: asFile(v('article_thumbnail') as MediaItem) }
        : undefined,
      poll: draft.postType === 'poll' ? v('poll') : undefined,
    };
  }
  return {
    title: v('title'),
    description: v('description'),
    tags: v('tags'),
    media,
    thumbnail: asFile(v('thumbnail') as MediaItem),
    category_id: v('category_id'),
    privacy: v('privacy'),
    made_for_kids: v('made_for_kids'),
    embeddable: v('embeddable'),
    license: v('license'),
    public_stats_viewable: v('public_stats_viewable'),
    default_language: v('default_language'),
    playlist_id: v('playlist_id'),
    notify_subscribers: v('notify_subscribers'),
  };
}

import { LIMITS, PLATFORM_LABEL, nativelyScheduled, postTypeInfo } from './platforms';
import { charCount, countHashtags, countMentions, getValue, mediaForType } from './mapping';
import { checkMedia, checkThumbnail, isShortsCandidate } from './mediaRules';
import type { AutoReplySettings, Issue, MediaItem, Platform, PlatformDraft, SharedFields } from './types';

/** Everything wrong with one platform tab, in the same words the server would use. */
export function validateDraft(platform: Platform, draft: PlatformDraft, shared: SharedFields): Issue[] {
  const issues: Issue[] = [];
  const v = <T,>(k: string) => getValue<T>(platform, draft, shared, k);
  const err = (message: string) => issues.push({ level: 'error', message });
  const all = (v<MediaItem[]>('media') || []);
  const info = postTypeInfo(platform, draft.postType);
  const media = mediaForType(platform, draft.postType, all);

  if (info.min && media.length < info.min) err(info.min === 1 ? `${info.label} needs ${info.media === 'pdf' ? 'a PDF' : info.media === 'video' ? 'a video' : info.media === 'image' ? 'an image' : 'a file'}.` : `${info.label} needs at least ${info.min} files (has ${media.length}).`);
  if (info.max && media.length > info.max) err(`${info.label} takes at most ${info.max} files.`);
  if (info.media !== 'none' && all.length > media.length) issues.push({ level: 'info', message: `${all.length - media.length} shared file(s) don't fit a ${info.label.toLowerCase()} and will be left out here.` });
  issues.push(...checkMedia(platform, draft.postType, media));

  if (platform === 'instagram') {
    const caption = v<string>('caption') || '';
    if (draft.postType === 'story') {
      if (caption.trim()) issues.push({ level: 'info', message: 'Stories have no caption, so the caption is not used. Link stickers also cannot be added through the API.' });
    } else {
      if (charCount(caption) > LIMITS.igCaption) err(`Caption is over ${LIMITS.igCaption} characters.`);
      if (countHashtags(caption) > LIMITS.igHashtags) err(`At most ${LIMITS.igHashtags} hashtags.`);
      if (countMentions(caption) > LIMITS.igMentions) err(`At most ${LIMITS.igMentions} @mentions.`);
    }
    if ((v<string[]>('collaborators') || []).length > LIMITS.igCollaborators) err(`At most ${LIMITS.igCollaborators} collaborators.`);
    if (draft.postType === 'reel') issues.push(...checkThumbnail('instagram', v<MediaItem | null>('cover')));
  }

  if (platform === 'facebook') {
    const message = v<string>('message') || '';
    if (charCount(message) > LIMITS.fbMessage) err(`Message is over ${LIMITS.fbMessage.toLocaleString()} characters.`);
    if (draft.postType === 'text' && !message.trim()) err('A text post needs a message.');
    if (draft.postType === 'link' && !/^https?:\/\/\S+\.\S+/.test(v<string>('link') || '')) err('A link post needs a full link (https://…).');
    if (draft.postType === 'video') issues.push(...checkThumbnail('facebook', v<MediaItem | null>('thumbnail')));
    const t = v<{ age_min?: string; age_max?: string }>('targeting') || {};
    if (t.age_min && t.age_max && Number(t.age_min) > Number(t.age_max)) err('Audience: minimum age is above maximum age.');
  }

  if (platform === 'linkedin') {
    const commentary = v<string>('commentary') || '';
    if (charCount(commentary) > LIMITS.liCommentary) err(`Post text is over ${LIMITS.liCommentary} characters.`);
    if (draft.postType === 'none' && !commentary.trim()) err('A text post needs some text.');
    if (draft.postType === 'document' && !String(v('document_title') || '').trim()) err('A document post needs a title.');
    if (draft.postType === 'article' && !/^https?:\/\/\S+\.\S+/.test(v<string>('article_url') || '')) err('An article needs a full link (https://…).');
    if (draft.postType === 'poll') {
      const p = v<{ question: string; options: string[] }>('poll');
      const options = (p?.options || []).map((o) => o.trim()).filter(Boolean);
      if (!p?.question?.trim()) err('The poll needs a question.');
      if (charCount(p?.question) > LIMITS.liPollQuestion) err(`The poll question is over ${LIMITS.liPollQuestion} characters.`);
      if (options.length < 2 || options.length > 4) err('The poll needs 2 to 4 options.');
      if (options.some((o) => charCount(o) > LIMITS.liPollOption)) err(`Poll options must be ${LIMITS.liPollOption} characters or fewer.`);
    }
    if (draft.postType === 'video') issues.push(...checkThumbnail('linkedin', v<MediaItem | null>('thumbnail')));
  }

  if (platform === 'youtube') {
    const title = v<string>('title') || '';
    const description = v<string>('description') || '';
    if (!title.trim()) err('A title is required.');
    if (charCount(title) > LIMITS.ytTitle) err(`Title is over ${LIMITS.ytTitle} characters.`);
    if (charCount(description) > LIMITS.ytDescription) err(`Description is over ${LIMITS.ytDescription} characters.`);
    if (/[<>]/.test(title + description)) err('YouTube does not allow < or > in the title or description.');
    if (v('made_for_kids') === null || v('made_for_kids') === undefined) err('Choose whether the video is made for kids (required by law).');
    if (draft.postType === 'short') {
      if (media[0]?.kind === 'video' && media[0].duration == null) issues.push({ level: 'warn', message: 'Could not read the video length. A Short must be 3 minutes or less.' });
    } else {
      issues.push(...checkThumbnail('youtube', v<MediaItem | null>('thumbnail')));
      if (isShortsCandidate(media[0])) issues.push({ level: 'warn', message: 'This video is vertical and 3 minutes or less, so YouTube will show it as a Short. Pick "Short" if that is what you want.' });
    }
  }
  return issues;
}

/** Converts the date-time picker value (local time) to an ISO string, or null. */
export function scheduleIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export function validateSchedule(local: string, platforms: { platform: Platform; postType: string }[], now = Date.now()): Issue[] {
  const iso = scheduleIso(local);
  if (!local) return [];
  if (!iso) return [{ level: 'error', message: 'The schedule time is not a valid date.' }];
  const minutes = (new Date(iso).getTime() - now) / 60000;
  if (minutes < 1) return [{ level: 'error', message: 'The schedule time must be in the future.' }];
  const issues: Issue[] = [];
  for (const { platform, postType } of platforms) {
    if (platform === 'facebook' && nativelyScheduled('facebook', postType as never) && (minutes < 10 || minutes > 30 * 24 * 60)) {
      issues.push({ level: 'error', message: `${PLATFORM_LABEL.facebook}: scheduled posts must be 10 minutes to 30 days ahead.` });
    }
  }
  return issues;
}

export function validateAutoReply(a: AutoReplySettings): Issue[] {
  if (!a.enabled) return [];
  const issues: Issue[] = [];
  const err = (message: string) => issues.push({ level: 'error', message });
  if (a.trigger === 'keywords' && !a.keywords.length) err('Add at least one keyword, or choose "Any comment".');
  const replies = a.public_replies.map((r) => r.trim()).filter(Boolean);
  if (!a.send_dm && !replies.length) err('Turn on the DM or write at least one public reply.');
  if (replies.some((r) => charCount(r) > LIMITS.publicReply)) err(`Public replies must be ${LIMITS.publicReply} characters or fewer.`);
  if (a.send_dm && !a.dm_text.trim() && !a.link_url.trim() && !a.dm_buttons.some((b) => b.title && b.url)) err('Write the DM text.');
  if (a.link_url && !/^https?:\/\//.test(a.link_url)) err('The DM link must start with https://.');
  for (const b of a.dm_buttons) if ((b.title || b.url) && !(b.title && /^https:\/\//.test(b.url))) err('Each button needs a title and an https:// link.');
  if (a.active_from && a.active_until && new Date(a.active_until) <= new Date(a.active_from)) err('The end date must be after the start date.');
  return issues;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === 'error');

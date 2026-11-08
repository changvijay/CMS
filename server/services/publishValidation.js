import { IG_LIMITS, IG_TYPES } from './publishers/instagram.js';
import { FB_LIMITS, FB_NATIVE_SCHEDULE, FB_TYPES } from './publishers/facebook.js';
import { LI_LIMITS, LI_TYPES, POLL_DURATIONS, VISIBILITY } from './publishers/linkedin.js';
import { YT_LIMITS, YT_PRIVACY, YT_TYPES, tagCost } from './publishers/youtube.js';

/**
 * Server-side checks for each target before anything is sent. The wizard runs the same checks in the browser;
 * these exist so a hand-made request can't push something a platform will reject halfway through.
 */
export const countHashtags = (text) => (String(text ?? '').match(/#[\p{L}\p{N}_]+/gu) || []).length;
export const countMentions = (text) => (String(text ?? '').match(/(^|[^\w])@[\w.]+/g) || []).length;
const len = (s) => [...String(s ?? '')].length;
const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
const isVideo = (m) => m?.kind === 'video' || String(m?.mime || '').startsWith('video/');

function isHttps(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function mediaUrls(errors, media, label) {
  for (const m of media) if (!isHttps(m.url)) errors.push(`${label}: every media file must be uploaded first (it needs a public https link).`);
}

export function validateInstagram(postType, f) {
  const errors = [];
  if (!IG_TYPES.includes(postType)) return [`Instagram: unknown post type "${postType}".`];
  const media = list(f.media);
  if (postType !== 'story') {
    if (len(f.caption) > IG_LIMITS.caption) errors.push(`Instagram: the caption is over ${IG_LIMITS.caption} characters.`);
    if (countHashtags(f.caption) > IG_LIMITS.hashtags) errors.push(`Instagram: at most ${IG_LIMITS.hashtags} hashtags.`);
    if (countMentions(f.caption) > IG_LIMITS.mentions) errors.push(`Instagram: at most ${IG_LIMITS.mentions} @mentions.`);
  }
  if (list(f.collaborators).length > IG_LIMITS.collaborators) errors.push(`Instagram: at most ${IG_LIMITS.collaborators} collaborators.`);
  if (postType === 'carousel' && (media.length < IG_LIMITS.carouselMin || media.length > IG_LIMITS.carouselMax)) errors.push('Instagram: a carousel needs 2 to 10 items.');
  if (postType === 'image' && (media.length !== 1 || isVideo(media[0]))) errors.push('Instagram: an image post needs exactly one image.');
  if (postType === 'reel' && (media.length !== 1 || !isVideo(media[0]))) errors.push('Instagram: a reel needs exactly one video.');
  if (postType === 'story' && media.length !== 1) errors.push('Instagram: a story needs exactly one image or video.');
  mediaUrls(errors, media, 'Instagram');
  for (const m of media) {
    for (const t of list(m.user_tags)) {
      if (t.x !== undefined && (t.x < 0 || t.x > 1 || t.y < 0 || t.y > 1)) errors.push('Instagram: tag positions must be inside the image.');
    }
  }
  return errors;
}

export function validateFacebook(postType, f, scheduleAt, now = Date.now()) {
  const errors = [];
  if (!FB_TYPES.includes(postType)) return [`Facebook: unknown post type "${postType}".`];
  const media = list(f.media);
  if (len(f.message) > FB_LIMITS.message) errors.push(`Facebook: the message is over ${FB_LIMITS.message} characters.`);
  if (postType === 'text' && !String(f.message || '').trim()) errors.push('Facebook: a text post needs a message.');
  if (postType === 'link' && !isHttps(f.link) && !/^http:\/\//.test(String(f.link || ''))) errors.push('Facebook: a link post needs a full link.');
  if (postType === 'photo' && (media.length !== 1 || isVideo(media[0]))) errors.push('Facebook: a photo post needs exactly one image.');
  if (postType === 'multi_photo' && media.filter((m) => !isVideo(m)).length < 2) errors.push('Facebook: a multi-photo post needs at least 2 images.');
  if ((postType === 'video' || postType === 'reel') && (media.length !== 1 || !isVideo(media[0]))) errors.push(`Facebook: a ${postType} needs exactly one video.`);
  if (postType === 'story' && media.length !== 1) errors.push('Facebook: a story needs exactly one image or video.');
  if (scheduleAt && FB_NATIVE_SCHEDULE.has(postType)) {
    const minutes = (new Date(scheduleAt).getTime() - now) / 60000;
    if (minutes < FB_LIMITS.minScheduleMinutes || minutes > FB_LIMITS.maxScheduleDays * 24 * 60) errors.push('Facebook: scheduled posts must be 10 minutes to 30 days ahead.');
  }
  mediaUrls(errors, media, 'Facebook');
  return errors;
}

export function validateLinkedIn(postType, f) {
  const errors = [];
  if (!LI_TYPES.includes(postType)) return [`LinkedIn: unknown content type "${postType}".`];
  const media = list(f.media);
  if (len(f.commentary) > LI_LIMITS.commentary) errors.push(`LinkedIn: the text is over ${LI_LIMITS.commentary} characters.`);
  if (f.visibility && !VISIBILITY.includes(f.visibility)) errors.push('LinkedIn: visibility must be PUBLIC, CONNECTIONS or LOGGED_IN.');
  if (postType === 'none' && !String(f.commentary || '').trim()) errors.push('LinkedIn: a text post needs some text.');
  if (postType === 'image' && media.length !== 1) errors.push('LinkedIn: an image post needs exactly one image.');
  if (postType === 'multi_image' && (media.length < LI_LIMITS.multiImageMin || media.length > LI_LIMITS.multiImageMax)) errors.push('LinkedIn: a multi-image post needs 2 to 20 images.');
  if (postType === 'video' && media.length !== 1) errors.push('LinkedIn: a video post needs exactly one video.');
  if (postType === 'document') {
    if (media.length !== 1) errors.push('LinkedIn: a document post needs one PDF.');
    if (!String(f.document_title || '').trim()) errors.push('LinkedIn: a document post needs a title.');
  }
  if (postType === 'article' && !String(f.article?.url || '').trim()) errors.push('LinkedIn: an article post needs a link.');
  if (postType === 'poll') {
    const p = f.poll || {};
    const options = list(p.options).map((o) => String(o).trim()).filter(Boolean);
    if (!String(p.question || '').trim()) errors.push('LinkedIn: a poll needs a question.');
    if (len(p.question) > LI_LIMITS.pollQuestion) errors.push(`LinkedIn: the poll question is over ${LI_LIMITS.pollQuestion} characters.`);
    if (options.length < LI_LIMITS.pollOptionsMin || options.length > LI_LIMITS.pollOptionsMax) errors.push('LinkedIn: a poll needs 2 to 4 options.');
    if (options.some((o) => len(o) > LI_LIMITS.pollOption)) errors.push(`LinkedIn: poll options must be ${LI_LIMITS.pollOption} characters or fewer.`);
    if (p.duration && !POLL_DURATIONS.includes(p.duration)) errors.push('LinkedIn: unknown poll duration.');
  }
  mediaUrls(errors, media, 'LinkedIn');
  return errors;
}

export function validateYoutube(postType, f) {
  if (!YT_TYPES.includes(postType)) return [`YouTube: unknown post type "${postType}".`];
  const errors = [];
  const media = list(f.media);
  if (media.length !== 1 || !isVideo(media[0])) errors.push('YouTube: upload one video file.');
  if (!String(f.title || '').trim()) errors.push('YouTube: a title is required.');
  if (len(f.title) > YT_LIMITS.title) errors.push(`YouTube: the title is over ${YT_LIMITS.title} characters.`);
  if (len(f.description) > YT_LIMITS.description) errors.push(`YouTube: the description is over ${YT_LIMITS.description} characters.`);
  // YouTube rejects angle brackets in titles and descriptions.
  if (/[<>]/.test(`${f.title || ''}${f.description || ''}`)) errors.push('YouTube: titles and descriptions cannot contain < or >.');
  if (tagCost(list(f.tags)) > YT_LIMITS.tagsTotal) errors.push(`YouTube: tags are over ${YT_LIMITS.tagsTotal} characters in total.`);
  if (f.privacy && !YT_PRIVACY.includes(f.privacy)) errors.push('YouTube: privacy must be public, unlisted or private.');
  if (f.made_for_kids === undefined || f.made_for_kids === null) errors.push('YouTube: say whether the video is made for kids (required by law).');
  if (postType === 'short' && media[0]) {
    const { width, height, duration } = media[0];
    if (duration != null && Number(duration) > YT_LIMITS.shortSeconds) errors.push('YouTube: a Short must be 3 minutes or less.');
    if (width && height && Number(width) > Number(height)) errors.push('YouTube: a Short must be vertical or square.');
  }
  mediaUrls(errors, media, 'YouTube');
  return errors;
}

/** All errors for one target, including its schedule time. */
export function validateTarget({ platform, postType, fields = {} }, scheduleAt, now = Date.now()) {
  const errors = [];
  if (scheduleAt) {
    const at = new Date(scheduleAt).getTime();
    if (!Number.isFinite(at)) errors.push('The schedule time is not a valid date.');
    else if (at < now + 60 * 1000) errors.push('The schedule time must be in the future.');
  }
  if (platform === 'instagram') errors.push(...validateInstagram(postType, fields));
  else if (platform === 'facebook') errors.push(...validateFacebook(postType, fields, scheduleAt, now));
  else if (platform === 'linkedin') errors.push(...validateLinkedIn(postType, fields));
  else if (platform === 'youtube') errors.push(...validateYoutube(postType, fields));
  else errors.push(`Unknown platform "${platform}".`);
  return errors;
}

/** Cleans the wizard's auto-reply settings into automation_rules columns. Returns { errors, value }. */
export function validateAutoReply(input = {}) {
  const errors = [];
  const keywords = [...new Set(list(input.keywords).map((k) => String(k).trim()).filter(Boolean))];
  const matchType = input.trigger === 'any' ? 'any' : 'contains';
  const variants = list(input.public_replies).map((v) => String(v).trim()).filter(Boolean).slice(0, 10);
  const buttons = list(input.dm_buttons).filter((b) => b.title && b.url).slice(0, 3).map((b) => ({ title: String(b.title).trim().slice(0, 20), url: String(b.url).trim() }));
  const quick = list(input.quick_replies).map((q) => (typeof q === 'string' ? { title: q } : q)).filter((q) => q.title).slice(0, 13).map((q) => ({ title: String(q.title).trim().slice(0, 20) }));
  const value = {
    name: String(input.name || '').trim() || 'Auto-reply for new post',
    keywords,
    match_type: matchType,
    public_reply_variants: variants,
    comment_reply_text: variants[0] || null,
    send_dm: input.send_dm !== false,
    reply_text: String(input.dm_text || '').trim(),
    link_url: String(input.link_url || '').trim(),
    dm_buttons: buttons,
    quick_replies: quick,
    require_follow: Boolean(input.require_follow),
    active_from: input.active_from || null,
    active_until: input.active_until || null,
    disclose_automation: input.disclose_automation !== false,
    cooldown_hours: Number.isFinite(Number(input.cooldown_hours)) ? Math.max(0, Math.round(Number(input.cooldown_hours))) : 0,
  };
  if (matchType === 'contains' && !keywords.length) errors.push('Auto-reply: add at least one keyword, or choose "Any comment".');
  if (keywords.some((k) => k.length > 60)) errors.push('Auto-reply: keywords must be 60 characters or fewer.');
  if (!value.send_dm && !variants.length) errors.push('Auto-reply: turn on the DM or write at least one public reply.');
  if (value.send_dm && !value.reply_text && !value.link_url && !buttons.length) errors.push('Auto-reply: write the DM text.');
  if (variants.some((v) => v.length > 300)) errors.push('Auto-reply: public replies must be 300 characters or fewer.');
  for (const b of buttons) if (!isHttps(b.url)) errors.push(`Auto-reply: the button link "${b.url}" must start with https://.`);
  if (value.link_url && !/^https?:\/\//.test(value.link_url)) errors.push('Auto-reply: the link must start with http:// or https://.');
  if (value.active_from && value.active_until && new Date(value.active_until) <= new Date(value.active_from)) errors.push('Auto-reply: the end date must be after the start date.');
  return { errors, value };
}

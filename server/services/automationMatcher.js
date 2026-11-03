/**
 * Keyword matching and message building for the Instagram auto-reply.
 * Everything here is pure so it can be tested without Instagram.
 */

export const TRIGGERS = ['comment', 'dm'];
/** `any` answers every comment (no keyword needed); used by auto-replies set up for one post. */
export const MATCH_TYPES = ['exact', 'starts_with', 'contains', 'any'];
/** Which content a rule applies to. Anything but `all` only answers comments (DMs are not tied to a post). */
export const SCOPES = ['all', 'reels', 'posts', 'specific'];
export const MAX_MESSAGE_BYTES = 1000; // Instagram's limit for a text message
const MATCH_PRIORITY = { exact: 0, starts_with: 1, contains: 2, any: 3 };
// A rule made for one reel beats one for all reels/posts, which beats an account-wide rule.
const SCOPE_PRIORITY = { specific: 0, reels: 1, posts: 1, all: 2 };

/** Lowercase, strip emoji and punctuation, collapse spaces. Works for any script (Tamil included). */
export function normalizeText(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The keyword that matched, or null. `contains` and `starts_with` only match whole words. */
export function matchesKeyword(text, keywords, mode) {
  const t = normalizeText(text);
  if (!t) return null;
  if (mode === 'any') return '';
  for (const raw of keywords || []) {
    const k = normalizeText(raw);
    if (!k) continue;
    if (mode === 'exact' && t === k) return raw;
    if (mode === 'starts_with' && (t === k || t.startsWith(`${k} `))) return raw;
    if (mode === 'contains' && ` ${t} `.includes(` ${k} `)) return raw;
  }
  return null;
}

const scopeOf = (rule) => rule.scope || (rule.media_id ? 'specific' : 'all');

/** Does this rule's scope cover the content the event happened on? */
export function scopeApplies(rule, { source, mediaId, mediaProductType }) {
  const scope = scopeOf(rule);
  if (scope === 'all') return true;
  if (source !== 'comment') return false;
  if (scope === 'specific') return Boolean(rule.media_id) && String(rule.media_id) === String(mediaId);
  if (scope === 'reels') return mediaProductType === 'REELS';
  if (scope === 'posts') return mediaProductType === 'FEED';
  return false;
}

/**
 * The rule that should answer, or null. Active rules for this source and content only.
 * More specific scope wins first (one reel/post, then all reels/posts, then everything), then the stricter
 * match type (exact, starts_with, contains), then the longer keyword, then the older rule.
 */
/** Inside the rule's optional start/end dates? */
export function inActiveWindow(rule, now = Date.now()) {
  if (rule.active_from && new Date(rule.active_from).getTime() > now) return false;
  if (rule.active_until && new Date(rule.active_until).getTime() < now) return false;
  return true;
}

export function pickRule(rules, event) {
  const { source, text } = event;
  const now = event.now ?? Date.now();
  const candidates = [];
  for (const rule of rules || []) {
    if (!rule.is_active || !(rule.triggers || []).includes(source) || !scopeApplies(rule, event) || !inActiveWindow(rule, now)) continue;
    const keyword = matchesKeyword(text, rule.keywords, rule.match_type);
    if (keyword !== null) candidates.push({ rule, keyword });
  }
  candidates.sort((a, b) =>
    SCOPE_PRIORITY[scopeOf(a.rule)] - SCOPE_PRIORITY[scopeOf(b.rule)]
    || MATCH_PRIORITY[a.rule.match_type] - MATCH_PRIORITY[b.rule.match_type]
    || normalizeText(b.keyword).length - normalizeText(a.keyword).length
    || Number(a.rule.id) - Number(b.rule.id));
  return candidates[0] ?? null;
}

/** A reel/post in the shape the rule picker needs. */
export function describeMedia(item) {
  const type = item.media_product_type === 'REELS' ? 'reel' : item.media_product_type === 'STORY' ? 'story' : 'post';
  return {
    id: String(item.id),
    type,
    product_type: item.media_product_type || null,
    caption: String(item.caption || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    thumbnail_url: item.thumbnail_url || (item.media_type !== 'VIDEO' ? item.media_url : null) || null,
    permalink: item.permalink || null,
    timestamp: item.timestamp || null,
  };
}

/** Both {{username}} and {username} become @name ("there" when Instagram did not send a username). */
export function fillUsername(text, username) {
  const who = username ? `@${username}` : 'there';
  return String(text ?? '').replaceAll('{{username}}', who).replaceAll('{username}', who);
}

/** The public comment reply: one of the variants at random (so replies don't look like spam), or the single text. */
export function pickPublicReply(rule, { username, random = Math.random } = {}) {
  const variants = (rule.public_reply_variants || []).map((v) => String(v).trim()).filter(Boolean);
  const pool = variants.length ? variants : [rule.comment_reply_text].filter(Boolean);
  if (!pool.length) return null;
  return fillUsername(pool[Math.floor(random() * pool.length) % pool.length], username).trim() || null;
}

export const FOLLOW_PAYLOAD = 'FOLLOWED:';
const QUICK_REPLY_MAX = 13;
const BUTTON_TEXT_MAX = 640;

/**
 * The DM as Instagram's message object: plain text, a button template when link buttons are set,
 * and quick replies on either. Buttons must be https links; Instagram allows 3.
 */
export function buildMessage(text, { buttons = [], quickReplies = [] } = {}) {
  const webButtons = (buttons || []).filter((b) => b?.title && b?.url).slice(0, 3)
    .map((b) => ({ type: 'web_url', url: String(b.url), title: String(b.title).slice(0, 20) }));
  const quick = (quickReplies || []).filter((q) => q?.title).slice(0, QUICK_REPLY_MAX)
    .map((q) => ({ content_type: 'text', title: String(q.title).slice(0, 20), payload: String(q.payload || q.title).slice(0, 1000) }));
  const message = webButtons.length
    ? { attachment: { type: 'template', payload: { template_type: 'button', text: String(text).slice(0, BUTTON_TEXT_MAX), buttons: webButtons } } }
    : { text: String(text) };
  if (quick.length) message.quick_replies = quick;
  return message;
}

/**
 * Instagram can't tell us whether a commenter follows us until they message us. So a "follow first" rule
 * sends a short ask with an "I followed" quick reply; tapping it is a message, and then we can check and send the link.
 */
export function followGateMessage(rule) {
  return buildMessage(
    String(rule.follow_prompt || 'Thanks for commenting! Follow us first, then tap the button below and I will send you the link 👇'),
    { quickReplies: [{ title: 'I followed ✅', payload: `${FOLLOW_PAYLOAD}${rule.id}` }] },
  );
}

export const byteLength = (s) => Buffer.byteLength(String(s ?? ''), 'utf8');

/** The exact direct message for a rule. `{{link}}` is replaced by the URL, or the URL is appended when absent. */
export function renderMessage(rule, { username } = {}) {
  const link = String(rule.link_url ?? '').trim();
  let text = fillUsername(rule.reply_text, username);
  if (link) {
    text = text.includes('{{link}}') ? text.replaceAll('{{link}}', link) : `${text}\n${link}`;
  } else {
    text = text.replaceAll('{{link}}', '');
  }
  text = text.trim();
  if (rule.disclose_automation) text = `${text}\n\n(Automated reply)`;
  return text.trim();
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Validates rule input from the UI. Returns { errors, value } where value is the cleaned rule. */
export function validateRule(input) {
  const errors = [];
  const keywords = [...new Set((Array.isArray(input.keywords) ? input.keywords : String(input.keywords ?? '').split(','))
    .map((k) => String(k).trim()).filter(Boolean))];
  const pickedTriggers = (Array.isArray(input.triggers) ? input.triggers : []).filter((t) => TRIGGERS.includes(t));
  const mediaId = String(input.media_id ?? '').trim();
  const scope = SCOPES.includes(input.scope) ? input.scope : mediaId ? 'specific' : 'all';
  // Reel/post rules can only answer comments on that content, so direct messages are dropped from them.
  const triggers = scope === 'all' ? pickedTriggers : pickedTriggers.filter((t) => t === 'comment');
  const permalink = String(input.media_permalink ?? '').trim();
  const value = {
    name: String(input.name ?? '').trim() || (keywords[0] ? `Reply to "${keywords[0]}"` : 'Auto-reply'),
    is_active: input.is_active !== false,
    triggers,
    keywords,
    match_type: input.match_type ?? 'contains',
    scope,
    media_id: scope === 'specific' ? mediaId : null,
    media_label: scope === 'specific' ? String(input.media_label ?? '').trim().slice(0, 160) || null : null,
    media_permalink: scope === 'specific' && isHttpUrl(permalink) ? permalink : null,
    reply_text: String(input.reply_text ?? '').trim(),
    link_url: String(input.link_url ?? '').trim(),
    comment_reply_text: String(input.comment_reply_text ?? '').trim() || null,
    disclose_automation: input.disclose_automation !== false,
    cooldown_hours: Number.isFinite(Number(input.cooldown_hours)) ? Math.round(Number(input.cooldown_hours)) : 24,
  };

  if (!keywords.length && value.match_type !== 'any') errors.push('Add at least one keyword.');
  if (keywords.some((k) => k.length > 60)) errors.push('Keywords must be 60 characters or fewer.');
  if (!triggers.length) {
    errors.push(scope !== 'all' && pickedTriggers.length
      ? 'Rules for reels and posts only work on comments. Tick Comments.'
      : 'Choose at least one trigger: comment or DM.');
  }
  if (scope === 'specific' && !/^\d{5,30}$/.test(mediaId)) errors.push('Choose which reel or post this rule is for.');
  if (!MATCH_TYPES.includes(value.match_type)) errors.push('Match type must be exact, starts_with, contains or any.');
  if (!value.reply_text && !value.link_url) errors.push('Write a reply message or add a link.');
  if (value.link_url && !isHttpUrl(value.link_url)) errors.push('The link must be a full URL starting with http:// or https://.');
  if (value.cooldown_hours < 0 || value.cooldown_hours > 720) errors.push('Cooldown must be between 0 and 720 hours.');
  if (value.comment_reply_text && value.comment_reply_text.length > 300) errors.push('The public comment reply must be 300 characters or fewer.');
  if (value.comment_reply_text && !triggers.includes('comment')) value.comment_reply_text = null;
  if (byteLength(renderMessage(value, { username: 'someone' })) > MAX_MESSAGE_BYTES) errors.push(`The message is longer than Instagram's ${MAX_MESSAGE_BYTES}-byte limit. Shorten it.`);

  return { errors, value };
}

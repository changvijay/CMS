import { describe, it, expect } from 'vitest';
import { describeMedia, matchesKeyword, normalizeText, pickRule, renderMessage, scopeApplies, validateRule, byteLength } from '../services/automationMatcher.js';

const rule = (over = {}) => ({
  id: 1, is_active: true, triggers: ['comment', 'dm'], keywords: ['link'], match_type: 'contains', media_id: null,
  reply_text: 'Here you go 👉 {{link}}', link_url: 'https://changtechs.com/', disclose_automation: false, ...over,
});

describe('normalizeText', () => {
  it('lowercases and strips punctuation and emoji', () => {
    expect(normalizeText('  LINK!!! 🔥🔥 ')).toBe('link');
    expect(normalizeText('Send  me\nthe Link.')).toBe('send me the link');
  });
  it('keeps Tamil letters with their vowel signs', () => {
    expect(normalizeText('லிங்க் அனுப்புங்க!')).toBe('லிங்க் அனுப்புங்க');
  });
});

describe('matchesKeyword', () => {
  it('exact needs the whole message to be the keyword', () => {
    expect(matchesKeyword('Link!', ['link'], 'exact')).toBe('link');
    expect(matchesKeyword('send link', ['link'], 'exact')).toBeNull();
  });
  it('contains only matches whole words', () => {
    expect(matchesKeyword('please send the link 🙏', ['link'], 'contains')).toBe('link');
    expect(matchesKeyword('blinking lights', ['link'], 'contains')).toBeNull();
    expect(matchesKeyword('linktree', ['link'], 'contains')).toBeNull();
  });
  it('starts_with matches the first word(s)', () => {
    expect(matchesKeyword('link please', ['link'], 'starts_with')).toBe('link');
    expect(matchesKeyword('please link', ['link'], 'starts_with')).toBeNull();
  });
  it('supports multi-word keywords and several keywords', () => {
    expect(matchesKeyword('i want the free guide', ['pdf', 'free guide'], 'contains')).toBe('free guide');
  });
  it('matches Tamil keywords', () => {
    expect(matchesKeyword('லிங்க் வேணும்', ['லிங்க்'], 'contains')).toBe('லிங்க்');
  });
  it('never matches empty text or empty keywords', () => {
    expect(matchesKeyword('', ['link'], 'contains')).toBeNull();
    expect(matchesKeyword('link', ['', '  '], 'contains')).toBeNull();
  });
});

describe('pickRule', () => {
  it('only answers the sources a rule is set for, and only when active', () => {
    expect(pickRule([rule({ triggers: ['dm'] })], { source: 'comment', text: 'link' })).toBeNull();
    expect(pickRule([rule({ is_active: false })], { source: 'dm', text: 'link' })).toBeNull();
    expect(pickRule([rule()], { source: 'dm', text: 'link' })?.rule.id).toBe(1);
  });
  it('prefers exact over starts_with over contains', () => {
    const rules = [rule({ id: 1, match_type: 'contains' }), rule({ id: 2, match_type: 'exact' }), rule({ id: 3, match_type: 'starts_with' })];
    expect(pickRule(rules, { source: 'dm', text: 'link' })?.rule.id).toBe(2);
    expect(pickRule(rules, { source: 'dm', text: 'link now' })?.rule.id).toBe(3);
    expect(pickRule(rules, { source: 'dm', text: 'send link' })?.rule.id).toBe(1);
  });
  it('breaks ties by longer keyword, then older rule', () => {
    const rules = [rule({ id: 5, keywords: ['link'] }), rule({ id: 6, keywords: ['free link'] })];
    expect(pickRule(rules, { source: 'dm', text: 'free link' })?.rule.id).toBe(6);
    expect(pickRule([rule({ id: 9 }), rule({ id: 4 })], { source: 'dm', text: 'link' })?.rule.id).toBe(4);
  });
  it('restricts post-specific rules to comments on that post', () => {
    const r = rule({ media_id: '1789000001' });
    expect(pickRule([r], { source: 'comment', text: 'link', mediaId: '1789000001' })).not.toBeNull();
    expect(pickRule([r], { source: 'comment', text: 'link', mediaId: '999' })).toBeNull();
    expect(pickRule([r], { source: 'dm', text: 'link' })).toBeNull();
  });
});

describe('renderMessage', () => {
  it('replaces {{link}} and {{username}}', () => {
    const r = rule({ reply_text: 'Hi {{username}}, here: {{link}}' });
    expect(renderMessage(r, { username: 'asha' })).toBe('Hi @asha, here: https://changtechs.com/');
    expect(renderMessage(r, {})).toBe('Hi there, here: https://changtechs.com/');
  });
  it('appends the link on its own line when the template has no placeholder', () => {
    expect(renderMessage(rule({ reply_text: 'Thanks for asking!' }))).toBe('Thanks for asking!\nhttps://changtechs.com/');
  });
  it('adds the automation note when asked', () => {
    expect(renderMessage(rule({ disclose_automation: true }))).toMatch(/\(Automated reply\)$/);
  });
  it('drops {{link}} when there is no URL', () => {
    expect(renderMessage(rule({ link_url: '', reply_text: 'Hello {{link}}' }))).toBe('Hello');
  });
});

describe('validateRule', () => {
  const good = { keywords: 'link, Link please', triggers: ['comment', 'dm'], reply_text: 'Here {{link}}', link_url: 'https://changtechs.com/' };
  it('accepts a good rule and cleans it up', () => {
    const { errors, value } = validateRule(good);
    expect(errors).toEqual([]);
    expect(value.keywords).toEqual(['link', 'Link please']);
    expect(value.match_type).toBe('contains');
    expect(value.cooldown_hours).toBe(24);
    expect(value.name).toBe('Reply to "link"');
  });
  it('reports every problem', () => {
    const { errors } = validateRule({ keywords: [], triggers: [], reply_text: '', link_url: 'not a url', cooldown_hours: 9999 });
    expect(errors.join(' ')).toMatch(/keyword/);
    expect(errors.join(' ')).toMatch(/trigger/);
    expect(errors.join(' ')).toMatch(/link must be a full URL/);
    expect(errors.join(' ')).toMatch(/Cooldown/);
  });
  it('requires a chosen reel/post for a specific rule', () => {
    const { errors } = validateRule({ ...good, scope: 'specific', triggers: ['comment'] });
    expect(errors.join(' ')).toMatch(/Choose which reel or post/);
    const ok = validateRule({ ...good, scope: 'specific', triggers: ['comment'], media_id: '17900000000000001', media_label: 'Reel: IPO basics', media_permalink: 'https://www.instagram.com/reel/abc/' });
    expect(ok.errors).toEqual([]);
    expect(ok.value).toMatchObject({ scope: 'specific', media_id: '17900000000000001', media_label: 'Reel: IPO basics', media_permalink: 'https://www.instagram.com/reel/abc/' });
  });
  it('treats an old rule that only has a media_id as specific', () => {
    expect(validateRule({ ...good, triggers: ['comment'], media_id: '17900000000000001' }).value.scope).toBe('specific');
  });
  it('clears the post fields when the scope is not specific', () => {
    const { value } = validateRule({ ...good, scope: 'reels', triggers: ['comment'], media_id: '17900000000000001', media_label: 'x' });
    expect(value).toMatchObject({ scope: 'reels', media_id: null, media_label: null, media_permalink: null });
  });
  it('drops DMs from reel/post rules and explains when nothing is left', () => {
    expect(validateRule({ ...good, scope: 'posts', triggers: ['comment', 'dm'] }).value.triggers).toEqual(['comment']);
    expect(validateRule({ ...good, scope: 'reels', triggers: ['dm'] }).errors.join(' ')).toMatch(/only work on comments/);
  });
  it('rejects a message over the byte limit (Tamil is 3 bytes per character)', () => {
    const { errors } = validateRule({ ...good, reply_text: 'ல'.repeat(400) });
    expect(errors.join(' ')).toMatch(/byte limit/);
    expect(byteLength('ல')).toBe(3);
  });
  it('ignores a public comment reply when comments are not a trigger', () => {
    const { value } = validateRule({ ...good, triggers: ['dm'], comment_reply_text: 'Check DMs' });
    expect(value.comment_reply_text).toBeNull();
  });
});

describe('scopes', () => {
  const comment = (over = {}) => ({ source: 'comment', text: 'link', mediaId: '111', mediaProductType: 'REELS', ...over });

  it('all-reels rules answer reel comments only', () => {
    const r = rule({ scope: 'reels', triggers: ['comment'] });
    expect(scopeApplies(r, comment())).toBe(true);
    expect(scopeApplies(r, comment({ mediaProductType: 'FEED' }))).toBe(false);
    expect(scopeApplies(r, { source: 'dm', text: 'link' })).toBe(false);
  });
  it('all-posts rules answer feed-post comments only', () => {
    const r = rule({ scope: 'posts', triggers: ['comment'] });
    expect(scopeApplies(r, comment({ mediaProductType: 'FEED' }))).toBe(true);
    expect(scopeApplies(r, comment())).toBe(false);
  });
  it('a specific rule answers only that reel or post', () => {
    const r = rule({ scope: 'specific', media_id: '111', triggers: ['comment'] });
    expect(scopeApplies(r, comment())).toBe(true);
    expect(scopeApplies(r, comment({ mediaId: '222' }))).toBe(false);
  });
  it('prefers the most specific rule: one reel, then all reels, then everything', () => {
    const everything = rule({ id: 1, reply_text: 'general' });
    const allReels = rule({ id: 2, scope: 'reels', triggers: ['comment'], reply_text: 'reels' });
    const oneReel = rule({ id: 3, scope: 'specific', media_id: '111', triggers: ['comment'], reply_text: 'this reel' });
    const rules = [everything, allReels, oneReel];
    expect(pickRule(rules, comment())?.rule.id).toBe(3);
    expect(pickRule(rules, comment({ mediaId: '999' }))?.rule.id).toBe(2);
    expect(pickRule(rules, comment({ mediaId: '999', mediaProductType: 'FEED' }))?.rule.id).toBe(1);
    expect(pickRule(rules, { source: 'dm', text: 'link' })?.rule.id).toBe(1);
  });
  it('scope beats match strictness: a "contains" rule for this reel wins over an "exact" account-wide rule', () => {
    const exactAll = rule({ id: 1, match_type: 'exact' });
    const containsReel = rule({ id: 2, scope: 'specific', media_id: '111', triggers: ['comment'], match_type: 'contains' });
    expect(pickRule([exactAll, containsReel], comment())?.rule.id).toBe(2);
  });
});

describe('describeMedia', () => {
  it('labels reels and posts and trims captions', () => {
    const reel = describeMedia({ id: 1, media_product_type: 'REELS', media_type: 'VIDEO', caption: '  Hello\n\nworld  ', thumbnail_url: 'https://t/x.jpg', permalink: 'https://p' });
    expect(reel).toMatchObject({ id: '1', type: 'reel', caption: 'Hello world', thumbnail_url: 'https://t/x.jpg' });
    const post = describeMedia({ id: 2, media_product_type: 'FEED', media_type: 'IMAGE', media_url: 'https://m/y.jpg' });
    expect(post).toMatchObject({ type: 'post', thumbnail_url: 'https://m/y.jpg', caption: '' });
    expect(describeMedia({ id: 3, media_product_type: 'STORY' }).type).toBe('story');
  });
  it('does not use a video file as a thumbnail', () => {
    expect(describeMedia({ id: 4, media_product_type: 'FEED', media_type: 'VIDEO', media_url: 'https://m/v.mp4' }).thumbnail_url).toBeNull();
  });
});

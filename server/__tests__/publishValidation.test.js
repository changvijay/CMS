import { describe, it, expect } from 'vitest';
import { countHashtags, countMentions, validateAutoReply, validateTarget } from '../services/publishValidation.js';
import { safeReturnPath, withParams } from '../utils/oauth.js';
import { canUpload } from '../services/googleAuth.js';

const now = Date.parse('2026-11-03T10:00:00Z');
const img = { url: 'https://cdn/a.jpg', mime: 'image/jpeg' };
const vid = { url: 'https://cdn/a.mp4', mime: 'video/mp4' };

describe('validateTarget', () => {
  it('counts hashtags and mentions', () => {
    expect(countHashtags('#a #b c#d #ஐபிஓ')).toBe(4);
    expect(countMentions('hi @asha and @bob.k, mail x@y.com')).toBe(2);
  });

  it('enforces Instagram limits', () => {
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ');
    expect(validateTarget({ platform: 'instagram', postType: 'image', fields: { caption: tags, media: [img] } })).toContain('Instagram: at most 30 hashtags.');
    expect(validateTarget({ platform: 'instagram', postType: 'reel', fields: { media: [img] } })).toContain('Instagram: a reel needs exactly one video.');
    expect(validateTarget({ platform: 'instagram', postType: 'image', fields: { media: [{ url: 'blob:local', mime: 'image/png' }] } })[0]).toMatch(/uploaded first/);
  });

  it('checks schedule times', () => {
    expect(validateTarget({ platform: 'linkedin', postType: 'none', fields: { commentary: 'x' } }, '2026-11-03T09:00:00Z', now)).toContain('The schedule time must be in the future.');
    expect(validateTarget({ platform: 'facebook', postType: 'text', fields: { message: 'x' } }, '2026-11-03T10:05:00Z', now)).toContain('Facebook: scheduled posts must be 10 minutes to 30 days ahead.');
    // Stories are held by our queue, so the Facebook window does not apply.
    expect(validateTarget({ platform: 'facebook', postType: 'story', fields: { media: [img] } }, '2026-11-03T10:05:00Z', now)).toEqual([]);
  });

  it('requires the YouTube made-for-kids answer and rejects angle brackets', () => {
    const errs = validateTarget({ platform: 'youtube', postType: 'video', fields: { title: 'a <b>', media: [vid] } });
    expect(errs).toContain('YouTube: titles and descriptions cannot contain < or >.');
    expect(errs).toContain('YouTube: say whether the video is made for kids (required by law).');
    expect(validateTarget({ platform: 'youtube', postType: 'video', fields: { title: 'ok', made_for_kids: false, media: [vid] } })).toEqual([]);
  });

  it('checks YouTube Shorts are vertical and 3 minutes or less', () => {
    const fields = (m) => ({ title: 'ok', made_for_kids: false, media: [{ ...vid, ...m }] });
    expect(validateTarget({ platform: 'youtube', postType: 'short', fields: fields({ width: 1080, height: 1920, duration: 60 }) })).toEqual([]);
    expect(validateTarget({ platform: 'youtube', postType: 'short', fields: fields({ width: 1920, height: 1080, duration: 60 }) })).toContain('YouTube: a Short must be vertical or square.');
    expect(validateTarget({ platform: 'youtube', postType: 'short', fields: fields({ width: 1080, height: 1920, duration: 240 }) })).toContain('YouTube: a Short must be 3 minutes or less.');
    expect(validateTarget({ platform: 'youtube', postType: 'live', fields: fields({}) })).toEqual(['YouTube: unknown post type "live".']);
  });

  it('needs a title for LinkedIn documents', () => {
    expect(validateTarget({ platform: 'linkedin', postType: 'document', fields: { media: [{ url: 'https://cdn/a.pdf', mime: 'application/pdf' }] } })).toContain('LinkedIn: a document post needs a title.');
  });
});

describe('validateAutoReply', () => {
  it('allows "any comment" without keywords', () => {
    const { errors, value } = validateAutoReply({ trigger: 'any', public_replies: ['Thanks {username}!'], send_dm: false });
    expect(errors).toEqual([]);
    expect(value).toMatchObject({ match_type: 'any', keywords: [], send_dm: false, comment_reply_text: 'Thanks {username}!' });
  });

  it('needs keywords for keyword triggers and https buttons', () => {
    const { errors } = validateAutoReply({ trigger: 'keywords', keywords: [], dm_text: 'x', dm_buttons: [{ title: 'Open', url: 'http://x' }] });
    expect(errors.join(' ')).toMatch(/at least one keyword/);
    expect(errors.join(' ')).toMatch(/https/);
  });
});

describe('oauth helpers', () => {
  it('only returns to same-site paths', () => {
    expect(safeReturnPath('/publish?step=2')).toBe('/publish?step=2');
    expect(safeReturnPath('//evil.com')).toBe('/accounts');
    expect(safeReturnPath('https://evil.com')).toBe('/accounts');
    expect(withParams('/publish?step=2', { facebook: 'connected' })).toBe('/publish?step=2&facebook=connected');
  });

  it('knows which YouTube scopes can upload', () => {
    expect(canUpload(null)).toBeNull();
    expect(canUpload('https://www.googleapis.com/auth/youtube.readonly')).toBe(false);
    expect(canUpload('https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload')).toBe(true);
  });
});

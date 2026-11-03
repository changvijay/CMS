import { describe, it, expect } from 'vitest';
import { allTags, buildFields, deriveShared, emptyDraft, fieldState, fitYoutubeTags, resetField, setField, trimTo, youtubeTagCost } from './mapping';
import { checkMedia, isShortsCandidate } from './mediaRules';
import { validateAutoReply, validateDraft, validateSchedule } from './validate';
import type { MediaItem, SharedFields } from './types';

const img = (id = 'a', extra: Partial<MediaItem> = {}): MediaItem => ({ id, name: `${id}.jpg`, mime: 'image/jpeg', kind: 'image', bytes: 1000, width: 1080, height: 1350, status: 'ready', url: `https://cdn/${id}.jpg`, ...extra });
const vid = (id = 'v', extra: Partial<MediaItem> = {}): MediaItem => ({ id, name: `${id}.mp4`, mime: 'video/mp4', kind: 'video', bytes: 5_000_000, width: 1080, height: 1920, duration: 30, status: 'ready', url: `https://cdn/${id}.mp4`, ...extra });

const shared = (over: Partial<SharedFields> = {}): SharedFields => ({
  title: 'Tata IPO explained', description: 'What it means for you.', hashtags: ['#ipo', 'tata'], keywords: ['stock market', 'IPO'],
  media: [img()], thumbnail: null, link: 'https://changtechs.com/ipo', location: { id: '123', name: 'Chennai' }, scheduleAt: '', ...over,
});

describe('reuse mapping', () => {
  it('composes captions from title, description and de-duplicated hashtags', () => {
    expect(allTags(shared())).toEqual(['#ipo', '#tata', '#stockmarket']);
    expect(deriveShared('instagram', 'caption', shared()).value).toBe('Tata IPO explained\n\nWhat it means for you.\n\n#ipo #tata #stockmarket');
    expect(deriveShared('youtube', 'tags', shared()).value).toEqual(['ipo', 'tata', 'stockmarket']);
    expect(deriveShared('youtube', 'description', shared()).value).toContain('https://changtechs.com/ipo');
    expect(deriveShared('linkedin', 'article_url', shared()).value).toBe('https://changtechs.com/ipo');
  });

  it('trims to the platform limit and says so', () => {
    const long = shared({ title: 'x'.repeat(150) });
    const d = deriveShared('youtube', 'title', long);
    expect([...(d.value as string)]).toHaveLength(100);
    expect(d.warning).toMatch(/100-character/);
    expect(trimTo('hello brave new world', 13)).toEqual({ value: 'hello brave', trimmed: true });
  });

  it('keeps only 30 hashtags on Instagram', () => {
    const many = shared({ hashtags: Array.from({ length: 35 }, (_, i) => `t${i}`), keywords: [] });
    const d = deriveShared('instagram', 'caption', many);
    expect((d.value as string).match(/#/g)).toHaveLength(30);
    expect(d.warning).toMatch(/first 30/);
  });

  it('unlinks one platform when edited there, and resets to shared', () => {
    let ig = emptyDraft('instagram');
    expect(fieldState('instagram', ig, shared(), 'caption').synced).toBe(true);
    ig = setField('instagram', ig, 'caption', 'My own caption');
    expect(fieldState('instagram', ig, shared(), 'caption')).toMatchObject({ value: 'My own caption', synced: false, syncable: true });
    // Facebook still follows the shared fields.
    expect(fieldState('facebook', emptyDraft('facebook'), shared(), 'message').synced).toBe(true);
    ig = resetField(ig, 'caption');
    expect(fieldState('instagram', ig, shared(), 'caption').synced).toBe(true);
  });

  it('builds the per-platform payload with only the media the type takes', () => {
    const s = shared({ media: [img('a'), vid('b')] });
    const ig = { ...emptyDraft('instagram'), perMedia: { a: { alt_text: 'Chart', user_tags: [{ username: 'asha', x: 0.2, y: 0.3 }] } } };
    const f = buildFields('instagram', ig, s);
    expect(f.media).toEqual([{ url: 'https://cdn/a.jpg', mime: 'image/jpeg', kind: 'image', bytes: 1000, alt_text: 'Chart', user_tags: [{ username: 'asha', x: 0.2, y: 0.3 }] }]);
    expect(f.location_id).toBe('123');
    const yt = buildFields('youtube', emptyDraft('youtube'), s);
    expect((yt.media as { url: string }[]).map((m) => m.url)).toEqual(['https://cdn/b.mp4']);
  });

  it('counts YouTube tags like YouTube', () => {
    expect(youtubeTagCost(['a b', 'c'])).toBe(5 + 1 + 1);
    expect(youtubeTagCost(fitYoutubeTags(Array.from({ length: 200 }, (_, i) => `tag${i}`)))).toBeLessThanOrEqual(500);
  });
});

describe('media rules', () => {
  it('rejects PNGs and wide images for Instagram feed posts', () => {
    const issues = checkMedia('instagram', 'image', [img('p', { mime: 'image/png', width: 2000, height: 500 })]);
    expect(issues.map((i) => i.level)).toEqual(['error', 'error']);
  });

  it('checks reel duration', () => {
    expect(checkMedia('instagram', 'reel', [vid('v', { duration: 2 })])[0].message).toMatch(/shorter than 3 s/);
    expect(checkMedia('instagram', 'reel', [vid('v', { duration: 30 })])).toEqual([]);
  });

  it('flags files still uploading', () => {
    expect(checkMedia('linkedin', 'image', [img('u', { status: 'uploading' })])[0].message).toMatch(/still uploading/);
  });

  it('spots Shorts', () => {
    expect(isShortsCandidate(vid('v', { duration: 120 }))).toBe(true);
    expect(isShortsCandidate(vid('v', { duration: 240 }))).toBe(false);
    expect(isShortsCandidate(vid('v', { width: 1920, height: 1080 }))).toBe(false);
  });
});

describe('validation', () => {
  it('requires the made-for-kids answer on YouTube', () => {
    const issues = validateDraft('youtube', emptyDraft('youtube'), shared({ media: [vid()] }));
    expect(issues.some((i) => /made for kids/.test(i.message))).toBe(true);
  });

  it('checks LinkedIn polls', () => {
    const d = setField('linkedin', { ...emptyDraft('linkedin'), postType: 'poll' }, 'poll', { question: 'Q', options: ['one', ''], duration: 'ONE_DAY' });
    expect(validateDraft('linkedin', d, shared()).some((i) => /2 to 4 options/.test(i.message))).toBe(true);
  });

  it('enforces the Facebook schedule window', () => {
    const now = new Date('2026-11-03T10:00:00').getTime();
    expect(validateSchedule('2026-11-03T10:05', [{ platform: 'facebook', postType: 'photo' }], now)[0].message).toMatch(/10 minutes/);
    expect(validateSchedule('2026-11-03T10:05', [{ platform: 'instagram', postType: 'image' }], now)).toEqual([]);
    expect(validateSchedule('2026-11-03T09:00', [{ platform: 'instagram', postType: 'image' }], now)[0].message).toMatch(/future/);
  });

  it('validates auto-reply settings', () => {
    const base = { enabled: true, trigger: 'keywords' as const, keywords: [], public_replies: [''], send_dm: true, dm_text: '', link_url: '', dm_buttons: [], quick_replies: [], require_follow: false, active_from: '', active_until: '', disclose_automation: true };
    const msgs = validateAutoReply(base).map((i) => i.message).join(' ');
    expect(msgs).toMatch(/keyword/);
    expect(msgs).toMatch(/DM text/);
    expect(validateAutoReply({ ...base, trigger: 'any', send_dm: false, public_replies: ['Thanks!'] })).toEqual([]);
  });
});

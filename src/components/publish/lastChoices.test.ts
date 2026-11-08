import { beforeEach, describe, expect, it } from 'vitest';
import { applyLastChoices, nextAt, readLastChoices, rememberChoices } from './lastChoices';
import { defaultAutoReply } from './helpers';
import type { WizardState } from './types';

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const blank = (): WizardState => ({
  step: 'platforms', platforms: [], accounts: {}, drafts: {}, autoReply: defaultAutoReply(),
  shared: { title: '', description: '', hashtags: [], keywords: [], media: [], thumbnail: null, link: '', location: null, scheduleAt: '' },
});

describe('last choices', () => {
  beforeEach(() => store.clear());

  it('starts a new post with the last platforms, accounts and settings, but no content', () => {
    rememberChoices({
      ...blank(),
      platforms: ['instagram', 'youtube'],
      accounts: { instagram: ['ig1'], youtube: ['yt1'] },
      drafts: {
        instagram: { postType: 'reel', values: { trial: true, caption: 'old caption', audio_name: 'x' }, unlinked: ['caption'], perMedia: {} },
        youtube: { postType: 'short', values: { made_for_kids: false, privacy: 'unlisted' }, unlinked: [], perMedia: {} },
      },
      shared: { ...blank().shared, title: 'Old title', scheduleAt: '2026-11-01T19:30' },
    });
    const next = applyLastChoices(blank());
    expect(next.platforms).toEqual(['instagram', 'youtube']);
    expect(next.accounts).toEqual({ instagram: ['ig1'], youtube: ['yt1'] });
    expect(next.drafts.instagram).toMatchObject({ postType: 'reel', values: { trial: true }, unlinked: [] });
    expect(next.drafts.instagram?.values).not.toHaveProperty('caption');
    expect(next.drafts.youtube).toMatchObject({ postType: 'short', values: { made_for_kids: false, privacy: 'unlisted' } });
    expect(next.shared.title).toBe('');
    expect(next.shared.scheduleAt.slice(11)).toBe('19:30');
  });

  it('keeps settings of platforms not used this time', () => {
    rememberChoices({ ...blank(), platforms: ['youtube'], drafts: { youtube: { postType: 'short', values: {}, unlinked: [], perMedia: {} } } });
    rememberChoices({ ...blank(), platforms: ['instagram'], drafts: { instagram: { postType: 'reel', values: {}, unlinked: [], perMedia: {} } } });
    expect(readLastChoices()?.drafts.youtube?.postType).toBe('short');
    expect(readLastChoices()?.platforms).toEqual(['instagram']);
  });

  it('does nothing when nothing was published yet', () => {
    expect(applyLastChoices(blank())).toEqual(blank());
  });

  it('moves the schedule to the next time that clock time comes round', () => {
    const now = new Date(2026, 10, 8, 18, 0);
    expect(nextAt('19:30', now)).toBe('2026-11-08T19:30');
    expect(nextAt('18:05', now)).toBe('2026-11-09T18:05');
    expect(nextAt('bad', now)).toBe('');
  });
});

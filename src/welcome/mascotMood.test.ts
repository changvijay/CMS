import { describe, expect, it } from 'vitest';
import { CLICK_MS, LINES, SLEEP_MS, SURPRISE_MS, isShake, lineFor, pickMood, sectionFromId, type MoodState } from './mascotMood';

const base = (over: Partial<MoodState> = {}): MoodState => ({
  now: 100_000,
  clickedAt: -Infinity,
  lastActivity: 100_000,
  wokeAt: -Infinity,
  overMascot: false,
  overCta: false,
  fastPointer: false,
  dizzy: false,
  section: 'hero',
  ...over,
});

describe('pickMood', () => {
  it('is happy by default', () => {
    expect(pickMood(base())).toBe('happy');
  });

  it('follows the section', () => {
    expect(pickMood(base({ section: 'results' }))).toBe('wow');
    expect(pickMood(base({ section: 'pricing' }))).toBe('love');
    expect(pickMood(base({ section: 'faq' }))).toBe('thinking');
    expect(pickMood(base({ section: 'features' }))).toBe('happy');
  });

  it('puts a click first, then hovering the mascot, then a button', () => {
    const all = base({ clickedAt: 99_000, overMascot: true, overCta: true, fastPointer: true, section: 'pricing' });
    expect(pickMood(all)).toBe('clicked');
    expect(pickMood({ ...all, clickedAt: 100_000 - CLICK_MS })).toBe('shy');
    expect(pickMood({ ...all, clickedAt: -Infinity, overMascot: false })).toBe('excited');
  });

  it('falls asleep after a quiet spell, and a button still wakes the face', () => {
    expect(pickMood(base({ lastActivity: 100_000 - SLEEP_MS + 1 }))).toBe('happy');
    expect(pickMood(base({ lastActivity: 100_000 - SLEEP_MS }))).toBe('sleepy');
    expect(pickMood(base({ lastActivity: 0, overCta: true }))).toBe('excited');
  });

  it('looks surprised just after waking, then carries on', () => {
    expect(pickMood(base({ wokeAt: 100_000 - 100 }))).toBe('surprised');
    expect(pickMood(base({ wokeAt: 100_000 - SURPRISE_MS }))).toBe('happy');
  });

  it('gets playful when chasing a fast pointer', () => {
    expect(pickMood(base({ fastPointer: true, section: 'results' }))).toBe('playful');
  });

  it('is dizzy after a flip, above everything but a click', () => {
    expect(pickMood(base({ dizzy: true, overMascot: true, overCta: true }))).toBe('dizzy');
    expect(pickMood(base({ dizzy: true, clickedAt: 99_500 }))).toBe('clicked');
  });
});

describe('isShake', () => {
  it('needs four direction changes inside the window', () => {
    expect(isShake([100, 300, 500], 600)).toBe(false);
    expect(isShake([100, 300, 500, 700], 800)).toBe(true);
    expect(isShake([100, 300, 500, 700], 1100)).toBe(false); // the first turn is too old
  });
});

describe('lineFor', () => {
  it('cycles through the section lines', () => {
    const n = LINES.pricing.length;
    expect(lineFor('pricing', 0).text).toBe(LINES.pricing[0]);
    expect(lineFor('pricing', n).text).toBe(LINES.pricing[0]);
    expect(lineFor('pricing', n + 1).text).toBe(LINES.pricing[1]);
  });

  it('offers the waiting list every third click', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => lineFor('hero', i).showCta)).toEqual([false, false, true, false, false, true]);
  });

  it('never uses hyphens in a line', () => {
    for (const lines of Object.values(LINES)) for (const l of lines) expect(l).not.toMatch(/ - |\w-\w/);
  });
});

describe('sectionFromId', () => {
  it('maps known ids and falls back to other', () => {
    expect(sectionFromId('pricing')).toBe('pricing');
    expect(sectionFromId('compare')).toBe('pricing');
    expect(sectionFromId('main')).toBe('other');
  });
});

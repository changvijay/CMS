import { describe, it, expect } from 'vitest';
import { parseVideoReport, preUploadPrompt, publishedReportPrompt } from '../services/scripts/aiPrompts.js';
import { median } from '../services/videoAnalysis.js';

describe('video report parsing', () => {
  it('reads JSON inside code fences, clamps scores and caps lists', () => {
    const raw = '```json\n' + JSON.stringify({
      score: 140, verdict: 'Strong hook', worked: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], hook: { score: -5, notes: 'fast' },
      action_steps: { views: ['x'] }, first_seconds: { hook: 'question', pacing: 'quick' },
    }) + '\n```';
    const r = parseVideoReport(raw);
    expect(r.parsed).toBe(true);
    expect(r.score).toBe(100);
    expect(r.hook.score).toBe(0);
    expect(r.worked).toHaveLength(5);
    expect(r.action_steps).toEqual({ views: ['x'], reach: [], engagement: [], growth: [] });
    expect(r.first_seconds.hook).toBe('question');
  });

  it('keeps corrections with what is wrong, the fix and a sample', () => {
    const r = parseVideoReport(JSON.stringify({
      score: 32,
      corrections: [
        { area: 'Hook', wrong: 'Opens with "Hi guys"', why: 'Skip rate 61%', fix: 'Lead with the result', example: 'This IPO doubled in 3 days. Here is why.' },
        { area: 'caption' },
        'not an object',
      ],
    }));
    expect(r.corrections).toEqual([{ area: 'hook', wrong: 'Opens with "Hi guys"', why: 'Skip rate 61%', fix: 'Lead with the result', example: 'This IPO doubled in 3 days. Here is why.' }]);
  });

  it('asks for corrections with an example, more of them when the score is low', () => {
    const p = publishedReportPrompt(null);
    expect(p).toMatch(/CORRECTIONS ARE REQUIRED/);
    expect(p).toMatch(/below 60, give at least 3 corrections/);
    expect(p).toMatch(/Never give a correction without an example/);
  });

  it('keeps a non-JSON answer as the verdict instead of failing', () => {
    const r = parseVideoReport('Sorry, I could not analyse this.');
    expect(r).toMatchObject({ parsed: false, score: null, verdict: 'Sorry, I could not analyse this.' });
  });

  it('prompts forbid invented numbers and view guarantees', () => {
    for (const p of [publishedReportPrompt(null), preUploadPrompt(null, { watchesVideo: false })]) {
      expect(p).toMatch(/Never invent/);
      expect(p).toMatch(/Never promise views/);
    }
    expect(preUploadPrompt(null, { watchesVideo: false })).toMatch(/cannot hear audio/);
    expect(preUploadPrompt(null, { watchesVideo: true })).toMatch(/hear the audio/);
  });

  it('median ignores missing values', () => {
    expect(median([3, null, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([null])).toBeNull();
  });
});

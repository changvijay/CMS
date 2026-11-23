import { describe, it, expect } from 'vitest';
import { normaliseDate, validateFolder, validateScript, validateGoal, validateTodo, validateCategory, validateNiche, mergeFields } from '../services/scripts/validation.js';
import { goalLinkChanges } from '../services/scripts/goalProgress.js';
import { parseDailyIdea, nicheContext, ideaToNotes, actionSystemPrompt, SYSTEM_PROMPTS } from '../services/scripts/aiPrompts.js';
import { seal, open, resolveKey } from '../utils/secretBox.js';

describe('scripts validation', () => {
  it('accepts real dates only', () => {
    expect(normaliseDate('2026-02-28')).toBe('2026-02-28');
    expect(normaliseDate('2026-02-30')).toBeUndefined();
    expect(normaliseDate('')).toBeNull();
    expect(normaliseDate('tomorrow')).toBeUndefined();
  });

  it('needs a title and a known status', () => {
    expect(validateScript({ title: ' ' }).errors).toContain('Title is required.');
    expect(validateScript({ title: 'x', status: 'done' }).errors[0]).toMatch(/Status/);
    const { errors, value } = validateScript({ title: ' Reel ', category_ids: ['3', 3, '4'] });
    expect(errors).toEqual([]);
    expect(value).toMatchObject({ title: 'Reel', status: 'not_started', deadline: null, goal_id: null, category_ids: ['3', '4'] });
  });

  it('marks a goal complete when progress reaches the target, and an empty target becomes 1', () => {
    expect(validateGoal({ title: 'g', target_value: 3, current_progress: 3 }).value.completed).toBe(true);
    expect(validateGoal({ title: 'g', target_value: '', current_progress: 0 }).value).toMatchObject({ target_value: 1, completed: false });
    expect(validateGoal({ title: 'g', target_value: 0 }).errors.length).toBe(1);
  });

  it('checks to-dos, categories and niches', () => {
    expect(validateTodo({ text: 'Film', priority: 'urgent' }).errors[0]).toMatch(/Priority/);
    expect(validateTodo({ text: 'Film' }).value.priority).toBe('medium');
    expect(validateCategory({ name: 'Tech', color: '#3b82f6' }).value.color).toBe('#3B82F6');
    expect(validateCategory({ name: 'Tech', color: 'blue' }).errors.length).toBe(1);
    expect(validateNiche({ title: 'Finance' }).value).toMatchObject({ language: 'English', description: expect.stringContaining('Finance') });
  });

  it('checks folders and a script folder id', () => {
    expect(validateFolder({ name: ' Movie 1 ', color: '#6366f1' }).value).toEqual({ name: 'Movie 1', color: '#6366F1', description: '' });
    expect(validateFolder({ name: '' }).errors[0]).toMatch(/name/);
    expect(validateFolder({ name: 'x', color: '#123456' }).errors[0]).toMatch(/colour/);
    expect(validateScript({ title: 't', folder_id: 7 }).value.folder_id).toBe('7');
    expect(validateScript({ title: 't', folder_id: 'abc' }).errors).toContain('Folder is not valid.');
  });

  it('PATCH only copies allowed fields that were sent', () => {
    expect(mergeFields({ title: 'a', notes: 'n' }, { title: 'b', user_id: 9 }, ['title', 'notes'])).toEqual({ title: 'b', notes: 'n' });
  });
});

describe('goal link changes', () => {
  it('moves one count from the old goal to the new one', () => {
    expect(goalLinkChanges(null, '5')).toEqual([['5', 1]]);
    expect(goalLinkChanges('4', '5')).toEqual([['4', -1], ['5', 1]]);
    expect(goalLinkChanges('4', null)).toEqual([['4', -1]]);
    expect(goalLinkChanges(4, '4')).toEqual([]);
  });
});

describe('AI prompts', () => {
  const niche = { title: 'Tamil Tech', language: 'Tamil', description: 'Gadgets for students' };

  it('adds the niche rules to an action prompt', () => {
    const p = actionSystemPrompt('grammar', niche);
    expect(p.startsWith(SYSTEM_PROMPTS.grammar)).toBe(true);
    expect(p).toContain('Target Audience Language: "Tamil"');
    expect(nicheContext(null)).toBe('');
  });

  it('parses JSON even with text around it', () => {
    const idea = parseDailyIdea('Sure!\n{"title":"T","description":"D","captions":["a","b"],"hook_mechanism":"curiosity gap"}\nBye', 'N', 'Tamil');
    expect(idea).toMatchObject({ title: 'T', description: 'D', captions: ['a', 'b'], niche: 'N', language: 'Tamil', hook_mechanism: 'curiosity gap' });
  });

  it('falls back to title:/description:/captions: lines', () => {
    const idea = parseDailyIdea('title: Big news\ndescription: Why it matters\nmore detail\ncaptions:\n- first\n- second', 'N');
    expect(idea.title).toBe('Big news');
    expect(idea.description).toContain('more detail');
    expect(idea.captions).toEqual(['first', 'second']);
  });

  it('builds the notes for an accepted idea', () => {
    const notes = ideaToNotes({ title: 'T', niche: 'N', language: 'Tamil', description: 'D', captions: ['c1'] }, '2026-11-19');
    expect(notes).toContain('# T');
    expect(notes).toContain('**Generated:** 2026-11-19');
    expect(notes).toContain('- c1');
  });
});

describe('secretBox', () => {
  const key = resolveKey({ SCRIPTS_SECRET_KEY: Buffer.alloc(32, 7).toString('base64') });

  it('round-trips and rejects tampering', () => {
    const box = seal('sk-secret-1234', key);
    expect(box.ciphertext).not.toContain('secret');
    expect(open(box, key)).toBe('sk-secret-1234');
    const flipped = Buffer.from(box.ciphertext, 'base64');
    flipped[0] ^= 1;
    expect(() => open({ ...box, ciphertext: flipped.toString('base64') }, key)).toThrow();
  });

  it('derives a key from JWT_SECRET and rejects a wrong-size key', () => {
    expect(resolveKey({ JWT_SECRET: 'x' }).length).toBe(32);
    expect(() => resolveKey({ SCRIPTS_SECRET_KEY: 'c2hvcnQ=' })).toThrow(/32 bytes/);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { createProviders } from '../services/scripts/aiProviders.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

describe('AI providers', () => {
  it('Claude: system prompt, version header, text blocks joined', async () => {
    const fetch = vi.fn(async () => ok({ content: [{ type: 'text', text: ' Hello ' }, { type: 'text', text: 'world' }] }));
    const out = await createProviders(fetch).claude.generate('k', 'claude-haiku-5-5', 'SYS', 'USER');
    expect(out).toBe('Hello world');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toMatchObject({ 'x-api-key': 'k', 'anthropic-version': '2023-06-01' });
    expect(JSON.parse(init.body)).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 2048, system: 'SYS', messages: [{ role: 'user', content: 'USER' }] });
  });

  it('Gemini: key in a header, not the URL', async () => {
    const fetch = vi.fn(async () => ok({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }));
    await createProviders(fetch).gemini.generate('secret', 'gemini-2.5-flash', 'SYS', 'USER');
    const [url, init] = fetch.mock.calls[0];
    expect(url).not.toContain('secret');
    expect(init.headers['x-goog-api-key']).toBe('secret');
    expect(JSON.parse(init.body).system_instruction.parts[0].text).toBe('SYS');
  });

  it('Groq / OpenRouter: OpenAI-style chat body', async () => {
    const fetch = vi.fn(async () => ok({ choices: [{ message: { content: 'done' } }] }));
    const p = createProviders(fetch);
    expect(await p.groq.generate('k', 'openai/gpt-oss-20b', 'S', 'U')).toBe('done');
    expect(await p.openrouter.generate('k', 'openai/gpt-4o', 'S', 'U')).toBe('done');
    for (const [, init] of fetch.mock.calls) expect(JSON.parse(init.body).messages).toEqual([{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }]);
  });

  it('turns provider errors and empty answers into readable errors', async () => {
    const bad = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) }));
    await expect(createProviders(bad).claude.test('k')).rejects.toThrow('Claude: invalid x-api-key');
    const empty = vi.fn(async () => ok({ choices: [] }));
    await expect(createProviders(empty).groq.generate('k', 'm', 's', 'u')).rejects.toThrow(/empty response/);
  });
});

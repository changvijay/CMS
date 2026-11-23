/**
 * AI providers for the Scripts assistant (ported from ScriptVault). Calls are made from the server with the user's own
 * key. Each provider has `test(apiKey)` and `generate(apiKey, model, systemPrompt, userContent)`.
 */
export const MAX_OUTPUT_TOKENS = 2048;
const TIMEOUT_MS = 90_000;

export const PROVIDER_META = {
  gemini: {
    key: 'gemini', name: 'Google Gemini', color: '#4285F4', defaultModel: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com/app/apikey',
    models: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }, { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }, { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }],
  },
  claude: {
    key: 'claude', name: 'Anthropic Claude', color: '#D97706', defaultModel: 'claude-haiku-5-5', keyUrl: 'https://console.anthropic.com/settings/keys',
    models: [{ id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }, { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }],
  },
  groq: {
    key: 'groq', name: 'Groq', color: '#00A67E', defaultModel: 'openai/gpt-oss-120b', keyUrl: 'https://console.groq.com/keys',
    models: [{ id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' }, { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' }, { id: 'qwen/qwen3.6-27b', label: 'Qwen 3.6 27B' }],
  },
  openrouter: {
    key: 'openrouter', name: 'OpenRouter', color: '#7C3AED', defaultModel: 'openai/gpt-4o-mini', keyUrl: 'https://openrouter.ai/keys',
    models: [{ id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' }, { id: 'openai/gpt-4o', label: 'GPT-4o' }, { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' }, { id: 'meta-llama/llama-3.3-70b-instruct', label: 'LLaMA 3.3 70B' }],
  },
};

/** The order used when no provider has been picked yet. */
export const PROVIDER_KEYS = ['gemini', 'claude', 'groq', 'openrouter'];

export const isProviderKey = (k) => PROVIDER_KEYS.includes(k);
export const isKnownModel = (provider, model) => PROVIDER_META[provider]?.models.some((m) => m.id === model) ?? false;

async function throwIfNotOk(res, name) {
  if (res.ok) return;
  let msg = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    msg = body?.error?.message ?? body?.error?.code ?? body?.message ?? msg;
  } catch { /* not JSON */ }
  throw Object.assign(new Error(`${name}: ${msg}`), { status: res.status });
}

const nonEmpty = (text, name) => {
  if (!text || !String(text).trim()) throw new Error(`${name} returned an empty response.`);
  return String(text).trim();
};

const chatBody = (model, systemPrompt, userContent) => JSON.stringify({
  model,
  max_tokens: MAX_OUTPUT_TOKENS,
  messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
});

export function createProviders(fetchImpl = globalThis.fetch) {
  const call = (url, init = {}) => fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

  return {
    gemini: {
      async test(apiKey) {
        await throwIfNotOk(await call('https://generativelanguage.googleapis.com/v1beta/models', { headers: { 'x-goog-api-key': apiKey } }), 'Gemini');
      },
      async generate(apiKey, model, systemPrompt, userContent) {
        const res = await call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userContent }] }],
            generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
          }),
        });
        await throwIfNotOk(res, 'Gemini');
        const data = await res.json();
        return nonEmpty(data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join(''), 'Gemini');
      },
    },

    claude: {
      async test(apiKey) {
        const res = await call('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: PROVIDER_META.claude.defaultModel, max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] }),
        });
        await throwIfNotOk(res, 'Claude');
      },
      async generate(apiKey, model, systemPrompt, userContent) {
        const res = await call('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: MAX_OUTPUT_TOKENS, system: systemPrompt, messages: [{ role: 'user', content: userContent }] }),
        });
        await throwIfNotOk(res, 'Claude');
        const data = await res.json();
        return nonEmpty((data?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join(''), 'Claude');
      },
    },

    groq: {
      async test(apiKey) {
        await throwIfNotOk(await call('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } }), 'Groq');
      },
      async generate(apiKey, model, systemPrompt, userContent) {
        const res = await call('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: chatBody(model, systemPrompt, userContent),
        });
        await throwIfNotOk(res, 'Groq');
        const data = await res.json();
        return nonEmpty(data?.choices?.[0]?.message?.content, 'Groq');
      },
    },

    openrouter: {
      async test(apiKey) {
        // /models is public, so check the key itself.
        await throwIfNotOk(await call('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${apiKey}` } }), 'OpenRouter');
      },
      async generate(apiKey, model, systemPrompt, userContent) {
        const res = await call('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'CMS Scripts' },
          body: chatBody(model, systemPrompt, userContent),
        });
        await throwIfNotOk(res, 'OpenRouter');
        const data = await res.json();
        return nonEmpty(data?.choices?.[0]?.message?.content, 'OpenRouter');
      },
    },
  };
}

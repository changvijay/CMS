import { pool } from '../../db.js';
import { createRateLimiter } from '../../utils/rateLimit.js';
import { open, resolveKey } from '../../utils/secretBox.js';
import { PROVIDER_KEYS, PROVIDER_META, createProviders, isKnownModel } from './aiProviders.js';
import { ACTION_META, DEFAULT_ACTION_ORDER } from './aiPrompts.js';

/**
 * The user's own AI providers, shared by every feature that calls them (the Scripts assistant, video analysis):
 * reading their settings and encrypted keys, picking the provider, and running a prompt. Keys never leave the server.
 */

const NICHE_SELECT = 'SELECT id, title, language, description, created_at FROM script_niches';

/** One limit across all AI features, per user: 30 calls per 10 minutes. */
const sharedLimiter = createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1000 });

export function createAiClient({ env = process.env, fetchImpl = globalThis.fetch, limiter = sharedLimiter } = {}) {
  const providers = createProviders(fetchImpl);

  const loadSettings = async (db, userId) => {
    const { rows } = await db.query('SELECT * FROM script_settings WHERE user_id = $1', [userId]);
    return rows[0] ?? { user_id: userId, categories_seeded: false, active_provider: null, providers: {}, action_prefs: {}, active_niche_id: null };
  };

  const loadKeys = async (userId) => {
    const { rows } = await pool.query('SELECT provider, ciphertext, iv, tag, last4 FROM script_ai_keys WHERE user_id = $1', [userId]);
    return Object.fromEntries(rows.map((r) => [r.provider, r]));
  };

  /** What the browser sees: never the key itself. */
  const describeAi = (settings, keys, niches) => {
    const providersOut = Object.fromEntries(PROVIDER_KEYS.map((k) => {
      const p = settings.providers?.[k] ?? {};
      return [k, { enabled: Boolean(p.enabled) && Boolean(keys[k]), model: isKnownModel(k, p.model) ? p.model : PROVIDER_META[k].defaultModel, configured: Boolean(keys[k]), last4: keys[k]?.last4 ?? '' }];
    }));
    const ready = PROVIDER_KEYS.filter((k) => providersOut[k].enabled);
    const active = ready.includes(settings.active_provider) ? settings.active_provider : ready[0] ?? null;
    const prefs = settings.action_prefs ?? {};
    const activeNiche = niches.find((n) => String(n.id) === String(settings.active_niche_id)) ?? niches[0] ?? null;
    return {
      providers: providersOut,
      active_provider: active,
      ready_providers: ready,
      action_prefs: {
        order: Array.isArray(prefs.order) ? prefs.order : DEFAULT_ACTION_ORDER,
        hidden: Array.isArray(prefs.hidden) ? prefs.hidden : [],
        custom_prompts: Array.isArray(prefs.custom_prompts) ? prefs.custom_prompts : [],
      },
      active_niche_id: activeNiche ? String(activeNiche.id) : null,
      catalog: { providers: PROVIDER_META, actions: ACTION_META, default_order: DEFAULT_ACTION_ORDER },
    };
  };

  const listNiches = async (userId) => (await pool.query(`${NICHE_SELECT} WHERE user_id = $1 ORDER BY id`, [userId])).rows;

  const aiState = async (userId) => {
    const [settings, keys, niches] = await Promise.all([loadSettings(pool, userId), loadKeys(userId), listNiches(userId)]);
    return { settings, keys, niches, view: describeAi(settings, keys, niches) };
  };

  /** The provider a request would use: the requested one if it is ready, else the active one. Null when none is set up. */
  const pickProvider = (view, requested) => (requested && view.ready_providers.includes(requested) ? requested : view.active_provider);

  /**
   * Picks the provider, decrypts its key and runs the prompt. `content` is text, or `{ text, images, video }` for
   * providers that can see pictures (see aiProviders.js). `options.maxTokens` lifts the answer length.
   */
  const generate = async (userId, requested, system, content, options = {}) => {
    const { keys, view } = await aiState(userId);
    const provider = pickProvider(view, requested);
    if (!provider) throw Object.assign(new Error('Set up an AI provider first (Scripts → Settings → AI providers).'), { status: 409 });
    const apiKey = open(keys[provider], resolveKey(env));
    const model = view.providers[provider].model;
    try {
      const text = await providers[provider].generate(apiKey, model, system, content, options);
      return { text, provider, model };
    } catch (err) {
      // A request we refused on purpose (e.g. pictures sent to a text-only provider) keeps its 4xx.
      if (err?.status === 422) throw Object.assign(new Error(err.message), { status: 422 });
      throw Object.assign(new Error(err?.message ?? 'The AI provider failed.'), { status: 502, expose: true });
    }
  };

  const activeNicheOf = async (userId) => {
    const { niches, view } = await aiState(userId);
    return niches.find((n) => String(n.id) === view.active_niche_id) ?? null;
  };

  /** Records one AI call for the user; false (and a 429 sent) when they are over the limit. */
  const aiAllowed = (req, res) => {
    const { allowed, retryAfterSeconds } = limiter.hit(String(req.user.userId));
    if (allowed) return true;
    res.set('Retry-After', String(retryAfterSeconds)).status(429).json({ error: `Too many AI requests. Try again in ${Math.ceil(retryAfterSeconds / 60)} min.` });
    return false;
  };

  return { providers, loadSettings, loadKeys, describeAi, listNiches, aiState, pickProvider, generate, activeNicheOf, aiAllowed };
}

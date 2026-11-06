/**
 * Small in-memory cache with per-entry expiry, a size cap and in-flight de-duplication:
 * two requests for the same key while the first is still loading share one upstream call.
 * Failed loads are never cached.
 */
export function createTtlCache({ maxEntries = 500, now = () => Date.now() } = {}) {
  const entries = new Map(); // key -> { value, expires }
  const inflight = new Map(); // key -> Promise

  function get(key) {
    const hit = entries.get(key);
    if (!hit) return undefined;
    if (hit.expires <= now()) {
      entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  function set(key, value, ttlMs) {
    if (!(ttlMs > 0)) return;
    entries.delete(key); // re-insert so the oldest entries are the ones dropped
    entries.set(key, { value, expires: now() + ttlMs });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  }

  /** The cached value, or the result of `load()` cached for `ttl` ms (`ttl` may be a function of the value). */
  async function getOrLoad(key, ttl, load) {
    const cached = get(key);
    if (cached !== undefined) return cached;
    if (inflight.has(key)) return inflight.get(key);
    const promise = (async () => {
      try {
        const value = await load();
        set(key, value, typeof ttl === 'function' ? ttl(value) : ttl);
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, promise);
    return promise;
  }

  /** Drops every entry whose key starts with `prefix` (everything when no prefix is given). */
  function invalidate(prefix = '') {
    for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key);
  }

  return { get, set, getOrLoad, invalidate, get size() { return entries.size; } };
}

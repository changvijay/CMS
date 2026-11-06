import { describe, it, expect, vi } from 'vitest';
import { createTtlCache } from '../utils/ttlCache.js';
import { createRateLimiter } from '../utils/rateLimit.js';

function clock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('createTtlCache', () => {
  it('returns a cached value until it expires', async () => {
    const c = clock();
    const cache = createTtlCache({ now: c.now });
    const load = vi.fn().mockResolvedValue('a');
    expect(await cache.getOrLoad('k', 100, load)).toBe('a');
    expect(await cache.getOrLoad('k', 100, load)).toBe('a');
    expect(load).toHaveBeenCalledTimes(1);
    c.advance(100);
    expect(await cache.getOrLoad('k', 100, load)).toBe('a');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one load between concurrent callers', async () => {
    const cache = createTtlCache();
    let resolve;
    const load = vi.fn(() => new Promise((r) => { resolve = r; }));
    const a = cache.getOrLoad('k', 1000, load);
    const b = cache.getOrLoad('k', 1000, load);
    resolve(42);
    expect(await Promise.all([a, b])).toEqual([42, 42]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures', async () => {
    const cache = createTtlCache();
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('ok');
    await expect(cache.getOrLoad('k', 1000, load)).rejects.toThrow('down');
    expect(await cache.getOrLoad('k', 1000, load)).toBe('ok');
  });

  it('takes the ttl from the value when given a function, and skips caching for ttl <= 0', async () => {
    const cache = createTtlCache();
    await cache.getOrLoad('short', (v) => v.ttl, async () => ({ ttl: 0 }));
    expect(cache.get('short')).toBeUndefined();
    await cache.getOrLoad('long', (v) => v.ttl, async () => ({ ttl: 5000 }));
    expect(cache.get('long')).toEqual({ ttl: 5000 });
  });

  it('drops the oldest entries past the size cap', () => {
    const cache = createTtlCache({ maxEntries: 2 });
    cache.set('a', 1, 1000);
    cache.set('b', 2, 1000);
    cache.set('c', 3, 1000);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  it('invalidates by prefix', () => {
    const cache = createTtlCache();
    cache.set('youtube:1:x', 1, 1000);
    cache.set('youtube:12:x', 2, 1000);
    cache.set('instagram:1:x', 3, 1000);
    cache.invalidate('youtube:1:');
    expect(cache.get('youtube:1:x')).toBeUndefined();
    expect(cache.get('youtube:12:x')).toBe(2);
    expect(cache.get('instagram:1:x')).toBe(3);
  });
});

describe('createRateLimiter', () => {
  it('allows up to the limit per window, then blocks with a retry time', () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: c.now });
    expect(limiter.hit('k').allowed).toBe(true);
    expect(limiter.hit('k').allowed).toBe(true);
    const third = limiter.hit('k');
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBe(60);
    expect(limiter.hit('other').allowed).toBe(true);
    c.advance(60_000);
    expect(limiter.hit('k').allowed).toBe(true);
  });

  it('reset clears a key', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.hit('k');
    expect(limiter.hit('k').allowed).toBe(false);
    limiter.reset('k');
    expect(limiter.hit('k').allowed).toBe(true);
  });
});

/**
 * Fixed-window attempt counter kept in memory (per server instance).
 * `hit(key)` records one attempt and says whether it is still allowed.
 */
export function createRateLimiter({ limit, windowMs, now = () => Date.now(), maxKeys = 10000 }) {
  const buckets = new Map(); // key -> { count, resetAt }

  function sweep(t) {
    for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
  }

  function hit(key) {
    const t = now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= t) {
      if (buckets.size >= maxKeys) sweep(t);
      bucket = { count: 0, resetAt: t + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    return { allowed: bucket.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - t) / 1000)) };
  }

  function reset(key) {
    buckets.delete(key);
  }

  return { hit, reset };
}

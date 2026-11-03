/** Shared pieces for the platform publishers. */

/** An error from a platform, carrying its exact message. `retryable` = worth trying again later (rate limit, outage). */
export class PublishError extends Error {
  constructor(message, { code = 500, retryable = false, step = null } = {}) {
    super(message);
    this.name = 'PublishError';
    this.code = code;
    this.retryable = retryable;
    this.step = step;
  }
}

/** Turns a { data } | { error } result into data, or throws the platform's error as-is. */
export function unwrap(result, step) {
  if (result.error) {
    throw new PublishError(result.error.message, { code: result.error.code, retryable: Boolean(result.error.retryable), step });
  }
  return result.data;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Calls `check()` until it returns a truthy value. `check` throws to stop early.
 * Defaults: every 3s for up to 10 minutes (long videos take a while on every platform).
 */
export async function pollUntil(check, { intervalMs = 3000, timeoutMs = 10 * 60 * 1000, wait = sleep, what = 'processing' } = {}) {
  const started = Date.now();
  for (;;) {
    const done = await check();
    if (done) return done;
    if (Date.now() - started > timeoutMs) {
      throw new PublishError(`Timed out waiting for ${what} to finish. It may still complete on the platform; check there before retrying.`, { code: 504, retryable: false });
    }
    await wait(intervalMs);
  }
}

/** Seconds since epoch, or undefined. */
export const unixSeconds = (iso) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : undefined);

/** Fetches a public media URL into a Buffer (used when a platform wants the bytes, not a link). */
export async function fetchBytes(url, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new PublishError(`Could not read the uploaded file (${res.status}). Upload it again.`, { code: res.status, step: 'upload' });
  return Buffer.from(await res.arrayBuffer());
}

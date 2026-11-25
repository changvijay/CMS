import { useEffect, useEffectEvent, useState } from 'react';
import { errorMessage } from '../../utils/errors';
import * as persisted from '../../services/persistCache';

export interface LiveState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export interface LiveOptions {
  /** How long (ms) a cached result counts as fresh enough to skip the request. Default 0: always refresh in the background. */
  maxAge?: number;
}

/** For slow analytics calls that don't change minute to minute. */
export const ANALYTICS_MAX_AGE = 2 * 60 * 1000;
/** For numbers read from the database: they only change on a sync, which invalidates them explicitly. */
export const STORED_MAX_AGE = 30 * 60 * 1000;

/** Older than this is not shown at all. Anything younger is shown at once and refreshed quietly when past its maxAge. */
const STALE_LIMIT = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
/** Whose data is in the cache; results are saved to the device under this id. Null = keep in memory only. */
let owner: string | null = null;
const cache = new Map<string, { data: unknown; at: number }>();
/** Requests still running, so two views asking for the same key share one call. */
const inflight = new Map<string, Promise<unknown>>();
/** Mounted hooks, told when their key is invalidated so they reload. */
const listeners = new Set<(key: string) => void>();

/** Forget everything cached. Call when the signed-in user changes: keys don't include who is asking. */
export function clearLiveCache() {
  cache.clear();
  inflight.clear();
  owner = null;
  void persisted.clearAll();
}

/**
 * Loads the results saved on this device for `userId` into memory, so the first render shows them without a request.
 * Call once the signed-in user is known; results are saved for that user from then on.
 */
export async function hydrateLiveCache(userId: string | number): Promise<void> {
  const id = String(userId);
  if (owner === id) return;
  owner = id;
  const entries = await persisted.readAll(id);
  if (owner !== id) return; // signed out meanwhile
  const now = Date.now();
  const expired: string[] = [];
  for (const e of entries) {
    if (now - e.at >= STALE_LIMIT) expired.push(e.key);
    else if (!cache.has(e.key)) cache.set(e.key, { data: e.data, at: e.at });
  }
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest);
    expired.push(oldest);
  }
  void persisted.deleteEntries(id, expired);
}

/**
 * Forget cached results whose key starts with one of `prefixes`, and reload any of them that are on screen.
 * Call after anything that changes what those requests return (a sync, adding or removing an account).
 */
export function invalidateLiveCache(...prefixes: string[]) {
  const matches = (key: string) => prefixes.some((p) => key.startsWith(p));
  const dropped = [...cache.keys()].filter(matches);
  for (const key of dropped) cache.delete(key);
  if (owner) void persisted.deleteEntries(owner, dropped);
  for (const key of [...inflight.keys()]) if (matches(key)) inflight.delete(key);
  for (const notify of listeners) notify(prefixes.join('\u0000'));
}

/** Exposed for tests. */
export function peekLiveCache(key: string): unknown {
  return cache.get(key)?.data;
}

/** Runs `load` once per key at a time and stores the result. */
export async function loadShared<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  let promise: Promise<T> | undefined = undefined;
  promise = (async () => {
    try {
      const data = await load();
      // Only store it if nobody invalidated this key while it was loading.
      if (inflight.get(key) === promise) {
        const at = Date.now();
        cache.delete(key); // re-insert so the oldest entries are the ones dropped
        cache.set(key, { data, at });
        if (owner) void persisted.writeEntry(owner, key, data, at);
        if (cache.size > MAX_ENTRIES) {
          const oldest = cache.keys().next().value!;
          cache.delete(oldest);
          if (owner) void persisted.deleteEntries(owner, [oldest]);
        }
      }
      return data;
    } finally {
      if (inflight.get(key) === promise) inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

/** Cache key prefixes of numbers read from the database (all platforms, or one). A sync makes them out of date. */
export function storedDataKeys(platform?: string): string[] {
  return platform ? [`history:${platform}:`, `media:${platform}:`, 'overview:'] : ['history:', 'media:', 'overview:'];
}

/**
 * Runs `load` whenever `key` changes (or `enabled` turns on) and tracks loading / error state.
 * `key` is the identity of the request: put everything the request depends on into it.
 * Results from a superseded request are ignored.
 *
 * Results are cached in memory by `key`, and saved on the device for the signed-in user (stale-while-revalidate): coming back to a request already made shows its last result
 * at once and refreshes it quietly, so the spinner only appears the first time. If that refresh fails, the cached result stays.
 * `invalidateLiveCache(prefix)` drops matching results and makes mounted hooks load again.
 */
export function useLive<T>(load: () => Promise<T>, key: string, enabled = true, { maxAge = 0 }: LiveOptions = {}): LiveState<T> {
  const [state, setState] = useState<LiveState<T>>(() => {
    const hit = cache.get(key);
    return enabled && hit && Date.now() - hit.at < STALE_LIMIT ? { data: hit.data as T, error: null, loading: false } : { data: null, error: null, loading: enabled };
  });
  const [generation, setGeneration] = useState(0);
  const run = useEffectEvent(load);

  useEffect(() => {
    const onInvalidate = (joined: string) => {
      if (joined.split('\u0000').some((p) => key.startsWith(p))) setGeneration((g) => g + 1);
    };
    listeners.add(onInvalidate);
    return () => {
      listeners.delete(onInvalidate);
    };
  }, [key]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      const hit = cache.get(key);
      const usable = hit !== undefined && Date.now() - hit.at < STALE_LIMIT;
      if (usable) {
        setState({ data: hit.data as T, error: null, loading: false });
        if (Date.now() - hit.at < maxAge) return;
      } else {
        // Keep showing the previous data (if any) while the new request loads; views decide whether to show a spinner.
        setState((s) => ({ ...s, loading: true, error: null }));
      }
      try {
        const data = await loadShared(key, run);
        if (!cancelled) setState({ data, error: null, loading: false });
      } catch (err) {
        if (!cancelled && !usable) setState({ data: null, error: errorMessage(err, 'Request failed'), loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, enabled, maxAge, generation]);

  return state;
}

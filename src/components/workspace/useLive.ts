import { useEffect, useEffectEvent, useState } from 'react';
import { errorMessage } from '../../utils/errors';

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

const STALE_LIMIT = 15 * 60 * 1000; // older than this is not shown at all
const MAX_ENTRIES = 200;
const cache = new Map<string, { data: unknown; at: number }>();

/** Forget everything cached. Call when the signed-in user changes: keys don't include who is asking. */
export function clearLiveCache() {
  cache.clear();
}

/**
 * Runs `load` whenever `key` changes (or `enabled` turns on) and tracks loading / error state.
 * `key` is the identity of the request: put everything the request depends on into it.
 * Results from a superseded request are ignored.
 *
 * Results are cached in memory by `key` (stale-while-revalidate): coming back to a request already made shows its last result
 * at once and refreshes it quietly, so the spinner only appears the first time. If that refresh fails, the cached result stays.
 */
export function useLive<T>(load: () => Promise<T>, key: string, enabled = true, { maxAge = 0 }: LiveOptions = {}): LiveState<T> {
  const [state, setState] = useState<LiveState<T>>(() => {
    const hit = cache.get(key);
    return enabled && hit && Date.now() - hit.at < STALE_LIMIT ? { data: hit.data as T, error: null, loading: false } : { data: null, error: null, loading: enabled };
  });
  const run = useEffectEvent(load);

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
        setState((s) => ({ ...s, loading: true, error: null }));
      }
      try {
        const data = await run();
        cache.delete(key); // re-insert so the oldest entries are the ones dropped
        cache.set(key, { data, at: Date.now() });
        if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
        if (!cancelled) setState({ data, error: null, loading: false });
      } catch (err) {
        if (!cancelled && !usable) setState({ data: null, error: errorMessage(err, 'Request failed'), loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, enabled, maxAge]);

  return state;
}

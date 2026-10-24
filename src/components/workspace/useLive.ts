import { useEffect, useEffectEvent, useState } from 'react';
import { errorMessage } from '../../utils/errors';

export interface LiveState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Runs `load` whenever `key` changes (or `enabled` turns on) and tracks loading / error state.
 * `key` is the identity of the request: put everything the request depends on into it.
 * Results from a superseded request are ignored.
 */
export function useLive<T>(load: () => Promise<T>, key: string, enabled = true): LiveState<T> {
  const [state, setState] = useState<LiveState<T>>({ data: null, error: null, loading: enabled });
  const run = useEffectEvent(load);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await run();
        if (!cancelled) setState({ data, error: null, loading: false });
      } catch (err) {
        if (!cancelled) setState({ data: null, error: errorMessage(err, 'Request failed'), loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, enabled]);

  return state;
}

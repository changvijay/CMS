/**
 * Browser-side log of the Connect Instagram / Facebook flow. The page is left for Meta's sign-in and comes back,
 * which wipes the console, so steps are also kept in localStorage and printed again on return.
 * Filter the console by "[oauth]". The flow id matches the server's logs/oauth.log lines.
 */
const KEY = 'oauthDebugLog';

interface Entry { t: string; step: string; details?: unknown }

function load(): Entry[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export function oauthLog(step: string, details?: unknown) {
  const entry: Entry = { t: new Date().toISOString(), step, details };
  console.info(`[oauth] ${entry.t} ${step}`, details ?? '');
  try { localStorage.setItem(KEY, JSON.stringify([...load(), entry].slice(-50))); } catch { /* storage blocked: console only */ }
}

/** On the page Meta sends you back to: print what happened before the redirect, then the result. */
export function oauthReplayOnReturn() {
  const q = new URLSearchParams(window.location.search);
  const kind = ['instagram', 'facebook', 'youtube', 'linkedin'].find((k) => q.has(k));
  if (!kind) return;
  const before = load();
  console.groupCollapsed(`[oauth] steps before leaving for ${kind} sign-in (${before.length})`);
  for (const e of before) console.info(`[oauth] ${e.t} ${e.step}`, e.details ?? '');
  console.groupEnd();
  oauthLog('returned', { kind, result: q.get(kind), name: q.get('name'), message: q.get('message'), url: window.location.href });
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

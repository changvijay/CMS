/**
 * Step-by-step log of the "Connect Instagram" / "Connect Facebook" sign-in flows, for debugging logins.
 *
 * Every attempt gets a flow id (e.g. ig-k3x9a2). It starts when the Connect button asks for the sign-in URL,
 * rides inside the OAuth `state`, and is picked up again when Meta sends the user back, so one grep shows
 * the whole attempt:  grep ig-k3x9a2 logs/oauth.log
 *
 * Lines go to the terminal and to logs/oauth.log (override with OAUTH_LOG_FILE; OAUTH_LOG=off turns it off).
 * Tokens, secrets and codes are masked to a fingerprint (first 6 + last 4 chars + length) so you can tell
 * which value was used without the log holding a usable credential.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOG_FILE = process.env.OAUTH_LOG_FILE || path.join(ROOT, 'logs', 'oauth.log');
const enabled = () => process.env.OAUTH_LOG !== 'off';

// Extra place each step goes (the database, set up in index.js), so the Accounts page can show it.
let sink = null;
export function setOAuthLogSink(fn) { sink = fn; }

const SECRET_KEYS = /^(access_token|client_secret|fb_exchange_token|code|state|token|page_access_token|appsecret_proof|refresh_token|input_token)$/i;

const MASKED = /^(\*\*\*|.{6}….{4}) \(len \d+\)$/;

/** "IGAAbc…wxyz (len 180)": enough to compare two values, not enough to use one. */
export function mask(value) {
  if (value === undefined || value === null || value === '') return value;
  const s = String(value);
  if (MASKED.test(s)) return s;
  if (s.length <= 12) return `*** (len ${s.length})`;
  return `${s.slice(0, 6)}…${s.slice(-4)} (len ${s.length})`;
}

/** Deep copy with every secret-looking field masked. */
export function redact(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    // Strings only: Graph's numeric error `code` (e.g. 190) is not a secret.
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) && typeof v === 'string' ? mask(v) : redact(v, depth + 1)]));
  }
  return value;
}

/** URL with secret query params masked. */
export function redactUrl(url) {
  try {
    const u = new URL(url);
    for (const [k, v] of [...u.searchParams.entries()]) if (SECRET_KEYS.test(k)) u.searchParams.set(k, mask(v));
    return decodeURIComponent(u.toString());
  } catch {
    return String(url);
  }
}

function write(line) {
  if (!enabled()) return;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch (err) {
    console.warn(`[oauth] could not write ${LOG_FILE}: ${err.message}`);
  }
}

export const newFlowId = (platform) => `${platform === 'instagram' ? 'ig' : 'fb'}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * A logger for one flow. `step(name, details)` writes one numbered line:
 *   2026-11-04T10:00:00.123Z [oauth ig-k3x9a2 #3 +412ms] callback.state_ok {"uid":1,...}
 */
export function flowLogger(platform, flowId = newFlowId(platform), userId = null) {
  const started = Date.now();
  let n = 0;
  const step = (name, details) => {
    n += 1;
    const safe = details === undefined ? undefined : redact(details);
    const extra = safe === undefined ? '' : ` ${JSON.stringify(safe)}`;
    write(`${new Date().toISOString()} [oauth ${flowId} #${n} +${Date.now() - started}ms] ${platform}.${name}${extra}`);
    if (enabled() && sink) {
      try {
        Promise.resolve(sink({ flowId, platform, userId, seq: n, step: name, details: safe ?? null, ms: Date.now() - started }))
          .catch((err) => console.warn(`[oauth] could not save log step: ${err.message}`));
      } catch (err) {
        console.warn(`[oauth] could not save log step: ${err.message}`);
      }
    }
  };
  const error = (name, err, details = {}) => step(`${name} ERROR`, {
    ...details, error: err?.message || String(err), errorName: err?.name, status: err?.status, stack: err?.stack?.split('\n').slice(1, 4).map((s) => s.trim()),
  });

  /**
   * fetch that logs the request and the full (masked) reply. Returns a minimal response ({ ok, status, json })
   * since the body is already read for the log; callers here only use those three.
   */
  const fetchLogged = (label, fetchImpl = fetch) => async (url, init = {}) => {
    const t0 = Date.now();
    const body = typeof init.body === 'string' ? Object.fromEntries(new URLSearchParams(init.body)) : undefined;
    step(`${label} → request`, { method: init.method || 'GET', url: redactUrl(url), body });
    let res;
    try {
      res = await fetchImpl(url, init);
    } catch (err) {
      error(`${label} → network`, err, { ms: Date.now() - t0 });
      throw err;
    }
    const data = await res.json().catch(() => ({ _note: 'reply was not JSON' }));
    step(`${label} ← response`, { status: res.status, ok: res.ok, ms: Date.now() - t0, body: data });
    return { ok: res.ok, status: res.status, json: async () => data };
  };

  return { flowId, step, error, fetchLogged };
}

/** The bits of an incoming request that matter for redirect/host mismatches. */
export function requestInfo(req) {
  return {
    method: req.method,
    path: req.path,
    query: req.query,
    host: req.get('host'),
    origin: req.get('origin') || null,
    referer: req.get('referer') || null,
    forwardedHost: req.get('x-forwarded-host') || null,
    forwardedProto: req.get('x-forwarded-proto') || null,
    userAgent: req.get('user-agent') || null,
    ip: req.ip,
  };
}

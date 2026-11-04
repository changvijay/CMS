import { useEffect, useState } from 'react';
import { clearOAuthLog, getOAuthLog, type OAuthLogEntry } from '../services/api';

/**
 * Every step of the last Connect Instagram / Connect Facebook attempts, from the click to the account being saved.
 * Each attempt gets a plain verdict on top, so you can see where it broke without reading every line.
 */

interface Flow { id: string; platform: string; steps: OAuthLogEntry[] }
type Tone = 'ok' | 'bad' | 'warn';

const isBad = (step: string) => /ERROR|FAILED|abort|failed|returned_error|no_pages|db_not_ready/.test(step);
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

function group(entries: OAuthLogEntry[]): Flow[] {
  const flows = new Map<string, Flow>();
  for (const e of entries) {
    if (!flows.has(e.flow_id)) flows.set(e.flow_id, { id: e.flow_id, platform: e.platform, steps: [] });
    flows.get(e.flow_id)!.steps.push(e);
  }
  // Newest attempt first; steps in order.
  return [...flows.values()]
    .map((f) => ({ ...f, steps: f.steps.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at) || a.seq - b.seq) }))
    .sort((a, b) => b.steps[b.steps.length - 1].id - a.steps[a.steps.length - 1].id);
}

/** One-line answer to "what happened?" for an attempt. */
function verdict(f: Flow): { tone: Tone; text: string; hint?: string } {
  const find = (re: RegExp) => f.steps.find((s) => re.test(s.step));
  const findLast = (re: RegExp) => [...f.steps].reverse().find((s) => re.test(s.step));
  const meta = f.platform === 'instagram' ? 'Instagram' : 'Facebook';

  if (find(/finish SUCCESS/)) return { tone: 'ok', text: `Connected: ${str(find(/finish SUCCESS/)!.details?.name)}` };

  const finishFail = find(/finish FAILED/);
  if (finishFail) {
    const firstError = f.steps.find((s) => isBad(s.step) && !/finish FAILED/.test(s.step));
    const d = firstError?.details || {};
    return {
      tone: 'bad',
      text: `Failed after coming back from ${meta}: ${str(finishFail.details?.message)}`,
      hint: firstError ? `First error at step “${firstError.step}”${d.hint ? `. Hint: ${str(d.hint)}` : ''}` : undefined,
    };
  }

  const abort = find(/connect_url\.abort|browser\.connect_url_failed/);
  if (abort) return { tone: 'bad', text: `The server refused to start the sign-in: ${str(abort.details?.reason || abort.details?.error)}` };

  const sent = findLast(/connect_url\.sent|browser\.leaving_for_meta/);
  if (sent && !find(/callback\.hit/)) {
    const leaving = find(/browser\.leaving_for_meta/)?.details || {};
    const age = Date.now() - +new Date(sent.created_at);
    if (age < 10 * 60 * 1000) return { tone: 'warn', text: `Waiting: you are on ${meta}'s page, or just left it.` };
    return {
      tone: 'bad',
      text: `${meta} never sent you back. It stopped the sign-in on its own page (e.g. "URL Blocked" or "Invalid scopes").`,
      hint: `Check in the Meta app: 1) this return URL is registered exactly: ${str(leaving.redirect_uri) || '(see step details)'}  `
        + `2) every permission asked for is added: ${str(leaving.scope) || (leaving.config_id ? `configuration ${str(leaving.config_id)}` : '(see step details)')}  `
        + `3) the account you signed in with has a role on the app (tester/admin) while it is not live.`,
    };
  }
  if (find(/callback\.hit/)) return { tone: 'warn', text: `${meta} sent you back, but the server never finished. Check the server is running and look at the last step.` };
  return { tone: 'warn', text: 'Incomplete attempt.' };
}

function servers(f: Flow) {
  const start = f.steps.find((s) => s.server && s.server !== 'browser' && /connect_url/.test(s.step))?.server;
  const end = f.steps.find((s) => s.server && s.server !== 'browser' && /callback/.test(s.step))?.server;
  return start && end && start !== end ? `Started on ${start}, finished on ${end}.` : null;
}

function asText(flows: Flow[]) {
  return flows.map((f) => {
    const v = verdict(f);
    const lines = f.steps.map((s) => `  ${s.created_at} #${s.seq} [${s.server || '?'}] ${s.platform}.${s.step} ${s.details ? JSON.stringify(s.details) : ''}`);
    return [`=== ${f.id} (${f.platform}) → ${v.text}${v.hint ? `\n    ${v.hint}` : ''}`, ...lines].join('\n');
  }).join('\n\n');
}

export default function OAuthLogPanel({ token }: { token: string }) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [tick, setTick] = useState(0);
  const load = () => { setLoading(true); setTick((t) => t + 1); };

  useEffect(() => {
    let cancelled = false;
    getOAuthLog(token)
      .then((r) => { if (!cancelled) { setFlows(group(r.entries)); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the connection log'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, tick]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(asText(flows)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };
  const clear = async () => {
    try { await clearOAuthLog(token); setFlows([]); } catch (err) { setError(err instanceof Error ? err.message : 'Could not clear the log'); }
  };

  return (
    <section className="viz-panel oauth-log">
      <div className="viz-panel-head">
        <div>
          <h3>Connection log: Instagram &amp; Facebook</h3>
          <p className="ws-sub">Every step of your recent Connect attempts. Red lines show where it broke. Kept for 14 days.</p>
        </div>
        <div className="oauth-log-actions">
          <button className="btn btn-secondary" type="button" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
          <button className="btn btn-secondary" type="button" onClick={copy} disabled={!flows.length}>{copied ? 'Copied' : 'Copy log'}</button>
          <button className="btn btn-secondary" type="button" onClick={clear} disabled={!flows.length}>Clear</button>
        </div>
      </div>
      {error && <div className="error-banner"><span>{error}</span></div>}
      {!loading && !error && !flows.length && <p className="ws-sub">No attempts yet. Click Connect Instagram or Connect Facebook above, then come back here.</p>}
      {flows.slice(0, 15).map((f, i) => {
        const v = verdict(f);
        const where = servers(f);
        return (
          <details key={f.id} className={`oauth-flow ${v.tone}`} open={i === 0}>
            <summary>
              <strong>{f.platform === 'instagram' ? 'Instagram' : 'Facebook'}</strong>
              <span className="oauth-flow-time">{new Date(f.steps[0].created_at).toLocaleString()}</span>
              <code>{f.id}</code>
              <span className={`linkedin-status ${v.tone}`}>{v.text}</span>
            </summary>
            {v.hint && <p className="oauth-flow-hint">{v.hint}</p>}
            {where && <p className="oauth-flow-hint">{where}</p>}
            <ol className="oauth-steps">
              {f.steps.map((s) => (
                <li key={s.id} className={isBad(s.step) ? 'bad' : undefined}>
                  <details>
                    <summary>
                      <span className="oauth-step-time">{new Date(s.created_at).toLocaleTimeString()}</span>
                      <span className="oauth-step-server">{s.server || '?'}</span>
                      <span className="oauth-step-name">{s.step}</span>
                    </summary>
                    <pre>{JSON.stringify(s.details, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ol>
          </details>
        );
      })}
    </section>
  );
}

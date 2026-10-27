import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  deleteAutomationRule, fetchAutomationLog, fetchAutomationMedia, fetchAutomationRules, fetchAutomationStatus, getInstagramAccounts,
  saveAutomationRule, setAutomationRuleActive, subscribeAutomationAccount, testAutomation,
  type AutomationEvent, type AutomationMedia, type AutomationRule, type AutomationRuleInput, type AutomationScope, type AutomationStatus,
  type AutomationTrigger, type InstagramAccount, type MatchType, type RuleTestResult,
} from '../services/api';
import { errorMessage } from '../utils/errors';
import '../assets/css/workspace.css';
import { MAX_MESSAGE_BYTES, byteLength, parseKeywords, previewMessage } from './workspace/automationPreview';
import { LiveBlock, Panel } from './workspace/ui';
import { useLive, type LiveState } from './workspace/useLive';

const MATCH_LABELS: Record<MatchType, string> = { contains: 'Contains the word', starts_with: 'Starts with', exact: 'Is exactly' };

const SCOPE_OPTIONS: { value: AutomationScope; label: string; hint: string }[] = [
  { value: 'all', label: 'Everything', hint: 'Comments on any reel or post, and direct messages' },
  { value: 'reels', label: 'All my reels', hint: 'Comments on any reel' },
  { value: 'posts', label: 'All my posts', hint: 'Comments on any photo or carousel post' },
  { value: 'specific', label: 'One specific reel or post', hint: 'Pick it below. Gets its own keyword, message and link' },
];

const SCOPE_CHIP: Record<AutomationScope, string> = { all: 'Everything', reels: 'All reels', posts: 'All posts', specific: 'One reel/post' };

const mediaTitle = (m: AutomationMedia) => `${m.type === 'reel' ? 'Reel' : 'Post'}: ${m.caption || '(no caption)'}`.slice(0, 150);

const emptyForm = (accountId: string | number): AutomationRuleInput => ({
  account_id: accountId, name: '', is_active: true, triggers: ['comment', 'dm'], keywords: [], match_type: 'contains', scope: 'all', media_id: '', media_label: '', media_permalink: '',
  reply_text: 'Here is the link you asked for 👉 {{link}}', link_url: '', comment_reply_text: 'Check your DMs! 📩', disclose_automation: true, cooldown_hours: 24,
});

/** Where "Set up auto-reply" on a reel/post sends you: the form opens already pointed at that content. */
interface Prefill {
  accountId: string;
  mediaId: string;
}

function Mark({ ok }: { ok: boolean }) {
  return <span className={ok ? 'check-ok' : 'check-bad'} aria-label={ok ? 'Done' : 'Needs attention'}>{ok ? '✓' : '✕'}</span>;
}

function Setup({ token, accountsTick, onChanged }: { token: string; accountsTick: number; onChanged: () => void }) {
  const state = useLive(() => fetchAutomationStatus(token), `status:${accountsTick}`);
  const [busy, setBusy] = useState<string | number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const subscribe = async (id: string | number) => {
    setBusy(id);
    setMessage(null);
    try {
      await subscribeAutomationAccount(token, id);
      setMessage({ ok: true, text: 'Subscribed. Instagram will now send comments and messages to your server.' });
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err, 'Could not subscribe') });
    } finally {
      setBusy(null);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Panel title="1. Setup check" sub="Everything here must be green for replies to be sent.">
      <LiveBlock<AutomationStatus> state={state}>
        {(s) => (
          <>
            {s.dry_run && <div className="ws-notice">Test mode is on (<code>AUTOMATION_DRY_RUN</code>). Replies are recorded in the activity log but nothing is sent to Instagram.</div>}
            <ul className="checklist">
              <li><Mark ok={s.app_secret_configured} /> Meta app secret is set on the server <small>(<code>META_APP_SECRET</code>)</small></li>
              <li><Mark ok={s.verify_token_configured} /> Webhook verify token is set on the server <small>(<code>WEBHOOK_VERIFY_TOKEN</code>)</small></li>
              <li><Mark ok={s.is_https} /> Server address is HTTPS {!s.is_https && <small>Needed for live use. For local testing, use a tunnel (see below).</small>}</li>
              {s.accounts.map((a) => (
                <li key={a.id} className="checklist-account">
                  <div><b>{a.name}</b></div>
                  <div><Mark ok={a.token_ok} /> Instagram token works {a.token_error && <small className="err">error {a.token_error.code}: {a.token_error.message}</small>}</div>
                  <div>
                    <Mark ok={a.subscribed} /> Subscribed to comments and messages
                    {a.subscription_error && <small className="err">error {a.subscription_error.code}: {a.subscription_error.message}</small>}
                    <button className="btn btn-secondary" onClick={() => subscribe(a.id)} disabled={busy === a.id}>{busy === a.id ? 'Subscribing…' : a.subscribed ? 'Subscribe again' : 'Subscribe'}</button>
                  </div>
                </li>
              ))}
            </ul>
            {message && <div className={message.ok ? 'ws-notice ok' : 'error-banner'} role="status">{message.text}</div>}

            <h4 className="sub-title">Your webhook address</h4>
            <div className="copy-row">
              <input type="text" readOnly value={s.callback_url} aria-label="Webhook callback URL" onFocus={(e) => e.currentTarget.select()} />
              <button className="btn btn-secondary" onClick={() => copy(s.callback_url)}>{copied ? 'Copied ✓' : 'Copy'}</button>
            </div>
            <details className="how-to">
              <summary>How to connect it in the Meta dashboard</summary>
              <ol>
                <li>Open your app in Meta for Developers, then <b>Instagram → API setup with Instagram login → Configure webhooks</b>.</li>
                <li>Paste the address above as the <b>Callback URL</b>, and your <code>WEBHOOK_VERIFY_TOKEN</code> as the <b>Verify token</b>. Save.</li>
                <li>Turn on the <b>{s.fields.split(',').join('</b> and <b>')}</b> fields.</li>
                <li>Come back here and press <b>Subscribe</b> for each account.</li>
                <li>For local testing, run <code>cloudflared tunnel --url http://localhost:5001</code> and use the https address it prints in place of the address above. Use a separate test app, because one app has only one callback URL.</li>
              </ol>
            </details>
          </>
        )}
      </LiveBlock>
    </Panel>
  );
}

function MediaPicker({ state, selectedId, onSelect }: { state: LiveState<AutomationMedia[]>; selectedId: string; onSelect: (m: AutomationMedia) => void }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | 'reel' | 'post'>('all');

  return (
    <div className="media-picker">
      <LiveBlock state={state}>
        {(media) => {
          const q = query.trim().toLowerCase();
          const shown = media.filter((m) => (kind === 'all' || m.type === kind) && (!q || m.caption.toLowerCase().includes(q)));
          return (
            <>
              <div className="media-picker-tools">
                <input type="search" placeholder="Search your reels and posts by caption" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search reels and posts" />
                <div className="seg" role="group" aria-label="Show">
                  {(['all', 'reel', 'post'] as const).map((k) => (
                    <button key={k} type="button" className={kind === k ? 'active' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{k === 'all' ? 'All' : k === 'reel' ? 'Reels' : 'Posts'}</button>
                  ))}
                </div>
              </div>
              {shown.length === 0 ? (
                <p className="trends-empty-inline">{media.length === 0 ? 'No reels or posts found on this account.' : 'Nothing matches your search.'}</p>
              ) : (
                <ul className="media-options">
                  {shown.map((m) => (
                    <li key={m.id}>
                      <button type="button" className={`media-option ${selectedId === m.id ? 'selected' : ''}`} aria-pressed={selectedId === m.id} onClick={() => onSelect(m)}>
                        {m.thumbnail_url ? <img src={m.thumbnail_url} alt="" loading="lazy" /> : <span className="media-option-empty">No preview</span>}
                        <span className="tag">{m.type === 'reel' ? 'Reel' : 'Post'}</span>
                        <span className="media-option-caption">{m.caption || '(no caption)'}</span>
                        {m.timestamp && <span className="media-option-date">{new Date(m.timestamp).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          );
        }}
      </LiveBlock>
    </div>
  );
}

function RuleForm({ token, accounts, initial, editing, onDone }: { token: string; accounts: InstagramAccount[]; initial: AutomationRuleInput; editing?: AutomationRule; onDone: () => void }) {
  const [form, setForm] = useState<AutomationRuleInput>(initial);
  const [keywordText, setKeywordText] = useState(initial.keywords.join(', '));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mediaState = useLive(() => fetchAutomationMedia(token, form.account_id), `pick:${form.account_id}`, form.scope === 'specific');

  const set = <K extends keyof AutomationRuleInput>(key: K, value: AutomationRuleInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const commentsOnly = form.scope !== 'all';
  const toggleTrigger = (t: AutomationTrigger) => set('triggers', form.triggers.includes(t) ? form.triggers.filter((x) => x !== t) : [...form.triggers, t]);

  const changeScope = (scope: AutomationScope) =>
    setForm((f) => ({
      ...f,
      scope,
      // reel/post rules answer comments only
      triggers: scope === 'all' ? f.triggers : ['comment'],
      ...(scope === 'specific' ? {} : { media_id: '', media_label: '', media_permalink: '' }),
    }));

  const pick = (m: AutomationMedia) => setForm((f) => ({ ...f, media_id: m.id, media_label: mediaTitle(m), media_permalink: m.permalink ?? '' }));
  const selected = mediaState.data?.find((m) => m.id === form.media_id);
  const selectedLabel = selected ? mediaTitle(selected) : form.media_label || (form.media_id ? `Post ${form.media_id}` : '');

  const preview = useMemo(() => previewMessage(form), [form]);
  const bytes = byteLength(preview);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const withLabel = selected ? { media_label: mediaTitle(selected), media_permalink: selected.permalink ?? '' } : {};
      await saveAutomationRule(token, { ...form, ...withLabel, keywords: parseKeywords(keywordText) }, editing?.id);
      onDone();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the rule'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="rule-form" onSubmit={submit}>
      {accounts.length > 1 && !editing && (
        <label><span>Instagram account</span>
          <select value={String(form.account_id)} onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value, media_id: '', media_label: '', media_permalink: '' }))}>
            {accounts.map((a) => <option key={a.id} value={String(a.id)}>{a.page_name}</option>)}
          </select>
        </label>
      )}

      <fieldset className="scope-picker">
        <legend>This rule applies to</legend>
        {SCOPE_OPTIONS.map((o) => (
          <label key={o.value} className={`scope-option ${form.scope === o.value ? 'selected' : ''}`}>
            <input type="radio" name="scope" value={o.value} checked={form.scope === o.value} onChange={() => changeScope(o.value)} />
            <span><b>{o.label}</b><small>{o.hint}</small></span>
          </label>
        ))}
      </fieldset>

      {form.scope === 'specific' && (
        <div>
          <span className="ws-field-label">{selectedLabel ? 'Selected' : 'Choose the reel or post'}</span>
          {selectedLabel && (
            <p className="selected-media">
              {selectedLabel}
              {(selected?.permalink || form.media_permalink) && <> · <a href={selected?.permalink || form.media_permalink} target="_blank" rel="noopener noreferrer">Open ↗</a></>}
            </p>
          )}
          <MediaPicker state={mediaState} selectedId={form.media_id} onSelect={pick} />
        </div>
      )}

      <label><span>Keywords <small>(separate with commas)</small></span>
        <input type="text" value={keywordText} onChange={(e) => setKeywordText(e.target.value)} placeholder="link, pdf, லிங்க்" required />
      </label>
      <div className="rule-row">
        <label><span>When the message…</span>
          <select value={form.match_type} onChange={(e) => set('match_type', e.target.value as MatchType)}>
            {(Object.keys(MATCH_LABELS) as MatchType[]).map((m) => <option key={m} value={m}>{MATCH_LABELS[m]}</option>)}
          </select>
        </label>
        <fieldset><legend>Reply to</legend>
          <label className="ws-check"><input type="checkbox" checked={form.triggers.includes('comment')} onChange={() => toggleTrigger('comment')} /> Comments (sends a DM)</label>
          <label className="ws-check"><input type="checkbox" checked={form.triggers.includes('dm') && !commentsOnly} disabled={commentsOnly} onChange={() => toggleTrigger('dm')} /> Direct messages</label>
          {commentsOnly && <small>Direct messages can’t be tied to a reel or post, so this rule answers comments only.</small>}
        </fieldset>
      </div>
      <label><span>Message to send</span>
        <textarea rows={3} value={form.reply_text} onChange={(e) => set('reply_text', e.target.value)} />
        <small>Use <code>{'{{link}}'}</code> for your link and <code>{'{{username}}'}</code> for their name.</small>
      </label>
      <label><span>Link</span>
        <input type="url" value={form.link_url} onChange={(e) => set('link_url', e.target.value)} placeholder="https://changtechs.com/" />
      </label>
      {form.triggers.includes('comment') && (
        <label><span>Public reply under the comment <small>(optional, sent only after the DM succeeds)</small></span>
          <input type="text" value={form.comment_reply_text} onChange={(e) => set('comment_reply_text', e.target.value)} maxLength={300} />
        </label>
      )}
      <label><span>Wait before messaging the same person again (hours)</span>
        <input type="number" min={0} max={720} value={form.cooldown_hours} onChange={(e) => set('cooldown_hours', Number(e.target.value))} />
      </label>
      <label className="ws-check"><input type="checkbox" checked={form.disclose_automation} onChange={(e) => set('disclose_automation', e.target.checked)} /> Add “(Automated reply)” to the message. Instagram recommends telling people it is automatic.</label>

      <div className="rule-preview" aria-live="polite">
        <span className="ws-field-label">Preview of what they will receive</span>
        <p>{preview || '—'}</p>
        <small className={bytes > MAX_MESSAGE_BYTES ? 'err' : ''}>{bytes} of {MAX_MESSAGE_BYTES} bytes</small>
      </div>

      {error && <div className="error-banner" role="alert"><span>{error}</span></div>}
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create rule'}</button>
        <button className="btn btn-secondary" type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function Rules({ token, accounts, tick, onChanged, prefill, onPrefillUsed }: { token: string; accounts: InstagramAccount[]; tick: number; onChanged: () => void; prefill: Prefill | null; onPrefillUsed: () => void }) {
  const state = useLive(() => fetchAutomationRules(token), `rules:${tick}`);
  const [editing, setEditing] = useState<AutomationRule | 'new' | null>(() => (prefill ? 'new' : null));
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | AutomationScope>('all');

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Request failed'));
    }
  };

  const close = () => {
    setEditing(null);
    onPrefillUsed();
    onChanged();
  };

  const formFor = (rule: AutomationRule): AutomationRuleInput => ({
    account_id: rule.account_id, name: rule.name, is_active: rule.is_active, triggers: rule.triggers, keywords: rule.keywords, match_type: rule.match_type,
    scope: rule.scope, media_id: rule.media_id ?? '', media_label: rule.media_label ?? '', media_permalink: rule.media_permalink ?? '',
    reply_text: rule.reply_text, link_url: rule.link_url, comment_reply_text: rule.comment_reply_text ?? '',
    disclose_automation: rule.disclose_automation, cooldown_hours: rule.cooldown_hours,
  });

  const newForm = (): AutomationRuleInput => {
    const base = emptyForm(accounts.find((a) => String(a.id) === prefill?.accountId)?.id ?? accounts[0]?.id ?? '');
    return prefill ? { ...base, scope: 'specific', triggers: ['comment'], media_id: prefill.mediaId } : base;
  };

  return (
    <Panel
      title="2. Your rules"
      sub="Each rule says: when someone writes one of these words, send this message. Set different rules for different reels and posts."
      actions={editing === null && accounts.length > 0 ? <button className="btn btn-primary" onClick={() => setEditing('new')}>New rule</button> : undefined}
    >
      {error && <div className="error-banner" role="alert"><span>{error}</span></div>}
      {editing !== null && (
        <RuleForm
          key={editing === 'new' ? 'new' : String(editing.id)}
          token={token}
          accounts={accounts}
          initial={editing === 'new' ? newForm() : formFor(editing)}
          editing={editing === 'new' ? undefined : editing}
          onDone={close}
        />
      )}
      <LiveBlock state={state}>
        {(rules) => {
          if (rules.length === 0) return editing === null ? <p className="trends-empty-inline">No rules yet. Create one, for example the keyword <b>link</b>.</p> : null;
          const count = (s: AutomationScope) => rules.filter((r) => r.scope === s).length;
          const shown = filter === 'all' ? rules : rules.filter((r) => r.scope === filter);
          return (
            <>
              <div className="chip-row" role="group" aria-label="Filter rules">
                <button className={`chip ${filter === 'all' ? 'active' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All rules ({rules.length})</button>
                {(['all', 'reels', 'posts', 'specific'] as const).filter((s) => count(s) > 0).map((s) => (
                  <button key={s} className={`chip ${filter === s ? 'active' : ''}`} aria-pressed={filter === s} onClick={() => setFilter(s)}>{SCOPE_CHIP[s]} ({count(s)})</button>
                ))}
              </div>
              <ul className="rule-list">
                {shown.map((r) => (
                  <li key={r.id} className={r.is_active ? '' : 'off'}>
                    <div className="rule-main">
                      <b>{r.name}</b> <span className="media-rank-meta">{r.account_name}</span>
                      <div className="chip-row">
                        <span className="tag tag-scope">{r.scope === 'specific' ? (r.media_label || 'One reel/post') : SCOPE_CHIP[r.scope]}</span>
                        {r.scope === 'specific' && r.media_permalink && <a className="content-link" href={r.media_permalink} target="_blank" rel="noopener noreferrer">Open ↗</a>}
                        {r.keywords.map((k) => <span key={k} className="tag">{k}</span>)}
                        <span className="tag tag-rate">{MATCH_LABELS[r.match_type]}</span>
                        {r.triggers.map((t) => <span key={t} className="tag">{t === 'dm' ? 'Direct messages' : 'Comments'}</span>)}
                      </div>
                      <p className="rule-msg">{previewMessage(r)}</p>
                      <small className="rule-sent">{r.sent_count ?? 0} {r.sent_count === 1 ? 'reply' : 'replies'} sent</small>
                    </div>
                    <div className="rule-actions">
                      <label className="ws-check"><input type="checkbox" checked={r.is_active} onChange={(e) => run(() => setAutomationRuleActive(token, r.id, e.target.checked))} /> Active</label>
                      <button className="btn btn-secondary" onClick={() => setEditing(r)}>Edit</button>
                      <button className="btn btn-secondary btn-danger" onClick={() => window.confirm(`Delete “${r.name}”?`) && run(() => deleteAutomationRule(token, r.id))}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </LiveBlock>
    </Panel>
  );
}

function TryIt({ token, accounts }: { token: string; accounts: InstagramAccount[] }) {
  const [accountId, setAccountId] = useState<string>(String(accounts[0]?.id ?? ''));
  const [source, setSource] = useState<AutomationTrigger>('comment');
  const [content, setContent] = useState('reel:any');
  const [text, setText] = useState('link');
  const [result, setResult] = useState<RuleTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mediaState = useLive(() => fetchAutomationMedia(token, accountId), `try-media:${accountId}`, Boolean(accountId) && source === 'comment');

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const picked = mediaState.data?.find((m) => m.id === content);
      const where =
        source === 'dm' ? {} :
        content === 'reel:any' ? { mediaProductType: 'REELS' } :
        content === 'post:any' ? { mediaProductType: 'FEED' } :
        picked ? { mediaId: picked.id, mediaProductType: picked.product_type ?? undefined } : {};
      setResult(await testAutomation(token, { accountId, source, text, ...where }));
    } catch (err) {
      setResult(null);
      setError(errorMessage(err, 'Test failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="3. Try it" sub="Type what someone might write, and where. Nothing is sent to anyone.">
      <form className="inline-form" onSubmit={run}>
        {accounts.length > 1 && (
          <label className="ws-select"><span className="sr-only">Account</span>
            <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setContent('reel:any'); }}>{accounts.map((a) => <option key={a.id} value={String(a.id)}>{a.page_name}</option>)}</select>
          </label>
        )}
        <div className="seg" role="group" aria-label="Where they wrote it">
          <button type="button" className={source === 'comment' ? 'active' : ''} aria-pressed={source === 'comment'} onClick={() => setSource('comment')}>Comment</button>
          <button type="button" className={source === 'dm' ? 'active' : ''} aria-pressed={source === 'dm'} onClick={() => setSource('dm')}>Direct message</button>
        </div>
        {source === 'comment' && (
          <label className="ws-select"><span className="sr-only">On which content</span>
            <select value={content} onChange={(e) => setContent(e.target.value)}>
              <option value="reel:any">On any reel</option>
              <option value="post:any">On any post</option>
              {(mediaState.data ?? []).map((m) => <option key={m.id} value={m.id}>On {mediaTitle(m).slice(0, 60)}</option>)}
            </select>
          </label>
        )}
        <label className="ws-search"><span className="sr-only">What they write</span><input type="text" value={text} onChange={(e) => setText(e.target.value)} /></label>
        <button className="btn btn-primary" type="submit" disabled={busy || !accountId}>{busy ? 'Checking…' : 'Test'}</button>
      </form>
      {error && <div className="error-banner"><span>{error}</span></div>}
      {result && (
        result.matched ? (
          <div className="rule-preview">
            <span className="ws-field-label">
              Matched “{result.rule_name}” ({result.scope === 'specific' ? result.media_label || 'one reel/post' : SCOPE_CHIP[result.scope ?? 'all']}) on “{result.keyword}”. They would receive:
            </span>
            <p>{result.message}</p>
            {result.public_reply && <small>And a public reply under their comment: “{result.public_reply}”</small>}
          </div>
        ) : <p className="trends-empty-inline">No rule matches this message, so nothing would be sent.</p>
      )}
    </Panel>
  );
}

const STATUS_TEXT: Record<AutomationEvent['status'], string> = { sent: '✓ Sent', failed: '✕ Failed', skipped: '⚠ Skipped', dry_run: '◌ Test only', processing: '… Working', ignored: '– No rule matched' };

function Activity({ token, tick }: { token: string; tick: number }) {
  const [refresh, setRefresh] = useState(0);
  const state = useLive(() => fetchAutomationLog(token), `log:${tick}:${refresh}`);
  return (
    <Panel title="4. Activity" sub="The latest messages the automation handled, with Instagram's own error code when something fails." actions={<button className="btn btn-secondary" onClick={() => setRefresh((r) => r + 1)}>Refresh</button>}>
      <LiveBlock state={state}>
        {(events) =>
          events.length === 0 ? (
            <p className="trends-empty-inline">Nothing yet. When someone writes a keyword, it will show up here.</p>
          ) : (
            <div className="viz-table-wrap tall">
              <table className="viz-table log-table">
                <thead><tr><th>When</th><th>Where</th><th>Who</th><th>They wrote</th><th>Rule</th><th>Result</th></tr></thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                      <td>{e.source === 'dm' ? 'Direct message' : 'Comment'}</td>
                      <td>{e.sender_username ? `@${e.sender_username}` : e.sender_id ?? '–'}</td>
                      <td className="log-text">{(e.trigger_text ?? '').slice(0, 60)}</td>
                      <td>{e.rule_name ?? '–'}</td>
                      <td className="log-result">
                        <span className={`status-${e.status}`}>{STATUS_TEXT[e.status]}</span>
                        {e.skip_reason && <small> ({e.skip_reason})</small>}
                        {e.error_code !== null && <small className="err"> error {e.error_code}: {e.error_message}</small>}
                        {e.note && <small> {e.note}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </LiveBlock>
    </Panel>
  );
}

export default function Automation({ token }: { token: string }) {
  const [tick, setTick] = useState(0);
  const [params, setParams] = useSearchParams();
  const accountsState = useLive(() => getInstagramAccounts(token), 'automation-accounts');
  const media = params.get('media');
  const prefill: Prefill | null = media ? { accountId: params.get('account') ?? '', mediaId: media } : null;

  return (
    <div className="ws">
      <main className="ws-main">
        <div className="ws-pagehead">
          <div>
            <h2>Auto-replies</h2>
            <p className="ws-sub">When someone comments or messages a keyword like “link”, send them your URL automatically. Give each reel or post its own keyword and link.</p>
          </div>
        </div>
        <LiveBlock state={accountsState}>
          {(accounts) =>
            accounts.length === 0 ? (
              <div className="ws-empty ws-empty-cta">
                <h3>Connect an Instagram account first</h3>
                <p>Auto-replies work on the Instagram accounts you have connected.</p>
                <Link className="btn btn-primary" to="/accounts">Add an account</Link>
              </div>
            ) : (
              <>
                <Setup token={token} accountsTick={tick} onChanged={() => setTick((t) => t + 1)} />
                <Rules token={token} accounts={accounts} tick={tick} onChanged={() => setTick((t) => t + 1)} prefill={prefill} onPrefillUsed={() => setParams({}, { replace: true })} />
                <TryIt token={token} accounts={accounts} />
                <Activity token={token} tick={tick} />
              </>
            )
          }
        </LiveBlock>
      </main>
    </div>
  );
}

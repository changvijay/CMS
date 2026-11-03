import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  createAccount,
  deleteAccount,
  deleteFacebookPage,
  deleteLinkedInAccount,
  getConnectUrl,
  getFacebookPages,
  getInstagramAccounts,
  getLinkedInAccounts,
  getPublishConfig,
  getYoutubeAccounts,
  updateAccountToken,
  type FacebookPage,
  type InstagramAccount,
  type LinkedInAccount,
  type ManualPlatform,
  type PublishConfig,
  type YoutubeAccount,
} from '../services/api';
import { PlatformIcon } from './publish/PlatformIcon';
import '../assets/css/workspace.css';

type Kind = 'instagram' | 'facebook' | 'youtube' | 'linkedin';
type Tone = 'ok' | 'warn' | 'bad';
const LABEL: Record<Kind, string> = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', linkedin: 'LinkedIn' };

/** After a Connect button, the provider sends you back to /accounts?<kind>=connected|error. Read once on load. */
function readReturn(kind: Kind): { notice: string | null; error: string | null } {
  const q = new URLSearchParams(window.location.search);
  const result = q.get(kind);
  if (result === 'connected') return { notice: `${LABEL[kind]} connected${q.get('name') ? `: ${q.get('name')}` : ''}. It renews itself, so you won't need to do this again.`, error: null };
  if (result === 'error') return { notice: null, error: q.get('message') || `${LABEL[kind]} connection failed.` };
  return { notice: null, error: null };
}

/** Loading, errors, notices, busy state and the Connect redirect shared by every section. */
function useSection<T>(token: string, kind: Kind, load: () => Promise<T>) {
  const [initial] = useState(() => readReturn(kind));
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initial.error);
  const [notice, setNotice] = useState<string | null>(initial.notice);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : `Failed to load ${LABEL[kind]} accounts`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // `load` is a fresh closure each render; reloading is driven by token and tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tick]);

  const connect = async (k: Parameters<typeof getConnectUrl>[1] = kind) => {
    setBusy(true);
    setError(null);
    try {
      window.location.href = await getConnectUrl(token, k, '/accounts');
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not start ${LABEL[kind]} sign-in`);
      setBusy(false);
    }
  };

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(success);
      setTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  return { data, loading, busy, error, notice, connect, run };
}

function ConnectButton({ kind, label, onClick, disabled }: { kind: Kind; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={`btn btn-connect btn-${kind}`} onClick={onClick} disabled={disabled}>
      <PlatformIcon platform={kind} size={18} /> {label}
    </button>
  );
}

function Status({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return <span className={`linkedin-status ${tone}`} title={title}>{children}</span>;
}

function Avatar({ src, name }: { src?: string | null; name: string }) {
  return src ? <img className="linkedin-avatar" src={src} alt="" /> : <span className="linkedin-avatar">{name.replace(/^@/, '').charAt(0).toUpperCase()}</span>;
}

/** One connected account: picture, name, details, status and buttons. */
function AccountRow({ avatar, name, meta, status, note, actions }: {
  avatar?: string | null; name: string; meta?: ReactNode; status?: ReactNode; note?: ReactNode; actions: ReactNode;
}) {
  return (
    <li>
      <div className="linkedin-person">
        <Avatar src={avatar} name={name} />
        <div className="account-main">
          <b>{name}</b>
          <span className="media-rank-meta">{[meta, status].filter(Boolean).map((x, i) => <span key={i}>{i > 0 && ' · '}{x}</span>)}</span>
          {note && <small className="media-rank-meta">{note}</small>}
        </div>
      </div>
      <div className="account-actions">{actions}</div>
    </li>
  );
}

function SectionShell({ title, sub, head, error, notice, setupMissing, loading, empty, children }: {
  title: string; sub: string; head?: ReactNode; error: string | null; notice: string | null; setupMissing?: string | null; loading: boolean; empty?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="viz-panel">
      <div className="viz-panel-head">
        <div>
          <h3>{title}</h3>
          <p className="ws-sub">{sub}</p>
        </div>
        {head}
      </div>
      {error && <div className="error-banner"><span>{error}</span></div>}
      {notice && <div className="ws-notice ok" role="status">{notice}</div>}
      {setupMissing && <div className="ws-notice">{setupMissing}</div>}
      {loading ? <div className="trends-loading"><div className="spinner" /></div> : empty}
      {children}
    </section>
  );
}

/** Pasting a token by hand: kept as a fallback for accounts that can't use the Connect button. */
function ManualAdd({ platform, busy, onAdd }: { platform: ManualPlatform; busy: boolean; onAdd: (body: Record<string, string>) => void }) {
  const [form, setForm] = useState({ name: '', externalId: '', secret: '' });
  const ig = platform === 'instagram';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAdd(ig
      ? { page_name: form.name, page_id: form.externalId, access_token: form.secret }
      : { channel_name: form.name, playlist_id: form.externalId, access_token: form.secret });
    setForm({ name: '', externalId: '', secret: '' });
  };
  return (
    <details className="account-manual">
      <summary>Add with a token instead</summary>
      <form className="account-form" onSubmit={submit}>
        <label><span>{ig ? 'Account name' : 'Channel name'}</span>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label><span>{ig ? 'Instagram user ID' : 'Uploads playlist ID'}</span>
          <input required value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} />
          <small>{ig ? 'The numeric Instagram professional account ID.' : 'Your channel’s uploads playlist (starts with UU).'}</small>
        </label>
        <label><span>{ig ? 'Long-lived access token' : 'Google refresh token'}</span>
          <input required type="password" autoComplete="off" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
          <small>{ig ? 'Renewed automatically every week once saved.' : 'Exchanged for an access token on each request. Connect YouTube is easier and allows uploads.'}</small>
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save account'}</button>
      </form>
    </details>
  );
}

/** "Update token" for one account, as a fallback to reconnecting. */
function TokenUpdate({ label, busy, onSave }: { label: string; busy: boolean; onSave: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  if (!open) return <button className="btn btn-secondary" onClick={() => setOpen(true)}>Update token</button>;
  return (
    <form className="account-token-form" onSubmit={(e) => { e.preventDefault(); onSave(value); setValue(''); setOpen(false); }}>
      <input required type="password" autoComplete="off" placeholder={label} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      <button className="btn btn-primary" type="submit" disabled={busy}>Save</button>
      <button className="btn btn-secondary" type="button" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

// ---------------------------------------------------------------------------

function instagramStatus(t: InstagramAccount['token']): { tone: Tone; text: string; expired: boolean } {
  if (!t) return { tone: 'ok', text: 'Connected', expired: false };
  if (t.status === 'expired') return { tone: 'bad', text: 'Expired, automatic renewal failed: please reconnect', expired: true };
  if (t.auto_refresh && t.expires_at) return { tone: 'ok', text: `Connected · renews automatically (valid until ${new Date(t.expires_at).toLocaleDateString()})`, expired: false };
  if (t.message) return { tone: 'warn', text: 'Connected · last renewal failed, will retry', expired: false };
  return { tone: 'ok', text: 'Connected · first renewal pending', expired: false };
}

function InstagramSection({ token, configured }: { token: string; configured: boolean }) {
  const s = useSection<InstagramAccount[]>(token, 'instagram', () => getInstagramAccounts(token));
  const rows = s.data ?? [];
  const connectBtn = (label: string) => <ConnectButton kind="instagram" label={s.busy ? 'Opening Instagram…' : label} onClick={() => s.connect()} disabled={s.busy || !configured} />;
  return (
    <SectionShell
      title="Instagram" sub="Professional (Business or Creator) accounts: analytics, posting and auto-replies."
      head={rows.length > 0 && connectBtn('Connect another account')}
      error={s.error} notice={s.notice} loading={s.loading}
      setupMissing={configured ? null : 'Instagram sign-in isn’t set up on the server yet. Add INSTAGRAM_APP_ID (and INSTAGRAM_APP_SECRET) to .env and restart.'}
      empty={!rows.length && (
        <div className="linkedin-empty">
          <p>Sign in with Instagram. The connection renews itself every week, so you only do this once.</p>
          {connectBtn('Connect Instagram')}
        </div>
      )}
    >
      <ul className="account-list">
        {rows.map((a) => {
          const st = instagramStatus(a.token);
          return (
            <AccountRow
              key={a.id} avatar={a.profile_picture_url} name={`@${a.page_name.replace(/^@/, '')}`}
              meta={`ID ${a.ig_user_id || a.page_id}`}
              status={<Status tone={st.tone} title={a.token?.message ?? undefined}>{st.text}</Status>}
              note={a.token?.status === 'ok' && a.token.message ? `Last renewal error: ${a.token.message}` : null}
              actions={(
                <>
                  {st.expired && connectBtn('Reconnect')}
                  <TokenUpdate label="New long-lived token" busy={s.busy} onSave={(t) => s.run(() => updateAccountToken(token, 'instagram', a.id, t), 'Token updated.')} />
                  <button className="btn btn-secondary btn-danger" disabled={s.busy}
                    onClick={() => window.confirm(`Disconnect @${a.page_name}? Its stored history and auto-replies are deleted too.`) && s.run(() => deleteAccount(token, 'instagram', a.id), 'Account disconnected.')}>
                    Disconnect
                  </button>
                </>
              )}
            />
          );
        })}
      </ul>
      <ManualAdd platform="instagram" busy={s.busy} onAdd={(body) => s.run(() => createAccount(token, 'instagram', body as never), 'Account added.')} />
    </SectionShell>
  );
}

function FacebookSection({ token, configured }: { token: string; configured: boolean }) {
  const s = useSection<{ configured: boolean; pages: FacebookPage[] }>(token, 'facebook', () => getFacebookPages(token));
  const pages = s.data?.pages ?? [];
  const ok = configured && (s.data?.configured ?? true);
  const connectBtn = (label: string) => <ConnectButton kind="facebook" label={s.busy ? 'Opening Facebook…' : label} onClick={() => s.connect()} disabled={s.busy || !ok} />;
  return (
    <SectionShell
      title="Facebook Pages" sub="Page posting and analytics. Also unlocks Instagram location search and product tags."
      head={pages.length > 0 && connectBtn('Add or update Pages')}
      error={s.error} notice={s.notice} loading={s.loading}
      setupMissing={ok ? null : 'Facebook isn’t set up on the server yet. Add FACEBOOK_APP_ID and FACEBOOK_APP_SECRET to .env and restart.'}
      empty={!pages.length && (
        <div className="linkedin-empty">
          <p>Sign in with a Facebook account that manages your Page, and tick the Pages to connect. Page access doesn’t expire.</p>
          {connectBtn('Connect Facebook')}
        </div>
      )}
    >
      <ul className="account-list">
        {pages.map((p) => (
          <AccountRow
            key={p.id} avatar={p.picture_url} name={p.name}
            meta={<a href={`https://www.facebook.com/${p.page_id}`} target="_blank" rel="noreferrer">facebook.com/{p.page_id}</a>}
            status={<Status tone="ok">Connected{p.ig_user_id ? ' · Instagram linked' : ''}</Status>}
            actions={(
              <button className="btn btn-secondary btn-danger" disabled={s.busy}
                onClick={() => window.confirm(`Disconnect the ${p.name} Page?`) && s.run(() => deleteFacebookPage(token, p.id), 'Page disconnected.')}>
                Disconnect
              </button>
            )}
          />
        ))}
      </ul>
    </SectionShell>
  );
}

function youtubeStatus(t: YoutubeAccount['token']): { tone: Tone; text: string; needsReconnect: boolean } {
  if (!t) return { tone: 'ok', text: 'Connected', needsReconnect: false };
  if (t.status === 'expired') return { tone: 'bad', text: 'Access revoked or expired: please reconnect', needsReconnect: true };
  if (t.can_upload === false) return { tone: 'warn', text: 'Connected · analytics only, reconnect to allow uploads', needsReconnect: true };
  if (t.can_upload === null) return { tone: 'warn', text: 'Connected · added by hand, reconnect to allow uploads', needsReconnect: true };
  return { tone: 'ok', text: 'Connected · renews automatically · can upload', needsReconnect: false };
}

function YoutubeSection({ token, configured }: { token: string; configured: boolean }) {
  const s = useSection<YoutubeAccount[]>(token, 'youtube', () => getYoutubeAccounts(token));
  const rows = s.data ?? [];
  const connectBtn = (label: string) => <ConnectButton kind="youtube" label={s.busy ? 'Opening Google…' : label} onClick={() => s.connect()} disabled={s.busy || !configured} />;
  return (
    <SectionShell
      title="YouTube channels" sub="Analytics and video uploads."
      head={rows.length > 0 && connectBtn('Connect another channel')}
      error={s.error} notice={s.notice} loading={s.loading}
      setupMissing={configured ? null : 'Google sign-in isn’t set up on the server yet (client_id / client_secret).'}
      empty={!rows.length && (
        <div className="linkedin-empty">
          <p>Sign in with the Google account that owns the channel. Access renews itself, so you only do this once.</p>
          {connectBtn('Connect YouTube')}
        </div>
      )}
    >
      <ul className="account-list">
        {rows.map((a) => {
          const st = youtubeStatus(a.token);
          return (
            <AccountRow
              key={a.id} avatar={a.picture_url} name={a.channel_name}
              meta={a.channel_id ? <a href={`https://www.youtube.com/channel/${a.channel_id}`} target="_blank" rel="noreferrer">youtube.com/channel/{a.channel_id}</a> : `Playlist ${a.playlist_id}`}
              status={<Status tone={st.tone} title={a.token?.message ?? undefined}>{st.text}</Status>}
              note={a.token?.status === 'expired' && a.token.message ? a.token.message : null}
              actions={(
                <>
                  {st.needsReconnect && connectBtn('Reconnect')}
                  <TokenUpdate label="New refresh token" busy={s.busy} onSave={(t) => s.run(() => updateAccountToken(token, 'youtube', a.id, t), 'Token updated.')} />
                  <button className="btn btn-secondary btn-danger" disabled={s.busy}
                    onClick={() => window.confirm(`Remove ${a.channel_name}? Its stored history will be deleted too.`) && s.run(() => deleteAccount(token, 'youtube', a.id), 'Channel removed.')}>
                    Remove
                  </button>
                </>
              )}
            />
          );
        })}
      </ul>
      <ManualAdd platform="youtube" busy={s.busy} onAdd={(body) => s.run(() => createAccount(token, 'youtube', body as never), 'Channel added.')} />
    </SectionShell>
  );
}

function linkedInStatus(a: LinkedInAccount): { label: string; tone: Tone } {
  if (a.status === 'expired') return { label: 'Expired, automatic renewal failed: please reconnect', tone: 'bad' };
  if (a.auto_refresh && !a.last_refresh_error) return { label: 'Connected · renews automatically', tone: 'ok' };
  if (a.last_refresh_error) return { label: 'Connected · last renewal failed, will retry', tone: 'warn' };
  return { label: `Connected until ${new Date(a.access_token_expires_at).toLocaleDateString()} (LinkedIn gave no refresh token: reconnect before then)`, tone: 'ok' };
}

function LinkedInSection({ token }: { token: string }) {
  const s = useSection<{ configured: boolean; accounts: LinkedInAccount[] }>(token, 'linkedin', () => getLinkedInAccounts(token));
  const accounts = s.data?.accounts ?? [];
  const configured = s.data?.configured ?? true;
  const connectBtn = (label: string) => <ConnectButton kind="linkedin" label={s.busy ? 'Opening LinkedIn…' : label} onClick={() => s.connect('linkedin')} disabled={s.busy || !configured} />;
  return (
    <SectionShell
      title="LinkedIn company pages" sub="Page analytics and posting."
      head={accounts.length > 0 && connectBtn('Connect another page')}
      error={s.error} notice={s.notice} loading={s.loading}
      setupMissing={configured ? null : 'LinkedIn isn’t set up on the server yet. Add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to .env and restart.'}
      empty={!accounts.length && (
        <div className="linkedin-empty">
          <p>Sign in with a LinkedIn account that is an admin of your company page. Every page you manage is added.</p>
          {connectBtn('Connect LinkedIn')}
        </div>
      )}
    >
      <ul className="account-list">
        {accounts.map((a) => {
          const st = linkedInStatus(a);
          return (
            <AccountRow
              key={a.id} name={a.name}
              meta={a.vanity_name ? <a href={`https://www.linkedin.com/company/${a.vanity_name}`} target="_blank" rel="noreferrer">linkedin.com/company/{a.vanity_name}</a> : null}
              status={<Status tone={st.tone} title={a.last_refresh_error ?? undefined}>{st.label}</Status>}
              actions={(
                <>
                  {a.status === 'expired' && connectBtn('Reconnect')}
                  <button className="btn btn-secondary btn-danger" disabled={s.busy}
                    onClick={() => window.confirm(`Disconnect the ${a.name} company page?`) && s.run(() => deleteLinkedInAccount(token, a.id), 'Company page disconnected.')}>
                    Disconnect
                  </button>
                </>
              )}
            />
          );
        })}
      </ul>
    </SectionShell>
  );
}

export default function Accounts({ token }: { token: string }) {
  const [config, setConfig] = useState<PublishConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Without it (e.g. the database is down) every button stays enabled and the server explains what's missing.
    getPublishConfig(token).then((c) => { if (!cancelled) setConfig(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  // Each section has read its "?instagram=connected" message on first render; tidy the URL so a refresh doesn't repeat it.
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  return (
    <div className="ws">
      <main className="ws-main">
        <div className="ws-pagehead">
          <div>
            <h2>Accounts</h2>
            <p className="ws-sub">Connect each platform once. Connections renew themselves; you only reconnect if a platform refuses the renewal.</p>
          </div>
        </div>
        <InstagramSection token={token} configured={config?.instagram ?? true} />
        <FacebookSection token={token} configured={config?.facebook ?? true} />
        <YoutubeSection token={token} configured={config?.google ?? true} />
        <LinkedInSection token={token} />
      </main>
    </div>
  );
}

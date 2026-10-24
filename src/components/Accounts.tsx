import { useEffect, useState, type FormEvent } from 'react';
import {
  createAccount,
  deleteAccount,
  getInstagramAccounts,
  getYoutubeAccounts,
  updateAccountToken,
  type Platform,
} from '../services/api';
import '../assets/css/workspace.css';

interface Row {
  id: string | number;
  name: string;
  externalId: string;
  created_at: string;
}

const COPY: Record<Platform, { title: string; nameLabel: string; idLabel: string; tokenLabel: string; idHelp: string; tokenHelp: string }> = {
  instagram: {
    title: 'Instagram accounts',
    nameLabel: 'Account name',
    idLabel: 'Instagram user ID',
    tokenLabel: 'Long-lived access token',
    idHelp: 'The numeric Instagram professional account ID.',
    tokenHelp: 'Instagram tokens expire after 60 days; paste a new one here when it does.',
  },
  youtube: {
    title: 'YouTube channels',
    nameLabel: 'Channel name',
    idLabel: 'Uploads playlist ID',
    tokenLabel: 'Google refresh token',
    idHelp: 'Your channel’s uploads playlist (starts with UU).',
    tokenHelp: 'The OAuth refresh token for the channel; it is exchanged for an access token on each request.',
  },
};

function AccountSection({ token, platform }: { token: string; platform: Platform }) {
  const copy = COPY[platform];
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | number | null>(null);
  const [form, setForm] = useState({ name: '', externalId: '', secret: '' });
  const [newSecret, setNewSecret] = useState('');
  const [busy, setBusy] = useState(false);

  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list =
          platform === 'instagram'
            ? (await getInstagramAccounts(token)).map((a) => ({ id: a.id, name: a.page_name, externalId: a.page_id, created_at: a.created_at }))
            : (await getYoutubeAccounts(token)).map((a) => ({ id: a.id, name: a.channel_name, externalId: a.playlist_id, created_at: a.created_at }));
        if (cancelled) return;
        setRows(list);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load accounts');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, token, tick]);

  const run = async (fn: () => Promise<void>, success: string) => {
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

  const handleAdd = (e: FormEvent) => {
    e.preventDefault();
    const body =
      platform === 'instagram'
        ? { page_name: form.name, page_id: form.externalId, access_token: form.secret }
        : { channel_name: form.name, playlist_id: form.externalId, access_token: form.secret };
    run(async () => {
      await createAccount(token, platform, body);
      setForm({ name: '', externalId: '', secret: '' });
      setAdding(false);
    }, 'Account added.');
  };

  const handleToken = (e: FormEvent, id: string | number) => {
    e.preventDefault();
    run(async () => {
      await updateAccountToken(token, platform, id, newSecret);
      setNewSecret('');
      setEditing(null);
    }, 'Token updated.');
  };

  const handleDelete = (row: Row) => {
    if (!window.confirm(`Remove ${row.name}? Its stored history will be deleted too.`)) return;
    run(() => deleteAccount(token, platform, row.id), 'Account removed.');
  };

  return (
    <section className="viz-panel">
      <div className="viz-panel-head">
        <h3>{copy.title}</h3>
        <button className="btn btn-secondary" onClick={() => setAdding((a) => !a)}>{adding ? 'Cancel' : 'Add account'}</button>
      </div>

      {error && <div className="error-banner"><span>{error}</span></div>}
      {notice && <div className="ws-notice ok" role="status">{notice}</div>}

      {adding && (
        <form className="account-form" onSubmit={handleAdd}>
          <label><span>{copy.nameLabel}</span>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label><span>{copy.idLabel}</span>
            <input required value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} />
            <small>{copy.idHelp}</small>
          </label>
          <label><span>{copy.tokenLabel}</span>
            <input required type="password" autoComplete="off" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
            <small>{copy.tokenHelp}</small>
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save account'}</button>
        </form>
      )}

      {loading && <div className="trends-loading"><div className="spinner" /></div>}
      {!loading && !rows.length && <p className="trends-empty-inline">No accounts yet.</p>}

      <ul className="account-list">
        {rows.map((r) => (
          <li key={r.id}>
            <div className="account-main">
              <b>{r.name}</b>
              <span className="media-rank-meta">{copy.idLabel}: {r.externalId} · added {new Date(r.created_at).toLocaleDateString()}</span>
            </div>
            <div className="account-actions">
              <button className="btn btn-secondary" onClick={() => { setEditing(editing === r.id ? null : r.id); setNewSecret(''); }}>
                {editing === r.id ? 'Cancel' : 'Update token'}
              </button>
              <button className="btn btn-secondary btn-danger" onClick={() => handleDelete(r)} disabled={busy}>Remove</button>
            </div>
            {editing === r.id && (
              <form className="account-token-form" onSubmit={(e) => handleToken(e, r.id)}>
                <input required type="password" autoComplete="off" placeholder={copy.tokenLabel} value={newSecret} onChange={(e) => setNewSecret(e.target.value)} />
                <button className="btn btn-primary" type="submit" disabled={busy}>Save token</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Accounts({ token }: { token: string }) {
  return (
    <div className="ws">
      <main className="ws-main">
        <div className="ws-pagehead">
          <div>
            <h2>Accounts</h2>
            <p className="ws-sub">Connect the Instagram and YouTube accounts to analyse. Stored tokens are never shown again after saving.</p>
          </div>
        </div>
        <AccountSection token={token} platform="instagram" />
        <AccountSection token={token} platform="youtube" />
      </main>
    </div>
  );
}

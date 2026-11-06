import { useEffect, useState } from 'react';
import { useConnect, type ConnectKind } from './helpers';
import { Link } from 'react-router-dom';
import { getPublishAccounts, getPublishConfig, getPublishPlatforms, type PublishConfig } from '../../services/api';
import { PLATFORM_BLURB, PLATFORM_LABEL, PLATFORM_ORDER } from './platforms';
import { PlatformIcon } from './PlatformIcon';
import type { Platform, PublishAccount } from './types';
import { SectionSkeleton } from '../Skeleton';

export function StepPlatforms({ token, selected, onChange, beforeLeave }: { token: string; selected: Platform[]; onChange: (p: Platform[]) => void; beforeLeave: () => Promise<string | null> }) {
  const [available, setAvailable] = useState<{ platform: Platform; accounts: number }[] | null>(null);
  const [config, setConfig] = useState<PublishConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { connect, error: connectError, busy } = useConnect(token, beforeLeave);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPublishPlatforms(token), getPublishConfig(token)])
      .then(([p, c]) => { if (!cancelled) { setAvailable(p.platforms); setConfig(c); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load platforms'); });
    return () => { cancelled = true; };
  }, [token]);

  if (error) return <div className="error-banner"><span>{error}</span></div>;
  if (!available) return <SectionSkeleton variant="list" rows={3} />;

  const have = new Set(available.map((a) => a.platform));
  const missing = PLATFORM_ORDER.filter((p) => !have.has(p));
  const toggle = (p: Platform) => onChange(selected.includes(p) ? selected.filter((x) => x !== p) : PLATFORM_ORDER.filter((x) => x === p || selected.includes(x)));

  return (
    <div>
      {config && !config.storage && (
        <div className="ws-notice">Media uploads are not set up on the server yet (GCS_BUCKET). Text-only posts still work.</div>
      )}
      {!available.length && <div className="ws-notice">No accounts are connected yet. Connect one below to start posting.</div>}
      <div className="pf-cards" role="group" aria-label="Platforms">
        {PLATFORM_ORDER.filter((p) => have.has(p)).map((p) => {
          const n = available.find((a) => a.platform === p)?.accounts ?? 0;
          const on = selected.includes(p);
          return (
            <button key={p} type="button" className={`pf-card pf-${p}${on ? ' selected' : ''}`} aria-pressed={on} onClick={() => toggle(p)}>
              <span className="pf-card-check" aria-hidden="true">{on ? '✓' : ''}</span>
              <PlatformIcon platform={p} size={30} />
              <b>{PLATFORM_LABEL[p]}</b>
              <small>{PLATFORM_BLURB[p]}</small>
              <small className="pf-card-n">{n} account{n === 1 ? '' : 's'} connected</small>
            </button>
          );
        })}
      </div>
      <p className="pf-hint">Pick more than one to cross-post. Each platform gets its own tab with the fields its API supports.</p>

      {missing.length > 0 && (
        <div className="pf-connect-more">
          <span>Connect more:</span>
          {missing.includes('facebook') && <button type="button" className="btn btn-secondary" disabled={busy || !config?.facebook} onClick={() => connect('facebook')} title={config?.facebook ? '' : 'FACEBOOK_APP_ID / FACEBOOK_APP_SECRET are not set on the server'}><PlatformIcon platform="facebook" size={16} /> Facebook Page</button>}
          {missing.includes('youtube') && <button type="button" className="btn btn-secondary" disabled={busy || !config?.google} onClick={() => connect('youtube')}><PlatformIcon platform="youtube" size={16} /> YouTube</button>}
          {missing.includes('linkedin') && <button type="button" className="btn btn-secondary" disabled={busy || !config?.linkedin} onClick={() => connect('linkedin')}><PlatformIcon platform="linkedin" size={16} /> LinkedIn page</button>}
          {missing.includes('instagram') && <Link className="btn btn-secondary" to="/accounts"><PlatformIcon platform="instagram" size={16} /> Instagram</Link>}
        </div>
      )}
      {connectError && <div className="error-banner"><span>{connectError}</span></div>}
    </div>
  );
}

const RECONNECT_LABEL: Record<string, string> = { facebook: 'Reconnect Facebook', youtube: 'Reconnect YouTube', linkedin: 'Reconnect LinkedIn', linkedin_person: 'Reconnect LinkedIn', instagram: 'Update token' };

export function StepAccounts({ token, platforms, selected, onChange, onLoaded, beforeLeave }: {
  token: string;
  platforms: Platform[];
  selected: Partial<Record<Platform, string[]>>;
  onChange: (s: Partial<Record<Platform, string[]>>) => void;
  onLoaded: (accounts: Partial<Record<Platform, PublishAccount[]>>) => void;
  beforeLeave: () => Promise<string | null>;
}) {
  const [accounts, setAccounts] = useState<Partial<Record<Platform, PublishAccount[]>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { connect, error: connectError, busy } = useConnect(token, beforeLeave);
  const key = platforms.join(',');

  useEffect(() => {
    let cancelled = false;
    getPublishAccounts(token, key.split(',') as Platform[])
      .then((r) => {
        if (cancelled) return;
        setAccounts(r.accounts);
        onLoaded(r.accounts);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load accounts'); });
    return () => { cancelled = true; };
    // onLoaded is a fresh closure each render; reloading on it would refetch in a loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, key]);

  if (error) return <div className="error-banner"><span>{error}</span></div>;
  if (!accounts) return <><p className="pf-hint">Checking each account's connection…</p><SectionSkeleton variant="list" rows={3} /></>;

  const toggle = (p: Platform, id: string) => {
    const cur = selected[p] ?? [];
    onChange({ ...selected, [p]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };

  return (
    <div className="pf-account-groups">
      {platforms.map((p) => (
        <section key={p} className="pf-account-group">
          <h3><PlatformIcon platform={p} size={18} /> {PLATFORM_LABEL[p]}</h3>
          <ul className="pf-accounts">
            {(accounts[p] ?? []).map((a) => {
              const usable = a.tokenStatus === 'ok';
              const on = (selected[p] ?? []).includes(a.id);
              return (
                <li key={a.id} className={`${usable ? '' : 'disabled'}${on ? ' selected' : ''}`}>
                  <label>
                    <input type="checkbox" checked={on && usable} disabled={!usable} onChange={() => toggle(p, a.id)} />
                    {a.avatar ? <img className="pf-avatar" src={a.avatar} alt="" /> : <span className="pf-avatar">{a.name.charAt(0)}</span>}
                    <span className="pf-account-main">
                      <b>{a.name}</b>
                      <small>{[a.handle, a.type].filter(Boolean).join(' · ')}</small>
                      {a.tokenMessage && <small className={usable ? 'pf-hint' : 'pf-error'}>{a.tokenMessage}</small>}
                      {p === 'facebook' && a.igLinked && <small className="pf-hint">Linked Instagram account: location search and product tags available</small>}
                    </span>
                  </label>
                  {!usable && a.reconnect && (a.reconnect === 'instagram'
                    ? <Link className="btn btn-secondary" to="/accounts">{RECONNECT_LABEL.instagram}</Link>
                    : <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => connect(a.reconnect as ConnectKind)}>{RECONNECT_LABEL[a.reconnect]}</button>)}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {connectError && <div className="error-banner"><span>{connectError}</span></div>}
    </div>
  );
}

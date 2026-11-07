import React, { useMemo, useState } from 'react';
import { joinWaitlist, WaitlistError } from '../services/api';
import { errorMessage } from '../utils/errors';
import { PlatformIcon } from './publish/PlatformIcon';
import type { Platform } from './publish/types';

const MAX_ACCOUNTS = 50;
const MAX_LINKS = 30;

type CountField = 'instagram' | 'facebook' | 'linkedin' | 'youtube';
const PLATFORMS: { field: CountField; platform: Platform; label: string; one: string }[] = [
  { field: 'instagram', platform: 'instagram', label: 'Instagram accounts', one: 'Instagram account' },
  { field: 'facebook', platform: 'facebook', label: 'Facebook pages', one: 'Facebook page' },
  { field: 'linkedin', platform: 'linkedin', label: 'LinkedIn pages', one: 'LinkedIn page' },
  { field: 'youtube', platform: 'youtube', label: 'YouTube channels', one: 'YouTube channel' },
];

/** Same splitting rules as the server: commas or new lines, https:// added, repeats dropped. */
function parseLinks(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const t = part.trim();
    if (!t) continue;
    const href = /^https?:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`;
    const key = href.toLowerCase().replace(/\/+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(href);
  }
  return out;
}

const looksLikeLink = (href: string) => {
  try {
    const u = new URL(href);
    return u.hostname.includes('.') && !/\s/.test(href);
  } catch {
    return false;
  }
};

type Errors = Partial<Record<CountField | 'email' | 'phone' | 'links' | 'accounts', string>>;

function checkForm(email: string, phone: string, counts: Record<CountField, number>, links: string[]): Errors {
  const e: Errors = {};
  if (!email.trim()) e.email = 'Enter your email address.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) e.email = 'Enter a valid email address, like name@example.com.';
  const digits = phone.replace(/\D/g, '').length;
  if (!phone.trim()) e.phone = 'Enter your contact number.';
  else if (/[^\d\s+\-().]/.test(phone) || digits < 10 || digits > 15) e.phone = 'Enter a contact number with 10 to 15 digits, for example +91 98765 43210.';
  if (PLATFORMS.every((p) => counts[p.field] === 0)) e.accounts = 'Add at least one account you want to connect.';
  if (!links.length) e.links = 'Add the links of the accounts you will manage, separated by commas.';
  else if (links.length > MAX_LINKS) e.links = `Add up to ${MAX_LINKS} links.`;
  else {
    const bad = links.find((l) => !looksLikeLink(l));
    if (bad) e.links = `This does not look like a link: ${bad.replace(/^https:\/\//, '')}`;
  }
  return e;
}

function Counter({ id, label, platform, value, onChange, invalid }: {
  id: string; label: string; platform: Platform; value: number; onChange: (n: number) => void; invalid: boolean;
}) {
  const set = (n: number) => onChange(Math.max(0, Math.min(MAX_ACCOUNTS, Number.isFinite(n) ? Math.round(n) : 0)));
  return (
    <div className={`wl-counter${value > 0 ? ' is-on' : ''}`}>
      <label htmlFor={id} className="wl-counter-label">
        <PlatformIcon platform={platform} size={18} />
        <span>{label}</span>
      </label>
      <div className="wl-stepper">
        <button type="button" onClick={() => set(value - 1)} disabled={value <= 0} aria-label={`One fewer ${label.toLowerCase()}`}>−</button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_ACCOUNTS}
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(e) => set(Number(e.target.value))}
          onFocus={(e) => e.target.select()}
        />
        <button type="button" onClick={() => set(value + 1)} disabled={value >= MAX_ACCOUNTS} aria-label={`One more ${label.toLowerCase()}`}>+</button>
      </div>
    </div>
  );
}

export const Waitlist: React.FC<{ onBackToSignIn: () => void }> = ({ onBackToSignIn }) => {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [counts, setCounts] = useState<Record<CountField, number>>({ instagram: 0, facebook: 0, linkedin: 0, youtube: 0 });
  const [linksText, setLinksText] = useState('');
  const [website, setWebsite] = useState(''); // spam trap
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ updated: boolean } | null>(null);

  const links = useMemo(() => parseLinks(linksText), [linksText]);
  const total = PLATFORMS.reduce((sum, p) => sum + counts[p.field], 0);

  const setCount = (field: CountField) => (n: number) => {
    setCounts((c) => ({ ...c, [field]: n }));
    setErrors((e) => ({ ...e, accounts: undefined, [field]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = checkForm(email, phone, counts, links);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length) {
      setFormError('Some details need fixing. Check the highlighted fields.');
      return;
    }
    setSaving(true);
    try {
      const result = await joinWaitlist({ email: email.trim(), phone: phone.trim(), ...counts, links: links.join(', '), website });
      setDone(result);
    } catch (err) {
      if (err instanceof WaitlistError) setErrors(err.fields as Errors);
      setFormError(errorMessage(err, 'Your details could not be saved. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <div className="wl-done" role="status">
        <div className="wl-done-mark" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        </div>
        <h2>{done.updated ? 'Your details are updated' : 'You are on the waiting list'}</h2>
        <p>We will contact you at <strong>{email.trim().toLowerCase()}</strong> or <strong>{phone.trim()}</strong> when your studio is ready.</p>
        <ul className="wl-summary">
          {PLATFORMS.filter((p) => counts[p.field] > 0).map((p) => (
            <li key={p.field}><PlatformIcon platform={p.platform} size={16} />{counts[p.field]} {counts[p.field] === 1 ? p.one : p.label}</li>
          ))}
          <li>{links.length} {links.length === 1 ? 'link' : 'links'} to manage</li>
        </ul>
        <button type="button" className="wl-secondary" onClick={onBackToSignIn}>Back to sign in</button>
      </div>
    );
  }

  const fieldError = (key: keyof Errors, id: string) =>
    errors[key] ? <span className="wl-field-error" id={id}>{errors[key]}</span> : null;

  return (
    <form onSubmit={handleSubmit} className="login-form" noValidate>
      {formError && (
        <div className="error-alert" role="alert">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          <span>{formError}</span>
        </div>
      )}

      <div className="form-group">
        <label htmlFor="wl-email">Email address</label>
        <div className="input-wrapper">
          <svg className="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></svg>
          <input id="wl-email" type="email" value={email} autoComplete="email" placeholder="you@example.com"
            aria-invalid={Boolean(errors.email) || undefined} aria-describedby={errors.email ? 'wl-email-err' : undefined}
            onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined })); }} />
        </div>
        {fieldError('email', 'wl-email-err')}
      </div>

      <div className="form-group">
        <label htmlFor="wl-phone">Contact number</label>
        <div className="input-wrapper">
          <svg className="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>
          <input id="wl-phone" type="tel" inputMode="tel" value={phone} autoComplete="tel" placeholder="+91 98765 43210"
            aria-invalid={Boolean(errors.phone) || undefined} aria-describedby={errors.phone ? 'wl-phone-err' : undefined}
            onChange={(e) => { setPhone(e.target.value); setErrors((x) => ({ ...x, phone: undefined })); }} />
        </div>
        {fieldError('phone', 'wl-phone-err')}
      </div>

      <fieldset className="wl-fieldset" aria-describedby={errors.accounts ? 'wl-accounts-err' : undefined}>
        <legend>How many accounts will you connect?</legend>
        <div className="wl-counters">
          {PLATFORMS.map((p) => (
            <Counter key={p.field} id={`wl-${p.field}`} label={p.label} platform={p.platform} value={counts[p.field]}
              onChange={setCount(p.field)} invalid={Boolean(errors.accounts || errors[p.field])} />
          ))}
        </div>
        <span className="wl-hint">{total === 0 ? 'Use + to add accounts.' : `${total} ${total === 1 ? 'account' : 'accounts'} in total.`}</span>
        {fieldError('accounts', 'wl-accounts-err')}
      </fieldset>

      <div className="form-group">
        <label htmlFor="wl-links">Links you will manage</label>
        <textarea id="wl-links" className="wl-textarea" rows={3} value={linksText}
          placeholder="instagram.com/yourbrand, youtube.com/@yourchannel, linkedin.com/company/yourbrand"
          aria-invalid={Boolean(errors.links) || undefined} aria-describedby={errors.links ? 'wl-links-err wl-links-hint' : 'wl-links-hint'}
          onChange={(e) => { setLinksText(e.target.value); setErrors((x) => ({ ...x, links: undefined })); }} />
        <span className="wl-hint" id="wl-links-hint">Separate links with commas. {links.length > 0 && `${links.length} ${links.length === 1 ? 'link' : 'links'} found.`}</span>
        {links.length > 0 && (
          <ul className="wl-chips" aria-label="Links found">
            {links.slice(0, 12).map((l) => (
              <li key={l} className={looksLikeLink(l) ? '' : 'is-bad'}>{l.replace(/^https?:\/\/(www\.)?/i, '')}</li>
            ))}
            {links.length > 12 && <li>+{links.length - 12} more</li>}
          </ul>
        )}
        {fieldError('links', 'wl-links-err')}
      </div>

      {/* Spam trap: hidden from people and screen readers. */}
      <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="wl-trap" />

      <button type="submit" className="submit-btn" disabled={saving}>
        {saving ? <span className="spinner-wrapper"><span className="spinner"></span> Saving your place...</span> : <span>Join the waiting list →</span>}
      </button>
      <p className="wl-privacy">We use these details only to contact you about your studio.</p>
    </form>
  );
};

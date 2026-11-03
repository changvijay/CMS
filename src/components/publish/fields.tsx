import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { InfoTip } from '../workspace/InfoTip';
import { searchPlaces } from '../../services/api';
import { charCount } from './mapping';
import { uploadFile } from './upload';
import { mediaSrc } from './helpers';
import type { MediaItem, Place } from './types';

/** Label, tooltip, counter, "Synced" badge and "Reset to shared", around any input. */
export function Field({ label, tip, children, count, limit, synced, syncable, onReset, warning, error, htmlFor, extra }: {
  label: string;
  tip?: string;
  children: ReactNode;
  count?: number;
  limit?: number;
  synced?: boolean;
  syncable?: boolean;
  onReset?: () => void;
  warning?: string;
  error?: string | null;
  htmlFor?: string;
  extra?: ReactNode;
}) {
  const over = limit !== undefined && count !== undefined && count > limit;
  return (
    <div className={`pf-field${error || over ? ' has-error' : ''}`}>
      <div className="pf-field-head">
        <label htmlFor={htmlFor}>{label}</label>
        {tip && <InfoTip text={tip} />}
        {syncable && (synced
          ? <span className="pf-badge synced" title="Filled from the shared fields. Edit it here to change it for this platform only.">Synced</span>
          : <button type="button" className="pf-badge reset" onClick={onReset} title="Follow the shared fields again">Reset to shared</button>)}
        {extra}
        {limit !== undefined && count !== undefined && <span className={`pf-count${over ? ' over' : count > limit * 0.9 ? ' near' : ''}`}>{count.toLocaleString()} / {limit.toLocaleString()}</span>}
      </div>
      {children}
      {warning && <p className="pf-warn" role="status">{warning}</p>}
      {error && <p className="pf-error">{error}</p>}
      {over && !error && <p className="pf-error">Over the {limit?.toLocaleString()}-character limit.</p>}
    </div>
  );
}

export function TextInput({ value, onChange, placeholder, id, type = 'text', maxLength }: { value: string; onChange: (v: string) => void; placeholder?: string; id?: string; type?: string; maxLength?: number }) {
  return <input id={id} type={type} className="pf-input" value={value ?? ''} placeholder={placeholder} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />;
}

export function TextArea({ value, onChange, placeholder, id, rows = 4 }: { value: string; onChange: (v: string) => void; placeholder?: string; id?: string; rows?: number }) {
  return <textarea id={id} className="pf-input" rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

/** A text field with label and counter in one go. */
export function TextField({ label, tip, value, onChange, limit, multiline, rows, placeholder, synced, syncable, onReset, warning, error }: {
  label: string; tip?: string; value: string; onChange: (v: string) => void; limit?: number; multiline?: boolean; rows?: number; placeholder?: string;
  synced?: boolean; syncable?: boolean; onReset?: () => void; warning?: string; error?: string | null;
}) {
  const id = useId();
  return (
    <Field label={label} tip={tip} htmlFor={id} count={limit ? charCount(value) : undefined} limit={limit} synced={synced} syncable={syncable} onReset={onReset} warning={warning} error={error}>
      {multiline ? <TextArea id={id} value={value} onChange={onChange} rows={rows} placeholder={placeholder} /> : <TextInput id={id} value={value} onChange={onChange} placeholder={placeholder} />}
    </Field>
  );
}

/** Words typed and confirmed with Enter or comma become chips. Pasting a list splits it. */
export function ChipsInput({ value, onChange, placeholder, prefix = '', max, id }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; prefix?: string; max?: number; id?: string }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(/[,\n]+/).map((p) => p.trim()).filter(Boolean).map((p) => (prefix && !p.startsWith(prefix) ? `${prefix}${p}` : p));
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(max ? next.slice(0, max) : next);
    setDraft('');
  };
  return (
    <div className="pf-chips">
      {value.map((v) => (
        <span key={v} className="pf-chip">
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>×</button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => (/[,\n]/.test(e.target.value) ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(draft); }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(draft)}
        disabled={max !== undefined && value.length >= max}
      />
    </div>
  );
}

export function Toggle({ checked, onChange, label, tip }: { checked: boolean; onChange: (v: boolean) => void; label: string; tip?: string }) {
  return (
    <label className="pf-toggle">
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
      <span className="pf-switch" aria-hidden="true" />
      <span>{label}</span>
      {tip && <InfoTip text={tip} />}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="pf-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'active' : ''} title={o.hint} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select({ value, onChange, options, id }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; id?: string }) {
  return (
    <select id={id} className="pf-input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Search Facebook places (used for Instagram location_id and Facebook place). An id can also be typed. */
export function PlaceSearch({ token, value, onChange, id }: { token: string; value: Place | null; onChange: (p: Place | null) => void; id?: string }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await searchPlaces(token, q.trim());
        if (!cancelled) { setResults(r.places); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, token]);

  if (value) {
    return (
      <div className="pf-place-chosen">
        <span>📍 {value.name}{value.detail ? <small> · {value.detail}</small> : null}</span>
        <button type="button" className="btn btn-secondary" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }
  const typedId = /^\d{5,}$/.test(q.trim());
  return (
    <div className="pf-place">
      <input id={id} className="pf-input" value={q} placeholder="Search a place, e.g. Marina Beach Chennai" onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) setResults([]); }} />
      {loading && <p className="pf-hint">Searching…</p>}
      {error && <p className="pf-hint">{error}{typedId ? '' : ' You can also paste a place id.'}</p>}
      {typedId && <button type="button" className="btn btn-secondary" onClick={() => onChange({ id: q.trim(), name: `Place ${q.trim()}` })}>Use place id {q.trim()}</button>}
      {results.length > 0 && (
        <ul className="pf-place-results">
          {results.map((p) => (
            <li key={p.id}><button type="button" onClick={() => { onChange(p); setQ(''); setResults([]); }}><b>{p.name}</b>{p.detail && <small>{p.detail}</small>}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtDur = (s?: number | null) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

export function MediaThumb({ item, className = '' }: { item: MediaItem; className?: string }) {
  if (item.kind === 'video') return <video className={`pf-thumb ${className}`} src={mediaSrc(item)} muted playsInline preload="metadata" />;
  if (item.kind === 'document') return <span className={`pf-thumb pf-thumb-doc ${className}`}>PDF</span>;
  return <img className={`pf-thumb ${className}`} src={mediaSrc(item)} alt="" />;
}

/**
 * Drop zone + list. Files upload right away (with progress); the list can be reordered, which sets the
 * carousel order. `single` replaces the current file instead of adding.
 */
export function MediaPicker({ token, value, onChange, accept = 'image/*,video/*,application/pdf', single, disabled, label = 'Add photos, videos or a PDF' }: {
  token: string; value: MediaItem[]; onChange: (items: MediaItem[]) => void; accept?: string; single?: boolean; disabled?: boolean; label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(value);
  // Uploads finish one by one after the click; they must add to the newest list, not the one from when they started.
  useEffect(() => { latest.current = value; }, [value]);
  const [dragging, setDragging] = useState(false);

  const upsert = (item: MediaItem) => {
    const list = latest.current;
    const next = list.some((m) => m.id === item.id) ? list.map((m) => (m.id === item.id ? item : m)) : single ? [item] : [...list, item];
    latest.current = next;
    onChange(next);
  };
  const addFiles = (files: FileList | File[]) => {
    const picked = Array.from(files);
    for (const f of single ? picked.slice(0, 1) : picked) uploadFile(token, f, upsert);
  };
  const move = (i: number, d: number) => {
    const next = [...value];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };

  return (
    <div className="pf-media">
      <div
        className={`pf-drop${dragging ? ' drag' : ''}${disabled ? ' disabled' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!disabled) addFiles(e.dataTransfer.files); }}
        onClick={() => !disabled && input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
      >
        <span className="pf-drop-icon" aria-hidden="true">⬆</span>
        <span>{label}</span>
        <small>Drag files here or click to choose</small>
        <input ref={input} type="file" hidden accept={accept} multiple={!single} onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
      </div>
      {value.length > 0 && (
        <ul className="pf-media-list">
          {value.map((m, i) => (
            <li key={m.id} className={m.status}>
              <MediaThumb item={m} />
              <div className="pf-media-meta">
                <b title={m.name}>{m.name}</b>
                <small>
                  {[fmtSize(m.bytes), m.width && m.height ? `${m.width}×${m.height}` : '', fmtDur(m.duration)].filter(Boolean).join(' · ')}
                </small>
                {m.status === 'uploading' && <span className="pf-progress"><span style={{ width: `${m.progress ?? 0}%` }} /></span>}
                {m.status === 'error' && <small className="pf-error">{m.error}</small>}
              </div>
              <div className="pf-media-actions">
                {!single && i > 0 && <button type="button" aria-label="Move earlier" onClick={() => move(i, -1)}>↑</button>}
                {!single && i < value.length - 1 && <button type="button" aria-label="Move later" onClick={() => move(i, 1)}>↓</button>}
                <button type="button" aria-label={`Remove ${m.name}`} onClick={() => onChange(value.filter((x) => x.id !== m.id))}>×</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Wraps a single optional file (thumbnail, cover) as a one-item picker. */
export function SingleMedia({ token, value, onChange, accept = 'image/jpeg,image/png', label }: { token: string; value: MediaItem | null; onChange: (m: MediaItem | null) => void; accept?: string; label: string }) {
  return <MediaPicker token={token} single accept={accept} label={label} value={value ? [value] : []} onChange={(items) => onChange(items[0] ?? null)} />;
}

export function Issues({ items }: { items: { level: string; message: string }[] }) {
  if (!items.length) return null;
  return (
    <ul className="pf-issues">
      {items.map((i, n) => <li key={`${i.message}-${n}`} className={i.level}>{i.message}</li>)}
    </ul>
  );
}

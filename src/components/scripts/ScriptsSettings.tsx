import { useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowSquareOut, CheckCircle, DownloadSimple, FileXls, Info, Lock, Plus, Robot, ShieldCheck, Tag, Target, Trash, WarningCircle,
} from '@phosphor-icons/react';
import {
  addDefaultNiches, deleteCategory, deleteNiche, downloadExport, listNiches, removeProvider, saveCategory,
  saveNiche, saveProvider, testProvider, updateAiSettings, type AiSettings, type Niche, type ProviderKey, type ScriptCategory,
} from '../../services/scriptsApi';
import { errorMessage } from '../../utils/errors';
import { useLive } from '../workspace/useLive';
import { Modal } from '../workspace/ui';
import ImportPanel from './ImportPanel';
import { EmptyState, SkeletonRows } from './shared';
import { KEY, confirmDialog, refreshScripts, toast, useAiSettings, useCategories } from './util';

const SECTIONS = [
  { id: 'ai', label: 'AI providers', icon: Robot },
  { id: 'niches', label: 'Content niches', icon: Target },
  { id: 'categories', label: 'Categories', icon: Tag },
  { id: 'import', label: 'Import & backup', icon: FileXls },
  { id: 'about', label: 'Privacy', icon: ShieldCheck },
] as const;
type Section = (typeof SECTIONS)[number]['id'];

const LANGUAGES = ['Tamil', 'English', 'Malayalam', 'Kannada', 'Telugu', 'Hindi'];

export default function ScriptsSettings({ token }: { token: string }) {
  const [params, setParams] = useSearchParams();
  const section = (SECTIONS.find((s) => s.id === params.get('section'))?.id ?? 'ai') as Section;

  return (
    <div className="sv-settings">
      <nav className="sv-settings-nav" aria-label="Settings">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={section === id ? 'active' : ''} aria-current={section === id ? 'page' : undefined}
            onClick={() => setParams({ section: id }, { replace: true })}>
            <Icon size={18} weight={section === id ? 'fill' : 'regular'} aria-hidden="true" /> {label}
          </button>
        ))}
      </nav>
      <div className="sv-settings-body">
        {section === 'import' && <ImportExport token={token} />}
        {section === 'categories' && <Categories token={token} />}
        {section === 'ai' && <Providers token={token} />}
        {section === 'niches' && <Niches token={token} />}
        {section === 'about' && <About />}
      </div>
    </div>
  );
}

function SettingsCard({ title, sub, actions, children }: { title: string; sub?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <section className="sv-card">
      <div className="sv-card-head">
        <div>
          <h2 className="title-2">{title}</h2>
          {sub && <p className="body-6 sv-soft">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ import / export
function ImportExport({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const backup = async () => {
    setBusy(true);
    try { await downloadExport(token); } catch (err) { toast(errorMessage(err, 'Could not download the backup.'), 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <SettingsCard title="Import scripts" sub="Bring scripts in from Excel. A Folder column puts rows into folders (new ones are created). You review everything before it is added. To import into one folder, use Import in that folder.">
        <ImportPanel token={token} />
      </SettingsCard>
      <SettingsCard title="Back up" sub="Download every script, to-do and goal as one Excel workbook. Each folder also has its own Export."
        actions={<button type="button" className="sv-btn sv-btn-ghost" disabled={busy} onClick={backup}><DownloadSimple size={16} aria-hidden="true" /> Download backup</button>} />
    </>
  );
}

// ------------------------------------------------------------------ categories
function Categories({ token }: { token: string }) {
  const state = useCategories(token);
  const [editing, setEditing] = useState<ScriptCategory | 'new' | null>(null);

  const remove = async (c: ScriptCategory) => {
    if (!(await confirmDialog({ title: `Delete “${c.name}”?`, body: c.script_count ? `It will be removed from ${c.script_count} script${c.script_count > 1 ? 's' : ''}. The scripts stay.` : undefined, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await deleteCategory(token, c.id);
      refreshScripts();
      toast('Category deleted');
    } catch (err) {
      toast(errorMessage(err, 'Could not delete.'), 'error');
    }
  };

  return (
    <SettingsCard title="Categories" sub="Colour tags for filtering. A script can have several." actions={<button type="button" className="sv-btn sv-btn-primary" onClick={() => setEditing('new')}><Plus size={16} weight="bold" aria-hidden="true" /> Add</button>}>
      {!state.data ? <SkeletonRows rows={3} /> : state.data.categories.length === 0 ? <p className="body-6 sv-soft">No categories yet.</p> : (
        <ul className="sv-manage">
          {state.data.categories.map((c) => (
            <li key={c.id}>
              <span className="sv-swatch" style={{ background: c.color }} aria-hidden="true" />
              <span className="sv-grow body-5">{c.name}</span>
              <span className="caption-4 sv-soft">{c.script_count} script{c.script_count === 1 ? '' : 's'}</span>
              <button type="button" className="sv-link caption-3" onClick={() => setEditing(c)}>Edit</button>
              <button type="button" className="sv-icon-btn sv-danger-btn" onClick={() => remove(c)} aria-label={`Delete ${c.name}`}><Trash size={16} /></button>
            </li>
          ))}
        </ul>
      )}
      {editing && state.data && <CategoryModal token={token} category={editing === 'new' ? null : editing} colors={state.data.colors} onClose={() => setEditing(null)} />}
    </SettingsCard>
  );
}

function CategoryModal({ token, category, colors, onClose }: { token: string; category: ScriptCategory | null; colors: string[]; onClose: () => void }) {
  const [name, setName] = useState(category?.name ?? '');
  const [color, setColor] = useState(category?.color ?? colors[6] ?? '#3B82F6');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Give it a name.'); return; }
    try {
      await saveCategory(token, { name: name.trim(), color }, category?.id);
      refreshScripts();
      toast(category ? 'Category updated' : 'Category added');
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save.'));
    }
  };
  return (
    <Modal title={category ? 'Edit category' : 'New category'} onClose={onClose}>
      <form className="sv-form" onSubmit={submit} noValidate>
        <label className="sv-field"><span className="caption-3">Name</span><input type="text" className="sv-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Market updates" autoFocus /></label>
        <div className="sv-field">
          <span className="caption-3">Colour</span>
          <div className="sv-swatches" role="radiogroup" aria-label="Colour">
            {colors.map((c) => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} className={`sv-swatch-btn ${color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />)}
          </div>
        </div>
        <div className="sv-field"><span className="caption-3">Preview</span><span className="sv-cat" style={{ ['--cat' as string]: color, alignSelf: 'flex-start' }}>{name || 'Category'}</span></div>
        {error && <div className="sv-banner error" role="alert">{error}</div>}
        <div className="sv-actions">
          <button type="submit" className="sv-btn sv-btn-primary">Save</button>
          <button type="button" className="sv-btn sv-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ AI providers
function Providers({ token }: { token: string }) {
  const state = useAiSettings(token);
  const [editing, setEditing] = useState<ProviderKey | null>(null);
  const makeDefault = async (k: ProviderKey) => {
    try { await updateAiSettings(token, { active_provider: k }); refreshScripts(); toast('Default provider changed'); } catch (err) { toast(errorMessage(err, 'Could not change it.'), 'error'); }
  };
  return (
    <SettingsCard title="AI providers" sub="Use your own API key. Usage is billed by the provider to your account.">
      <p className="sv-note caption-2"><Lock size={16} weight="fill" aria-hidden="true" /> Keys are encrypted on our server and never shown again. Requests go from the server, not your browser.</p>
      {!state.data ? <SkeletonRows rows={4} /> : (
        <ul className="sv-providers">
          {(Object.keys(state.data.catalog.providers) as ProviderKey[]).map((k) => {
            const s = state.data!;
            const meta = s.catalog.providers[k];
            const p = s.providers[k];
            return (
              <li key={k} className={`sv-provider ${p.enabled ? 'on' : ''}`} style={{ ['--prov' as string]: meta.color }}>
                <span className="sv-prov-mark" aria-hidden="true">{meta.name.split(' ').pop()![0]}</span>
                <span className="sv-grow">
                  <span className="title-4">{meta.name} {s.active_provider === k && <span className="sv-badge sv-badge-accent">Default</span>}</span>
                  <span className="caption-5 sv-soft">{p.enabled ? `Connected · key ending ${p.last4} · ${meta.models.find((m) => m.id === p.model)?.label ?? p.model}` : p.configured ? 'Turned off' : 'Not connected'}</span>
                </span>
                {p.enabled && s.active_provider !== k && <button type="button" className="sv-link caption-3" onClick={() => makeDefault(k)}>Make default</button>}
                <button type="button" className={`sv-btn sv-btn-sm ${p.configured ? 'sv-btn-ghost' : 'sv-btn-primary'}`} onClick={() => setEditing(k)}>{p.configured ? 'Manage' : 'Connect'}</button>
              </li>
            );
          })}
        </ul>
      )}
      {editing && state.data && <ProviderModal token={token} settings={state.data} provider={editing} onClose={() => setEditing(null)} />}
    </SettingsCard>
  );
}

function ProviderModal({ token, settings, provider, onClose }: { token: string; settings: AiSettings; provider: ProviderKey; onClose: () => void }) {
  const meta = settings.catalog.providers[provider];
  const current = settings.providers[provider];
  const [enabled, setEnabled] = useState(current.configured ? current.enabled : true);
  const [apiKey, setApiKey] = useState('');
  const [show, setShow] = useState(false);
  const [model, setModel] = useState(current.model);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<'' | 'test' | 'save'>('');

  const run = async (kind: 'test' | 'save', fn: () => Promise<void>) => {
    setBusy(kind);
    setMsg(null);
    try { await fn(); } catch (err) { setMsg({ ok: false, text: errorMessage(err, 'Something went wrong.') }); } finally { setBusy(''); }
  };

  const test = () => run('test', async () => {
    await testProvider(token, provider, apiKey.trim() || undefined);
    setMsg({ ok: true, text: 'Connection works.' });
  });

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim() && !current.configured) { setMsg({ ok: false, text: 'Paste your API key first.' }); return; }
    run('save', async () => {
      await saveProvider(token, provider, { api_key: apiKey.trim() || undefined, enabled, model });
      refreshScripts();
      toast(`${meta.name} ${current.configured ? 'updated' : 'connected'}`);
      onClose();
    });
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: `Remove your ${meta.name} key?`, body: 'The AI assistant stops using it right away.', confirmLabel: 'Remove', danger: true }))) return;
    run('save', async () => {
      await removeProvider(token, provider);
      refreshScripts();
      toast(`${meta.name} disconnected`);
      onClose();
    });
  };

  return (
    <Modal title={`${current.configured ? 'Manage' : 'Connect'} ${meta.name}`} onClose={onClose}>
      <form className="sv-form" onSubmit={save} noValidate>
        <ol className="sv-howto body-6">
          <li>Open <a className="sv-link" href={meta.keyUrl} target="_blank" rel="noopener noreferrer">{meta.name} keys <ArrowSquareOut size={14} aria-hidden="true" /></a> and create a key.</li>
          <li>Paste it below. We test it before saving.</li>
        </ol>
        <label className="sv-field">
          <span className="caption-3">API key</span>
          <span className="sv-row">
            <input type={show ? 'text' : 'password'} className="sv-input sv-grow" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false}
              placeholder={current.configured ? `Saved key ends in ${current.last4}. Leave empty to keep it` : 'Paste your key'} />
            <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={() => setShow((v) => !v)}>{show ? 'Hide' : 'Show'}</button>
          </span>
        </label>
        <fieldset className="sv-field sv-fieldset">
          <legend className="caption-3">Model</legend>
          <div className="sv-options">
            {meta.models.map((m) => (
              <label key={m.id} className={`sv-option ${model === m.id ? 'active' : ''}`}>
                <input type="radio" name="model" value={m.id} checked={model === m.id} onChange={() => setModel(m.id)} />
                <span className="body-5">{m.label}</span>
                {m.id === meta.defaultModel && <span className="sv-badge">Recommended</span>}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="sv-switch">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="sv-switch-track" aria-hidden="true" /><span className="body-5">Use {meta.name}</span>
        </label>
        {msg && <div className={`sv-banner ${msg.ok ? 'ok' : 'error'}`} role="status">{msg.ok ? <CheckCircle size={18} weight="fill" /> : <WarningCircle size={18} weight="fill" />}<span className="body-5">{msg.text}</span></div>}
        <div className="sv-actions">
          <button type="submit" className="sv-btn sv-btn-primary" disabled={Boolean(busy)}>{busy === 'save' ? 'Checking the key…' : current.configured ? 'Save' : 'Test and connect'}</button>
          <button type="button" className="sv-btn sv-btn-ghost" disabled={Boolean(busy) || (!apiKey.trim() && !current.configured)} onClick={test}>{busy === 'test' ? 'Testing…' : 'Test only'}</button>
          {current.configured && <button type="button" className="sv-btn sv-btn-ghost sv-danger-text sv-push" disabled={Boolean(busy)} onClick={remove}>Remove key</button>}
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ niches
function Niches({ token }: { token: string }) {
  const ai = useAiSettings(token);
  const state = useLive(() => listNiches(token), `${KEY}niches`);
  const [editing, setEditing] = useState<Niche | 'new' | null>(null);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try { await fn(); refreshScripts(); toast(done); } catch (err) { toast(errorMessage(err, 'Could not save.'), 'error'); }
  };
  const remove = async (n: Niche) => {
    if (await confirmDialog({ title: `Delete “${n.title}”?`, body: 'Its daily ideas are deleted too. Scripts stay.', confirmLabel: 'Delete', danger: true })) act(() => deleteNiche(token, n.id), 'Niche deleted');
  };

  return (
    <SettingsCard title="Content niches" sub="Tell the AI who you create for. It writes hooks, captions and ideas for the active niche, in its language."
      actions={<button type="button" className="sv-btn sv-btn-primary" onClick={() => setEditing('new')}><Plus size={16} weight="bold" aria-hidden="true" /> Add niche</button>}>
      {!ai.data?.active_provider && !ai.loading && <p className="sv-note caption-2"><Info size={16} weight="fill" aria-hidden="true" /> Niches are used by the AI assistant. Connect a provider to use them.</p>}
      {!state.data ? <SkeletonRows rows={2} tall /> : state.data.length === 0 ? (
        <EmptyState icon={<Target size={28} weight="duotone" />} title="No niche yet" body="Describe your audience once, and every AI answer fits it. Start from an example if you like.">
          <button type="button" className="sv-btn sv-btn-ghost" onClick={() => act(() => addDefaultNiches(token), 'Example niches added')}>Load 3 examples</button>
          <button type="button" className="sv-btn sv-btn-primary" onClick={() => setEditing('new')}>Describe my niche</button>
        </EmptyState>
      ) : (
        <ul className="sv-niches">
          {state.data.map((n) => {
            const active = ai.data?.active_niche_id === n.id;
            return (
              <li key={n.id} className={active ? 'active' : ''}>
                <div className="sv-grow">
                  <span className="title-4">{n.title}</span> <span className="sv-badge">{n.language}</span> {active && <span className="sv-badge sv-badge-accent">Active</span>}
                  <p className="body-6 sv-soft sv-clamp-2">{n.description}</p>
                </div>
                <div className="sv-row">
                  {!active && <button type="button" className="sv-link caption-3" onClick={() => act(() => updateAiSettings(token, { active_niche_id: n.id }), `${n.title} is now active`)}>Make active</button>}
                  <button type="button" className="sv-link caption-3" onClick={() => setEditing(n)}>Edit</button>
                  <button type="button" className="sv-icon-btn sv-danger-btn" onClick={() => remove(n)} aria-label={`Delete ${n.title}`}><Trash size={16} /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <NicheModal token={token} niche={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </SettingsCard>
  );
}

function NicheModal({ token, niche, onClose }: { token: string; niche: Niche | null; onClose: () => void }) {
  const [title, setTitle] = useState(niche?.title ?? '');
  const [language, setLanguage] = useState(niche?.language ?? 'Tamil');
  const [description, setDescription] = useState(niche?.description ?? '');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('Name your niche.'); return; }
    try {
      await saveNiche(token, { title: title.trim(), language: language.trim() || 'English', description: description.trim() }, niche?.id);
      refreshScripts();
      toast(niche ? 'Niche updated' : 'Niche added');
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save.'));
    }
  };
  return (
    <Modal title={niche ? 'Edit niche' : 'New niche'} onClose={onClose}>
      <form className="sv-form" onSubmit={submit} noValidate>
        <label className="sv-field"><span className="caption-3">Niche</span><input type="text" className="sv-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Stock market basics for beginners" autoFocus /></label>
        <div className="sv-field">
          <span className="caption-3">Audience language</span>
          <div className="sv-chiprow">{LANGUAGES.map((l) => <button key={l} type="button" className={`sv-chip ${language === l ? 'active' : ''}`} aria-pressed={language === l} onClick={() => setLanguage(l)}>{l}</button>)}</div>
          <span className="caption-5 sv-soft">Or type another language:</span>
          <input type="text" className="sv-input" value={language} maxLength={40} onChange={(e) => setLanguage(e.target.value)} aria-label="Language" />
        </div>
        <label className="sv-field">
          <span className="caption-3">Audience and style</span>
          <textarea className="sv-input" rows={4} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} placeholder="Who watches, what they want, your tone. e.g. Tamil speaking first time investors, simple words, relatable examples from daily life." />
        </label>
        {error && <div className="sv-banner error" role="alert">{error}</div>}
        <div className="sv-actions">
          <button type="submit" className="sv-btn sv-btn-primary">Save</button>
          <button type="button" className="sv-btn sv-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function About() {
  return (
    <SettingsCard title="Privacy and your data" sub="Scripts, inside CMS Analytics Studio.">
      <ul className="sv-about">
        <li><ShieldCheck size={20} weight="duotone" aria-hidden="true" /><span className="body-6">Scripts, categories, goals and to-dos are saved to your account, so they match on every device.</span></li>
        <li><Lock size={20} weight="duotone" aria-hidden="true" /><span className="body-6">AI requests go from our server to the provider you chose, with <b>your</b> key. Keys are encrypted (AES-256-GCM) and never sent back to the browser.</span></li>
        <li><DownloadSimple size={20} weight="duotone" aria-hidden="true" /><span className="body-6">Download a full backup any time from Import &amp; backup.</span></li>
      </ul>
    </SettingsCard>
  );
}

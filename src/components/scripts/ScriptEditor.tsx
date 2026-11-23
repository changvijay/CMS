import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowSquareOut, CaretRight, CheckCircle, CircleNotch, Folder, Robot, SlidersHorizontal, Trash, WarningCircle } from '@phosphor-icons/react';
import { createScript, deleteScript, getScript, localToday, updateScript, type Script, type ScriptInput, type ScriptStatus } from '../../services/scriptsApi';
import { errorMessage } from '../../utils/errors';
import { useLive } from '../workspace/useLive';
import AiAssistant from './AiAssistant';
import { SkeletonRows, StatusDot } from './shared';
import { KEY, STATUSES, STATUS_LABEL, confirmDialog, deadlineLabel, refreshScripts, toast, useCategories, useFolders, useGoals, wordCount } from './util';

interface Form {
  title: string;
  notes: string;
  reference: string;
  status: ScriptStatus;
  deadline: string;
  goal_id: string;
  folder_id: string;
  category_ids: string[];
}

const EMPTY: Form = { title: '', notes: '', reference: '', status: 'not_started', deadline: '', goal_id: '', folder_id: '', category_ids: [] };
const AUTOSAVE_MS = 1000;

const fromScript = (s: Script): Form => ({
  title: s.title, notes: s.notes, reference: s.reference, status: s.status, deadline: s.deadline ?? '', goal_id: s.goal_id ?? '', folder_id: s.folder_id ?? '', category_ids: s.category_ids,
});

/** Loads the script (or starts a blank one, with ?date= as the deadline) and hands it to the form. */
export default function ScriptEditor({ token, id }: { token: string; id: string }) {
  const isNew = id === 'new';
  const [params] = useSearchParams();
  const existing = useLive(() => getScript(token, id), `${KEY}item:${id}`, !isNew);

  if (isNew) return <EditorForm token={token} initialId={null} initial={{ ...EMPTY, deadline: params.get('date') ?? '', folder_id: params.get('folder') ?? '' }} />;
  if (existing.error) return <div className="sv-banner error">{existing.error} <Link className="sv-link" to="/scripts/library">Back to scripts</Link></div>;
  // Later background refreshes must not wipe typing, so the form only takes the first copy it is given.
  if (!existing.data) return <SkeletonRows rows={4} tall />;
  return <EditorForm token={token} initialId={id} initial={fromScript(existing.data)} />;
}

type SaveState = 'saved' | 'pending' | 'saving' | 'error';

function EditorForm({ token, initialId, initial }: { token: string; initialId: string | null; initial: Form }) {
  const navigate = useNavigate();
  const today = localToday();
  const cats = useCategories(token);
  const goals = useGoals(token);
  const foldersState = useFolders(token);
  const folders = foldersState.data?.folders ?? [];

  const [scriptId, setScriptId] = useState<string | null>(initialId);
  const [form, setForm] = useState<Form>(initial);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState('');
  const [panel, setPanel] = useState<'details' | 'ai'>('details');
  const lastSaved = useRef(JSON.stringify(initial));
  const saving = useRef<Promise<void> | null>(null);

  const save = useCallback(async (f: Form) => {
    const snapshot = JSON.stringify(f);
    if (snapshot === lastSaved.current) { setSaveState('saved'); return; }
    if (!f.title.trim()) { setSaveState(scriptId ? 'error' : 'pending'); if (scriptId) setSaveError('Give the script a title to save it.'); return; }
    const input: ScriptInput = { ...f, title: f.title.trim(), deadline: f.deadline || null, goal_id: f.goal_id || null, folder_id: f.folder_id || null };
    setSaveState('saving');
    setSaveError('');
    try {
      if (scriptId) {
        await updateScript(token, scriptId, input);
      } else {
        const s = await createScript(token, input);
        setScriptId(s.id);
        // Swap the address without remounting the editor, so typing is not interrupted.
        window.history.replaceState(window.history.state, '', `/scripts/library/${s.id}`);
      }
      lastSaved.current = snapshot;
      setSaveState('saved');
      refreshScripts();
    } catch (err) {
      setSaveState('error');
      setSaveError(errorMessage(err, 'Could not save.'));
    }
  }, [scriptId, token]);

  // Autosave a moment after the last change.
  useEffect(() => {
    if (JSON.stringify(form) === lastSaved.current) return;
    const t = setTimeout(() => { saving.current = save(form); }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [form, save]);

  // Ctrl/Cmd+S saves now; leaving with unsaved text asks first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saving.current = save(form); }
    };
    const onLeave = (e: BeforeUnloadEvent) => { if (JSON.stringify(form) !== lastSaved.current) e.preventDefault(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onLeave);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onLeave); };
  }, [form, save]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaveState('pending');
  };

  // Back goes to the folder the script is in now.
  const libraryHref = form.folder_id ? `/scripts/library?folder=${form.folder_id}` : '/scripts/library';
  const folder = folders.find((f) => f.id === form.folder_id) ?? null;
  const back = async () => {
    if (JSON.stringify(form) !== lastSaved.current) await save(form);
    navigate(libraryHref);
  };

  const remove = async () => {
    if (!scriptId) { navigate('/scripts/library'); return; }
    if (!(await confirmDialog({ title: 'Delete this script?', body: `“${form.title || 'Untitled'}” will be removed for good.`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await deleteScript(token, scriptId);
      lastSaved.current = JSON.stringify(form);
      refreshScripts();
      toast('Script deleted');
      navigate(libraryHref);
    } catch (err) {
      toast(errorMessage(err, 'Could not delete the script.'), 'error');
    }
  };

  const acceptAi = (text: string) => {
    const before = form.notes;
    set('notes', text);
    toast('Notes replaced with the AI version', 'ok', { label: 'Undo', run: () => set('notes', before) });
  };

  const toggleCategory = (cid: string) => set('category_ids', form.category_ids.includes(cid) ? form.category_ids.filter((c) => c !== cid) : [...form.category_ids, cid]);
  const refOk = /^https?:\/\/\S+$/i.test(form.reference.trim());
  const words = wordCount(form.notes);
  const seconds = Math.round((words / 150) * 60);

  return (
    <div className="sv-editor">
      <div className="sv-editor-bar">
        <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={back} aria-label={`Back to ${folder?.name ?? 'library'}`}><ArrowLeft size={16} aria-hidden="true" /></button>
        <nav className="sv-crumbs caption-4" aria-label="Breadcrumb">
          <Link to="/scripts/library">Library</Link>
          {folder && <><CaretRight size={12} aria-hidden="true" /><Link to={libraryHref} style={{ ['--folder' as string]: folder.color }} className="sv-crumb-folder"><Folder size={14} weight="fill" aria-hidden="true" />{folder.name}</Link></>}
          <CaretRight size={12} aria-hidden="true" /><span aria-current="page" className="sv-ellipsis">{form.title.trim() || 'Untitled'}</span>
        </nav>
        <div className="sv-seg sv-status-seg" role="radiogroup" aria-label="Status">
          {STATUSES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={form.status === s} className={`${form.status === s ? 'active' : ''} sv-st-${s}`} onClick={() => set('status', s)}>
              <StatusDot status={s} />{STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <span className={`sv-save caption-4 ${saveState}`} role="status" aria-live="polite">
          {saveState === 'saving' && <><CircleNotch size={14} className="sv-spin" aria-hidden="true" /> Saving</>}
          {saveState === 'saved' && (scriptId ? <><CheckCircle size={14} weight="fill" aria-hidden="true" /> Saved</> : 'Add a title to save')}
          {saveState === 'pending' && (form.title.trim() ? 'Editing' : 'Add a title to save')}
          {saveState === 'error' && <><WarningCircle size={14} weight="fill" aria-hidden="true" /> {saveError || 'Not saved'}</>}
        </span>
        <button type="button" className="sv-icon-btn sv-danger-btn" onClick={remove} aria-label="Delete script" title="Delete script"><Trash size={18} /></button>
      </div>

      <div className="sv-editor-grid">
        <section className="sv-paper" aria-label="Script">
          <textarea className="sv-title-input heading-4" rows={1} value={form.title} maxLength={200} placeholder="Untitled script"
            onChange={(e) => set('title', e.target.value.replace(/\n/g, ' '))} autoFocus={!initialId} aria-label="Title" />
          <textarea className="sv-notes body-3" value={form.notes} onChange={(e) => set('notes', e.target.value)} aria-label="Script notes"
            placeholder={'Start with the hook. The first line decides if they keep watching.\n\nThen the body, then a clear call to action.'} />
          <div className="sv-paper-foot caption-5">
            <span>{words} words</span>
            <span>About {seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`} spoken</span>
            <span className="sv-soft">Saves automatically · Ctrl/⌘ S</span>
          </div>
        </section>

        <aside className="sv-side">
          <div className="sv-seg sv-side-tabs" role="tablist" aria-label="Side panel">
            <button type="button" role="tab" aria-selected={panel === 'details'} className={panel === 'details' ? 'active' : ''} onClick={() => setPanel('details')}><SlidersHorizontal size={16} aria-hidden="true" /> Details</button>
            <button type="button" role="tab" aria-selected={panel === 'ai'} className={panel === 'ai' ? 'active' : ''} onClick={() => setPanel('ai')}><Robot size={16} aria-hidden="true" /> AI assistant</button>
          </div>

          {panel === 'ai' ? <AiAssistant token={token} content={form.notes} onAccept={acceptAi} /> : (
            <div className="sv-fields">
              <label className="sv-field">
                <span className="caption-3">Folder</span>
                <select className="sv-input" value={form.folder_id} onChange={(e) => set('folder_id', e.target.value)}>
                  <option value="">No folder</option>
                  {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>

              <label className="sv-field">
                <span className="caption-3">Deadline</span>
                <span className="sv-row">
                  <input type="date" className="sv-input" value={form.deadline} min={form.deadline && form.deadline < today ? undefined : today} onChange={(e) => set('deadline', e.target.value)} />
                  {form.deadline && <button type="button" className="sv-link" onClick={() => set('deadline', '')}>Clear</button>}
                </span>
                {form.deadline && <span className={`caption-4 ${form.deadline < today && form.status !== 'completed' ? 'sv-bad' : 'sv-soft'}`}>{deadlineLabel(form.deadline, form.status === 'completed')}</span>}
              </label>

              <div className="sv-field">
                <span className="caption-3">Categories</span>
                <div className="sv-chiprow">
                  {(cats.data?.categories ?? []).map((c) => (
                    <button key={c.id} type="button" className={`sv-chip sv-chip-cat ${form.category_ids.includes(c.id) ? 'active' : ''}`} style={{ ['--cat' as string]: c.color }}
                      aria-pressed={form.category_ids.includes(c.id)} onClick={() => toggleCategory(c.id)}>{c.name}</button>
                  ))}
                  <Link to="/scripts/settings?section=categories" className="sv-link caption-3">Manage</Link>
                </div>
              </div>

              <label className="sv-field">
                <span className="caption-3">Counts toward goal</span>
                <select className="sv-input" value={form.goal_id} onChange={(e) => set('goal_id', e.target.value)}>
                  <option value="">No goal</option>
                  {(goals.data ?? []).filter((g) => !g.completed || g.id === form.goal_id).map((g) => <option key={g.id} value={g.id}>{g.title} ({g.current_progress}/{g.target_value})</option>)}
                </select>
              </label>

              <label className="sv-field">
                <span className="caption-3">Reference link</span>
                <input type="url" className="sv-input" value={form.reference} maxLength={2000} onChange={(e) => set('reference', e.target.value)} placeholder="Inspiration reel, article, source…" />
                {refOk && <a className="sv-link caption-3" href={form.reference.trim()} target="_blank" rel="noopener noreferrer">Open link <ArrowSquareOut size={14} aria-hidden="true" /></a>}
              </label>

              <button type="button" className="sv-ai-promo" onClick={() => setPanel('ai')}>
                <Robot size={20} weight="duotone" aria-hidden="true" />
                <span><span className="title-4">Stuck on the hook?</span><span className="caption-5 sv-soft">Ask the AI assistant to enhance, add a hook, fix grammar or shorten.</span></span>
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

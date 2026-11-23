import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowClockwise, ArrowDown, ArrowUp, BookmarkSimple, Check, Copy, DotsSixVertical, Eye, EyeSlash, PaperPlaneRight, Robot, Trash, X } from '@phosphor-icons/react';
import { runAi, updateAiSettings, type ActionPrefs, type AiSettings, type CustomPrompt, type ProviderKey } from '../../services/scriptsApi';
import { errorMessage } from '../../utils/errors';
import { Modal } from '../workspace/ui';
import { EmptyState } from './shared';
import { confirmDialog, refreshScripts, toast, useAiSettings, wordCount } from './util';

const EMOJIS = ['✨', '⚡️', '🚀', '🔥', '💡', '🎯', '🎨', '📝', '🌐', '💬'];

interface Button { id: string; label: string; emoji: string; description: string; custom?: CustomPrompt }

/** The buttons in the user's order: built-in actions and saved prompts. */
function buttonsOf(s: AiSettings): Button[] {
  const all: Button[] = [
    ...Object.values(s.catalog.actions).map((a) => ({ id: a.key, label: a.label, emoji: a.emoji, description: a.description })),
    ...s.action_prefs.custom_prompts.map((c) => ({ id: c.id, label: c.label, emoji: c.emoji, description: c.prompt, custom: c })),
  ];
  const order = [...s.action_prefs.order, ...all.map((b) => b.id).filter((id) => !s.action_prefs.order.includes(id))];
  return order.map((id) => all.find((b) => b.id === id)).filter((b): b is Button => Boolean(b));
}

interface Run { label: string; action?: string; prompt?: string }

export default function AiAssistant({ token, content, onAccept }: { token: string; content: string; onAccept: (text: string) => void }) {
  const ai = useAiSettings(token);
  const [instruction, setInstruction] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [result, setResult] = useState<{ text: string; provider: string; model: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [managing, setManaging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const s = ai.data;
  if (!s) return ai.error ? <div className="sv-banner error">{ai.error}</div> : null;
  if (!s.active_provider) {
    return (
      <EmptyState icon={<Robot size={28} weight="duotone" />} title="Bring your own AI" body="Connect Gemini, Claude, Groq or OpenRouter with your own key. Then enhance scripts, add hooks and fix grammar in one click.">
        <Link className="sv-btn sv-btn-primary" to="/scripts/settings?section=ai">Connect a provider</Link>
      </EmptyState>
    );
  }

  const buttons = buttonsOf(s);
  const visible = buttons.filter((b) => !s.action_prefs.hidden.includes(b.id));

  const savePrefs = async (prefs: ActionPrefs) => {
    try {
      await updateAiSettings(token, { action_prefs: prefs });
      refreshScripts();
    } catch (err) {
      toast(errorMessage(err, 'Could not save.'), 'error');
    }
  };

  const go = async (r: Run) => {
    if (!content.trim()) { setError('Write a few lines first. The assistant works on your notes.'); return; }
    setRun(r);
    setResult(null);
    setBusy(true);
    setError('');
    try {
      setResult(await runAi(token, { action: r.action, prompt: r.prompt, content }));
    } catch (err) {
      setError(errorMessage(err, 'The AI request failed.'));
    } finally {
      setBusy(false);
    }
  };

  const send = (e: FormEvent) => {
    e.preventDefault();
    if (instruction.trim()) go({ label: 'Your instruction', prompt: instruction.trim() });
  };

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = buttons.map((b) => b.id);
    ids.splice(ids.indexOf(dragId), 1);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    setDragId(null);
    savePrefs({ ...s.action_prefs, order: ids });
  };

  const setProvider = async (key: ProviderKey) => {
    try {
      await updateAiSettings(token, { active_provider: key });
      refreshScripts();
    } catch (err) {
      toast(errorMessage(err, 'Could not switch provider.'), 'error');
    }
  };

  const close = () => { setResult(null); setRun(null); };

  return (
    <section className="sv-ai" aria-label="AI assistant">
      <div className="sv-row-between">
        {s.ready_providers.length > 1 ? (
          <select className="sv-select sv-select-sm" aria-label="AI provider" value={s.active_provider} onChange={(e) => setProvider(e.target.value as ProviderKey)}>
            {s.ready_providers.map((k) => <option key={k} value={k}>{s.catalog.providers[k].name}</option>)}
          </select>
        ) : <span className="caption-4 sv-soft">Using {s.catalog.providers[s.active_provider].name}</span>}
        <button type="button" className="sv-link caption-3" onClick={() => setManaging(true)}>Customize</button>
      </div>

      <div className="sv-ai-grid">
        {visible.map((b) => (
          <button key={b.id} type="button" className={`sv-ai-action ${dragId === b.id ? 'dragging' : ''} ${run?.label === b.label && busy ? 'running' : ''}`}
            title={b.description} draggable onDragStart={() => setDragId(b.id)} onDragEnd={() => setDragId(null)} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(b.id)}
            disabled={busy} onClick={() => go(b.custom ? { label: b.label, prompt: b.custom.prompt } : { label: b.label, action: b.id })}>
            <span className="sv-ai-emoji" aria-hidden="true">{b.emoji}</span>
            <span className="body-5">{b.label}</span>
          </button>
        ))}
      </div>

      <form className="sv-ai-ask" onSubmit={send}>
        <input type="text" className="sv-input" placeholder="Or tell it what to do, e.g. “translate to Tamil”" value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={4000} aria-label="Custom instruction" />
        <button type="button" className="sv-icon-btn" disabled={!instruction.trim()} onClick={() => setSaving(true)} aria-label="Save as a button" title="Save as a button"><BookmarkSimple size={18} /></button>
        <button type="submit" className="sv-icon-btn sv-icon-primary" disabled={busy || !instruction.trim()} aria-label="Send"><PaperPlaneRight size={18} weight="fill" /></button>
      </form>

      {error && <div className="sv-banner error" role="alert">{error}</div>}

      {(busy || result) && run && (
        <div className="sv-ai-result" aria-busy={busy}>
          <div className="sv-row-between">
            <span className="title-4">{run.label}</span>
            {!busy && <button type="button" className="sv-icon-btn" onClick={close} aria-label="Discard"><X size={16} /></button>}
          </div>
          {busy ? (
            <div className="sv-ai-thinking">
              <span className="sv-skel" /><span className="sv-skel" style={{ width: '92%' }} /><span className="sv-skel" style={{ width: '78%' }} /><span className="sv-skel short" />
            </div>
          ) : result && (
            <>
              <pre className="sv-ai-text body-6">{result.text}</pre>
              <span className="caption-5 sv-soft">{wordCount(result.text)} words · {s.catalog.providers[result.provider as ProviderKey]?.name ?? result.provider}</span>
              <div className="sv-actions">
                <button type="button" className="sv-btn sv-btn-primary sv-btn-sm" onClick={() => { onAccept(result.text); close(); }}><Check size={14} weight="bold" aria-hidden="true" /> Use this</button>
                <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={() => go(run)}><ArrowClockwise size={14} aria-hidden="true" /> Try again</button>
                <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={() => { navigator.clipboard?.writeText(result.text); toast('Copied', 'info'); }}><Copy size={14} aria-hidden="true" /> Copy</button>
              </div>
            </>
          )}
        </div>
      )}

      {managing && <ManageModal settings={s} buttons={buttons} onSave={savePrefs} onClose={() => setManaging(false)} />}
      {saving && (
        <SavePromptModal prompt={instruction.trim()} onClose={() => setSaving(false)} onSave={async (c) => {
          await savePrefs({ ...s.action_prefs, custom_prompts: [...s.action_prefs.custom_prompts, c], order: [...buttons.map((b) => b.id), c.id] });
          setSaving(false);
          setInstruction('');
          toast(`Saved “${c.label}” as a button`);
        }} />
      )}
    </section>
  );
}

function ManageModal({ settings: s, buttons, onSave, onClose }: { settings: AiSettings; buttons: Button[]; onSave: (p: ActionPrefs) => Promise<void>; onClose: () => void }) {
  const ids = buttons.map((b) => b.id);
  const move = (i: number, dir: number) => {
    const next = [...ids];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    onSave({ ...s.action_prefs, order: next });
  };
  const toggleHidden = (id: string) => {
    const hidden = s.action_prefs.hidden.includes(id) ? s.action_prefs.hidden.filter((h) => h !== id) : [...s.action_prefs.hidden, id];
    onSave({ ...s.action_prefs, hidden });
  };
  const remove = async (b: Button) => {
    if (!(await confirmDialog({ title: `Delete “${b.label}”?`, body: 'This saved prompt will be removed.', confirmLabel: 'Delete', danger: true }))) return;
    onSave({ order: ids.filter((x) => x !== b.id), hidden: s.action_prefs.hidden.filter((x) => x !== b.id), custom_prompts: s.action_prefs.custom_prompts.filter((c) => c.id !== b.id) });
  };
  return (
    <Modal title="Customize AI buttons" onClose={onClose}>
      <p className="body-6 sv-soft">Reorder, hide or delete. You can also drag the buttons in the editor.</p>
      <ul className="sv-manage">
        {buttons.map((b, i) => {
          const hidden = s.action_prefs.hidden.includes(b.id);
          return (
            <li key={b.id} className={hidden ? 'muted' : ''}>
              <DotsSixVertical size={16} className="sv-soft" aria-hidden="true" />
              <span className="sv-grow body-5">{b.emoji} {b.label}{b.custom && <span className="sv-badge">Saved prompt</span>}</span>
              <button type="button" className="sv-icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${b.label} up`}><ArrowUp size={14} /></button>
              <button type="button" className="sv-icon-btn" disabled={i === buttons.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${b.label} down`}><ArrowDown size={14} /></button>
              <button type="button" className="sv-icon-btn" onClick={() => toggleHidden(b.id)} aria-label={hidden ? `Show ${b.label}` : `Hide ${b.label}`}>{hidden ? <EyeSlash size={14} /> : <Eye size={14} />}</button>
              {b.custom && <button type="button" className="sv-icon-btn sv-danger-btn" onClick={() => remove(b)} aria-label={`Delete ${b.label}`}><Trash size={14} /></button>}
            </li>
          );
        })}
      </ul>
      <div className="sv-actions">
        <button type="button" className="sv-btn sv-btn-ghost" onClick={() => onSave({ ...s.action_prefs, order: s.catalog.default_order, hidden: [] })}>Reset to default</button>
        <button type="button" className="sv-btn sv-btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

function SavePromptModal({ prompt, onSave, onClose }: { prompt: string; onSave: (c: CustomPrompt) => Promise<void>; onClose: () => void }) {
  const [emoji, setEmoji] = useState('✨');
  const [label, setLabel] = useState(prompt.slice(0, 20));
  const [text, setText] = useState(prompt);
  return (
    <Modal title="Save as a button" onClose={onClose}>
      <form className="sv-form" onSubmit={(e) => { e.preventDefault(); if (label.trim() && text.trim()) onSave({ id: `custom_${Date.now().toString(36)}`, emoji, label: label.trim(), prompt: text.trim() }); }}>
        <div className="sv-field">
          <span className="caption-3">Icon</span>
          <div className="sv-chiprow" role="radiogroup" aria-label="Icon">
            {EMOJIS.map((e) => <button key={e} type="button" role="radio" aria-checked={emoji === e} className={`sv-chip sv-chip-emoji ${emoji === e ? 'active' : ''}`} onClick={() => setEmoji(e)}>{e}</button>)}
          </div>
        </div>
        <label className="sv-field"><span className="caption-3">Label</span><input type="text" className="sv-input" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} required /></label>
        <label className="sv-field"><span className="caption-3">Prompt</span><textarea className="sv-input" rows={4} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} required /></label>
        <div className="sv-actions">
          <button type="submit" className="sv-btn sv-btn-primary">Save button</button>
          <button type="button" className="sv-btn sv-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

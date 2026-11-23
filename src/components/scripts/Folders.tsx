import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Folder, FolderOpen, FolderPlus, PencilSimple, Trash } from '@phosphor-icons/react';
import { deleteFolder, saveFolder, type ScriptFolder } from '../../services/scriptsApi';
import { errorMessage } from '../../utils/errors';
import { Modal } from '../workspace/ui';
import { refreshScripts, toast } from './util';

const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

/** One folder in the row at the top of the library. Click to open; edit or delete from the corner. */
export function FolderChip({ folder: f, onEdit, onDelete }: { folder: ScriptFolder; onEdit: () => void; onDelete: () => void }) {
  const p = pct(f.done_count, f.script_count);
  return (
    <li className="sv-fchip" style={{ ['--folder' as string]: f.color }}>
      <Link to={`/scripts/library?folder=${f.id}`} className="sv-fchip-link" title={f.description || f.name}>
        <Folder size={20} weight="fill" className="sv-folder-tint" aria-hidden="true" />
        <span className="sv-fchip-text">
          <span className="title-4 sv-ellipsis">{f.name}</span>
          <span className="caption-5 sv-soft">{f.script_count} script{f.script_count === 1 ? '' : 's'}{f.script_count ? ` · ${p}% done` : ''}</span>
        </span>
        <span className="sv-fchip-bar" aria-hidden="true"><span style={{ transform: `scaleX(${p / 100})` }} /></span>
      </Link>
      <span className="sv-fchip-tools">
        <button type="button" className="sv-icon-btn" onClick={onEdit} aria-label={`Edit folder ${f.name}`}><PencilSimple size={14} /></button>
        <button type="button" className="sv-icon-btn sv-danger-btn" onClick={onDelete} aria-label={`Delete folder ${f.name}`}><Trash size={14} /></button>
      </span>
    </li>
  );
}

export function NewFolderChip({ onClick }: { onClick: () => void }) {
  return (
    <li>
      <button type="button" className="sv-fchip-new" onClick={onClick}>
        <FolderPlus size={20} weight="duotone" aria-hidden="true" /><span className="title-4">New folder</span>
      </button>
    </li>
  );
}

/** Create or edit a folder. Calls onSaved with the saved folder. */
export function FolderModal({ token, folder, colors, onClose, onSaved }: {
  token: string; folder: ScriptFolder | null; colors: string[]; onClose: () => void; onSaved?: (f: ScriptFolder) => void;
}) {
  const [name, setName] = useState(folder?.name ?? '');
  const [color, setColor] = useState(folder?.color ?? colors[7] ?? '#6366F1');
  const [description, setDescription] = useState(folder?.description ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name the folder.'); return; }
    setBusy(true);
    try {
      const saved = await saveFolder(token, { name: name.trim(), color, description: description.trim() }, folder?.id);
      refreshScripts();
      toast(folder ? 'Folder updated' : `Folder “${saved.name}” created`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the folder.'));
      setBusy(false);
    }
  };

  return (
    <Modal title={folder ? 'Edit folder' : 'New folder'} onClose={onClose}>
      <form className="sv-form" onSubmit={submit} noValidate>
        <div className="sv-folder-preview" style={{ ['--folder' as string]: color }} aria-hidden="true">
          <Folder size={32} weight="fill" /><span className="title-3 sv-ellipsis">{name || 'Untitled folder'}</span>
        </div>
        <label className="sv-field"><span className="caption-3">Name</span><input type="text" className="sv-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Movie 1: The Chennai Heist" autoFocus /></label>
        <div className="sv-field">
          <span className="caption-3">Colour</span>
          <div className="sv-swatches" role="radiogroup" aria-label="Colour">
            {colors.map((c) => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} className={`sv-swatch-btn ${color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />)}
          </div>
        </div>
        <label className="sv-field">
          <span className="caption-3">Description (optional)</span>
          <textarea className="sv-input" rows={3} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Thriller set in Chennai, around 2 hours, 40 scenes" />
        </label>
        {error && <div className="sv-banner error" role="alert">{error}</div>}
        <div className="sv-actions">
          <button type="submit" className="sv-btn sv-btn-primary" disabled={busy}>{busy ? 'Saving…' : folder ? 'Save folder' : 'Create folder'}</button>
          <button type="button" className="sv-btn sv-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

/** Delete a folder, choosing whether its scripts stay (back in the library) or go with it. */
export function DeleteFolderModal({ token, folder, onClose, onDeleted }: { token: string; folder: ScriptFolder; onClose: () => void; onDeleted?: () => void }) {
  const [withScripts, setWithScripts] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = folder.script_count;
  const go = async () => {
    setBusy(true);
    try {
      const r = await deleteFolder(token, folder.id, withScripts);
      refreshScripts();
      toast(withScripts && r.deleted_scripts ? `Deleted “${folder.name}” and ${r.deleted_scripts} script${r.deleted_scripts === 1 ? '' : 's'}` : `Deleted “${folder.name}”${n ? '. Its scripts are back in the library' : ''}`);
      onDeleted?.();
      onClose();
    } catch (err) {
      toast(errorMessage(err, 'Could not delete the folder.'), 'error');
      setBusy(false);
    }
  };
  return (
    <Modal title={`Delete “${folder.name}”?`} onClose={onClose}>
      <div className="sv-form">
        {n > 0 ? (
          <div className="sv-options" role="radiogroup" aria-label="What happens to the scripts">
            <label className={`sv-option ${!withScripts ? 'active' : ''}`}>
              <input type="radio" name="del" checked={!withScripts} onChange={() => setWithScripts(false)} />
              <span><span className="body-5">Keep the {n} script{n === 1 ? '' : 's'}</span><br /><span className="caption-5 sv-soft">They move to the library. Only the folder is removed.</span></span>
            </label>
            <label className={`sv-option ${withScripts ? 'active danger' : ''}`}>
              <input type="radio" name="del" checked={withScripts} onChange={() => setWithScripts(true)} />
              <span><span className="body-5">Delete the folder and its {n} script{n === 1 ? '' : 's'}</span><br /><span className="caption-5 sv-soft">This cannot be undone.</span></span>
            </label>
          </div>
        ) : <p className="body-6 sv-soft">The folder is empty.</p>}
        <div className="sv-actions">
          <button type="button" className="sv-btn sv-btn-danger" disabled={busy} onClick={go}>{busy ? 'Deleting…' : withScripts ? `Delete folder and ${n} script${n === 1 ? '' : 's'}` : 'Delete folder'}</button>
          <button type="button" className="sv-btn sv-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

/** Pick where selected scripts go. */
export function MoveModal({ count, folders, current, onMove, onNewFolder, onClose }: {
  count: number; folders: ScriptFolder[]; current: string | null; onMove: (folderId: string | null) => Promise<void>; onNewFolder: () => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const move = async (id: string | null) => { setBusy(true); await onMove(id); setBusy(false); };
  return (
    <Modal title={`Move ${count} script${count === 1 ? '' : 's'} to…`} onClose={onClose}>
      <ul className="sv-move-list">
        {folders.map((f) => (
          <li key={f.id}>
            <button type="button" className="sv-move-item" disabled={busy || current === f.id} onClick={() => move(f.id)} style={{ ['--folder' as string]: f.color }}>
              <Folder size={20} weight="fill" className="sv-folder-tint" aria-hidden="true" />
              <span className="body-5 sv-grow sv-ellipsis">{f.name}</span>
              <span className="caption-5 sv-soft">{current === f.id ? 'Current' : `${f.script_count} scripts`}</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="sv-move-item" disabled={busy || current === null} onClick={() => move(null)}>
            <FolderOpen size={20} aria-hidden="true" /><span className="body-5 sv-grow">No folder (library)</span>
            {current === null && <span className="caption-5 sv-soft">Current</span>}
          </button>
        </li>
      </ul>
      <div className="sv-actions">
        <button type="button" className="sv-btn sv-btn-ghost" onClick={onNewFolder}><FolderPlus size={16} aria-hidden="true" /> New folder</button>
      </div>
    </Modal>
  );
}

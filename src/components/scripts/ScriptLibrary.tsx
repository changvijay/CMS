import { useEffect, useState, type DragEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CaretRight, DownloadSimple, Folder, Kanban, LinkSimple, UploadSimple, ListBullets, MagnifyingGlass, NotePencil, PencilSimple, Plus, Trash, X } from '@phosphor-icons/react';
import {
  bulkDeleteScripts, bulkMoveScripts, downloadExport, listScripts, updateScript, type Script, type ScriptCategory, type ScriptFolder, type ScriptStatus,
} from '../../services/scriptsApi';
import { errorMessage } from '../../utils/errors';
import { useLive } from '../workspace/useLive';
import { Modal } from '../workspace/ui';
import ImportPanel from './ImportPanel';
import DailyIdeaCard from './DailyIdeaCard';
import { DeleteFolderModal, FolderChip, FolderModal, MoveModal, NewFolderChip } from './Folders';
import { CategoryChips, DeadlineChip, EmptyState, Pager, SkeletonRows, StatusDot, StatusSelect } from './shared';
import {
  KEY, STATUSES, STATUS_LABEL, confirmDialog, readLibraryView, refreshScripts, saveLibraryView, timeAgo, toast, useCategories, useFolders, wordCount,
} from './util';

const LIST_PAGE = 8;
const BOARD_LIMIT = 100;

type FolderModalState = { kind: 'edit'; folder: ScriptFolder | null; then?: (f: ScriptFolder) => void } | { kind: 'delete'; folder: ScriptFolder } | null;

/**
 * /scripts/library            → folders in a row on top, then the scripts that are in no folder, as a board or list
 * /scripts/library?folder=12  → that folder's scripts, same board or list
 * Typing in search on the library home searches every script, in every folder.
 */
export default function ScriptLibrary({ token }: { token: string }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const folderParam = params.get('folder');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<FolderModalState>(null);
  const cats = useCategories(token);
  const foldersState = useFolders(token);
  const categories = cats.data?.categories ?? [];
  const folders = foldersState.data?.folders ?? [];
  const colors = foldersState.data?.colors ?? cats.data?.colors ?? [];

  // Search waits for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const changeStatus = async (s: Pick<Script, 'id' | 'title'>, next: ScriptStatus) => {
    try {
      await updateScript(token, s.id, { status: next });
      refreshScripts();
      toast(`“${s.title}” moved to ${STATUS_LABEL[next]}`);
    } catch (err) {
      toast(errorMessage(err, 'Could not change the status.'), 'error');
    }
  };

  const folder = folderParam ? folders.find((f) => f.id === folderParam) ?? null : null;
  const missing = Boolean(folderParam && foldersState.data && !folder);
  const openNewFolder = (then?: (f: ScriptFolder) => void) => setModal({ kind: 'edit', folder: null, then });
  const shared = { token, categories, folders, onStatus: changeStatus, onNewFolder: openNewFolder };

  return (
    <div className="sv-stack">
      {!folderParam && <DailyIdeaCard token={token} />}

      {folder ? (
        <FolderHeader token={token} folder={folder} onEdit={() => setModal({ kind: 'edit', folder })} onDelete={() => setModal({ kind: 'delete', folder })} />
      ) : !folderParam && (
        <section className="sv-folder-section" aria-label="Folders">
          <h2 className="caption-3 sv-group-title">Folders {folders.length > 0 && <span className="sv-count">{folders.length}</span>}</h2>
          {foldersState.error ? <div className="sv-banner error">{foldersState.error}</div> : (
            <ul className="sv-folder-row">
              {folders.map((f) => <FolderChip key={f.id} folder={f} onEdit={() => setModal({ kind: 'edit', folder: f })} onDelete={() => setModal({ kind: 'delete', folder: f })} />)}
              <NewFolderChip onClick={() => openNewFolder((f) => navigate(`/scripts/library?folder=${f.id}`))} />
              {foldersState.data && !folders.length && <li className="caption-5 sv-soft sv-folder-hint">Group scripts by project, for example one folder per movie.</li>}
            </ul>
          )}
        </section>
      )}

      {missing ? (
        <EmptyState icon={<Folder size={28} weight="duotone" />} title="Folder not found" body="It may have been deleted.">
          <Link className="sv-btn sv-btn-primary" to="/scripts/library">Back to library</Link>
        </EmptyState>
      ) : (
        <ScriptsArea {...shared} folder={folder} q={q} query={query} setQuery={setQuery} />
      )}

      {modal?.kind === 'edit' && <FolderModal token={token} folder={modal.folder} colors={colors} onClose={() => setModal(null)} onSaved={modal.then} />}
      {modal?.kind === 'delete' && (
        <DeleteFolderModal token={token} folder={modal.folder} onClose={() => setModal(null)}
          onDeleted={() => { if (folderParam === modal.folder.id) navigate('/scripts/library'); }} />
      )}
    </div>
  );
}

const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

function FolderHeader({ token, folder, onEdit, onDelete }: { token: string; folder: ScriptFolder; onEdit: () => void; onDelete: () => void }) {
  const p = pct(folder.done_count, folder.script_count);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportFolder = async () => {
    setExporting(true);
    try {
      await downloadExport(token, folder.id);
      toast(`Exported ${folder.script_count} script${folder.script_count === 1 ? '' : 's'} from ${folder.name}`);
    } catch (err) {
      toast(errorMessage(err, 'Could not export the folder.'), 'error');
    } finally {
      setExporting(false);
    }
  };
  return (
    <header className="sv-folder-head" style={{ ['--folder' as string]: folder.color }}>
      <nav className="sv-crumbs caption-4" aria-label="Breadcrumb">
        <Link to="/scripts/library">Library</Link><CaretRight size={12} aria-hidden="true" /><span aria-current="page" className="sv-ellipsis">{folder.name}</span>
      </nav>
      <div className="sv-folder-head-main">
        <Folder size={28} weight="fill" className="sv-folder-tint" aria-hidden="true" />
        <div className="sv-grow">
          <h1 className="heading-6 sv-ellipsis">{folder.name}</h1>
          <p className="caption-2 sv-soft">
            {folder.script_count} script{folder.script_count === 1 ? '' : 's'}{folder.script_count ? ` · ${folder.done_count} completed (${p}%)` : ''}
            {folder.description ? ` · ${folder.description}` : ''}
          </p>
        </div>
        <div className="sv-folder-actions">
          <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={() => setImporting(true)}><UploadSimple size={16} aria-hidden="true" /> Import</button>
          <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={exportFolder} disabled={exporting || folder.script_count === 0}
            title={folder.script_count === 0 ? 'The folder is empty' : `Download ${folder.name} as Excel`}>
            <DownloadSimple size={16} aria-hidden="true" /> {exporting ? 'Exporting…' : 'Export'}
          </button>
          <button type="button" className="sv-icon-btn" onClick={onEdit} aria-label="Edit folder"><PencilSimple size={18} /></button>
          <button type="button" className="sv-icon-btn sv-danger-btn" onClick={onDelete} aria-label="Delete folder"><Trash size={18} /></button>
        </div>
      </div>
      {importing && (
        <Modal title={`Import into ${folder.name}`} onClose={() => setImporting(false)}>
          <ImportPanel token={token} folderId={folder.id} folderName={folder.name} onDone={() => setImporting(false)} />
        </Modal>
      )}
      {folder.script_count > 0 && <span className="sv-folder-bar" aria-hidden="true"><span style={{ transform: `scaleX(${p / 100})` }} /></span>}
    </header>
  );
}

/** Search, filters and the Board/List of scripts: the loose ones on the library home, or one folder's. */
function ScriptsArea({ token, categories, folders, folder, q, query, setQuery, onStatus, onNewFolder }: {
  token: string; categories: ScriptCategory[]; folders: ScriptFolder[]; folder: ScriptFolder | null; q: string; query: string; setQuery: (v: string) => void;
  onStatus: (s: Script, st: ScriptStatus) => void; onNewFolder: (then?: (f: ScriptFolder) => void) => void;
}) {
  const [view, setView] = useState<'board' | 'list'>(readLibraryView);
  const [category, setCategory] = useState('');
  const changeView = (v: 'board' | 'list') => { setView(v); saveLibraryView(v); };
  const searchingAll = !folder && Boolean(q);
  // Home shows only scripts outside folders; a search on the home page looks in every folder.
  const apiFolder = folder ? folder.id : searchingAll ? '' : 'none';
  const newHref = folder ? `/scripts/library/new?folder=${folder.id}` : '/scripts/library/new';

  return (
    <section className="sv-stack" aria-label="Scripts">
      {!folder && <h2 className="caption-3 sv-group-title">Scripts</h2>}
      <div className="sv-toolbar">
        <label className="sv-search">
          <MagnifyingGlass size={18} aria-hidden="true" />
          <input type="search" placeholder={folder ? `Search in ${folder.name}` : 'Search all scripts, including folders'} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search scripts" />
          {query && <button type="button" className="sv-search-clear" onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}
        </label>
        <select className="sv-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="sv-seg" role="group" aria-label="View">
          <button type="button" className={view === 'board' ? 'active' : ''} aria-pressed={view === 'board'} onClick={() => changeView('board')}><Kanban size={16} aria-hidden="true" /> Board</button>
          <button type="button" className={view === 'list' ? 'active' : ''} aria-pressed={view === 'list'} onClick={() => changeView('list')}><ListBullets size={16} aria-hidden="true" /> List</button>
        </div>
        {folder && <Link className="sv-btn sv-btn-primary" to={newHref}><Plus size={16} weight="bold" aria-hidden="true" /> New script here</Link>}
      </div>

      {view === 'board'
        ? <Board token={token} q={q} category={category} folder={apiFolder} newHref={newHref} categories={categories} folders={folders} showFolder={searchingAll} onStatus={onStatus} inFolder={Boolean(folder)} />
        : <List key={`${apiFolder}:${q}:${category}`} token={token} q={q} category={category} folder={apiFolder} categories={categories} folders={folders}
          onStatus={onStatus} onNewFolder={onNewFolder} currentFolder={searchingAll ? 'mixed' : folder?.id ?? null} newHref={newHref} showFolder={searchingAll} />}
    </section>
  );
}

const COLUMN_HINT: Record<ScriptStatus, string> = {
  not_started: 'Ideas and drafts waiting for you',
  in_progress: 'Being written or recorded',
  completed: 'Ready or published',
};

/** Three columns by status. Drag a card to another column to change its status. */
function Board({ token, q, category, folder, newHref, categories, folders, showFolder, inFolder, onStatus }: {
  token: string; q: string; category: string; folder: string; newHref: string; categories: ScriptCategory[]; folders: ScriptFolder[];
  showFolder: boolean; inFolder: boolean; onStatus: (s: Script, st: ScriptStatus) => void;
}) {
  const load = (status: ScriptStatus) => () => listScripts(token, { q, category, folder, status, pageSize: BOARD_LIMIT });
  const cols = {
    not_started: useLive(load('not_started'), `${KEY}board:not_started:${folder}:${q}:${category}`),
    in_progress: useLive(load('in_progress'), `${KEY}board:in_progress:${folder}:${q}:${category}`),
    completed: useLive(load('completed'), `${KEY}board:completed:${folder}:${q}:${category}`),
  };
  const [dragging, setDragging] = useState<Script | null>(null);
  const [over, setOver] = useState<ScriptStatus | null>(null);

  const total = STATUSES.reduce((n, s) => n + (cols[s].data?.total ?? 0), 0);
  const loaded = STATUSES.every((s) => cols[s].data);
  if (loaded && total === 0) {
    return q || category ? (
      <EmptyState icon={<MagnifyingGlass size={28} weight="duotone" />} title="No scripts match" body="Try another word, or clear the category filter." />
    ) : (
      <EmptyState icon={<NotePencil size={28} weight="duotone" />} title={inFolder ? 'This folder is empty' : 'No scripts outside folders'}
        body={inFolder ? 'Write the first script for this project.' : 'Write a script here, or open a folder above to see its scripts.'}>
        <Link className="sv-btn sv-btn-primary" to={newHref}><Plus size={16} weight="bold" aria-hidden="true" /> New script</Link>
      </EmptyState>
    );
  }

  const drop = (status: ScriptStatus) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    if (dragging && dragging.status !== status) onStatus(dragging, status);
    setDragging(null);
  };

  return (
    <div className="sv-board">
      {STATUSES.map((status) => {
        const st = cols[status];
        return (
          <section key={status} className={`sv-col ${over === status ? 'over' : ''}`} aria-label={STATUS_LABEL[status]}
            onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(status); } }} onDragLeave={() => setOver(null)} onDrop={drop(status)}>
            <header className="sv-col-head">
              <StatusDot status={status} />
              <h2 className="title-3">{STATUS_LABEL[status]}</h2>
              <span className="sv-count caption-3">{st.data?.total ?? 0}</span>
            </header>
            <p className="caption-5 sv-soft">{COLUMN_HINT[status]}</p>
            {st.loading && !st.data ? <SkeletonRows rows={2} tall /> : (
              <ul className="sv-col-list">
                {(st.data?.scripts ?? []).map((s) => (
                  <li key={s.id} draggable onDragStart={(e) => { setDragging(s); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDragging(null); setOver(null); }}
                    className={`sv-tile ${dragging?.id === s.id ? 'dragging' : ''}`}>
                    <Link to={`/scripts/library/${s.id}`} className="sv-tile-link">
                      <span className="title-4 sv-clamp-2">{s.title}</span>
                      {s.notes.trim() && <span className="caption-5 sv-soft sv-clamp-2">{preview(s.notes)}</span>}
                    </Link>
                    <span className="sv-meta">
                      {showFolder && <FolderTag id={s.folder_id} folders={folders} />}
                      <DeadlineChip date={s.deadline} done={s.status === 'completed'} />
                      <CategoryChips ids={s.category_ids} categories={categories} max={2} />
                    </span>
                    <span className="sv-tile-foot">
                      <span className="caption-5 sv-soft">{wordCount(s.notes)} words · {timeAgo(s.modified_at)}</span>
                      <StatusSelect value={s.status} onChange={(next) => onStatus(s, next)} label={`Move ${s.title}`} />
                    </span>
                  </li>
                ))}
                {status === 'not_started' && (
                  <li><Link className="sv-col-add" to={newHref}><Plus size={16} aria-hidden="true" /> New script</Link></li>
                )}
                {(st.data?.total ?? 0) > BOARD_LIMIT && <li className="caption-5 sv-soft">Showing the latest {BOARD_LIMIT}. Use search or the list view to see older ones.</li>}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

const preview = (notes: string) => notes.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);

/** Folder name tag, shown where scripts from several folders are mixed. */
function FolderTag({ id, folders }: { id: string | null; folders: ScriptFolder[] }) {
  const f = id ? folders.find((x) => x.id === id) : null;
  if (!f) return null;
  return <Link to={`/scripts/library?folder=${f.id}`} className="sv-folder-tag caption-4" style={{ ['--folder' as string]: f.color }}><Folder size={14} weight="fill" aria-hidden="true" /> {f.name}</Link>;
}

function List({ token, q, category = '', folder, categories, folders, onStatus, onNewFolder, showFolder = false, currentFolder = null, newHref = '/scripts/library/new' }: {
  token: string; q: string; category?: string; folder: string; categories: ScriptCategory[]; folders: ScriptFolder[];
  onStatus: (s: Script, st: ScriptStatus) => void; onNewFolder: (then?: (f: ScriptFolder) => void) => void;
  showFolder?: boolean; currentFolder?: string | null; newHref?: string;
}) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<ScriptStatus | ''>('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const state = useLive(() => listScripts(token, { q, status, category, folder, page, pageSize: LIST_PAGE }), `${KEY}items:${folder}:${q}:${status}:${category}:${page}`);

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const removeSelected = async () => {
    const n = selected.size;
    if (!(await confirmDialog({ title: `Delete ${n} script${n > 1 ? 's' : ''}?`, body: 'This cannot be undone. Linked goals lose the count.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await bulkDeleteScripts(token, [...selected]);
      setSelected(new Set());
      refreshScripts();
      toast(`Deleted ${n} script${n > 1 ? 's' : ''}`);
    } catch (err) {
      toast(errorMessage(err, 'Could not delete.'), 'error');
    }
  };

  const moveSelected = async (folderId: string | null) => {
    const n = selected.size;
    try {
      await bulkMoveScripts(token, [...selected], folderId);
      setSelected(new Set());
      setMoving(false);
      refreshScripts();
      const name = folderId ? folders.find((f) => f.id === folderId)?.name ?? 'the folder' : 'the library';
      toast(`Moved ${n} script${n > 1 ? 's' : ''} to ${name}`, 'ok', folderId ? { label: 'Open', run: () => navigate(`/scripts/library?folder=${folderId}`) } : undefined);
    } catch (err) {
      toast(errorMessage(err, 'Could not move the scripts.'), 'error');
    }
  };

  const data = state.data;
  const filtered = Boolean(q || category || status);
  return (
    <>
      <div className="sv-chiprow" role="group" aria-label="Status">
        {(['', ...STATUSES] as const).map((s) => (
          <button key={s || 'all'} type="button" className={`sv-chip ${status === s ? 'active' : ''}`} aria-pressed={status === s}
            onClick={() => { setStatus(s); setPage(1); setSelected(new Set()); }}>
            {s && <StatusDot status={s} />}{s ? STATUS_LABEL[s] : 'All'}
          </button>
        ))}
        {showFolder && data && <span className="caption-4 sv-soft sv-push">{data.total} result{data.total === 1 ? '' : 's'} across all folders</span>}
      </div>
      {!data ? (state.error ? <div className="sv-banner error">{state.error}</div> : <SkeletonRows rows={5} tall />) : data.scripts.length === 0 ? (
        <EmptyState icon={<NotePencil size={28} weight="duotone" />} title={filtered ? 'No scripts match' : currentFolder ? 'This folder is empty' : 'No scripts outside folders'}
          body={filtered ? 'Try another search or filter.' : currentFolder ? 'Write the first script for this project.' : 'Write a script here, or open a folder above.'}>
          {!filtered && <Link className="sv-btn sv-btn-primary" to={newHref}><Plus size={16} weight="bold" aria-hidden="true" /> New script</Link>}
        </EmptyState>
      ) : (
        <>
          <ul className="sv-list">
            {data.scripts.map((s) => (
              <li key={s.id} className={`sv-list-item ${selected.has(s.id) ? 'selected' : ''}`}>
                <input type="checkbox" className="sv-check" checked={selected.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Select ${s.title}`} />
                <button type="button" className="sv-list-main" onClick={() => navigate(`/scripts/library/${s.id}`)}>
                  <span className="title-3 sv-ellipsis">{s.title}</span>
                  {s.notes.trim() && <span className="body-6 sv-soft sv-clamp-2">{preview(s.notes)}</span>}
                </button>
                <span className="sv-meta sv-list-meta">
                  {showFolder && <FolderTag id={s.folder_id} folders={folders} />}
                  {s.reference && /^https?:\/\//i.test(s.reference) && (
                    <a className="sv-ref caption-4" href={s.reference} target="_blank" rel="noopener noreferrer"><LinkSimple size={14} aria-hidden="true" />{s.reference.replace(/^https?:\/\/(www\.)?/i, '').slice(0, 32)}</a>
                  )}
                  <DeadlineChip date={s.deadline} done={s.status === 'completed'} />
                  <CategoryChips ids={s.category_ids} categories={categories} />
                  <span className="caption-5 sv-soft">{timeAgo(s.modified_at)}</span>
                </span>
                <StatusSelect value={s.status} onChange={(st) => onStatus(s, st)} label={`Status of ${s.title}`} />
              </li>
            ))}
          </ul>
          <Pager page={data.page} pages={data.pages} onPage={(p) => { setPage(p); setSelected(new Set()); }} />
        </>
      )}

      {selected.size > 0 && (
        <div className="sv-selbar" role="region" aria-label="Selected scripts">
          <span className="body-4">{selected.size} selected</span>
          <button type="button" className="sv-link sv-link-light" onClick={() => setSelected(new Set(data?.scripts.map((s) => s.id)))}>Select page</button>
          <button type="button" className="sv-link sv-link-light" onClick={() => setSelected(new Set())}>Clear</button>
          <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={() => setMoving(true)}><Folder size={16} aria-hidden="true" /> Move to folder</button>
          <button type="button" className="sv-btn sv-btn-danger sv-btn-sm" onClick={removeSelected}><Trash size={16} aria-hidden="true" /> Delete</button>
        </div>
      )}
      {moving && (
        <MoveModal count={selected.size} folders={folders} current={currentFolder} onMove={moveSelected} onClose={() => setMoving(false)}
          onNewFolder={() => { setMoving(false); onNewFolder((f) => moveSelected(f.id)); }} />
      )}
    </>
  );
}

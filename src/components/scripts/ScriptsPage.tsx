import { NavLink, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CheckSquare, GearSix, House, NotePencil, Plus, Target } from '@phosphor-icons/react';
import type { User } from '../../services/api';
import '../../assets/css/workspace.css';
import './scripts.css';
import { lazy, Suspense } from 'react';
import { PageSkeleton } from '../Skeleton';
// Each view is its own chunk, downloaded the first time it is opened.
const Dashboard = lazy(() => import('./Dashboard'));
const ScriptLibrary = lazy(() => import('./ScriptLibrary'));
const ScriptEditor = lazy(() => import('./ScriptEditor'));
const Todos = lazy(() => import('./Todos'));
const Goals = lazy(() => import('./Goals'));
const ScriptsSettings = lazy(() => import('./ScriptsSettings'));
import { FeedbackHost } from './shared';

const TABS = [
  { id: 'dashboard', label: 'Home', icon: House },
  { id: 'library', label: 'Scripts', icon: NotePencil },
  { id: 'todos', label: 'To-do', icon: CheckSquare },
  { id: 'goals', label: 'Goals', icon: Target },
  { id: 'settings', label: 'Settings', icon: GearSix },
] as const;

/** The Scripts workspace: /scripts/:tab, and /scripts/library/:id for the editor. */
export default function ScriptsPage({ token, user }: { token: string; user: User | null }) {
  const { tab = 'dashboard', id } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Inside a folder, the header button creates the script in that folder.
  const inFolder = tab === 'library' ? params.get('folder') : null;
  if (!TABS.some((t) => t.id === tab)) return <Navigate to="/scripts" replace />;
  const editing = tab === 'library' && Boolean(id);

  return (
    <div className="ws sv">
      <main className="sv-main">
        {!editing && (
          <header className="sv-top">
            <nav className="sv-tabs" aria-label="Scripts sections">
              {TABS.map(({ id: tid, label, icon: Icon }) => (
                <NavLink key={tid} to={tid === 'dashboard' ? '/scripts' : `/scripts/${tid}`} end
                  className={({ isActive }) => `sv-tab ${isActive || (tid === 'dashboard' && tab === 'dashboard') ? 'active' : ''}`}>
                  {({ isActive }) => (
                    <>
                      <Icon size={18} weight={isActive || (tid === 'dashboard' && tab === 'dashboard') ? 'fill' : 'regular'} aria-hidden="true" />
                      <span>{label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
            <button type="button" className="sv-btn sv-btn-primary sv-top-cta" onClick={() => navigate(inFolder ? `/scripts/library/new?folder=${inFolder}` : '/scripts/library/new')}>
              <Plus size={16} weight="bold" aria-hidden="true" /> New script
            </button>
          </header>
        )}
        <div className="sv-view" key={editing ? `edit-${id}` : tab}>
          <Suspense fallback={<PageSkeleton label="Loading…" />}>
            {tab === 'dashboard' && <Dashboard token={token} user={user} />}
            {tab === 'library' && (id ? <ScriptEditor key={id} token={token} id={id} /> : <ScriptLibrary token={token} />)}
            {tab === 'todos' && <Todos token={token} />}
            {tab === 'goals' && <Goals token={token} />}
            {tab === 'settings' && <ScriptsSettings token={token} />}
          </Suspense>
        </div>
      </main>
      <FeedbackHost />
    </div>
  );
}

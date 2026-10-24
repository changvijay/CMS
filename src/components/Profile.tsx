import { Link } from 'react-router-dom';
import { getInstagramAccounts, getYoutubeAccounts, type User } from '../services/api';
import '../assets/css/workspace.css';
import { Panel, StatTiles } from './workspace/ui';
import { useLive } from './workspace/useLive';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '–' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function Profile({ user, token, onLogout }: { user: User; token: string; onLogout: () => void }) {
  const counts = useLive(async () => {
    const [ig, yt] = await Promise.all([getInstagramAccounts(token), getYoutubeAccounts(token)]);
    return { instagram: ig.length, youtube: yt.length };
  }, `counts:${user.id}`);

  return (
    <div className="ws">
      <main className="ws-main">
        <div className="ws-pagehead">
          <div>
            <h2>My profile</h2>
            <p className="ws-sub">Your account details and connected accounts.</p>
          </div>
        </div>

        <section className="ws-profile">
          <div className="ws-avatar" aria-hidden="true">{user.username.charAt(0).toUpperCase()}</div>
          <div className="ws-profile-main">
            <h2>@{user.username}</h2>
            <span className="ws-handle">{user.email_address}</span>
          </div>
          <span className={`tag ${user.is_active ? 'tag-rate' : ''}`}>{user.is_active ? 'Active' : 'Deactivated'}</span>
        </section>

        <Panel title="Account details">
          <dl className="profile-details">
            <div><dt>Username</dt><dd>{user.username}</dd></div>
            <div><dt>Email</dt><dd>{user.email_address}</dd></div>
            <div><dt>Phone</dt><dd>{user.phone_number || 'Not provided'}</dd></div>
            <div><dt>Member since</dt><dd>{formatDate(user.created_at)}</dd></div>
          </dl>
        </Panel>

        <Panel title="Connected accounts" sub="Add, update or remove the accounts you analyse." actions={<Link className="btn btn-secondary" to="/accounts">Manage accounts</Link>}>
          {counts.error ? (
            <p className="trends-empty-inline">{counts.error}</p>
          ) : (
            <StatTiles items={[
              { label: 'Instagram accounts', value: counts.data ? String(counts.data.instagram) : '…' },
              { label: 'YouTube channels', value: counts.data ? String(counts.data.youtube) : '…' },
            ]} />
          )}
        </Panel>

        <Panel title="Session" sub="Signing out ends this session on this device.">
          <button className="btn btn-secondary btn-danger" onClick={onLogout}>Log out</button>
        </Panel>
      </main>
    </div>
  );
}

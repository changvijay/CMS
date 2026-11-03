import { useState, type MouseEvent } from 'react';
import { mediaSrc } from './helpers';
import type { MediaItem, UserTag } from './types';

/**
 * Click the image to drop a tag there, then type the username. Positions are stored as 0-1 fractions,
 * which is what Instagram's user_tags x/y expect. Videos (reels, stories) take tags without a position.
 */
export function UserTagPicker({ item, tags, onChange, withPosition = true, max = 20 }: { item: MediaItem; tags: UserTag[]; onChange: (t: UserTag[]) => void; withPosition?: boolean; max?: number }) {
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [name, setName] = useState('');

  const place = (e: MouseEvent<HTMLDivElement>) => {
    if (tags.length >= max) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPending({ x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) });
    setName('');
  };
  const save = () => {
    const username = name.trim().replace(/^@/, '');
    if (!username) return;
    onChange([...tags.filter((t) => t.username !== username), withPosition && pending ? { username, x: Math.round(pending.x * 1000) / 1000, y: Math.round(pending.y * 1000) / 1000 } : { username }]);
    setPending(null);
    setName('');
  };

  return (
    <div className="pf-tagger">
      {withPosition && item.kind === 'image' ? (
        <div className="pf-tagger-image" onClick={place} role="presentation">
          <img src={mediaSrc(item)} alt="Click to tag someone" />
          {tags.filter((t) => t.x !== undefined).map((t) => (
            <span key={t.username} className="pf-tag-dot" style={{ left: `${(t.x ?? 0) * 100}%`, top: `${(t.y ?? 0) * 100}%` }}>@{t.username}</span>
          ))}
          {pending && <span className="pf-tag-dot pending" style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%` }}>+</span>}
        </div>
      ) : null}
      {(pending || !withPosition || item.kind !== 'image') && (
        <div className="pf-tagger-input">
          <input
            className="pf-input"
            autoFocus={Boolean(pending)}
            value={name}
            placeholder="@username"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') setPending(null); }}
          />
          <button type="button" className="btn btn-secondary" onClick={save}>Tag</button>
        </div>
      )}
      {withPosition && item.kind === 'image' && !pending && <p className="pf-hint">Click on the photo where the person is, then type their username.</p>}
      {tags.length > 0 && (
        <div className="pf-chips static">
          {tags.map((t) => (
            <span key={t.username} className="pf-chip">@{t.username}<button type="button" aria-label={`Remove @${t.username}`} onClick={() => onChange(tags.filter((x) => x.username !== t.username))}>×</button></span>
          ))}
        </div>
      )}
    </div>
  );
}

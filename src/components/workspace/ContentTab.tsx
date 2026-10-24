import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Platform, StoredMedia } from '../../services/api';
import { RankedBars } from '../charts/RankedBars';
import { ENGAGEMENT_RATE_HELP, SKIP_RATE_HELP, formatCompact, formatPercent, formatSeconds, formatShortDate } from '../charts/viz';
import { CommentInsights } from './CommentInsights';
import { InfoTip } from './InfoTip';
import { InstagramStories } from './InstagramStories';
import { YoutubeVideos } from './YoutubeVideos';
import { hashtagPerformance, mediaEngagementRate, performanceByFormat, typeLabel } from './content';

type SortKey = 'newest' | 'views' | 'engagement' | 'likes' | 'comments' | 'saves' | 'shares' | 'skip' | 'watch';

const SORTS: { key: SortKey; label: string; platforms?: Platform[] }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'views', label: 'Most views' },
  { key: 'engagement', label: 'Best engagement rate' },
  { key: 'likes', label: 'Most likes' },
  { key: 'comments', label: 'Most comments' },
  { key: 'saves', label: 'Most saves', platforms: ['instagram'] },
  { key: 'shares', label: 'Most shares', platforms: ['instagram'] },
  { key: 'skip', label: 'Lowest skip rate (reels)', platforms: ['instagram'] },
  { key: 'watch', label: 'Longest avg watch time (reels)', platforms: ['instagram'] },
];

function Thumb({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className="content-thumb content-thumb-empty" aria-hidden="true">No preview</div>;
  return <img className="content-thumb" src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

interface Props {
  platform: Platform;
  media: StoredMedia[];
  token: string;
  accountId: string;
  since: string;
  until: string;
}

export function ContentTab({ platform, media, token, accountId, since, until }: Props) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('ALL');
  const [sort, setSort] = useState<SortKey>('newest');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');

  const noun = platform === 'instagram' ? 'posts' : 'videos';
  const posts = useMemo(() => media.filter((m) => m.media_type !== 'STORY'), [media]);
  const storyCount = media.length - posts.length;

  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of media) counts.set(m.media_type || 'Other', (counts.get(m.media_type || 'Other') ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [media]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = type === 'ALL' ? posts : media.filter((m) => (m.media_type || 'Other') === type);
    const list = pool.filter((m) => !q || (m.title || '').toLowerCase().includes(q));
    const audience = (m: StoredMedia) => m.views ?? m.reach ?? 0;
    const time = (m: StoredMedia) => new Date(m.published_at || 0).getTime();
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'views': return audience(b) - audience(a);
        case 'engagement': return (mediaEngagementRate(b) ?? -1) - (mediaEngagementRate(a) ?? -1);
        case 'likes': return (b.likes ?? 0) - (a.likes ?? 0);
        case 'comments': return (b.comments ?? 0) - (a.comments ?? 0);
        case 'saves': return (b.saves ?? 0) - (a.saves ?? 0);
        case 'shares': return (b.shares ?? 0) - (a.shares ?? 0);
        case 'skip': return (a.skip_rate ?? 101) - (b.skip_rate ?? 101);
        case 'watch': return (b.avg_watch_seconds ?? -1) - (a.avg_watch_seconds ?? -1);
        default: return time(b) - time(a);
      }
    });
  }, [media, posts, query, type, sort]);

  const formats = useMemo(() => performanceByFormat(posts), [posts]);
  const hashtags = useMemo(() => (platform === 'instagram' ? hashtagPerformance(posts).slice(0, 10) : []), [posts, platform]);

  const totalViews = shown.reduce((a, m) => a + (m.views ?? m.reach ?? 0), 0);
  const rates = shown.map(mediaEngagementRate).filter((r): r is number => r !== null);
  const avgRate = rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10 : null;
  const skips = shown.map((m) => m.skip_rate).filter((s): s is number => s !== null);
  const avgSkip = skips.length ? Math.round((skips.reduce((a, b) => a + b, 0) / skips.length) * 10) / 10 : null;

  return (
    <>
      {platform === 'instagram' && <InstagramStories token={token} accountId={accountId} />}

      <section className="viz-panel">
        <div className="content-controls">
          <label className="ws-search">
            <span className="sr-only">Search {noun}</span>
            <input type="search" placeholder={`Search ${noun} by caption or title`} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label className="ws-select">
            <span className="sr-only">Sort by</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {SORTS.filter((s) => !s.platforms || s.platforms.includes(platform)).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <div className="seg" role="group" aria-label="Layout">
            <button className={layout === 'grid' ? 'active' : ''} aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}>Grid</button>
            <button className={layout === 'list' ? 'active' : ''} aria-pressed={layout === 'list'} onClick={() => setLayout('list')}>List</button>
          </div>
        </div>

        {types.length > 1 && (
          <div className="chip-row" role="group" aria-label="Filter by format">
            <button className={`chip ${type === 'ALL' ? 'active' : ''}`} aria-pressed={type === 'ALL'} onClick={() => setType('ALL')}>All {noun} ({posts.length})</button>
            {types.map(([t, n]) => (
              <button key={t} className={`chip ${type === t ? 'active' : ''}`} aria-pressed={type === t} onClick={() => setType(t)}>{typeLabel(t)} ({n})</button>
            ))}
          </div>
        )}

        <dl className="stat-strip">
          <div><dt>Showing</dt><dd>{shown.length} {type === 'STORY' ? 'stories' : noun}</dd></div>
          <div><dt>Total views</dt><dd>{formatCompact(totalViews)}</dd></div>
          <div><dt>Avg engagement rate<InfoTip text={ENGAGEMENT_RATE_HELP} /></dt><dd>{avgRate === null ? '–' : `${avgRate}%`}</dd></div>
          {avgSkip !== null && <div><dt>Avg skip rate<InfoTip text={SKIP_RATE_HELP} /></dt><dd>{avgSkip}%</dd></div>}
        </dl>
        {storyCount > 0 && type === 'ALL' && <p className="ws-note">{storyCount} saved stories are hidden here. Choose “Stories” above to see them.</p>}
      </section>

      {shown.length === 0 ? (
        <div className="ws-empty">No {noun} match your filters.</div>
      ) : (
        <ul className={`content-list ${layout === 'grid' ? 'content-grid' : 'content-list-view'}`}>
          {shown.map((m) => {
            const rate = mediaEngagementRate(m);
            const stats: [string, string | null][] = [
              ['Views', m.views !== null ? formatCompact(m.views) : null],
              ['Reach', m.reach !== null ? formatCompact(m.reach) : null],
              ['Likes', m.likes !== null ? formatCompact(m.likes) : null],
              ['Comments', m.comments !== null ? formatCompact(m.comments) : null],
              ['Saves', m.saves !== null ? formatCompact(m.saves) : null],
              ['Shares', m.shares !== null ? formatCompact(m.shares) : null],
              ['Reposts', m.reposts !== null ? formatCompact(m.reposts) : null],
              ['Skip rate', m.skip_rate !== null ? formatPercent(m.skip_rate) : null],
              ['Avg watch', m.avg_watch_seconds !== null ? formatSeconds(m.avg_watch_seconds) : null],
              ['Follows', m.follows !== null ? formatCompact(m.follows) : null],
              ['Profile visits', m.profile_visits !== null ? formatCompact(m.profile_visits) : null],
              ['Replies', m.replies !== null ? formatCompact(m.replies) : null],
              ['Link clicks', m.link_clicks !== null ? formatCompact(m.link_clicks) : null],
              ['Length', m.duration_seconds !== null ? formatSeconds(m.duration_seconds) : null],
            ];
            return (
              <li key={m.media_id} className="content-card">
                <Thumb src={m.thumbnail_url} />
                <div className="content-body">
                  <div className="content-meta">
                    <span className="tag">{typeLabel(m.media_type)}</span>
                    {m.published_at && <span>{formatShortDate(m.published_at.slice(0, 10))}</span>}
                    {rate !== null && <span className="tag tag-rate" title={ENGAGEMENT_RATE_HELP}>{rate}% engagement</span>}
                  </div>
                  <p className="content-title">{m.title || 'Untitled'}</p>
                  <dl className="content-stats">
                    {stats.filter(([, v]) => v !== null).map(([label, v]) => (
                      <div key={label}><dd>{v}</dd><dt>{label}</dt></div>
                    ))}
                  </dl>
                  <div className="content-actions">
                    {m.permalink && <a className="content-link" href={m.permalink} target="_blank" rel="noreferrer">Open on {platform === 'instagram' ? 'Instagram' : 'YouTube'} ↗</a>}
                    {platform === 'instagram' && m.media_type !== 'STORY' && /^\d+$/.test(m.media_id) && (
                      <Link className="content-link" to={`/automation?account=${accountId}&media=${m.media_id}`}>Set up auto-reply for this {m.media_type === 'REEL' ? 'reel' : 'post'} →</Link>
                    )}
                    {m.media_type !== 'STORY' && (platform === 'youtube' || /^\d+$/.test(m.media_id)) && (
                      <CommentInsights platform={platform} token={token} accountId={accountId} id={m.media_id} />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {(formats.length > 0 || hashtags.length > 0) && (
        <div className="viz-two-col">
          {formats.length > 0 && (
            <section className="viz-panel">
              <h3>Which format works best</h3>
              <p className="ws-sub">Average engagement rate by format.</p>
              <RankedBars rows={formats.map((f) => ({ label: `${f.label} (${f.count})`, value: f.avgRate }))} valueSuffix="%" />
            </section>
          )}
          {platform === 'instagram' && (
            <section className="viz-panel">
              <h3>Hashtag performance</h3>
              <p className="ws-sub">Hashtags used on at least 2 posts, ranked by average engagement rate.</p>
              {hashtags.length === 0 ? (
                <p className="trends-empty-inline">Not enough repeated hashtags yet.</p>
              ) : (
                <div className="viz-table-wrap">
                  <table className="viz-table">
                    <thead><tr><th>Hashtag</th><th>Posts</th><th>Avg views</th><th>Avg engagement</th></tr></thead>
                    <tbody>
                      {hashtags.map((h) => (
                        <tr key={h.tag}><td>{h.tag}</td><td>{h.posts}</td><td>{formatCompact(h.avgViews)}</td><td>{h.avgRate}%</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {platform === 'youtube' && <YoutubeVideos token={token} accountId={accountId} since={since} until={until} />}
    </>
  );
}

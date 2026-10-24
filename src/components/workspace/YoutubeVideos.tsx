import { Fragment, useMemo, useState } from 'react';
import { fetchYoutubeRetention, fetchYoutubeVideos, type RetentionPoint, type YoutubeVideoAnalytics } from '../../services/api';
import { RetentionChart } from '../charts/RetentionChart';
import { formatCompact, formatPercent, formatSeconds } from '../charts/viz';
import { CommentInsights } from './CommentInsights';
import { LiveBlock, Panel } from './ui';
import { useLive } from './useLive';

type SortKey = 'views' | 'engagedViews' | 'averageViewPercentage' | 'averageViewDuration' | 'likes' | 'comments' | 'shares' | 'subscribersGained' | 'videosAddedToPlaylists' | 'duration_seconds' | 'subsPer1k';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'views', label: 'Views' },
  { key: 'engagedViews', label: 'Engaged' },
  { key: 'averageViewPercentage', label: 'Avg % viewed' },
  { key: 'averageViewDuration', label: 'Avg duration' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'subscribersGained', label: 'Subs gained' },
  { key: 'subsPer1k', label: 'Subs / 1K views' },
  { key: 'videosAddedToPlaylists', label: 'Playlist adds' },
];

const FORMAT: Record<string, string> = { SHORTS: 'Short', VIDEO_ON_DEMAND: 'Video', LIVE_STREAM: 'Live' };

function value(v: YoutubeVideoAnalytics, key: SortKey): number {
  if (key === 'subsPer1k') return v.views > 0 ? (v.subscribersGained / v.views) * 1000 : 0;
  return (v[key] as number | null) ?? 0;
}

function Retention({ token, accountId, videoId }: { token: string; accountId: string; videoId: string }) {
  const state = useLive<RetentionPoint[]>(() => fetchYoutubeRetention(token, videoId, accountId), `ret:${accountId}:${videoId}`);
  return (
    <LiveBlock state={state}>
      {(points) => {
        if (!points.length) return <p className="trends-empty-inline">YouTube has no retention curve for this video yet.</p>;
        const at = (pct: number) => points.find((p) => Math.round(p.elapsedVideoTimeRatio * 100) === pct);
        const marks = [10, 25, 50, 75].map((p) => ({ p, v: at(p) })).filter((m) => m.v);
        return (
          <>
            <RetentionChart points={points} />
            <p className="ws-note">
              {marks.map((m) => `${m.p}% in: ${Math.round((m.v!.audienceWatchRatio) * 100)}% still watching`).join(' · ')}. A steep drop in the first 10% means the intro isn't hooking viewers.
            </p>
          </>
        );
      }}
    </LiveBlock>
  );
}

export function YoutubeVideos({ token, accountId, since, until }: { token: string; accountId: string; since: string; until: string }) {
  const state = useLive(() => fetchYoutubeVideos(token, { accountId, since, until }), `vids:${accountId}:${since}:${until}`);
  const [sort, setSort] = useState<SortKey>('views');
  const [open, setOpen] = useState<string | null>(null);

  const sorted = useMemo(() => [...(state.data ?? [])].sort((a, b) => value(b, sort) - value(a, sort)), [state.data, sort]);

  return (
    <Panel title="Every video, side by side" sub="Performance in the selected dates for up to 200 videos. Click a column to sort. Open a video to see where viewers drop off.">
      <LiveBlock state={state}>
        {() =>
          sorted.length === 0 ? (
            <p className="trends-empty-inline">No video analytics for this range.</p>
          ) : (
            <div className="viz-table-wrap tall">
              <table className="viz-table video-table">
                <thead>
                  <tr>
                    <th>Video</th>
                    <th>Format</th>
                    <th><button className={`th-sort ${sort === 'duration_seconds' ? 'on' : ''}`} onClick={() => setSort('duration_seconds')}>Length</button></th>
                    {COLUMNS.map((c) => (
                      <th key={c.key}><button className={`th-sort ${sort === c.key ? 'on' : ''}`} onClick={() => setSort(c.key)}>{c.label}</button></th>
                    ))}
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((v) => (
                    <Fragment key={v.video}>
                      <tr>
                        <td className="viz-table-title"><a href={`https://www.youtube.com/watch?v=${v.video}`} target="_blank" rel="noreferrer">{v.title}</a></td>
                        <td>{FORMAT[v.creatorContentType ?? ''] ?? '–'}</td>
                        <td>{formatSeconds(v.duration_seconds)}</td>
                        <td>{formatCompact(v.views)}</td>
                        <td>{formatCompact(v.engagedViews)}</td>
                        <td>{formatPercent(v.averageViewPercentage)}</td>
                        <td>{formatSeconds(v.averageViewDuration)}</td>
                        <td>{formatCompact(v.likes)}</td>
                        <td>{formatCompact(v.comments)}</td>
                        <td>{formatCompact(v.shares)}</td>
                        <td>{formatCompact(v.subscribersGained)}</td>
                        <td>{Math.round(value(v, 'subsPer1k') * 10) / 10}</td>
                        <td>{formatCompact(v.videosAddedToPlaylists)}</td>
                        <td><button className="content-link as-button" onClick={() => setOpen(open === v.video ? null : v.video)} aria-expanded={open === v.video}>{open === v.video ? 'Close' : 'Open'}</button></td>
                      </tr>
                      {open === v.video && (
                        <tr className="detail-row">
                          <td colSpan={COLUMNS.length + 4}>
                            <h4>Audience retention</h4>
                            <Retention token={token} accountId={accountId} videoId={v.video} />
                            <CommentInsights platform="youtube" token={token} accountId={accountId} id={v.video} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </LiveBlock>
    </Panel>
  );
}

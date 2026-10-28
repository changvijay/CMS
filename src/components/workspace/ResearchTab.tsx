import { useMemo, useState, type FormEvent } from 'react';
import {
  fetchBenchmark, fetchHashtag, fetchInstagramTags, fetchPublishingLimit, fetchYoutubePlaylists, fetchYoutubeRevenue,
  type BenchmarkSummary, type HashtagResult, type Platform, type StoredMedia, type YoutubePlaylist, type YoutubeRevenue,
} from '../../services/api';
import { errorMessage } from '../../utils/errors';
import { formatCompact, formatPercent, formatSeconds, formatShortDate } from '../charts/viz';
import { CommentInsights } from './CommentInsights';
import { ErrorLine, LiveBlock, Panel, ReportBody, StatTiles } from './ui';
import { isPermissionError } from '../../utils/errors';
import { useLive, ANALYTICS_MAX_AGE } from './useLive';
import { cadence } from './strategy';

// ---------------------------------------------------------------- Instagram

function PublishingLimit({ token, accountId }: { token: string; accountId: string }) {
  const state = useLive(() => fetchPublishingLimit(token, accountId), `limit:${accountId}`, true, { maxAge: ANALYTICS_MAX_AGE });
  return (
    <Panel title="Publishing quota" sub="Instagram caps how many posts an account can publish through the API in 24 hours.">
      <LiveBlock state={state}>
        {(d) => (
          <StatTiles items={[
            { label: 'Used', value: d.quota_usage === null ? '–' : String(d.quota_usage) },
            { label: 'Allowed', value: d.quota_total === null ? '–' : String(d.quota_total) },
            { label: 'Window', value: d.quota_duration_seconds ? `${Math.round(d.quota_duration_seconds / 3600)} hours` : '–' },
          ]} />
        )}
      </LiveBlock>
    </Panel>
  );
}

function Benchmark({ token, accountId, media }: { token: string; accountId: string; media: StoredMedia[] }) {
  const [name, setName] = useState('');
  const [result, setResult] = useState<BenchmarkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mine = useMemo(() => {
    const posts = media.filter((m) => m.media_type !== 'STORY');
    const avg = (pick: (m: StoredMedia) => number | null) => (posts.length ? Math.round(posts.reduce((a, m) => a + (pick(m) ?? 0), 0) / posts.length) : null);
    return { avgLikes: avg((m) => m.likes), avgComments: avg((m) => m.comments), perWeek: cadence(posts)?.postsPerWeek ?? null, posts: posts.length };
  }, [media]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await fetchBenchmark(token, name.trim(), accountId));
    } catch (err) {
      setResult(null);
      setError(errorMessage(err, 'Benchmark failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Compare with another account" sub="Enter any public Instagram business or creator account to see how its audience, posting rhythm and engagement compare with yours.">
      <form className="inline-form" onSubmit={submit}>
        <label className="ws-search"><span className="sr-only">Instagram username</span><input type="text" placeholder="username, without @" value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Looking up…' : 'Compare'}</button>
      </form>
      {error && <div className="error-banner"><span>{error}</span></div>}
      {result && (
        <>
          <h4 className="sub-title">@{result.username} {result.name ? `· ${result.name}` : ''}</h4>
          <StatTiles items={[
            { label: 'Followers', value: formatCompact(result.followers_count) },
            { label: 'Posts (total)', value: formatCompact(result.media_count) },
            { label: 'Engagement rate', value: formatPercent(result.engagement_rate), hint: '(likes + comments) per post, divided by followers' },
            { label: 'Posts per week', value: result.posts_per_week === null ? '–' : String(result.posts_per_week) },
            { label: 'Avg likes', value: formatCompact(result.avg_likes) },
            { label: 'Avg comments', value: formatCompact(result.avg_comments) },
          ]} />
          <div className="viz-table-wrap">
            <table className="viz-table">
              <thead><tr><th>Measure</th><th>You (stored posts)</th><th>@{result.username} (latest {result.sampled_posts})</th></tr></thead>
              <tbody>
                <tr><td>Avg likes per post</td><td>{mine.avgLikes === null ? '–' : formatCompact(mine.avgLikes)}</td><td>{formatCompact(result.avg_likes)}</td></tr>
                <tr><td>Avg comments per post</td><td>{mine.avgComments === null ? '–' : formatCompact(mine.avgComments)}</td><td>{formatCompact(result.avg_comments)}</td></tr>
                <tr><td>Posts per week</td><td>{mine.perWeek ?? '–'}</td><td>{result.posts_per_week ?? '–'}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="ws-note">Format mix: {Object.entries(result.format_mix).map(([k, v]) => `${k.toLowerCase().replace('_', ' ')} ${v}`).join(' · ') || '–'}</p>
          <h4 className="sub-title">Their best recent posts</h4>
          <ul className="hook-list">
            {result.top_posts.map((p) => (
              <li key={p.permalink}><b>{formatCompact(p.likes + p.comments)}</b> reactions · <a href={p.permalink} target="_blank" rel="noreferrer">{p.caption || '(no caption)'}</a></li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function HashtagResearch({ token, accountId }: { token: string; accountId: string }) {
  const [tag, setTag] = useState('');
  const [result, setResult] = useState<HashtagResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await fetchHashtag(token, tag.trim().replace(/^#/, ''), accountId));
    } catch (err) {
      setResult(null);
      setError(errorMessage(err, 'Hashtag search failed'));
    } finally {
      setBusy(false);
    }
  };

  const avg = (rows: HashtagResult['top']) => (rows.length ? Math.round(rows.reduce((a, r) => a + (r.like_count ?? 0), 0) / rows.length) : null);

  return (
    <Panel title="Hashtag research" sub="See the posts doing best right now under any hashtag before you use it. Instagram allows 30 different hashtag searches per week.">
      <form className="inline-form" onSubmit={submit}>
        <label className="ws-search"><span className="sr-only">Hashtag</span><input type="text" placeholder="hashtag, without #" value={tag} onChange={(e) => setTag(e.target.value)} required /></label>
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
      </form>
      {error && <div className="error-banner"><span>{error}</span></div>}
      {result && (
        <>
          <StatTiles items={[
            { label: 'Top posts: avg likes', value: formatCompact(avg(result.top)) },
            { label: 'Recent posts: avg likes', value: formatCompact(avg(result.recent)) },
          ]} />
          {result.top_error && <ErrorLine error={result.top_error} label="Instagram (top posts)" />}
          {result.recent_error && <ErrorLine error={result.recent_error} label="Instagram (recent posts)" />}
          <div className="viz-two-col">
            {([['Top posts', result.top], ['Most recent', result.recent]] as const).map(([title, rows]) => (
              <div key={title}>
                <h4 className="sub-title">{title}</h4>
                <ul className="hook-list">
                  {rows.slice(0, 10).map((r) => <li key={r.id}><b>{formatCompact(r.like_count ?? 0)}</b> likes · <a href={r.permalink} target="_blank" rel="noreferrer">{(r.caption || '(no caption)').slice(0, 70)}</a></li>)}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

function TaggedPosts({ token, accountId }: { token: string; accountId: string }) {
  const state = useLive(() => fetchInstagramTags(token, accountId), `tags:${accountId}`, true, { maxAge: ANALYTICS_MAX_AGE });
  return (
    <Panel title="Posts that tag you" sub="Content other people made about you. Great material for reposting and thanking creators.">
      <LiveBlock state={state}>
        {(rows) => rows.length === 0 ? <p className="trends-empty-inline">No tagged posts found.</p> : (
          <ul className="hook-list">
            {rows.map((r) => <li key={r.id}><b>{r.timestamp ? formatShortDate(r.timestamp.slice(0, 10)) : ''}</b> · <a href={r.permalink} target="_blank" rel="noreferrer">{(r.caption || '(no caption)').slice(0, 90)}</a></li>)}
          </ul>
        )}
      </LiveBlock>
    </Panel>
  );
}

// ---------------------------------------------------------------- YouTube

function Revenue({ token, accountId, since, until }: { token: string; accountId: string; since: string; until: string }) {
  const state = useLive<YoutubeRevenue>(() => fetchYoutubeRevenue(token, { accountId, since, until }), `rev:${accountId}:${since}:${until}`);
  const money = (v: number | undefined) => (v === undefined ? '–' : `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  // Revenue is only readable with a Google token that has the monetary permission (an admin/owner token). Others never see this section.
  if (state.loading || (state.data?.totals?.error && isPermissionError(state.data.totals.error))) return null;
  return (
    <Panel title="Revenue" sub="Needs a monetised channel (YouTube Partner Program) and a Google token that includes the monetary permission. Amounts are in US dollars.">
      <LiveBlock state={state}>
        {(d) => (
          <>
            <ReportBody report={d.totals} label="YouTube" empty="No revenue data for this range.">
              {(rows) => {
                const t = rows[0];
                return (
                  <StatTiles items={[
                    { label: 'Estimated revenue', value: money(t.estimatedRevenue) },
                    { label: 'From ads', value: money(t.estimatedAdRevenue) },
                    { label: 'From Premium', value: money(t.estimatedRedPartnerRevenue) },
                    { label: 'Gross ad revenue', value: money(t.grossRevenue) },
                    { label: 'CPM', value: money(t.cpm), hint: 'Gross revenue per 1,000 ad impressions' },
                    { label: 'Playback CPM', value: money(t.playbackBasedCpm), hint: 'Gross revenue per 1,000 playbacks' },
                    { label: 'Ad impressions', value: formatCompact(t.adImpressions) },
                    { label: 'Monetised playbacks', value: formatCompact(t.monetizedPlaybacks) },
                  ]} />
                );
              }}
            </ReportBody>
            <h4 className="sub-title">Top earning videos</h4>
            <ReportBody report={d.top_videos} label="YouTube" empty="No earning videos in this range.">
              {(rows) => (
                <ul className="hook-list">
                  {rows.map((r) => <li key={r.video}><b>{money(r.estimatedRevenue)}</b> · {formatCompact(r.views)} views · {r.title ?? r.video}</li>)}
                </ul>
              )}
            </ReportBody>
          </>
        )}
      </LiveBlock>
    </Panel>
  );
}

function Playlists({ token, accountId, since, until }: { token: string; accountId: string; since: string; until: string }) {
  const state = useLive<YoutubePlaylist[]>(() => fetchYoutubePlaylists(token, { accountId, since, until }), `pl:${accountId}:${since}:${until}`);
  return (
    <Panel title="Playlists" sub="Do viewers keep watching after the first video? Starts and views per start show it.">
      <LiveBlock state={state}>
        {(rows) => rows.length === 0 ? <p className="trends-empty-inline">No playlists found.</p> : (
          <div className="viz-table-wrap">
            <table className="viz-table">
              <thead><tr><th>Playlist</th><th>Videos</th><th>Starts</th><th>Views</th><th>Views / start</th><th>Avg time in playlist</th><th>Saves</th></tr></thead>
              <tbody>
                {rows.map((p) => {
                  const s = p.stats && !('error' in p.stats) ? (p.stats as Record<string, number>) : null;
                  return (
                    <tr key={p.id}>
                      <td className="viz-table-title"><a href={`https://www.youtube.com/playlist?list=${p.id}`} target="_blank" rel="noreferrer">{p.title}</a></td>
                      <td>{p.item_count ?? '–'}</td>
                      <td>{s ? formatCompact(s.playlistStarts) : '–'}</td>
                      <td>{s ? formatCompact(s.playlistViews ?? s.views) : '–'}</td>
                      <td>{s?.viewsPerPlaylistStart !== undefined ? Math.round(s.viewsPerPlaylistStart * 10) / 10 : '–'}</td>
                      <td>{s?.averageTimeInPlaylist !== undefined ? formatSeconds(s.averageTimeInPlaylist * 60) : '–'}</td>
                      <td>{s ? formatCompact(s.playlistSaves) : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </LiveBlock>
    </Panel>
  );
}

function CommentLookup({ token, accountId, media }: { token: string; accountId: string; media: StoredMedia[] }) {
  const [id, setId] = useState(media[0]?.media_id ?? '');
  return (
    <Panel title="What are viewers saying?" sub="Pick a video to see the questions and most-used words in its comments. Questions are ready-made ideas for your next video.">
      {media.length === 0 ? <p className="trends-empty-inline">Update your data first so your videos appear here.</p> : (
        <>
          <label className="ws-select"><span className="sr-only">Video</span>
            <select value={id} onChange={(e) => setId(e.target.value)}>
              {media.map((m) => <option key={m.media_id} value={m.media_id}>{(m.title || 'Untitled').slice(0, 80)}</option>)}
            </select>
          </label>
          <CommentInsights key={id} platform="youtube" token={token} accountId={accountId} id={id} />
        </>
      )}
    </Panel>
  );
}

export function ResearchTab({ platform, token, accountId, since, until, media }: { platform: Platform; token: string; accountId: string; since: string; until: string; media: StoredMedia[] }) {
  return platform === 'instagram' ? (
    <>
      <Benchmark token={token} accountId={accountId} media={media} />
      <HashtagResearch token={token} accountId={accountId} />
      <TaggedPosts token={token} accountId={accountId} />
      <PublishingLimit token={token} accountId={accountId} />
    </>
  ) : (
    <>
      <Revenue token={token} accountId={accountId} since={since} until={until} />
      <Playlists token={token} accountId={accountId} since={since} until={until} />
      <CommentLookup token={token} accountId={accountId} media={media} />
    </>
  );
}

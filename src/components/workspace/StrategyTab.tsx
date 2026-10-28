import { useMemo } from 'react';
import { fetchYoutubeVideos, type Platform, type StoredMedia, type YoutubeVideoAnalytics } from '../../services/api';
import { RankedBars } from '../charts/RankedBars';
import { ENGAGEMENT_RATE_HELP, SKIP_RATE_HELP, formatCompact, formatPercent, formatSeconds } from '../charts/viz';
import { InfoTip } from './InfoTip';
import { LiveBlock, Panel, StatTiles } from './ui';
import { useLive, ANALYTICS_MAX_AGE } from './useLive';
import {
  cadence, captionAnalysis, durationBuckets, formatTable, instagramActions, postingSchedule, reelScorecard,
  round1, storyScorecard, titleAnalysis, uploadWeekdays, youtubeActions,
  type Action, type BucketRow, type VideoBucket,
} from './strategy';

const KIND_CLASS: Record<Action['kind'], string> = { 'Double down': 'k-double', Fix: 'k-fix', Test: 'k-test', 'Keep doing': 'k-keep' };

function ActionPlan({ actions, minimum }: { actions: Action[]; minimum: string }) {
  return (
    <Panel title="Your action plan" sub="Recommendations from your own results, most important first. Each one shows the numbers behind it.">
      {actions.length === 0 ? (
        <p className="trends-empty-inline">{minimum}</p>
      ) : (
        <ol className="action-list">
          {actions.map((a) => (
            <li key={a.title} className={`action action-${a.priority}`}>
              <span className={`action-kind ${KIND_CLASS[a.kind]}`}>{a.kind}</span>
              <div>
                <b>{a.title}</b>
                <p>{a.detail}</p>
              </div>
              <span className="action-priority">{a.priority === 'high' ? 'High priority' : a.priority === 'medium' ? 'Medium' : 'Nice to have'}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function BucketTable({ rows, columns }: { rows: (BucketRow | VideoBucket)[]; columns: [string, string, (v: number | null) => string][] }) {
  return (
    <div className="viz-table-wrap">
      <table className="viz-table">
        <thead><tr><th>Group</th><th>Count</th>{columns.map(([, h]) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>{r.count}</td>
              {columns.map(([k, h, f]) => <td key={h}>{f((r as unknown as Record<string, number | null>)[k] ?? null)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const pct = (v: number | null) => (v === null ? '–' : `${v}%`);
const num = (v: number | null) => (v === null ? '–' : formatCompact(Math.round(v)));
const one = (v: number | null) => (v === null ? '–' : String(v));

function InstagramStrategy({ media }: { media: StoredMedia[] }) {
  const posts = useMemo(() => media.filter((m) => m.media_type !== 'STORY'), [media]);
  const actions = useMemo(() => instagramActions(media), [media]);
  const reels = useMemo(() => reelScorecard(posts), [posts]);
  const formats = useMemo(() => formatTable(posts), [posts]);
  const schedule = useMemo(() => postingSchedule(posts), [posts]);
  const rhythm = useMemo(() => cadence(posts), [posts]);
  const captions = useMemo(() => captionAnalysis(posts), [posts]);
  const stories = useMemo(() => storyScorecard(media), [media]);
  const growth = useMemo(
    () => posts.filter((m) => (m.reach ?? 0) >= 300 && m.follows !== null).map((m) => ({ m, per1k: round1(((m.follows ?? 0) / (m.reach ?? 1)) * 1000) })).sort((a, b) => b.per1k - a.per1k).slice(0, 5),
    [posts]
  );

  return (
    <>
      <ActionPlan actions={actions} minimum="Not enough posts yet for recommendations. Press Update data after a few more posts, or choose a longer content window." />

      <Panel title="Reel hooks: skip rate" sub="Skip rate is the share of plays abandoned in the first 3 seconds. It is the clearest score of how good your opening is.">
        {!reels ? (
          <p className="trends-empty-inline">No reel skip-rate data yet. Instagram reports it for recent reels; press Update data to collect it.</p>
        ) : (
          <>
            <StatTiles items={[
              { label: 'Reels measured', value: String(reels.count) },
              { label: 'Skip rate (view-weighted)', value: formatPercent(reels.weightedSkipRate), hint: SKIP_RATE_HELP },
              { label: 'Avg watch time', value: formatSeconds(reels.avgWatchSeconds) },
              { label: 'Total watch time', value: reels.totalWatchHours === null ? '–' : `${reels.totalWatchHours} h` },
            ]} />
            <h4 className="sub-title">Do reels with fewer skips perform better?</h4>
            <BucketTable rows={reels.buckets} columns={[['avgViews', 'Avg views', num], ['avgRate', 'Avg engagement', pct]]} />
            {reels.skipVsEngagement !== null && (
              <p className="ws-note">
                Correlation between skip rate and engagement: <b>{reels.skipVsEngagement}</b>. {reels.skipVsEngagement <= -0.4 ? 'Strongly negative: better hooks go with more engagement.' : reels.skipVsEngagement >= 0.4 ? 'Positive: in your data, higher skip rates go with higher engagement, so skip rate alone may not be your problem.' : 'Weak: skip rate and engagement are not tightly linked in your data.'}
              </p>
            )}
            <div className="viz-two-col">
              <div>
                <h4 className="sub-title">Hooks to copy (lowest skip rate)</h4>
                <ul className="hook-list">
                  {reels.best.map((m) => <li key={m.media_id}><b>{formatPercent(m.skip_rate)}</b> {(m.title || 'Untitled').slice(0, 80)}</li>)}
                </ul>
              </div>
              <div>
                <h4 className="sub-title">Hooks to rework (highest skip rate)</h4>
                <ul className="hook-list">
                  {reels.worst.map((m) => <li key={m.media_id}><b>{formatPercent(m.skip_rate)}</b> {(m.title || 'Untitled').slice(0, 80)}</li>)}
                </ul>
              </div>
            </div>
          </>
        )}
      </Panel>

      <Panel title="Format scorecard" sub="Every format side by side. Save rate and share rate are per person reached.">
        {formats.length === 0 ? <p className="trends-empty-inline">No posts yet.</p> : (
          <div className="viz-table-wrap">
            <table className="viz-table">
              <thead><tr><th>Format</th><th>Posts</th><th>Avg views</th><th>Engagement<InfoTip text={ENGAGEMENT_RATE_HELP} /></th><th>Save rate</th><th>Share rate</th><th>Follows / 1K reach</th><th>Skip rate</th></tr></thead>
              <tbody>
                {formats.map((f) => (
                  <tr key={f.type}><td>{f.label}</td><td>{f.count}</td><td>{num(f.avgAudience)}</td><td>{pct(f.avgRate)}</td><td>{pct(f.saveRate)}</td><td>{pct(f.shareRate)}</td><td>{one(f.followsPer1kReach)}</td><td>{pct(f.avgSkipRate)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="viz-two-col">
        <Panel title="Best day to post" sub={schedule.enough ? 'Average engagement rate by publish day (India time).' : `Based on ${schedule.posts} posts. Treat this as a hint until you have 10 or more.`}>
          <RankedBars rows={schedule.weekdays.filter((d) => d.avgRate !== null).map((d) => ({ label: `${d.label} (${d.count})`, value: d.avgRate as number }))} valueSuffix="%" emptyText="Not enough dated posts yet." />
        </Panel>
        <Panel title="Best time of day" sub="Average engagement rate by publish time (India time). Compare with when your followers are online in the Audience tab.">
          <RankedBars rows={schedule.bands.filter((d) => d.avgRate !== null).map((d) => ({ label: `${d.label} (${d.count})`, value: d.avgRate as number }))} valueSuffix="%" emptyText="Not enough dated posts yet." />
        </Panel>
      </div>

      <Panel title="Posting rhythm" sub="Consistency matters as much as quality.">
        {!rhythm ? <p className="trends-empty-inline">Need at least 3 posts.</p> : (
          <>
            <StatTiles items={[
              { label: 'Posts per week', value: one(rhythm.postsPerWeek) },
              { label: 'Typical gap', value: `${rhythm.medianGapDays} days` },
              { label: 'Busy weeks: avg views', value: num(rhythm.busyWeeksAvg) },
              { label: 'Quiet weeks: avg views', value: num(rhythm.quietWeeksAvg) },
            ]} />
            <RankedBars rows={rhythm.weekly.slice(-12).map((w) => ({ label: `Week of ${w.week.slice(5)}`, value: w.posts }))} valueSuffix=" posts" singularSuffix=" post" />
          </>
        )}
      </Panel>

      <Panel title="Caption patterns" sub="Average engagement rate by caption style.">
        <div className="viz-two-col">
          <div><h4 className="sub-title">Length</h4><BucketTable rows={captions.length} columns={[['avgRate', 'Avg engagement', pct]]} /></div>
          <div><h4 className="sub-title">Hashtags</h4><BucketTable rows={captions.hashtags} columns={[['avgRate', 'Avg engagement', pct]]} /></div>
        </div>
        <h4 className="sub-title">Questions</h4>
        <BucketTable rows={captions.question} columns={[['avgRate', 'Avg engagement', pct]]} />
      </Panel>

      {growth.length > 0 && (
        <Panel title="Posts that win followers" sub="Followers gained per 1,000 people reached.">
          <ul className="hook-list">
            {growth.map(({ m, per1k }) => <li key={m.media_id}><b>{per1k}</b> per 1K · {m.follows} followers · {(m.title || 'Untitled').slice(0, 80)}</li>)}
          </ul>
        </Panel>
      )}

      {stories && (
        <Panel title="Stories" sub={`${stories.count} stories captured. Navigation shows how people move through them.`}>
          <StatTiles items={[
            { label: 'Avg views', value: num(stories.avgViews) },
            { label: 'Avg reach', value: num(stories.avgReach) },
            { label: 'Exit rate', value: pct(stories.exitRate), hint: 'Share of story views that ended by leaving the story.' },
            { label: 'Forward taps', value: pct(stories.forwardTapRate) },
            { label: 'Back taps', value: pct(stories.backTapRate), hint: 'People tapping back to re-watch: a sign of interesting content.' },
            { label: 'Replies', value: String(stories.replies) },
            { label: 'Follows', value: String(stories.follows) },
            { label: 'Link clicks', value: String(stories.linkClicks) },
          ]} />
        </Panel>
      )}
    </>
  );
}

function YoutubeStrategyBody({ videos }: { videos: YoutubeVideoAnalytics[] }) {
  const actions = useMemo(() => youtubeActions(videos), [videos]);
  const durations = useMemo(() => durationBuckets(videos), [videos]);
  const titles = useMemo(() => titleAnalysis(videos), [videos]);
  const days = useMemo(() => uploadWeekdays(videos), [videos]);
  const converters = useMemo(() => videos.filter((v) => v.views >= 200).map((v) => ({ v, per1k: round1((v.subscribersGained / v.views) * 1000) })).sort((a, b) => b.per1k - a.per1k).slice(0, 5), [videos]);
  const leavers = useMemo(() => videos.filter((v) => v.views >= 100).sort((a, b) => a.averageViewPercentage - b.averageViewPercentage).slice(0, 5), [videos]);
  const cols: [string, string, (v: number | null) => string][] = [['avgViews', 'Avg views', num], ['avgViewPct', 'Avg % viewed', pct], ['engagementPer1k', 'Reactions / 1K views', one], ['subsPer1k', 'Subs / 1K views', one]];

  return (
    <>
      <ActionPlan actions={actions} minimum="Not enough videos with data in this range for recommendations. Try a longer date range." />
      <Panel title="Does video length matter?" sub="Retention and conversion by length. Retention is weighted by views.">
        <BucketTable rows={durations} columns={cols} />
      </Panel>
      <div className="viz-two-col">
        <Panel title="Videos that win subscribers" sub="Subscribers gained per 1,000 views (videos with 200+ views).">
          <ul className="hook-list">{converters.map(({ v, per1k }) => <li key={v.video}><b>{per1k}</b> per 1K · {v.subscribersGained} subs · {v.title.slice(0, 70)}</li>)}</ul>
        </Panel>
        <Panel title="Videos that lose viewers early" sub="Lowest average % viewed (videos with 100+ views). Open them in Content to see the retention curve.">
          <ul className="hook-list">{leavers.map((v) => <li key={v.video}><b>{formatPercent(v.averageViewPercentage)}</b> viewed · {v.title.slice(0, 70)}</li>)}</ul>
        </Panel>
      </div>
      <Panel title="Title patterns" sub="Measured with age-independent numbers, so older videos aren't unfairly favoured.">
        <div className="viz-two-col">
          <div><h4 className="sub-title">Length</h4><BucketTable rows={titles.length} columns={cols} /></div>
          <div><h4 className="sub-title">Numbers</h4><BucketTable rows={titles.number} columns={cols} /></div>
        </div>
        <h4 className="sub-title">Questions</h4>
        <BucketTable rows={titles.question} columns={cols} />
      </Panel>
      <Panel title="Upload day" sub="How videos perform by the day they were published (India time).">
        <BucketTable rows={days.filter((d) => d.count > 0)} columns={cols} />
      </Panel>
    </>
  );
}

function YoutubeStrategy({ token, accountId, since, until }: { token: string; accountId: string; since: string; until: string }) {
  const state = useLive(() => fetchYoutubeVideos(token, { accountId, since, until }), `strategy-vids:${accountId}:${since}:${until}`, true, { maxAge: ANALYTICS_MAX_AGE });
  return <LiveBlock state={state}>{(videos) => <YoutubeStrategyBody videos={videos} />}</LiveBlock>;
}

export function StrategyTab({ platform, media, token, accountId, since, until }: { platform: Platform; media: StoredMedia[]; token: string; accountId: string; since: string; until: string }) {
  return platform === 'instagram' ? <InstagramStrategy media={media} /> : <YoutubeStrategy token={token} accountId={accountId} since={since} until={until} />;
}

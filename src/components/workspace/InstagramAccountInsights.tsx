import { fetchInstagramAccountInsights, type InstagramAccountInsights as Insights } from '../../services/api';
import { RankedBars } from '../charts/RankedBars';
import { formatCompact, METRIC_HELP } from '../charts/viz';
import { ErrorLine, LiveBlock, Panel, StatTiles } from './ui';
import { useLive, ANALYTICS_MAX_AGE } from './useLive';

const FORMAT_LABELS: Record<string, string> = { REEL: 'Reels', REELS: 'Reels', POST: 'Posts', FEED: 'Posts', STORY: 'Stories', AD: 'Ads', CAROUSEL_CONTAINER: 'Carousels', CAROUSEL_ALBUM: 'Carousels' };
const FOLLOW_LABELS: Record<string, string> = { FOLLOWER: 'Followers', NON_FOLLOWER: 'Non-followers', UNKNOWN: 'Unknown' };
const CONTACT_LABELS: Record<string, string> = { BOOK_NOW: 'Book now', CALL: 'Call', DIRECTION: 'Directions', EMAIL: 'Email', INSTANT_EXPERIENCE: 'Instant experience', OTHER: 'Other', TEXT: 'Text' };

const pretty = (map: Record<string, string>) => (label: string) => map[label] ?? label.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');

function Breakdown({ data, k, title, sub, labeler, suffix }: { data: Insights; k: string; title: string; sub: string; labeler: (l: string) => string; suffix: string }) {
  const b = data.breakdowns[k];
  return (
    <Panel title={title} sub={sub}>
      {!b ? null : b.error ? <ErrorLine error={b.error} label="Instagram" /> : b.rows.length === 0 ? (
        <p className="trends-empty-inline">No data for this range.</p>
      ) : (
        <RankedBars rows={b.rows.map((r) => ({ label: labeler(r.label), value: r.value }))} valueSuffix={suffix} />
      )}
    </Panel>
  );
}

export function InstagramAccountInsights({ token, accountId, since, until }: { token: string; accountId: string; since: string; until: string }) {
  const state = useLive(() => fetchInstagramAccountInsights(token, { accountId, since, until }), `acct:${accountId}:${since}:${until}`, true, { maxAge: ANALYTICS_MAX_AGE });
  const fmt = pretty(FORMAT_LABELS);
  const follow = pretty(FOLLOW_LABELS);
  const contact = pretty(CONTACT_LABELS);

  return (
    <LiveBlock state={state}>
      {(d) => {
        const followerRows = d.breakdowns.reach_by_follower_type?.rows;
        const nonFollowerShare = (() => {
          const rows = followerRows ?? [];
          const total = rows.reduce((a, r) => a + r.value, 0);
          const non = rows.filter((r) => /non/i.test(r.label)).reduce((a, r) => a + r.value, 0);
          return total > 0 ? Math.round((non / total) * 100) : null;
        })();
        const totals = [
          ['Reach', 'reach'], ['Views', 'views'], ['Accounts engaged', 'accounts_engaged'], ['Interactions', 'total_interactions'],
          ['Likes', 'likes'], ['Comments', 'comments'], ['Saves', 'saves'], ['Shares', 'shares'], ['Story replies', 'replies'], ['Reposts', 'reposts'], ['Profile views', 'profile_views'],
        ] as const;
        return (
          <>
            <Panel title={`Account totals, ${d.range.since} to ${d.range.until}`} sub="Straight from Instagram for the selected dates.">
              <StatTiles items={totals.filter(([, k]) => d.totals[k] !== undefined).map(([label, k]) => ({ label, value: formatCompact(d.totals[k]), hint: METRIC_HELP[k] }))} />
              {Object.entries(d.total_errors).map(([metric, e]) => <ErrorLine key={metric} error={e} label={`Instagram (${metric})`} />)}
              {nonFollowerShare !== null && (
                <p className="ws-note"><b>{nonFollowerShare}%</b> of the accounts you reached don’t follow you yet. A high number means your content is being discovered; a low one means you mostly reach your existing audience.</p>
              )}
            </Panel>
            <div className="viz-two-col">
              <Breakdown data={d} k="reach_by_follower_type" title="Reach: followers vs non-followers" sub="Who sees your content." labeler={follow} suffix=" accounts" />
              <Breakdown data={d} k="views_by_follower_type" title="Views: followers vs non-followers" sub="Who plays your content." labeler={follow} suffix=" views" />
            </div>
            <div className="viz-two-col">
              <Breakdown data={d} k="views_by_format" title="Views by format" sub="Where your views come from." labeler={fmt} suffix=" views" />
              <Breakdown data={d} k="reach_by_format" title="Reach by format" sub="Which format finds new people." labeler={fmt} suffix=" accounts" />
            </div>
            <div className="viz-two-col">
              <Breakdown data={d} k="interactions_by_format" title="Interactions by format" sub="Likes, comments, saves and shares combined." labeler={fmt} suffix="" />
              <Breakdown data={d} k="follows_and_unfollows" title="Follows and unfollows" sub="Growth versus churn in this period." labeler={follow} suffix="" />
            </div>
            <div className="viz-two-col">
              <Breakdown data={d} k="saves_by_format" title="Saves by format" sub="Which format people bookmark." labeler={fmt} suffix=" saves" />
              <Breakdown data={d} k="shares_by_format" title="Shares by format" sub="Which format people pass on." labeler={fmt} suffix=" shares" />
            </div>
            <div className="viz-two-col">
              <Breakdown data={d} k="likes_by_format" title="Likes by format" sub="" labeler={fmt} suffix=" likes" />
              <Breakdown data={d} k="comments_by_format" title="Comments by format" sub="" labeler={fmt} suffix=" comments" />
            </div>
            <Breakdown data={d} k="profile_link_taps" title="Profile link taps" sub="Which contact button people used." labeler={contact} suffix=" taps" />
          </>
        );
      }}
    </LiveBlock>
  );
}

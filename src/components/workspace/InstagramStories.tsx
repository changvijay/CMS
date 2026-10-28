import { fetchInstagramStories, type InstagramStory } from '../../services/api';
import { formatCompact, formatPercent } from '../charts/viz';
import { LiveBlock, Panel } from './ui';
import { useLive, ANALYTICS_MAX_AGE } from './useLive';

function navShare(story: InstagramStory, needle: string): number | null {
  const rows = story.breakdowns?.navigation;
  const views = story.views ?? 0;
  if (!rows || views <= 0) return null;
  return (rows.filter((r) => r.label.toLowerCase().includes(needle)).reduce((a, r) => a + r.value, 0) / views) * 100;
}

/** Stories are only readable for 24 hours, so this is fetched live. */
export function InstagramStories({ token, accountId }: { token: string; accountId: string }) {
  const state = useLive(() => fetchInstagramStories(token, accountId), `stories:${accountId}`, true, { maxAge: ANALYTICS_MAX_AGE });
  return (
    <Panel title="Stories live right now" sub="Instagram only shares story numbers for 24 hours. Each time you press Update data, the current stories are saved so you keep their history.">
      <LiveBlock state={state}>
        {(stories) =>
          stories.length === 0 ? (
            <p className="trends-empty-inline">You have no active stories.</p>
          ) : (
            <div className="viz-table-wrap">
              <table className="viz-table">
                <thead>
                  <tr><th>Story</th><th>Views</th><th>Reach</th><th>Replies</th><th>Shares</th><th>Follows</th><th>Profile visits</th><th>Link clicks</th><th>Forward taps</th><th>Exits</th></tr>
                </thead>
                <tbody>
                  {stories.map((s) => (
                    <tr key={s.media_id}>
                      <td className="viz-table-title"><a href={s.permalink} target="_blank" rel="noreferrer">{s.caption ? s.caption.slice(0, 40) : `${s.media_type} · ${new Date(s.published_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</a></td>
                      <td>{formatCompact(s.views)}</td>
                      <td>{formatCompact(s.reach)}</td>
                      <td>{formatCompact(s.replies)}</td>
                      <td>{formatCompact(s.shares)}</td>
                      <td>{formatCompact(s.follows)}</td>
                      <td>{formatCompact(s.profile_visits)}</td>
                      <td>{formatCompact(s.link_clicks)}</td>
                      <td>{formatPercent(navShare(s, 'tap_forward'))}</td>
                      <td>{formatPercent(navShare(s, 'exit'))}</td>
                    </tr>
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

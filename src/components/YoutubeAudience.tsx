import { useMemo } from 'react';
import { fetchYoutubeGroups, type YoutubeBreakdowns } from '../services/api';
import { RankedBars } from './charts/RankedBars';
import { Demographics } from './charts/Demographics';
import { formatCompact, formatPercent, formatSeconds, METRIC_HELP } from './charts/viz';
import { LiveBlock, Panel, ReportBody, StatTiles } from './workspace/ui';
import { useLive } from './workspace/useLive';

const TRAFFIC_LABELS: Record<string, string> = {
  YT_SEARCH: 'YouTube search', SUGGESTED_VIDEO: 'Suggested videos', BROWSE: 'Browse features', EXT_URL: 'External sites',
  NO_LINK_OTHER: 'Direct / unknown', NOTIFICATION: 'Notifications', PLAYLIST: 'Playlists', YT_CHANNEL: 'Channel pages',
  SHORTS: 'Shorts feed', END_SCREEN: 'End screens', YT_OTHER_PAGE: 'Other YouTube pages', RELATED_VIDEO: 'Related videos',
  SUBSCRIBER: 'Subscriptions feed', HASHTAGS: 'Hashtags', CAMPAIGN_CARD: 'Cards', ADVERTISING: 'Advertising', NO_LINK_EMBEDDED: 'Embedded players',
  PROMOTED: 'Promoted', VIDEO_REMIXES: 'Remixes', LIVE_REDIRECT: 'Live redirects', SOUND_PAGE: 'Sound pages', YT_PLAYLIST_PAGE: 'Playlist pages',
};
const CONTENT_LABELS: Record<string, string> = { SHORTS: 'Shorts', VIDEO_ON_DEMAND: 'Regular videos', LIVE_STREAM: 'Live streams', STORY: 'Stories' };
const SUBSCRIBED_LABELS: Record<string, string> = { SUBSCRIBED: 'Subscribers', UNSUBSCRIBED: 'Non-subscribers' };
const PLAYBACK_LABELS: Record<string, string> = { WATCH: 'YouTube watch page', EMBEDDED: 'Embedded on other sites', CHANNEL: 'Channel page', EXTERNAL_APP: 'External apps', MOBILE: 'Mobile', YT_OTHER: 'Other YouTube pages', SEARCH: 'Search results', BROWSE: 'Browse' };

const titleCase = (s: string) => s.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const label = (map: Record<string, string>) => (s: string) => map[s] ?? titleCase(s);

const TOTAL_TILES: [string, string, 'n' | 'sec' | 'pct'][] = [
  ['views', 'Views', 'n'], ['engagedViews', 'Engaged views', 'n'], ['redViews', 'Premium views', 'n'], ['estimatedMinutesWatched', 'Minutes watched', 'n'],
  ['averageViewDuration', 'Avg view duration', 'sec'], ['averageViewPercentage', 'Avg % viewed', 'pct'], ['likes', 'Likes', 'n'], ['dislikes', 'Dislikes', 'n'],
  ['comments', 'Comments', 'n'], ['shares', 'Shares', 'n'], ['videosAddedToPlaylists', 'Added to playlists', 'n'], ['videosRemovedFromPlaylists', 'Removed from playlists', 'n'],
  ['subscribersGained', 'Subscribers gained', 'n'], ['subscribersLost', 'Subscribers lost', 'n'],
];

function fmt(kind: 'n' | 'sec' | 'pct', v: number) {
  return kind === 'sec' ? formatSeconds(v) : kind === 'pct' ? formatPercent(v) : formatCompact(v);
}

type Row = Record<string, number | string>;

function MetricTable({ rows, nameKey, names, columns }: { rows: Row[]; nameKey: string; names: (s: string) => string; columns: [string, string, 'n' | 'sec' | 'pct'][] }) {
  return (
    <div className="viz-table-wrap">
      <table className="viz-table">
        <thead><tr><th>Name</th>{columns.map(([, h]) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r[nameKey])}>
              <td>{names(String(r[nameKey]))}</td>
              {columns.map(([k, h, kind]) => <td key={h}>{typeof r[k] === 'number' ? fmt(kind, r[k] as number) : '–'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DETAIL_COLUMNS: [string, string, 'n' | 'sec' | 'pct'][] = [['views', 'Views', 'n'], ['engagedViews', 'Engaged views', 'n'], ['estimatedMinutesWatched', 'Minutes', 'n']];
const PLAYER_COLUMNS: [string, string, 'n' | 'sec' | 'pct'][] = [['views', 'Views', 'n'], ['engagedViews', 'Engaged views', 'n'], ['estimatedMinutesWatched', 'Minutes', 'n'], ['averageViewDuration', 'Avg duration', 'sec'], ['averageViewPercentage', 'Avg % viewed', 'pct'], ['likes', 'Likes', 'n'], ['shares', 'Shares', 'n']];

function Body({ d }: { d: YoutubeBreakdowns }) {
  const countryNames = useMemo(() => {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; }
  }, []);
  const country = (c: string) => countryNames?.of(c) ?? c;
  const totals = d.channel_totals?.rows?.[0];
  const cards = d.cards?.rows?.[0];

  return (
    <>
      <h3 className="ws-section-title">Channel totals</h3>
      <Panel title="Everything in this period" sub="All headline numbers YouTube reports for the selected dates.">
        <ReportBody report={d.channel_totals} label="YouTube" empty="No totals for this range.">
          {() => totals ? <StatTiles items={TOTAL_TILES.filter(([k]) => typeof totals[k] === 'number').map(([k, name, kind]) => ({ label: name, value: fmt(kind, totals[k] as number), hint: METRIC_HELP[k] }))} /> : null}
        </ReportBody>
      </Panel>
      <Panel title="Cards" sub="The clickable prompts you add to videos.">
        <ReportBody report={d.cards} label="YouTube" empty="No card data for this range.">
          {() => cards ? <StatTiles items={[
            ['Card impressions', cards.cardImpressions], ['Card clicks', cards.cardClicks], ['Card click rate', cards.cardClickRate],
            ['Teaser impressions', cards.cardTeaserImpressions], ['Teaser clicks', cards.cardTeaserClicks], ['Teaser click rate', cards.cardTeaserClickRate],
          ].filter(([, v]) => typeof v === 'number').map(([l, v]) => ({ label: String(l), value: String(l).includes('rate') ? formatPercent((v as number) * 100) : formatCompact(v as number) }))} /> : null}
        </ReportBody>
      </Panel>

      <div className="viz-two-col">
        <Panel title="Shorts vs regular videos" sub="How each format performs.">
          <ReportBody report={d.content_types} label="YouTube">
            {(rows) => <MetricTable rows={rows as Row[]} nameKey="creatorContentType" names={label(CONTENT_LABELS)} columns={PLAYER_COLUMNS} />}
          </ReportBody>
        </Panel>
        <Panel title="Subscribers vs non-subscribers" sub="Loyal audience versus new discovery.">
          <ReportBody report={d.subscribed_status} label="YouTube">
            {(rows) => <MetricTable rows={rows as Row[]} nameKey="subscribedStatus" names={label(SUBSCRIBED_LABELS)} columns={PLAYER_COLUMNS} />}
          </ReportBody>
        </Panel>
      </div>

      <h3 className="ws-section-title">Who watches</h3>
      <div className="viz-two-col">
        <Panel title="Top countries" sub="Where your viewers are, and how well they watch.">
          <ReportBody report={d.countries} label="YouTube">
            {(rows) => <MetricTable rows={rows as Row[]} nameKey="country" names={country} columns={[['views', 'Views', 'n'], ['estimatedMinutesWatched', 'Minutes', 'n'], ['averageViewDuration', 'Avg duration', 'sec'], ['averageViewPercentage', 'Avg % viewed', 'pct']]} />}
          </ReportBody>
        </Panel>
        <Panel title="Top cities" sub="The 25 cities with the most views.">
          <ReportBody report={d.cities} label="YouTube" empty="No city data. YouTube needs enough views to report cities.">
            {(rows) => <RankedBars rows={rows.map((r) => ({ label: r.city, value: r.views }))} valueSuffix=" views" />}
          </ReportBody>
        </Panel>
      </div>
      <div className="viz-two-col">
        <Panel title="Devices">
          <ReportBody report={d.devices} label="YouTube">
            {(rows) => <RankedBars rows={rows.map((r) => ({ label: titleCase(r.deviceType), value: r.views }))} valueSuffix=" views" />}
          </ReportBody>
        </Panel>
        <Panel title="Operating systems">
          <ReportBody report={d.operating_systems} label="YouTube">
            {(rows) => <RankedBars rows={rows.map((r) => ({ label: titleCase(r.operatingSystem), value: r.views }))} valueSuffix=" views" />}
          </ReportBody>
        </Panel>
      </div>
      <Panel title="Viewer age and gender">
        <ReportBody report={d.demographics} label="YouTube" empty="No demographic data for this range.">
          {(rows) => <Demographics rows={rows} />}
        </ReportBody>
      </Panel>

      <h3 className="ws-section-title">How people find you</h3>
      <div className="viz-two-col">
        <Panel title="Traffic sources" sub="Where views come from.">
          <ReportBody report={d.traffic_sources} label="YouTube">
            {(rows) => <RankedBars rows={rows.map((r) => ({ label: label(TRAFFIC_LABELS)(r.insightTrafficSourceType), value: r.views }))} valueSuffix=" views" />}
          </ReportBody>
        </Panel>
        <Panel title="Search terms" sub="What people typed into YouTube search before finding you. Use these in titles.">
          <ReportBody report={d.search_terms} label="YouTube" empty="No search-term data. Terms appear once enough people find you through search.">
            {(rows) => <MetricTable rows={rows as Row[]} nameKey="insightTrafficSourceDetail" names={(s) => s} columns={DETAIL_COLUMNS} />}
          </ReportBody>
        </Panel>
      </div>
      <div className="viz-two-col">
        <Panel title="External websites" sub="Sites that send you viewers.">
          <ReportBody report={d.external_sites} label="YouTube" empty="No external referrals in this range.">
            {(rows) => <RankedBars rows={rows.map((r) => ({ label: r.insightTrafficSourceDetail, value: r.views }))} valueSuffix=" views" />}
          </ReportBody>
        </Panel>
        <Panel title="Related videos" sub="Videos whose “up next” suggestions bring viewers to you.">
          <ReportBody report={d.related_videos} label="YouTube" empty="No related-video traffic in this range.">
            {(rows) => <RankedBars rows={rows.map((r) => ({ label: r.title ?? r.insightTrafficSourceDetail, value: r.views }))} valueSuffix=" views" />}
          </ReportBody>
        </Panel>
      </div>
      <div className="viz-two-col">
        <Panel title="Where videos are played" sub="Watch page, channel page, embeds and apps.">
          <ReportBody report={d.playback_locations} label="YouTube">
            {(rows) => <RankedBars rows={rows.map((r) => ({ label: label(PLAYBACK_LABELS)(r.insightPlaybackLocationType), value: r.views }))} valueSuffix=" views" />}
          </ReportBody>
        </Panel>
        <Panel title="Sites embedding your videos">
          <ReportBody report={d.embedded_sites} label="YouTube" empty="Your videos weren't embedded on other sites in this range.">
            {(rows) => <RankedBars rows={rows.map((r) => ({ label: r.insightPlaybackLocationDetail, value: r.views }))} valueSuffix=" views" />}
          </ReportBody>
        </Panel>
      </div>
      <Panel title="Where people share your videos" sub="Which apps viewers use when they press Share.">
        <ReportBody report={d.sharing_services} label="YouTube" empty="No sharing data for this range.">
          {(rows) => <RankedBars rows={rows.map((r) => ({ label: titleCase(r.sharingService), value: r.shares }))} valueSuffix=" shares" />}
        </ReportBody>
      </Panel>
    </>
  );
}

export function YoutubeAudience({ token, accountId, since, until }: { token: string; accountId: string; since: string; until: string }) {
  const state = useLive(() => fetchYoutubeGroups(token, { accountId, since, until, groups: ['overview', 'audience', 'acquisition'] }), `yt:${accountId}:${since}:${until}`);
  return <LiveBlock state={state}>{(d) => <Body d={d} />}</LiveBlock>;
}

import { Link } from 'react-router-dom';
import type { AccountCard, MetricDelta, OverviewPlatform } from '../../services/api';
import { Sparkline } from '../charts/KpiCard';
import { formatCompact, formatPercent } from '../charts/viz';

interface Kpi {
  key: string;
  label: string;
  format: 'n' | 'pct';
}

const KPIS: Record<OverviewPlatform, Kpi[]> = {
  instagram: [
    { key: 'reach', label: 'Reach', format: 'n' },
    { key: 'views', label: 'Views', format: 'n' },
    { key: 'interactions', label: 'Interactions', format: 'n' },
    { key: 'net_followers', label: 'Net followers', format: 'n' },
    { key: 'link_taps', label: 'Link taps', format: 'n' },
    { key: 'engagement_rate', label: 'Engagement rate', format: 'pct' },
  ],
  youtube: [
    { key: 'views', label: 'Views', format: 'n' },
    { key: 'watch_hours', label: 'Watch hours', format: 'n' },
    { key: 'net_subscribers', label: 'Net subscribers', format: 'n' },
    { key: 'interactions', label: 'Interactions', format: 'n' },
    { key: 'avg_view_percentage', label: 'Avg % viewed', format: 'pct' },
    { key: 'engagement_rate', label: 'Engagement rate', format: 'pct' },
  ],
  linkedin: [
    { key: 'impressions', label: 'Impressions', format: 'n' },
    { key: 'clicks', label: 'Clicks', format: 'n' },
    { key: 'reactions', label: 'Reactions', format: 'n' },
    { key: 'net_followers', label: 'New followers', format: 'n' },
    { key: 'page_views', label: 'Page views', format: 'n' },
    { key: 'engagement_rate', label: 'Engagement rate', format: 'pct' },
  ],
  facebook: [
    { key: 'views', label: 'Views', format: 'n' },
    { key: 'reach', label: 'Reach', format: 'n' },
    { key: 'engagements', label: 'Engagements', format: 'n' },
    { key: 'net_followers', label: 'Net followers', format: 'n' },
    { key: 'page_visits', label: 'Page visits', format: 'n' },
    { key: 'engagement_rate', label: 'Engagement rate', format: 'pct' },
  ],
};

const PLATFORM_NAME: Record<OverviewPlatform, string> = { instagram: 'Instagram', youtube: 'YouTube', linkedin: 'LinkedIn', facebook: 'Facebook' };
const PLATFORM_COLOR: Record<OverviewPlatform, string> = { instagram: 'var(--series-1)', youtube: 'var(--series-2)', linkedin: 'var(--series-3)', facebook: 'var(--series-4)' };

function Delta({ delta }: { delta?: MetricDelta }) {
  const pct = delta?.change_pct;
  if (pct === null || pct === undefined) return <span className="delta-neutral">no prior data</span>;
  if (pct === 0) return <span className="delta-neutral">■ 0%</span>;
  return <span className={pct > 0 ? 'delta-good' : 'delta-bad'}>{pct > 0 ? '▲' : '▼'} {Math.abs(pct)}%</span>;
}

export function AccountCards({ cards, days }: { cards: AccountCard[]; days: number }) {
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="account-cards-title">
      <h3 id="account-cards-title" className="ws-section-title">Each account at a glance</h3>
      <p className="ws-sub">The main numbers for every connected account on its own, for the last {days} days, with the change from the {days} days before.</p>
      <ul className="account-cards">
        {cards.map((c) => (
          <li key={`${c.platform}-${c.id}`} className={`account-card platform-${c.platform}`}>
            <div className="account-card-head">
              <div>
                <span className="platform-chip" style={{ borderColor: PLATFORM_COLOR[c.platform] }}>{PLATFORM_NAME[c.platform]}</span>
                <h4>{c.name}</h4>
              </div>
              <Link className="content-link" to={`/${c.platform}?account=${c.id}`}>Open ↗</Link>
            </div>
            {c.days_with_data === 0 ? (
              <p className="trends-empty-inline">No data stored for this account in this period yet. Open it and press Update data.</p>
            ) : (
              <>
                <dl className="account-kpis">
                  {KPIS[c.platform].map((k) => (
                    <div key={k.key}>
                      <dt>{k.label}</dt>
                      <dd>{k.format === 'pct' ? formatPercent(c.totals[k.key]) : formatCompact(c.totals[k.key])}</dd>
                      <span className="account-kpi-delta"><Delta delta={c.deltas[k.key]} /></span>
                    </div>
                  ))}
                </dl>
                <div className="account-card-foot">
                  <span>{c.platform === 'linkedin' ? 'Daily impressions' : 'Daily views'}</span>
                  <Sparkline values={c.series} color={PLATFORM_COLOR[c.platform]} />
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

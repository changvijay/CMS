import type { CSSProperties, ReactNode } from 'react';
import './Skeleton.css';

/** One grey placeholder shape. Width/height take any CSS size. */
export function Sk({ w = '100%', h = 12, circle, style }: { w?: number | string; h?: number | string; circle?: boolean; style?: CSSProperties }) {
  return <span className={circle ? 'sk sk-circle' : 'sk'} style={{ width: w, height: h, ...style }} aria-hidden="true" />;
}

/** Wraps placeholders so screen readers hear "Loading…" once instead of a pile of empty shapes. */
function Busy({ label = 'Loading…', className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div className={className} role="status" aria-busy="true">
      <span className="sk-sr">{label}</span>
      {children}
    </div>
  );
}

// Fixed heights (not random) so the placeholder doesn't jump on every render.
const BAR_HEIGHTS = [38, 52, 45, 63, 58, 72, 50, 66, 80, 61, 74, 69, 88, 70, 77, 64, 83, 92, 75, 86];
const LINE_WIDTHS = ['92%', '78%', '85%', '64%', '88%', '71%', '80%', '58%'];

export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div className="sk-chart" style={{ height }}>
      {BAR_HEIGHTS.map((h, i) => <Sk key={i} h={`${h}%`} />)}
    </div>
  );
}

export function TableSkeleton({ rows = 6, thumb = false }: { rows?: number; thumb?: boolean }) {
  return (
    <div className="sk-table">
      {Array.from({ length: rows }, (_, i) => (
        <div className="sk-row" key={i}>
          {thumb && <Sk w={40} h={40} style={{ flexShrink: 0, borderRadius: 6 }} />}
          <Sk w={LINE_WIDTHS[i % LINE_WIDTHS.length]} h={12} style={{ maxWidth: 360 }} />
          <span style={{ flex: 1 }} />
          <Sk w={48} /><Sk w={48} /><Sk w={48} />
        </div>
      ))}
    </div>
  );
}

/** Horizontal ranked bars (countries, reaction types, …). */
export function BarsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="sk-bars">
      {Array.from({ length: rows }, (_, i) => (
        <div className="sk-row" key={i}>
          <Sk h={10} />
          <Sk w={`${90 - i * 14}%`} h={14} />
        </div>
      ))}
    </div>
  );
}

export function TextSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="sk-stack sk-inline">
      {Array.from({ length: lines }, (_, i) => <Sk key={i} w={LINE_WIDTHS[i % LINE_WIDTHS.length]} />)}
    </div>
  );
}

function KpiSkeletons({ count = 4 }: { count?: number }) {
  return (
    <div className="sk-kpis">
      {Array.from({ length: count }, (_, i) => (
        <div className="sk-card sk-kpi" key={i}>
          <Sk w="45%" h={10} />
          <div className="sk-row" style={{ justifyContent: 'space-between' }}>
            <Sk w="40%" h={26} />
            <Sk w={80} h={22} />
          </div>
          <Sk w="30%" h={10} />
        </div>
      ))}
    </div>
  );
}

function PanelSkeleton({ children }: { children: ReactNode }) {
  return (
    <div className="sk-card sk-section">
      <div className="sk-stack" style={{ marginBottom: 14 }}>
        <Sk w={180} h={14} />
        <Sk w={300} h={10} style={{ maxWidth: '70%' }} />
      </div>
      {children}
    </div>
  );
}

/** Placeholder for one part of a page, shaped like what it will become. */
export function SectionSkeleton({ variant = 'chart', rows, label }: { variant?: 'chart' | 'table' | 'bars' | 'text' | 'list'; rows?: number; label?: string }) {
  return (
    <Busy label={label}>
      {variant === 'chart' && <ChartSkeleton />}
      {variant === 'table' && <TableSkeleton rows={rows} thumb />}
      {variant === 'bars' && <BarsSkeleton rows={rows} />}
      {variant === 'text' && <TextSkeleton lines={rows} />}
      {variant === 'list' && (
        <div className="sk-stack" style={{ gap: 12, paddingTop: 8 }}>
          {Array.from({ length: rows ?? 3 }, (_, i) => (
            <div className="sk-card sk-row" key={i} style={{ padding: '14px 16px' }}>
              <Sk w={40} h={40} circle style={{ flexShrink: 0 }} />
              <div className="sk-stack" style={{ flex: 1, gap: 8 }}>
                <Sk w="35%" h={12} />
                <Sk w="55%" h={10} />
              </div>
              <Sk w={84} h={30} style={{ borderRadius: 8 }} />
            </div>
          ))}
        </div>
      )}
    </Busy>
  );
}

/** Number cards, a big chart and two panels: the body of an analytics page. */
export function DashboardSkeleton({ kpis = 4, label }: { kpis?: number; label?: string }) {
  return (
    <Busy label={label}>
      <KpiSkeletons count={kpis} />
      <PanelSkeleton><ChartSkeleton /></PanelSkeleton>
      <div className="sk-two">
        <PanelSkeleton><BarsSkeleton rows={4} /></PanelSkeleton>
        <PanelSkeleton><TableSkeleton rows={4} /></PanelSkeleton>
      </div>
    </Busy>
  );
}

/** A whole page while its code or session loads: profile header, filters, then the dashboard body. */
export function PageSkeleton({ label = 'Loading your dashboard…' }: { label?: string }) {
  return (
    <Busy label={label} className="sk-page">
      <div className="sk-card sk-profile">
        <Sk w={72} h={72} circle style={{ flexShrink: 0 }} />
        <div className="sk-profile-main">
          <Sk w={220} h={18} style={{ maxWidth: '80%' }} />
          <Sk w={140} h={10} />
          <Sk w="70%" h={10} />
        </div>
        <div className="sk-profile-stats">
          {[0, 1, 2].map((i) => (
            <div className="sk-stack" key={i} style={{ alignItems: 'center', gap: 8 }}>
              <Sk w={48} h={20} />
              <Sk w={60} h={10} />
            </div>
          ))}
        </div>
      </div>
      <div className="sk-toolbar">
        <Sk w={260} h={36} style={{ borderRadius: 10, maxWidth: '100%' }} />
        <span style={{ flex: 1 }} />
        <Sk w={120} h={36} style={{ borderRadius: 10 }} />
      </div>
      <KpiSkeletons />
      <PanelSkeleton><ChartSkeleton /></PanelSkeleton>
      <div className="sk-two">
        <PanelSkeleton><BarsSkeleton rows={4} /></PanelSkeleton>
        <PanelSkeleton><TableSkeleton rows={4} /></PanelSkeleton>
      </div>
    </Busy>
  );
}

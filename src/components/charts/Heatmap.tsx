import { useState } from 'react';
import { WEEKDAYS, formatCompact } from './viz';

interface HeatmapProps {
  matrix: (number | null)[][];
  unit: string;
}

function hourLabel(h: number): string {
  const suffix = h < 12 ? 'a' : 'p';
  return `${h % 12 === 0 ? 12 : h % 12}${suffix}`;
}

/** Weekday x hour grid. Sequential single-hue ramp: darker/dimmer = lower, brighter = higher. */
export function Heatmap({ matrix, unit }: HeatmapProps) {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const values = matrix.flat().filter((v): v is number => v !== null);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);

  const pct = (v: number) => 12 + ((v - min) / (max - min || 1)) * 88;
  const hovered = hover ? matrix[hover.d][hover.h] : null;

  return (
    <div className="heatmap" role="img" aria-label={`Heatmap of ${unit} by weekday and hour`}>
      <div className="heatmap-scroll">
        <div className="heatmap-grid">
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="heatmap-hour">{h % 3 === 0 ? hourLabel(h) : ''}</span>
          ))}
          {matrix.map((row, d) => (
            <div className="heatmap-row" key={d}>
              <span className="heatmap-day">{WEEKDAYS[d].slice(0, 3)}</span>
              {row.map((v, h) => (
                <span
                  key={h}
                  className={`heatmap-cell ${v === null ? 'empty' : ''} ${hover?.d === d && hover?.h === h ? 'hover' : ''}`}
                  style={v === null ? undefined : { background: `color-mix(in srgb, var(--series-1) ${pct(v).toFixed(0)}%, var(--surface))` }}
                  title={`${WEEKDAYS[d]} ${hourLabel(h)}: ${v === null ? 'no data' : v.toLocaleString()}`}
                  onMouseEnter={() => setHover({ d, h })}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="heatmap-foot">
        <span className="heatmap-readout">
          {hover ? `${WEEKDAYS[hover.d]} ${hourLabel(hover.h)} · ${hovered === null ? 'no data' : `${hovered.toLocaleString()} ${unit}`}` : 'Hover a cell for details'}
        </span>
        <span className="heatmap-legend" aria-hidden="true">
          <span>{formatCompact(min)}</span>
          <span className="heatmap-ramp" />
          <span>{formatCompact(max)}</span>
        </span>
      </div>
    </div>
  );
}

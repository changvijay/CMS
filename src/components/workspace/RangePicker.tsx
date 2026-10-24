import { shiftDate, istToday } from '../../utils/dates';
import { PRESETS, presetRange, type RangeValue } from './range';

export function RangePicker({ value, onChange }: { value: RangeValue; onChange: (next: RangeValue) => void }) {
  const yesterday = shiftDate(istToday(), -1);
  const invalid = value.preset === 'custom' && value.since > value.until;

  return (
    <div className="ws-field">
      <span className="ws-field-label">Date range</span>
      <div className="ws-range">
        <div className="seg" role="group" aria-label="Date range presets">
          {PRESETS.map((d) => (
            <button key={d} className={value.preset === d ? 'active' : ''} aria-pressed={value.preset === d} onClick={() => onChange(presetRange(d))}>
              {d} days
            </button>
          ))}
          <button
            className={value.preset === 'custom' ? 'active' : ''}
            aria-pressed={value.preset === 'custom'}
            onClick={() => onChange({ ...value, preset: 'custom' })}
          >
            Custom
          </button>
        </div>
        {value.preset === 'custom' && (
          <div className="ws-range-custom">
            <input type="date" aria-label="From date" value={value.since} max={yesterday} onChange={(e) => e.target.value && onChange({ ...value, since: e.target.value })} />
            <span>to</span>
            <input type="date" aria-label="To date" value={value.until} max={yesterday} onChange={(e) => e.target.value && onChange({ ...value, until: e.target.value })} />
            {invalid && <span className="ws-range-error" role="alert">Start date must be before the end date.</span>}
          </div>
        )}
      </div>
    </div>
  );
}

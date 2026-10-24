import { describe, it, expect } from 'vitest';
import { isoDurationToSeconds } from '../utils/duration.js';

describe('isoDurationToSeconds', () => {
  it('parses common YouTube durations', () => {
    expect(isoDurationToSeconds('PT45S')).toBe(45);
    expect(isoDurationToSeconds('PT3M20S')).toBe(200);
    expect(isoDurationToSeconds('PT1H2M3S')).toBe(3723);
    expect(isoDurationToSeconds('P1DT1M')).toBe(86460);
  });
  it('returns null for garbage', () => {
    expect(isoDurationToSeconds('abc')).toBeNull();
    expect(isoDurationToSeconds(undefined)).toBeNull();
  });
});

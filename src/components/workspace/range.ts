import { lastDaysRange } from '../../utils/dates';

export interface RangeValue {
  preset: 7 | 14 | 30 | 'custom';
  since: string;
  until: string;
}

// Presets cover the stored 30 days; anything longer is picked with Custom (fetched live).
export const PRESETS = [7, 14, 30] as const;

export function presetRange(days: (typeof PRESETS)[number]): RangeValue {
  return { preset: days, ...lastDaysRange(days) };
}

import { lastDaysRange } from '../../utils/dates';

export interface RangeValue {
  preset: 7 | 14 | 30 | 90 | 'custom';
  since: string;
  until: string;
}

export const PRESETS = [7, 14, 30, 90] as const;

export function presetRange(days: (typeof PRESETS)[number]): RangeValue {
  return { preset: days, ...lastDaysRange(days) };
}

const IST = 'Asia/Kolkata';

const istFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "YYYY-MM-DD" for the given instant in IST. */
export function istDateString(date = new Date()) {
  return istFormatter.format(date);
}

/** Add whole days to a "YYYY-MM-DD" string (calendar arithmetic, no TZ drift). */
export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of "YYYY-MM-DD" strings between two dates. */
export function dateRange(startStr, endStr) {
  const out = [];
  for (let d = startStr; d <= endStr; d = addDays(d, 1)) out.push(d);
  return out;
}

export function daysBetween(startStr, endStr) {
  return Math.round((new Date(`${endStr}T00:00:00Z`) - new Date(`${startStr}T00:00:00Z`)) / 86400000);
}

/** Unix seconds for [IST midnight of dateStr, IST midnight of next day). */
export function istDayWindowSeconds(dateStr) {
  const since = Math.floor(new Date(`${dateStr}T00:00:00+05:30`).getTime() / 1000);
  return { since, until: since + 86400 };
}

export function isDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** since/until query params as dates, defaulting to the 30 complete days ending yesterday (IST). */
export function resolveRange(query) {
  const until = isDateString(query.until) ? query.until : addDays(istDateString(), -1);
  const since = isDateString(query.since) ? query.since : addDays(until, -29);
  return { since, until };
}

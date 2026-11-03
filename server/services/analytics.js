export const METRICS = {
  instagram: ['reach', 'views', 'likes', 'comments', 'saves', 'shares', 'total_interactions', 'accounts_engaged', 'profile_links_taps', 'follower_change', 'replies', 'reposts'],
  youtube: ['views', 'likes', 'comments', 'shares', 'minutes_watched', 'subs_gained', 'subs_lost', 'engaged_views', 'avg_view_duration',
    'avg_view_percentage', 'playlist_adds', 'playlist_removes', 'dislikes', 'card_impressions', 'card_clicks', 'premium_views'],
  linkedin: ['impressions', 'unique_impressions', 'clicks', 'likes', 'comments', 'shares', 'page_views', 'unique_page_views',
    'desktop_page_views', 'mobile_page_views', 'organic_follower_gain', 'paid_follower_gain'],
};

/** Averages that must be weighted by views rather than summed across days. */
export const WEIGHTED_AVERAGES = { avg_view_duration: 'views', avg_view_percentage: 'views' };

export const PRIMARY_METRIC = { instagram: 'reach', youtube: 'views', linkedin: 'impressions' };

const n = (v) => (v === null || v === undefined ? 0 : Number(v));

export function sumMetrics(rows, metrics, weighted = WEIGHTED_AVERAGES) {
  const out = {};
  for (const m of metrics) {
    if (weighted[m]) {
      const w = weighted[m];
      const total = rows.reduce((acc, r) => acc + n(r[w]), 0);
      out[m] = total > 0 ? Math.round((rows.reduce((acc, r) => acc + n(r[m]) * n(r[w]), 0) / total) * 100) / 100 : 0;
    } else {
      out[m] = rows.reduce((acc, r) => acc + n(r[m]), 0);
    }
  }
  return out;
}

/** Percent change from previous to current; null when there is no baseline. */
export function pctChange(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export function computeDeltas(current, previous) {
  const out = {};
  for (const key of Object.keys(current)) {
    out[key] = { current: current[key], previous: previous[key] ?? 0, change_pct: pctChange(current[key], previous[key] ?? 0) };
  }
  return out;
}

export function movingAverage(values, window = 7) {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return Math.round((slice.reduce((a, b) => a + b, 0) / slice.length) * 100) / 100;
  });
}

/** Flags points more than `threshold` standard deviations from the mean. */
export function detectAnomalies(points, threshold = 2) {
  if (points.length < 5) return [];
  const vals = points.map((p) => p.value);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  if (sd === 0) return [];
  return points
    .map((p) => ({ ...p, z: (p.value - mean) / sd }))
    .filter((p) => Math.abs(p.z) > threshold)
    .map((p) => ({ date: p.date, value: p.value, z_score: Math.round(p.z * 100) / 100, type: p.z > 0 ? 'spike' : 'drop' }));
}

/** Least-squares line over the series; returns the next `horizon` predicted values (floored at 0). */
export function linearForecast(values, horizon = 7) {
  const len = values.length;
  if (len < 3) return { slope: 0, predictions: [] };
  const xMean = (len - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / len;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - xMean) * (y - yMean);
    den += (x - xMean) ** 2;
  });
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  const predictions = Array.from({ length: horizon }, (_, i) =>
    Math.max(0, Math.round(intercept + slope * (len + i)))
  );
  return { slope: Math.round(slope * 100) / 100, predictions };
}

/** Best weekday by average of the metric (0=Sunday). */
export function bestWeekday(points) {
  const buckets = Array.from({ length: 7 }, () => ({ sum: 0, count: 0 }));
  for (const p of points) {
    const d = new Date(`${p.date}T00:00:00Z`).getUTCDay();
    buckets[d].sum += p.value;
    buckets[d].count += 1;
  }
  const avgs = buckets.map((b, day) => ({ day, avg: b.count ? b.sum / b.count : 0 }));
  const best = avgs.reduce((a, b) => (b.avg > a.avg ? b : a));
  return best.avg > 0 ? best.day : null;
}

/**
 * Folds Instagram `online_followers` values ({ "0": n, ... "23": n } per day) into a weekday x hour matrix.
 * `end_time` marks the end of the day the counts describe, so the weekday is taken from end_time minus 12h
 * (correct for the usual midnight-aligned periods, a close approximation otherwise).
 */
export function buildBestTimeMatrix(insightsData) {
  const metric = (Array.isArray(insightsData) ? insightsData : []).find((m) => m.name === 'online_followers');
  const sums = Array.from({ length: 7 }, () => Array(24).fill(0));
  const counts = Array.from({ length: 7 }, () => Array(24).fill(0));
  let daysSampled = 0;

  for (const entry of metric?.values || []) {
    if (!entry?.value || typeof entry.value !== 'object' || !entry.end_time) continue;
    const day = new Date(new Date(entry.end_time).getTime() - 12 * 3600 * 1000).getUTCDay();
    let used = false;
    for (let h = 0; h < 24; h += 1) {
      const v = entry.value[String(h)];
      if (typeof v === 'number') {
        sums[day][h] += v;
        counts[day][h] += 1;
        used = true;
      }
    }
    if (used) daysSampled += 1;
  }

  const matrix = sums.map((row, d) => row.map((s, h) => (counts[d][h] ? Math.round(s / counts[d][h]) : null)));
  const hourly = Array.from({ length: 24 }, (_, h) => {
    const vals = matrix.map((row) => row[h]).filter((v) => v !== null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  });
  const slots = [];
  matrix.forEach((row, weekday) => row.forEach((value, hour) => value !== null && slots.push({ weekday, hour, value })));
  slots.sort((a, b) => b.value - a.value);

  return { matrix, hourly_avg: hourly, top_slots: slots.slice(0, 3), days_sampled: daysSampled };
}

/** Engagement used to rank content across platforms: reactions / audience size, as a percentage. */
export function engagementRate(item) {
  const n2 = (v) => (v === null || v === undefined ? 0 : Number(v));
  const engagement = n2(item.likes) + n2(item.comments) + n2(item.saves) + n2(item.shares);
  const audience = n2(item.views) || n2(item.reach);
  return audience > 0 ? Math.round((engagement / audience) * 1000) / 10 : null;
}

const GENDER_LABELS = { F: 'Women', M: 'Men', U: 'Not specified' };

/**
 * Parses an Instagram `follower_demographics` response for one breakdown
 * into [{ label, value }] sorted by value (largest first).
 */
export function parseDemographicBreakdown(json, breakdown) {
  const results = json?.data?.[0]?.total_value?.breakdowns?.[0]?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((r) => {
      const raw = String(r.dimension_values?.[0] ?? '');
      return { label: breakdown === 'gender' ? GENDER_LABELS[raw] || raw : raw, value: Number(r.value) || 0 };
    })
    .filter((r) => r.label)
    .sort((a, b) => b.value - a.value);
}

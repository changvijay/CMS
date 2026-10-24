/** ISO-8601 duration ("PT1H2M3S", "P1DT2M") to whole seconds; null when unparseable. */
export function isoDurationToSeconds(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso || '');
  if (!m) return null;
  const [, d = 0, h = 0, min = 0, s = 0] = m;
  return Math.round(Number(d) * 86400 + Number(h) * 3600 + Number(min) * 60 + Number(s));
}

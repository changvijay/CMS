const STOPWORDS = new Set(('a an and are as at be but by for from has have i in is it its me my of on or our so that the their them there they this to was we were what when which who will with you your ' +
  'im ive dont cant just very much more also than then too can get got all not no yes').split(' '));

/**
 * Summarises a batch of comments: how many, how many are questions, the most-used words and the longest/most-liked ones.
 * Works on any script (words are split on non-letters), so Tamil and English both count.
 */
export function analyzeComments(comments) {
  const items = (comments || []).filter((c) => c && typeof c.text === 'string' && c.text.trim());
  const counts = new Map();
  let questions = 0;
  for (const c of items) {
    if (/\?|\bhow\b|\bwhy\b|\bwhat\b|\bwhen\b|\bwhich\b|\bcan\b/i.test(c.text)) questions += 1;
    const words = c.text.toLowerCase().match(/[\p{L}\p{M}\p{N}]{3,}/gu) || [];
    for (const w of new Set(words)) {
      if (!STOPWORDS.has(w) && !/^\d+$/.test(w)) counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  const topWords = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([word, count]) => ({ word, count }));
  const topLiked = [...items].sort((a, b) => (b.like_count || 0) - (a.like_count || 0)).slice(0, 5);
  return {
    total: items.length,
    questions,
    question_share: items.length ? Math.round((questions / items.length) * 100) : 0,
    top_words: topWords,
    top_comments: topLiked.map((c) => ({ text: c.text.slice(0, 280), like_count: c.like_count || 0, author: c.username || c.author || null })),
  };
}

/** Competitor / benchmark summary from a business_discovery response. */
export function summarizeBenchmark(json) {
  const bd = json?.business_discovery;
  if (!bd) return null;
  const media = bd.media?.data || [];
  const followers = bd.followers_count || 0;
  const likes = media.reduce((a, m) => a + (m.like_count || 0), 0);
  const comments = media.reduce((a, m) => a + (m.comments_count || 0), 0);
  const times = media.map((m) => new Date(m.timestamp).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  const spanDays = times.length > 1 ? (times[times.length - 1] - times[0]) / 86400000 : 0;
  const mix = {};
  for (const m of media) mix[m.media_type || 'OTHER'] = (mix[m.media_type || 'OTHER'] || 0) + 1;
  const n = media.length;
  return {
    username: bd.username,
    name: bd.name || null,
    biography: bd.biography || '',
    followers_count: followers,
    follows_count: bd.follows_count ?? null,
    media_count: bd.media_count ?? null,
    sampled_posts: n,
    avg_likes: n ? Math.round(likes / n) : 0,
    avg_comments: n ? Math.round(comments / n) : 0,
    engagement_rate: followers && n ? Math.round(((likes + comments) / n / followers) * 10000) / 100 : null,
    posts_per_week: spanDays > 0 ? Math.round(((n - 1) / spanDays) * 7 * 10) / 10 : null,
    format_mix: mix,
    top_posts: [...media].sort((a, b) => (b.like_count || 0) + (b.comments_count || 0) - ((a.like_count || 0) + (a.comments_count || 0))).slice(0, 5)
      .map((m) => ({ caption: (m.caption || '').slice(0, 140), media_type: m.media_type, likes: m.like_count || 0, comments: m.comments_count || 0, permalink: m.permalink, timestamp: m.timestamp })),
  };
}

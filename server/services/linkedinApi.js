import { linkedinGet } from './linkedinAuth.js';

// ---------------------------------------------------------------------------
// Names for LinkedIn's coded values
// ---------------------------------------------------------------------------

export const SENIORITIES = {
  1: 'Unpaid', 2: 'Training', 3: 'Entry level', 4: 'Senior', 5: 'Manager',
  6: 'Director', 7: 'Vice President', 8: 'CXO', 9: 'Partner', 10: 'Owner',
};

export const FUNCTIONS = {
  1: 'Accounting', 2: 'Administrative', 3: 'Arts and Design', 4: 'Business Development', 5: 'Community and Social Services',
  6: 'Consulting', 7: 'Education', 8: 'Engineering', 9: 'Entrepreneurship', 10: 'Finance', 11: 'Healthcare Services',
  12: 'Human Resources', 13: 'Information Technology', 14: 'Legal', 15: 'Marketing', 16: 'Media and Communication',
  17: 'Military and Protective Services', 18: 'Operations', 19: 'Product Management', 20: 'Program and Project Management',
  21: 'Purchasing', 22: 'Quality Assurance', 23: 'Real Estate', 24: 'Research', 25: 'Sales', 26: 'Customer Success and Support',
};

export const STAFF_COUNT = {
  SIZE_1: 'Just 1', SIZE_2_TO_10: '2–10', SIZE_11_TO_50: '11–50', SIZE_51_TO_200: '51–200', SIZE_201_TO_500: '201–500',
  SIZE_501_TO_1000: '501–1,000', SIZE_1001_TO_5000: '1,001–5,000', SIZE_5001_TO_10000: '5,001–10,000', SIZE_10001_OR_MORE: '10,001+',
};

export const REACTIONS = {
  LIKE: 'Like', PRAISE: 'Celebrate', APPRECIATION: 'Support', EMPATHY: 'Love', INTEREST: 'Insightful', ENTERTAINMENT: 'Funny',
};

const urnId = (urn) => String(urn ?? '').split(':').pop();
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const orgUrn = (orgId) => `urn:li:organization:${orgId}`;
const enc = encodeURIComponent;

/** Rest.li time window for the time-bound statistics endpoints. LinkedIn's DAY buckets are UTC days. */
export function timeIntervals(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`) + 24 * 60 * 60 * 1000;
  return `(timeRange:(start:${start},end:${end}),timeGranularityType:DAY)`;
}

const bucketDate = (el) => new Date(el.timeRange?.start ?? 0).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Normalisers: LinkedIn response -> plain numbers (pure, unit tested)
// ---------------------------------------------------------------------------

export function shareStats(s = {}) {
  return {
    impressions: num(s.impressionCount),
    unique_impressions: num(s.uniqueImpressionsCount),
    clicks: num(s.clickCount),
    likes: num(s.likeCount),
    comments: num(s.commentCount),
    shares: num(s.shareCount),
    engagement: num(s.engagement),
  };
}

export function pageViewStats(p = {}) {
  const v = p.views || {};
  return {
    page_views: num(v.allPageViews?.pageViews),
    unique_page_views: num(v.allPageViews?.uniquePageViews),
    desktop_page_views: num(v.allDesktopPageViews?.pageViews),
    mobile_page_views: num(v.allMobilePageViews?.pageViews),
  };
}

/** Daily rows keyed by date: { 'YYYY-MM-DD': { impressions, ..., page_views, ..., organic_follower_gain, paid_follower_gain } } */
export function mergeDaily({ share = [], page = [], follower = [] }) {
  const out = {};
  const day = (d) => (out[d] ||= {});
  for (const el of share) Object.assign(day(bucketDate(el)), shareStats(el.totalShareStatistics));
  for (const el of page) Object.assign(day(bucketDate(el)), pageViewStats(el.totalPageStatistics));
  for (const el of follower) {
    Object.assign(day(bucketDate(el)), {
      organic_follower_gain: num(el.followerGains?.organicFollowerGain),
      paid_follower_gain: num(el.followerGains?.paidFollowerGain),
    });
  }
  return out;
}

const PAGE_SECTIONS = [
  ['overviewPageViews', 'Home'], ['aboutPageViews', 'About'], ['postsPageViews', 'Posts'], ['jobsPageViews', 'Jobs'],
  ['careersPageViews', 'Careers'], ['lifeAtPageViews', 'Life'], ['peoplePageViews', 'People'], ['insightsPageViews', 'Insights'],
  ['productsPageViews', 'Products'], ['videosPageViews', 'Videos'], ['eventsPageViews', 'Events'],
];

/** Page views by section and device, from the lifetime page statistics. */
export function pageSections(total = {}) {
  const v = total.views || {};
  return {
    sections: PAGE_SECTIONS.map(([key, label]) => ({ label, value: num(v[key]?.pageViews) ?? 0 })).filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value),
    devices: [
      { label: 'Desktop', value: num(v.allDesktopPageViews?.pageViews) ?? 0 },
      { label: 'Mobile', value: num(v.allMobilePageViews?.pageViews) ?? 0 },
    ],
    total: num(v.allPageViews?.pageViews) ?? 0,
  };
}

/** [{ key, value }] for one demographic list; key is LinkedIn's raw code, named later. */
function breakdown(list, keyField, valueOf) {
  return (list || [])
    .map((e) => ({ key: e[keyField], value: valueOf(e) ?? 0 }))
    .filter((e) => e.key && e.value > 0)
    .sort((a, b) => b.value - a.value);
}

const followers = (e) => (num(e.followerCounts?.organicFollowerCount) ?? 0) + (num(e.followerCounts?.paidFollowerCount) ?? 0);
const views = (e) => num(e.pageStatistics?.views?.allPageViews?.pageViews);

export function followerBreakdowns(el = {}) {
  return {
    function: breakdown(el.followerCountsByFunction, 'function', followers),
    seniority: breakdown(el.followerCountsBySeniority, 'seniority', followers),
    industry: breakdown(el.followerCountsByIndustryV2 || el.followerCountsByIndustry, el.followerCountsByIndustryV2 ? 'industryV2' : 'industry', followers),
    company_size: breakdown(el.followerCountsByStaffCountRange, 'staffCountRange', followers),
    country: breakdown(el.followerCountsByGeoCountry, 'geo', followers),
    region: breakdown(el.followerCountsByGeo, 'geo', followers),
  };
}

export function visitorBreakdowns(el = {}) {
  return {
    function: breakdown(el.pageStatisticsByFunction, 'function', views),
    seniority: breakdown(el.pageStatisticsBySeniority, 'seniority', views),
    industry: breakdown(el.pageStatisticsByIndustryV2 || el.pageStatisticsByIndustry, el.pageStatisticsByIndustryV2 ? 'industryV2' : 'industry', views),
    company_size: breakdown(el.pageStatisticsByStaffCountRange, 'staffCountRange', views),
    country: breakdown(el.pageStatisticsByGeoCountry, 'geo', views),
    region: breakdown(el.pageStatisticsByGeo, 'geo', views),
  };
}

/** Post type for the content list. */
export function postType(post = {}) {
  const c = post.content || {};
  if (c.poll) return 'POLL';
  if (c.article) return 'ARTICLE';
  if (c.multiImage) return 'CAROUSEL_ALBUM';
  const media = String(c.media?.id || '');
  if (media.includes(':video:')) return 'VIDEO';
  if (media.includes(':image:')) return 'IMAGE';
  if (media.includes(':document:')) return 'DOCUMENT';
  if (post.reshareContext) return 'REPOST';
  return 'TEXT';
}

export function reactionCounts(meta = {}) {
  const out = {};
  for (const [type, label] of Object.entries(REACTIONS)) out[label] = num(meta.reactionSummaries?.[type]?.count) ?? 0;
  return out;
}

// ---------------------------------------------------------------------------
// Name lookups for industry and place codes (cached for the life of the process)
// ---------------------------------------------------------------------------

const nameCache = new Map();

async function lookupName(accessToken, kind, id) {
  const key = `${kind}:${id}`;
  if (nameCache.has(key)) return nameCache.get(key);
  let name = null;
  try {
    if (kind === 'geo') {
      const g = await linkedinGet(accessToken, `/geo/${id}`);
      name = g.defaultLocalizedName?.value || null;
    } else {
      const i = await linkedinGet(accessToken, `/industryTaxonomyVersions/DEFAULT/industries/${id}`);
      name = i.name?.localized?.en_US || Object.values(i.name?.localized || {})[0] || null;
    }
  } catch {
    // fall back to the code below
  }
  nameCache.set(key, name);
  return name;
}

/** Turns raw breakdown codes into readable labels: [{ label, value }]. */
async function nameBreakdowns(accessToken, groups, limit = 10) {
  const out = {};
  for (const [group, rows] of Object.entries(groups)) {
    const top = rows.slice(0, limit);
    out[group] = await Promise.all(top.map(async ({ key, value }) => {
      const id = urnId(key);
      let label;
      if (group === 'seniority') label = SENIORITIES[id];
      else if (group === 'function') label = FUNCTIONS[id];
      else if (group === 'company_size') label = STAFF_COUNT[key] ? `${STAFF_COUNT[key]} employees` : null;
      else if (group === 'industry') label = await lookupName(accessToken, 'industry', id);
      else label = await lookupName(accessToken, 'geo', id);
      return { label: label || `${group.replace('_', ' ')} ${id}`, value };
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function fetchOrganization(accessToken, orgId) {
  const org = await linkedinGet(accessToken, `/organizations/${orgId}`);
  return {
    id: String(orgId),
    name: org.localizedName || null,
    vanity_name: org.vanityName || null,
    description: org.localizedDescription || null,
    website: org.localizedWebsite || null,
    staff_count: STAFF_COUNT[org.staffCountRange] ? `${STAFF_COUNT[org.staffCountRange]} employees` : null,
    industry_codes: (org.industries || []).map(urnId),
  };
}

export async function fetchFollowerCount(accessToken, orgId) {
  const res = await linkedinGet(accessToken, `/networkSizes/${enc(orgUrn(orgId))}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`);
  return num(res.firstDegreeSize);
}

/** Daily share, page and follower statistics for an inclusive date window. Missing pieces come back empty. */
export async function fetchDailyStats(accessToken, orgId, startDate, endDate) {
  const urn = enc(orgUrn(orgId));
  const ti = timeIntervals(startDate, endDate);
  const get = (path) => linkedinGet(accessToken, path).then((r) => r.elements || []);
  const [share, page, follower] = await Promise.allSettled([
    get(`/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${urn}&timeIntervals=${ti}`),
    get(`/organizationPageStatistics?q=organization&organization=${urn}&timeIntervals=${ti}`),
    get(`/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${urn}&timeIntervals=${ti}`),
  ]);
  // Post statistics are the core of the page; if those fail there is nothing worth storing.
  if (share.status === 'rejected') throw share.reason;
  return mergeDaily({
    share: share.value,
    page: page.status === 'fulfilled' ? page.value : [],
    follower: follower.status === 'fulfilled' ? follower.value : [],
  });
}

/** Lifetime follower demographics, named. */
export async function fetchFollowerDemographics(accessToken, orgId) {
  const res = await linkedinGet(accessToken, `/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${enc(orgUrn(orgId))}`);
  return nameBreakdowns(accessToken, followerBreakdowns(res.elements?.[0]));
}

/** Lifetime visitor demographics + page sections + devices, named. */
export async function fetchVisitorStats(accessToken, orgId) {
  const res = await linkedinGet(accessToken, `/organizationPageStatistics?q=organization&organization=${enc(orgUrn(orgId))}`);
  const el = res.elements?.[0] || {};
  return { ...pageSections(el.totalPageStatistics), demographics: await nameBreakdowns(accessToken, visitorBreakdowns(el)) };
}

/** The page's latest posts with lifetime stats and reaction breakdowns, shaped as media_snapshots rows. */
export async function fetchPostSnapshots(accessToken, orgId, limit = 50) {
  const posts = [];
  let start = 0;
  while (posts.length < limit) {
    const count = Math.min(50, limit - posts.length);
    const res = await linkedinGet(accessToken, `/posts?q=author&author=${enc(orgUrn(orgId))}&count=${count}&start=${start}&sortBy=LAST_MODIFIED`);
    const batch = (res.elements || []).filter((p) => p.lifecycleState !== 'DELETED');
    posts.push(...batch);
    if ((res.elements || []).length < count) break;
    start += count;
  }
  if (!posts.length) return [];

  // Post stats are requested in groups, split by URN kind as the API expects.
  const stats = new Map();
  for (let i = 0; i < posts.length; i += 20) {
    const ids = posts.slice(i, i + 20).map((p) => p.id);
    const shares = ids.filter((id) => id.startsWith('urn:li:share:'));
    const ugc = ids.filter((id) => id.startsWith('urn:li:ugcPost:'));
    const params = [
      shares.length ? `shares=List(${shares.map(enc).join(',')})` : '',
      ugc.length ? `ugcPosts=List(${ugc.map(enc).join(',')})` : '',
    ].filter(Boolean).join('&');
    if (!params) continue;
    try {
      const res = await linkedinGet(accessToken, `/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${enc(orgUrn(orgId))}&${params}`);
      for (const el of res.elements || []) stats.set(el.share || el.ugcPost, shareStats(el.totalShareStatistics));
    } catch (err) {
      console.warn(`LinkedIn post stats failed for org ${orgId}: ${err.message}`);
    }
  }

  const reactions = new Map();
  for (let i = 0; i < posts.length; i += 5) {
    await Promise.all(posts.slice(i, i + 5).map(async (p) => {
      try {
        reactions.set(p.id, await linkedinGet(accessToken, `/socialMetadata/${enc(p.id)}`));
      } catch {
        // reactions are a bonus; the post still shows without them
      }
    }));
  }

  return posts.map((p) => {
    const s = stats.get(p.id) || {};
    const meta = reactions.get(p.id);
    const text = String(p.commentary || p.content?.article?.title || '').replace(/\{hashtag\|\\#\|([^}]+)\}/g, '#$1');
    return {
      media_id: p.id,
      title: text,
      media_type: postType(p),
      permalink: `https://www.linkedin.com/feed/update/${p.id}/`,
      thumbnail_url: null,
      published_at: p.publishedAt ? new Date(p.publishedAt).toISOString() : p.createdAt ? new Date(p.createdAt).toISOString() : null,
      views: s.impressions ?? null,
      reach: s.unique_impressions ?? null,
      likes: s.likes ?? num(meta?.reactionSummaries ? Object.values(meta.reactionSummaries).reduce((a, r) => a + (r.count || 0), 0) : null),
      comments: s.comments ?? num(meta?.commentSummary?.count),
      shares: s.shares ?? null,
      link_clicks: s.clicks ?? null,
      total_interactions: [s.likes, s.comments, s.shares, s.clicks].some((v) => v !== null && v !== undefined)
        ? (s.likes ?? 0) + (s.comments ?? 0) + (s.shares ?? 0) + (s.clicks ?? 0) : null,
      extra: {
        engagement_rate: s.engagement !== null && s.engagement !== undefined ? Math.round(s.engagement * 1000) / 10 : null,
        reactions: meta ? reactionCounts(meta) : null,
        article_url: p.content?.article?.source || null,
      },
    };
  });
}

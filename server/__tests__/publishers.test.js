import { describe, it, expect } from 'vitest';
import { containerParams, publishInstagram } from '../services/publishers/instagram.js';
import { audience, publishFacebook, scheduleParams } from '../services/publishers/facebook.js';
import { pollContent, postBody, publishLinkedIn, toLittleText } from '../services/publishers/linkedin.js';
import { fitTags, tagCost, videoResource } from '../services/publishers/youtube.js';
import { PublishError } from '../services/publishers/common.js';
import { overallStatus, backoffMs } from '../services/publishRunner.js';

const img = (url = 'https://cdn/x.jpg', extra = {}) => ({ url, mime: 'image/jpeg', kind: 'image', ...extra });
const vid = (url = 'https://cdn/x.mp4') => ({ url, mime: 'video/mp4', kind: 'video' });
const noWait = async () => {};

/** Records Graph calls and answers them from a script of responses keyed by "METHOD path-suffix". */
function fakeGraph(responses) {
  const calls = [];
  const call = async (method, url, token, params) => {
    calls.push({ method, url, params });
    const key = Object.keys(responses).find((k) => {
      const [m, suffix] = k.split(' ');
      return m === method && url.endsWith(suffix);
    });
    const r = key ? responses[key] : { data: {} };
    return typeof r === 'function' ? r(params, calls) : r;
  };
  return { calls, call };
}

describe('Instagram containers', () => {
  it('builds an image container with tags, collaborators and alt text', () => {
    const { parent } = containerParams('image', {
      caption: 'Hi', location_id: '123', collaborators: ['@a', 'b', 'c', 'd'],
      media: [img('https://cdn/1.jpg', { alt_text: 'A chart', user_tags: [{ username: '@asha', x: 0.5, y: 0.25 }] })],
    });
    expect(parent).toMatchObject({ image_url: 'https://cdn/1.jpg', caption: 'Hi', location_id: '123', alt_text: 'A chart', collaborators: ['a', 'b', 'c'], user_tags: [{ username: 'asha', x: 0.5, y: 0.25 }] });
  });

  it('builds reels with cover, trial params and no x/y on tags', () => {
    const { parent } = containerParams('reel', { media: [{ ...vid(), user_tags: [{ username: 'z', x: 0.1, y: 0.1 }] }], cover_url: 'https://cdn/c.jpg', thumb_offset: 1500, share_to_feed: false, audio_name: 'My audio', trial: true });
    expect(parent).toMatchObject({ media_type: 'REELS', video_url: 'https://cdn/x.mp4', cover_url: 'https://cdn/c.jpg', share_to_feed: false, audio_name: 'My audio', trial_params: { graduation_strategy: 'MANUAL' }, user_tags: [{ username: 'z' }] });
    expect(parent.thumb_offset).toBeUndefined(); // a cover wins over a frame offset
  });

  it('rejects a carousel outside 2-10 items and builds mixed children', () => {
    expect(() => containerParams('carousel', { media: [img()] })).toThrow(PublishError);
    const plan = containerParams('carousel', { caption: 'c', media: [img('https://cdn/a.jpg'), vid('https://cdn/b.mp4')] });
    expect(plan.children).toEqual([
      { is_carousel_item: true, image_url: 'https://cdn/a.jpg', alt_text: undefined, user_tags: undefined },
      { is_carousel_item: true, media_type: 'VIDEO', video_url: 'https://cdn/b.mp4' },
    ]);
    expect(plan.parent.media_type).toBe('CAROUSEL');
  });

  it('creates children, waits, then publishes the carousel and reads the permalink', async () => {
    let child = 0;
    const g = fakeGraph({
      'GET /content_publishing_limit': { data: { data: [{ quota_usage: 1, config: { quota_total: 100 } }] } },
      'POST /media': () => ({ data: { id: `c${++child}` } }),
      'POST /media_publish': { data: { id: 'M1' } },
      'GET /M1': { data: { permalink: 'https://instagram.com/p/x' } },
    });
    g.call = ((orig) => async (method, url, token, params) => (method === 'GET' && params?.fields === 'status_code,status' ? { data: { status_code: 'FINISHED' } } : orig(method, url, token, params)))(g.call);
    const steps = [];
    const out = await publishInstagram({ postType: 'carousel', fields: { caption: 'x', media: [img(), img()] } }, { account: { page_id: 'IG', access_token: 't' } }, (s) => steps.push(s), { call: g.call, wait: noWait });
    expect(out).toEqual({ externalId: 'M1', permalink: 'https://instagram.com/p/x' });
    expect(steps).toEqual(['upload', 'container', 'poll', 'poll', 'publish']);
  });

  it('stops before posting when the daily limit is used up', async () => {
    const g = fakeGraph({ 'GET /content_publishing_limit': { data: { data: [{ quota_usage: 100, config: { quota_total: 100 } }] } } });
    await expect(publishInstagram({ postType: 'image', fields: { media: [img()] } }, { account: { page_id: 'IG', access_token: 't' } }, () => {}, { call: g.call })).rejects.toMatchObject({ retryable: true, code: 429 });
    expect(g.calls.some((c) => c.url.endsWith('/media'))).toBe(false);
  });

  it('passes the exact Instagram error through', async () => {
    const g = fakeGraph({ 'POST /media': { error: { code: 9004, message: 'Only photo or video can be accepted as media type.' } } });
    await expect(publishInstagram({ postType: 'image', fields: { media: [img()] } }, { account: { page_id: 'IG', access_token: 't' } }, () => {}, { call: g.call })).rejects.toThrow('Only photo or video can be accepted as media type.');
  });

  it('needs a linked Facebook Page for product tags', () => {
    return expect(publishInstagram({ postType: 'image', fields: { media: [img()], product_tags: [{ product_id: '1' }] } }, { account: { page_id: 'IG' }, fbPage: null })).rejects.toThrow(/Facebook Page/);
  });
});

describe('Facebook', () => {
  const now = Date.parse('2026-11-03T10:00:00Z');
  it('only allows native schedules 10 minutes to 30 days ahead', () => {
    expect(() => scheduleParams({}, '2026-11-03T10:05:00Z', now)).toThrow(/10 minutes/);
    expect(() => scheduleParams({}, '2026-12-10T10:00:00Z', now)).toThrow(/30 days/);
    expect(scheduleParams({}, '2026-11-04T10:00:00Z', now)).toEqual({ published: false, scheduled_publish_time: Date.parse('2026-11-04T10:00:00Z') / 1000 });
  });

  it('drops empty audience fields so posts are not restricted by accident', () => {
    expect(audience({ countries: [], locales: [] })).toBeUndefined();
    expect(audience({ countries: ['in'], age_min: '18' })).toEqual({ geo_locations: { countries: ['IN'] }, age_min: 18 });
  });

  it('uploads multi-photo items unpublished and attaches them to one feed post', async () => {
    let n = 0;
    const g = fakeGraph({ 'POST /photos': () => ({ data: { id: `p${++n}` } }), 'POST /feed': { data: { id: 'PAGE_POST' } }, 'GET /PAGE_POST': { data: { permalink_url: 'https://fb.com/1' } } });
    const out = await publishFacebook({ postType: 'multi_photo', fields: { message: 'hi', media: [img(), img()] } }, { page: { page_id: 'PG', page_access_token: 'pt' } }, () => {}, { call: g.call, wait: noWait, now });
    const feed = g.calls.find((c) => c.url.endsWith('/feed'));
    expect(feed.params.attached_media).toEqual([{ media_fbid: 'p1' }, { media_fbid: 'p2' }]);
    expect(g.calls.filter((c) => c.url.endsWith('/photos')).every((c) => c.params.published === false)).toBe(true);
    expect(out).toMatchObject({ externalId: 'PAGE_POST', permalink: 'https://fb.com/1', nativeScheduled: false });
  });
});

describe('LinkedIn', () => {
  it('escapes little-text characters and keeps hashtags clickable', () => {
    expect(toLittleText('Hello (world) @you #Nifty50 & #')).toBe('Hello \\(world\\) \\@you {hashtag|\\#|Nifty50} & \\#');
  });

  it('builds the post body with visibility, reshare and draft state', () => {
    expect(postBody('urn:li:organization:1', { commentary: 'x', visibility: 'CONNECTIONS', reshare_disabled: true, lifecycle: 'DRAFT' })).toMatchObject({
      author: 'urn:li:organization:1', visibility: 'CONNECTIONS', lifecycleState: 'DRAFT', isReshareDisabledByAuthor: true,
      distribution: { feedDistribution: 'MAIN_FEED' },
    });
  });

  it('validates polls', () => {
    expect(() => pollContent({ question: 'Q?', options: ['a'] })).toThrow(/2 to 4/);
    expect(pollContent({ question: 'Q?', options: ['a', 'b', ''], duration: 'SEVEN_DAYS' })).toEqual({ poll: { question: 'Q?', options: [{ text: 'a' }, { text: 'b' }], settings: { duration: 'SEVEN_DAYS' } } });
  });

  it('posts a poll and returns the feed link from the x-restli-id header', async () => {
    const sent = [];
    const client = { json: async (method, path, body) => { sent.push({ method, path, body }); return { data: {}, headers: new Map([['x-restli-id', 'urn:li:share:9']]) }; } };
    const out = await publishLinkedIn({ postType: 'poll', fields: { commentary: 'Vote', poll: { question: 'Which?', options: ['A', 'B'] } } }, { account: { member_id: 'urn:li:person:abc' }, accessToken: 't' }, () => {}, { client });
    expect(sent[0].path).toBe('/posts');
    expect(sent[0].body.content.poll.options).toHaveLength(2);
    expect(out).toEqual({ externalId: 'urn:li:share:9', permalink: 'https://www.linkedin.com/feed/update/urn:li:share:9/' });
  });
});

describe('YouTube', () => {
  it('counts tags the way YouTube does and stops before 500 characters', () => {
    expect(tagCost(['a b', 'cd'])).toBe(5 + 2 + 1);
    const many = Array.from({ length: 100 }, (_, i) => `tag${i}`);
    expect(tagCost(fitTags(many))).toBeLessThanOrEqual(500);
  });

  it('uploads scheduled videos as private with publishAt', () => {
    const r = videoResource({ title: 'T', privacy: 'public', made_for_kids: false, tags: ['#ipo'] }, '2026-11-05T05:30:00Z');
    expect(r.status).toMatchObject({ privacyStatus: 'private', publishAt: '2026-11-05T05:30:00.000Z', selfDeclaredMadeForKids: false, embeddable: true, license: 'youtube' });
    expect(r.snippet.tags).toEqual(['ipo']);
  });
});

describe('runner', () => {
  it('derives the post status from its targets', () => {
    expect(overallStatus(['done', 'done'])).toBe('done');
    expect(overallStatus(['done', 'failed'])).toBe('partial');
    expect(overallStatus(['failed'])).toBe('failed');
    expect(overallStatus(['scheduled', 'scheduled'])).toBe('scheduled');
    expect(overallStatus(['done', 'publishing'])).toBe('publishing');
    expect(overallStatus(['done', 'scheduled'])).toBe('publishing'); // one is out, one is retrying later
  });

  it('backs off longer each retry', () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([120000, 480000, 1080000]);
  });
});

import { graphCall, GRAPH } from '../facebookApi.js';
import { PublishError, pollUntil, unwrap } from './common.js';

/**
 * Instagram Content Publishing: create a container, wait until Instagram has processed it, then publish it.
 * Instagram-Login tokens use graph.instagram.com. Product tags only work through Facebook Login, so when they
 * are used (and a Facebook Page is linked to this Instagram account) the page token and graph.facebook.com are used.
 */
const IG_HOST = 'https://graph.instagram.com/v24.0';

export const IG_TYPES = ['image', 'carousel', 'reel', 'story'];
export const IG_LIMITS = { caption: 2200, hashtags: 30, mentions: 20, collaborators: 3, carouselMin: 2, carouselMax: 10 };

/** Which host, token and Instagram id to call with. */
export function connection(account, fbPage, fields = {}) {
  const needsFacebook = Array.isArray(fields.product_tags) && fields.product_tags.length > 0;
  if (needsFacebook) {
    if (!fbPage?.ig_user_id) {
      throw new PublishError('Product tags need a Facebook Page linked to this Instagram account. Connect Facebook first, or remove the product tags.', { code: 400 });
    }
    return { host: GRAPH, token: fbPage.page_access_token, igId: fbPage.ig_user_id };
  }
  return { host: IG_HOST, token: account.access_token, igId: account.ig_user_id || account.page_id };
}

const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
const tags = (v) => list(v).filter((t) => t.username).map((t) => (t.x === undefined || t.x === null
  ? { username: String(t.username).replace(/^@/, '') }
  : { username: String(t.username).replace(/^@/, ''), x: Number(t.x), y: Number(t.y) }));
const collaborators = (v) => list(v).map((u) => String(u).replace(/^@/, '').trim()).filter(Boolean).slice(0, IG_LIMITS.collaborators);
const productTags = (v) => list(v).filter((p) => p.product_id).map((p) => (p.x === undefined ? { product_id: String(p.product_id) } : { product_id: String(p.product_id), x: Number(p.x), y: Number(p.y) }));
const isVideo = (m) => m?.kind === 'video' || String(m?.mime || '').startsWith('video/');
const nonEmpty = (v) => (Array.isArray(v) && v.length ? v : undefined);

/** The container parameters for each post type. Pure, so the exact API payload is unit-tested. */
export function containerParams(postType, f) {
  const media = list(f.media);
  const first = media[0];
  const shared = {
    caption: f.caption || undefined,
    location_id: f.location_id || undefined,
    collaborators: nonEmpty(collaborators(f.collaborators)),
  };

  if (postType === 'image') {
    if (!first || isVideo(first)) throw new PublishError('An image post needs one image.', { code: 400 });
    return { parent: { ...shared, image_url: first.url, alt_text: first.alt_text || f.alt_text || undefined, user_tags: nonEmpty(tags(first.user_tags)), product_tags: nonEmpty(productTags(f.product_tags)) } };
  }

  if (postType === 'reel') {
    if (!first || !isVideo(first)) throw new PublishError('A reel needs one video.', { code: 400 });
    return {
      parent: {
        ...shared,
        media_type: 'REELS',
        video_url: first.url,
        cover_url: f.cover_url || undefined,
        thumb_offset: f.cover_url ? undefined : (Number.isFinite(Number(f.thumb_offset)) && f.thumb_offset !== '' ? Math.round(Number(f.thumb_offset)) : undefined),
        share_to_feed: f.share_to_feed === undefined ? undefined : Boolean(f.share_to_feed),
        audio_name: f.audio_name || undefined,
        user_tags: nonEmpty(tags(first.user_tags).map(({ username }) => ({ username }))),
        product_tags: nonEmpty(productTags(f.product_tags).map(({ product_id }) => ({ product_id }))),
        trial_params: f.trial ? { graduation_strategy: f.trial_graduation === 'SS_PERFORMANCE' ? 'SS_PERFORMANCE' : 'MANUAL' } : undefined,
      },
    };
  }

  if (postType === 'story') {
    if (!first) throw new PublishError('A story needs one image or video.', { code: 400 });
    return {
      parent: {
        media_type: 'STORIES',
        ...(isVideo(first) ? { video_url: first.url } : { image_url: first.url }),
        user_tags: nonEmpty(tags(first.user_tags).map(({ username }) => ({ username }))),
      },
    };
  }

  if (postType === 'carousel') {
    if (media.length < IG_LIMITS.carouselMin || media.length > IG_LIMITS.carouselMax) {
      throw new PublishError(`A carousel needs ${IG_LIMITS.carouselMin} to ${IG_LIMITS.carouselMax} items (it has ${media.length}).`, { code: 400 });
    }
    return {
      children: media.map((m) => (isVideo(m)
        ? { is_carousel_item: true, media_type: 'VIDEO', video_url: m.url }
        : { is_carousel_item: true, image_url: m.url, alt_text: m.alt_text || undefined, user_tags: nonEmpty(tags(m.user_tags)) })),
      parent: { ...shared, media_type: 'CAROUSEL', product_tags: nonEmpty(productTags(f.product_tags)) },
    };
  }

  throw new PublishError(`Unknown Instagram post type "${postType}".`, { code: 400 });
}

/** Publishes one Instagram target. `onStep` reports progress; `deps` lets tests swap the network and the clock. */
export async function publishInstagram({ postType, fields }, { account, fbPage }, onStep = () => {}, deps = {}) {
  const call = deps.call || graphCall;
  const wait = deps.wait;
  const { host, token, igId } = connection(account, fbPage, fields);
  const plan = containerParams(postType, fields);

  onStep('upload');
  const limit = await call('GET', `${host}/${igId}/content_publishing_limit`, token, { fields: 'quota_usage,config' });
  const quota = limit.data?.data?.[0];
  if (quota?.config?.quota_total && quota.quota_usage >= quota.config.quota_total) {
    throw new PublishError(`Instagram's daily publishing limit is used up (${quota.quota_usage}/${quota.config.quota_total} posts in 24 hours). Try again later.`, { code: 429, retryable: true });
  }

  onStep('container');
  const waitReady = (id) => pollUntil(async () => {
    const s = unwrap(await call('GET', `${host}/${id}`, token, { fields: 'status_code,status' }), 'poll');
    if (s.status_code === 'FINISHED') return true;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
      throw new PublishError(`Instagram could not process the media: ${s.status || s.status_code}`, { code: 422, step: 'poll' });
    }
    return false;
  }, { wait, what: 'Instagram media processing' });

  let parentParams = plan.parent;
  if (plan.children) {
    const childIds = [];
    for (const child of plan.children) childIds.push(unwrap(await call('POST', `${host}/${igId}/media`, token, child), 'container').id);
    onStep('poll');
    for (const id of childIds) await waitReady(id);
    parentParams = { ...plan.parent, children: childIds.join(',') };
  }
  const container = unwrap(await call('POST', `${host}/${igId}/media`, token, parentParams), 'container');

  onStep('poll');
  await waitReady(container.id);

  onStep('publish');
  const published = unwrap(await call('POST', `${host}/${igId}/media_publish`, token, { creation_id: container.id }), 'publish');
  const info = await call('GET', `${host}/${published.id}`, token, { fields: 'permalink' });
  return { externalId: String(published.id), permalink: info.data?.permalink || null };
}

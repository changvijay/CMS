import { GRAPH, GRAPH_VERSION, graphCall, graphError } from '../facebookApi.js';
import { PublishError, fetchBytes, pollUntil, unixSeconds, unwrap } from './common.js';

/**
 * Facebook Page publishing with the page token.
 * Text/link/photo/multi-photo/video/reel can be scheduled by Facebook itself (10 minutes to 30 days ahead);
 * stories cannot, so the app scheduler holds those.
 */
export const FB_TYPES = ['text', 'link', 'photo', 'multi_photo', 'video', 'reel', 'story'];
export const FB_NATIVE_SCHEDULE = new Set(['text', 'link', 'photo', 'multi_photo', 'video', 'reel']);
export const FB_LIMITS = { message: 63206, minScheduleMinutes: 10, maxScheduleDays: 30 };

const RUPLOAD = `https://rupload.facebook.com/video-upload/${GRAPH_VERSION}`;
const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
const isVideo = (m) => m?.kind === 'video' || String(m?.mime || '').startsWith('video/');

/** Facebook's audience fields want arrays of ids; empty ones are dropped so the post is not restricted by accident. */
export function audience(t) {
  if (!t) return undefined;
  const out = {};
  const countries = list(t.countries).map((c) => String(c).toUpperCase());
  if (countries.length) out.geo_locations = { countries };
  if (t.age_min) out.age_min = Number(t.age_min);
  if (t.age_max) out.age_max = Number(t.age_max);
  const locales = list(t.locales).map(Number).filter(Number.isFinite);
  if (locales.length) out.locales = locales;
  return Object.keys(out).length ? out : undefined;
}

/** published / scheduled_publish_time, checked against Facebook's 10 minute to 30 day window. */
export function scheduleParams(f, scheduleAt, now = Date.now()) {
  if (!scheduleAt) return { published: f.published === false ? false : undefined };
  const at = new Date(scheduleAt).getTime();
  const minutes = (at - now) / 60000;
  if (minutes < FB_LIMITS.minScheduleMinutes || minutes > FB_LIMITS.maxScheduleDays * 24 * 60) {
    throw new PublishError('Facebook can only schedule posts between 10 minutes and 30 days ahead.', { code: 400 });
  }
  return { published: false, scheduled_publish_time: unixSeconds(scheduleAt) };
}

/** Posts form fields plus one file (used for video thumbnails, which Facebook only takes as an upload). */
async function multipart(url, token, params, file, fetchImpl = fetch) {
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  if (file) form.append(file.field, new Blob([file.bytes], { type: file.mime }), file.name);
  form.append('access_token', token);
  try {
    const res = await fetchImpl(url, { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) return { error: graphError(json, res.status) };
    return { data: json };
  } catch (err) {
    return { error: { code: 502, message: `Failed to reach Facebook: ${err.message}`, retryable: true } };
  }
}

/** Hands Facebook a hosted video URL for a reel or video story that was started with upload_phase=start. */
async function ruploadFromUrl(videoId, token, fileUrl, fetchImpl = fetch) {
  const res = await fetchImpl(`${RUPLOAD}/${videoId}`, { method: 'POST', headers: { Authorization: `OAuth ${token}`, file_url: fileUrl } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error || json.success === false) {
    throw new PublishError(json.error?.message || json.debug_info?.message || `Facebook video upload failed (${res.status})`, { code: res.status, step: 'upload', retryable: res.status >= 500 });
  }
}

export async function publishFacebook({ postType, fields: f, scheduleAt }, { page }, onStep = () => {}, deps = {}) {
  const call = deps.call || graphCall;
  const fetchImpl = deps.fetch || fetch;
  const now = deps.now ?? Date.now();
  const token = page.page_access_token;
  const pageId = page.page_id;
  const at = (path) => `${GRAPH}/${path}`;
  const media = list(f.media);
  const common = {
    place: f.place || undefined,
    tags: list(f.tags).length ? list(f.tags).join(',') : undefined,
    targeting: audience(f.targeting),
    feed_targeting: audience(f.feed_targeting),
  };
  const sched = FB_NATIVE_SCHEDULE.has(postType) ? scheduleParams(f, scheduleAt, now) : {};
  let postId;

  if (postType === 'text' || postType === 'link') {
    if (postType === 'link' && !f.link) throw new PublishError('A link post needs a link.', { code: 400 });
    if (postType === 'text' && !f.message) throw new PublishError('A text post needs a message.', { code: 400 });
    onStep('publish');
    postId = unwrap(await call('POST', at(`${pageId}/feed`), token, { message: f.message, link: postType === 'link' ? f.link : undefined, ...common, ...sched }), 'publish').id;
  } else if (postType === 'photo') {
    const img = media[0];
    if (!img || isVideo(img)) throw new PublishError('A photo post needs one image.', { code: 400 });
    onStep('publish');
    const r = unwrap(await call('POST', at(`${pageId}/photos`), token, { url: img.url, caption: f.message, alt_text_custom: img.alt_text || undefined, place: common.place, targeting: common.targeting, feed_targeting: common.feed_targeting, ...sched }), 'publish');
    postId = r.post_id || r.id;
  } else if (postType === 'multi_photo') {
    const images = media.filter((m) => !isVideo(m));
    if (images.length < 2) throw new PublishError('A multi-photo post needs at least 2 images.', { code: 400 });
    onStep('upload');
    const ids = [];
    for (const img of images) {
      // Unpublished photos are attached to the feed post below; `temporary` keeps them alive until a scheduled post goes out.
      ids.push(unwrap(await call('POST', at(`${pageId}/photos`), token, { url: img.url, published: false, temporary: sched.scheduled_publish_time ? true : undefined, alt_text_custom: img.alt_text || undefined }), 'upload').id);
    }
    onStep('publish');
    postId = unwrap(await call('POST', at(`${pageId}/feed`), token, { message: f.message, attached_media: ids.map((id) => ({ media_fbid: id })), ...common, ...sched }), 'publish').id;
  } else if (postType === 'video') {
    const vid = media[0];
    if (!vid || !isVideo(vid)) throw new PublishError('A video post needs one video.', { code: 400 });
    onStep('upload');
    const thumb = f.thumbnail?.url ? { field: 'thumb', bytes: await fetchBytes(f.thumbnail.url, { fetchImpl }), mime: f.thumbnail.mime || 'image/jpeg', name: 'thumb.jpg' } : null;
    const r = unwrap(await multipart(`https://graph-video.facebook.com/${GRAPH_VERSION}/${pageId}/videos`, token, {
      file_url: vid.url, title: f.title, description: f.description || f.message, place: common.place, targeting: common.targeting, ...sched,
    }, thumb, fetchImpl), 'upload');
    postId = r.post_id || r.id;
    onStep('publish');
  } else if (postType === 'reel') {
    const vid = media[0];
    if (!vid || !isVideo(vid)) throw new PublishError('A reel needs one video.', { code: 400 });
    onStep('upload');
    const start = unwrap(await call('POST', at(`${pageId}/video_reels`), token, { upload_phase: 'start' }), 'upload');
    await ruploadFromUrl(start.video_id, token, vid.url, fetchImpl);
    onStep('publish');
    const finish = unwrap(await call('POST', at(`${pageId}/video_reels`), token, {
      upload_phase: 'finish', video_id: start.video_id, description: f.message, title: f.title, place: common.place,
      video_state: sched.scheduled_publish_time ? 'SCHEDULED' : 'PUBLISHED', scheduled_publish_time: sched.scheduled_publish_time,
    }), 'publish');
    postId = finish.post_id || start.video_id;
  } else if (postType === 'story') {
    const item = media[0];
    if (!item) throw new PublishError('A story needs one image or video.', { code: 400 });
    onStep('upload');
    if (isVideo(item)) {
      const start = unwrap(await call('POST', at(`${pageId}/video_stories`), token, { upload_phase: 'start' }), 'upload');
      await ruploadFromUrl(start.video_id, token, item.url, fetchImpl);
      onStep('publish');
      postId = unwrap(await call('POST', at(`${pageId}/video_stories`), token, { upload_phase: 'finish', video_id: start.video_id }), 'publish').post_id;
    } else {
      const photo = unwrap(await call('POST', at(`${pageId}/photos`), token, { url: item.url, published: false }), 'upload');
      onStep('publish');
      postId = unwrap(await call('POST', at(`${pageId}/photo_stories`), token, { photo_id: photo.id }), 'publish').post_id;
    }
  } else {
    throw new PublishError(`Unknown Facebook post type "${postType}".`, { code: 400 });
  }

  // Scheduled posts have no public link yet; published ones do (it can take a moment to appear).
  let permalink = null;
  if (postId && !sched.scheduled_publish_time) {
    const info = await pollUntil(async () => {
      const r = await call('GET', at(postId), token, { fields: 'permalink_url' });
      return r.data?.permalink_url || (r.error ? 'none' : null);
    }, { intervalMs: 2000, timeoutMs: 10000, wait: deps.wait, what: 'the post link' }).catch(() => null);
    permalink = info && info !== 'none' ? info : null;
  }
  return { externalId: postId ? String(postId) : null, permalink, nativeScheduled: Boolean(sched.scheduled_publish_time) };
}

import { PublishError, fetchBytes } from './common.js';

/**
 * YouTube Data API v3: resumable videos.insert, then the custom thumbnail and the playlist.
 * A scheduled video is uploaded as private with status.publishAt; YouTube makes it public at that time.
 */
const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';
export const YT_LIMITS = { title: 100, description: 5000, tagsTotal: 500, thumbnailBytes: 2 * 1024 * 1024, shortSeconds: 180 };
export const YT_TYPES = ['video', 'short'];
export const YT_PRIVACY = ['public', 'unlisted', 'private'];
export const YT_LICENSES = ['youtube', 'creativeCommon'];

async function ytError(res, step) {
  const json = await res.json().catch(() => ({}));
  const e = json.error || {};
  const reason = e.errors?.[0]?.reason;
  return new PublishError(e.message || `YouTube API request failed (${res.status})`, {
    code: res.status,
    retryable: res.status >= 500 || res.status === 429 || reason === 'rateLimitExceeded' || reason === 'backendError',
    step,
  });
}

/** YouTube counts each tag's length (plus quotes when it has a space) toward a 500 character total. */
export function tagCost(tags) {
  return tags.reduce((n, t) => n + t.length + (t.includes(' ') ? 2 : 0), 0) + Math.max(0, tags.length - 1);
}

export function fitTags(tags, limit = YT_LIMITS.tagsTotal) {
  const out = [];
  for (const t of (tags || []).map((x) => String(x).replace(/^#/, '').trim()).filter(Boolean)) {
    if (tagCost([...out, t]) > limit) break;
    out.push(t);
  }
  return out;
}

const SHORTS_TAG = /#shorts\b/i;

/** Adds #Shorts to the title, or to the start of the description if the title has no room. */
export function withShortsTag(f) {
  const title = String(f.title || '').trim();
  const description = String(f.description || '');
  if (SHORTS_TAG.test(title) || SHORTS_TAG.test(description)) return { title, description };
  const tagged = `${title} #Shorts`;
  if ([...tagged].length <= YT_LIMITS.title) return { title: tagged, description };
  return { title, description: description ? `#Shorts\n\n${description}` : '#Shorts' };
}

/** The videos.insert body. Pure, so it is unit-tested. */
export function videoResource(f, scheduleAt, postType = 'video') {
  const { title, description } = postType === 'short' ? withShortsTag(f) : { title: f.title, description: f.description };
  const privacy = scheduleAt ? 'private' : (YT_PRIVACY.includes(f.privacy) ? f.privacy : 'public');
  return {
    snippet: {
      title: String(title || '').slice(0, YT_LIMITS.title) || 'Untitled',
      description: String(description || '').slice(0, YT_LIMITS.description),
      tags: fitTags(f.tags),
      categoryId: f.category_id ? String(f.category_id) : undefined,
      defaultLanguage: f.default_language || undefined,
      defaultAudioLanguage: f.default_language || undefined,
    },
    status: {
      privacyStatus: privacy,
      publishAt: scheduleAt ? new Date(scheduleAt).toISOString() : undefined,
      selfDeclaredMadeForKids: Boolean(f.made_for_kids),
      embeddable: f.embeddable !== false,
      license: YT_LICENSES.includes(f.license) ? f.license : 'youtube',
      publicStatsViewable: f.public_stats_viewable !== false,
    },
  };
}

export async function publishYoutube({ postType = 'video', fields: f, scheduleAt }, { accessToken }, onStep = () => {}, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const auth = { Authorization: `Bearer ${accessToken}` };
  const video = (f.media || [])[0];
  if (!video) throw new PublishError('A YouTube upload needs a video file.', { code: 400 });
  if (!String(f.title || '').trim()) throw new PublishError('A YouTube video needs a title.', { code: 400 });

  onStep('upload');
  // Read the file from storage first so we know its exact size for the resumable session.
  const source = await fetchImpl(video.url);
  if (!source.ok) throw new PublishError(`Could not read the uploaded video (${source.status}). Upload it again.`, { code: source.status, step: 'upload' });
  const size = Number(source.headers.get('content-length')) || Number(video.bytes) || undefined;
  const mime = video.mime || source.headers.get('content-type') || 'video/*';

  const init = await fetchImpl(`${UPLOAD}/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${f.notify_subscribers === false ? 'false' : 'true'}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, ...(size ? { 'X-Upload-Content-Length': String(size) } : {}) },
    body: JSON.stringify(videoResource(f, scheduleAt, postType)),
  });
  if (!init.ok) throw await ytError(init, 'upload');
  const sessionUrl = init.headers.get('location');

  const put = await fetchImpl(sessionUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mime, ...(size ? { 'Content-Length': String(size) } : {}) },
    body: source.body,
    duplex: 'half', // streams the file through without holding it all in memory
  });
  if (!put.ok) throw await ytError(put, 'upload');
  const uploaded = await put.json();
  const videoId = uploaded.id;

  onStep('publish');
  const notes = [];
  // Shorts don't show custom thumbnails, so none is set for them.
  if (f.thumbnail?.url && postType !== 'short') {
    const bytes = await fetchBytes(f.thumbnail.url, { fetchImpl });
    const r = await fetchImpl(`${UPLOAD}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, { method: 'POST', headers: { ...auth, 'Content-Type': f.thumbnail.mime || 'image/jpeg' }, body: bytes });
    // A failed thumbnail must not undo a successful upload, so it is reported as a note instead.
    if (!r.ok) notes.push(`Thumbnail not set: ${(await ytError(r)).message}`);
  }
  if (f.playlist_id) {
    const r = await fetchImpl(`${API}/playlistItems?part=snippet`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ snippet: { playlistId: f.playlist_id, resourceId: { kind: 'youtube#video', videoId } } }),
    });
    if (!r.ok) notes.push(`Not added to playlist: ${(await ytError(r)).message}`);
  }

  return { externalId: videoId, permalink: `https://www.youtube.com/watch?v=${videoId}`, nativeScheduled: Boolean(scheduleAt), note: notes.join(' ') || null };
}

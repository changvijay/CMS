import { apiVersion } from '../linkedinAuth.js';
import { PublishError, fetchBytes, pollUntil } from './common.js';

/**
 * LinkedIn Posts API (/rest/posts) as a person (w_member_social) or a company page (w_organization_social).
 * Images, videos and documents are uploaded to LinkedIn first and referenced by URN.
 */
const REST = 'https://api.linkedin.com/rest';
export const LI_TYPES = ['none', 'image', 'multi_image', 'video', 'document', 'article', 'poll'];
export const LI_LIMITS = { commentary: 3000, pollQuestion: 140, pollOption: 30, pollOptionsMin: 2, pollOptionsMax: 4, multiImageMin: 2, multiImageMax: 20 };
export const POLL_DURATIONS = ['ONE_DAY', 'THREE_DAYS', 'SEVEN_DAYS', 'FOURTEEN_DAYS'];
export const VISIBILITY = ['PUBLIC', 'CONNECTIONS', 'LOGGED_IN'];

/**
 * LinkedIn commentary is "little text": reserved characters must be backslash-escaped, and a hashtag must be
 * written as {hashtag|\#|word} or it shows as plain text.
 */
export function toLittleText(text) {
  const escaped = String(text ?? '').replace(/[\\|{}@[\]()<>*_~]/g, (c) => `\\${c}`);
  return escaped.replace(/(^|[^\p{L}\p{N}_\\])#([\p{L}\p{N}_]+)/gu, (_, pre, tag) => `${pre}{hashtag|\\#|${tag}}`)
    .replace(/(^|[^\\{|])#(?![\p{L}\p{N}_])/gu, '$1\\#');
}

function headers(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, 'LinkedIn-Version': apiVersion(), 'X-Restli-Protocol-Version': '2.0.0', ...extra };
}

async function liError(res, step) {
  const json = await res.json().catch(() => ({}));
  const message = json.message || json.error_description || `LinkedIn API request failed (${res.status})`;
  return new PublishError(message, { code: res.status, retryable: res.status === 429 || res.status >= 500, step });
}

export function createLinkedInClient(token, fetchImpl = fetch) {
  const json = async (method, path, body, step) => {
    const res = await fetchImpl(`${REST}${path}`, { method, headers: headers(token, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw await liError(res, step);
    const text = await res.text();
    return { data: text ? JSON.parse(text) : {}, headers: res.headers };
  };
  const put = async (url, bytes, mime, step) => {
    const res = await fetchImpl(url, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime || 'application/octet-stream' }, body: bytes });
    if (!res.ok) throw await liError(res, step);
    return res.headers.get('etag');
  };
  return { json, put };
}

async function uploadImage(client, owner, item, fetchImpl) {
  const { data } = await client.json('POST', '/images?action=initializeUpload', { initializeUploadRequest: { owner } }, 'upload');
  await client.put(data.value.uploadUrl, await fetchBytes(item.url, { fetchImpl }), item.mime, 'upload');
  return data.value.image;
}

async function uploadDocument(client, owner, item, fetchImpl) {
  const { data } = await client.json('POST', '/documents?action=initializeUpload', { initializeUploadRequest: { owner } }, 'upload');
  await client.put(data.value.uploadUrl, await fetchBytes(item.url, { fetchImpl }), item.mime || 'application/pdf', 'upload');
  return data.value.document;
}

async function uploadVideo(client, owner, item, thumbnail, fetchImpl, wait) {
  const bytes = await fetchBytes(item.url, { fetchImpl });
  const { data } = await client.json('POST', '/videos?action=initializeUpload', {
    initializeUploadRequest: { owner, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: Boolean(thumbnail?.url) },
  }, 'upload');
  const v = data.value;
  // LinkedIn splits large videos into parts; each part's ETag proves it arrived.
  const partIds = [];
  for (const part of v.uploadInstructions || []) {
    partIds.push(await client.put(part.uploadUrl, bytes.subarray(part.firstByte, part.lastByte + 1), 'application/octet-stream', 'upload'));
  }
  if (thumbnail?.url && v.thumbnailUploadUrl) await client.put(v.thumbnailUploadUrl, await fetchBytes(thumbnail.url, { fetchImpl }), thumbnail.mime || 'image/jpeg', 'upload');
  await client.json('POST', '/videos?action=finalizeUpload', { finalizeUploadRequest: { video: v.video, uploadToken: v.uploadToken || '', uploadedPartIds: partIds } }, 'upload');
  await pollUntil(async () => {
    const { data: s } = await client.json('GET', `/videos/${encodeURIComponent(v.video)}`, null, 'poll');
    if (s.status === 'AVAILABLE') return true;
    if (s.status === 'PROCESSING_FAILED') throw new PublishError(`LinkedIn could not process the video: ${s.processingFailureReason || 'unknown reason'}`, { code: 422, step: 'poll' });
    return false;
  }, { wait, what: 'LinkedIn video processing' });
  return v.video;
}

/** The post body without content. Pure, so it is unit-tested. */
export function postBody(author, f) {
  return {
    author,
    commentary: toLittleText(f.commentary || ''),
    visibility: VISIBILITY.includes(f.visibility) ? f.visibility : 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: f.lifecycle === 'DRAFT' ? 'DRAFT' : 'PUBLISHED',
    isReshareDisabledByAuthor: Boolean(f.reshare_disabled),
  };
}

export function pollContent(poll = {}) {
  const options = (poll.options || []).map((o) => String(o).trim()).filter(Boolean);
  if (!String(poll.question || '').trim()) throw new PublishError('A poll needs a question.', { code: 400 });
  if (options.length < LI_LIMITS.pollOptionsMin || options.length > LI_LIMITS.pollOptionsMax) throw new PublishError('A poll needs 2 to 4 options.', { code: 400 });
  return { poll: { question: String(poll.question).trim(), options: options.map((text) => ({ text })), settings: { duration: POLL_DURATIONS.includes(poll.duration) ? poll.duration : 'THREE_DAYS' } } };
}

export async function publishLinkedIn({ postType, fields: f }, { account, accessToken }, onStep = () => {}, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const client = deps.client || createLinkedInClient(accessToken, fetchImpl);
  const author = account.member_id;
  const media = (f.media || []).filter(Boolean);
  const body = postBody(author, f);

  onStep('upload');
  if (postType === 'image') {
    if (!media[0]) throw new PublishError('An image post needs one image.', { code: 400 });
    body.content = { media: { id: await uploadImage(client, author, media[0], fetchImpl), altText: media[0].alt_text || undefined } };
  } else if (postType === 'multi_image') {
    if (media.length < LI_LIMITS.multiImageMin) throw new PublishError('A multi-image post needs at least 2 images.', { code: 400 });
    const images = [];
    for (const m of media.slice(0, LI_LIMITS.multiImageMax)) images.push({ id: await uploadImage(client, author, m, fetchImpl), altText: m.alt_text || undefined });
    body.content = { multiImage: { images } };
  } else if (postType === 'video') {
    if (!media[0]) throw new PublishError('A video post needs one video.', { code: 400 });
    onStep('container');
    body.content = { media: { id: await uploadVideo(client, author, media[0], f.thumbnail, fetchImpl, deps.wait), title: f.title || undefined } };
  } else if (postType === 'document') {
    if (!media[0]) throw new PublishError('A document post needs a PDF.', { code: 400 });
    if (!f.document_title) throw new PublishError('A document post needs a title.', { code: 400 });
    body.content = { media: { id: await uploadDocument(client, author, media[0], fetchImpl), title: f.document_title } };
  } else if (postType === 'article') {
    const a = f.article || {};
    if (!a.url) throw new PublishError('An article post needs a link.', { code: 400 });
    const thumbnail = a.thumbnail?.url ? await uploadImage(client, author, a.thumbnail, fetchImpl) : undefined;
    body.content = { article: { source: a.url, title: a.title || a.url, description: a.description || undefined, thumbnail } };
  } else if (postType === 'poll') {
    body.content = pollContent(f.poll);
  } else if (postType !== 'none') {
    throw new PublishError(`Unknown LinkedIn post type "${postType}".`, { code: 400 });
  }
  if (postType === 'none' && !String(f.commentary || '').trim()) throw new PublishError('A text post needs some text.', { code: 400 });

  onStep('publish');
  const { headers: h } = await client.json('POST', '/posts', body, 'publish');
  const urn = h.get('x-restli-id') || h.get('x-linkedin-id');
  return { externalId: urn, permalink: urn && body.lifecycleState === 'PUBLISHED' ? `https://www.linkedin.com/feed/update/${urn}/` : null };
}

import crypto from 'node:crypto';
import { Storage } from '@google-cloud/storage';

/**
 * Google Cloud Storage for post media. The browser uploads straight to the bucket with a signed URL, so large
 * videos never pass through Express. Instagram and Facebook fetch the media from its public URL, so the objects
 * must be publicly readable (bucket-level "allUsers: Storage Object Viewer", or a public prefix).
 */
let storage = null;
const client = () => (storage ??= new Storage());

export const isStorageConfigured = () => Boolean(process.env.GCS_BUCKET);

const bucket = () => {
  if (!isStorageConfigured()) throw Object.assign(new Error('Media storage is not set up on the server (GCS_BUCKET).'), { status: 500 });
  return client().bucket(process.env.GCS_BUCKET);
};

export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024 * 4; // 4 GB (YouTube allows more, but this is plenty for the wizard)

const safeName = (name) => String(name || 'file').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-80) || 'file';

export function objectKey(userId, fileName) {
  const day = new Date().toISOString().slice(0, 10);
  return `posts/${userId}/${day}/${crypto.randomUUID()}-${safeName(fileName)}`;
}

export const publicUrl = (key) => `https://storage.googleapis.com/${process.env.GCS_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;

/** A signed URL the browser PUTs the file to (valid 1 hour). */
export async function signedUploadUrl(key, mime) {
  const [url] = await bucket().file(key).getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + 60 * 60 * 1000,
    contentType: mime,
  });
  return url;
}

/** Size and type of an uploaded object, or null when it is not there. */
export async function objectInfo(key) {
  const [exists] = await bucket().file(key).exists();
  if (!exists) return null;
  const [meta] = await bucket().file(key).getMetadata();
  return { bytes: Number(meta.size), mime: meta.contentType };
}

/** A readable stream of the object, for uploading to LinkedIn and YouTube. */
export const readStream = (key) => bucket().file(key).createReadStream();

export async function readBuffer(key) {
  const [buf] = await bucket().file(key).download();
  return buf;
}

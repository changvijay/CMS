import { completeUpload, startUpload } from '../../services/api';
import type { MediaItem } from './types';

/** Width, height and duration read in the browser, so media rules can be checked before upload finishes. */
export function measure(file: File, previewUrl: string): Promise<{ width?: number; height?: number; duration?: number }> {
  if (file.type.startsWith('image/')) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({});
      img.src = previewUrl;
    });
  }
  if (file.type.startsWith('video/')) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => resolve({ width: v.videoWidth, height: v.videoHeight, duration: Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : undefined });
      v.onerror = () => resolve({});
      v.src = previewUrl;
    });
  }
  return Promise.resolve({});
}

export const kindOf = (mime: string): MediaItem['kind'] => (mime.startsWith('video/') ? 'video' : mime === 'application/pdf' ? 'document' : 'image');

/** PUT with progress events (fetch has no upload progress). */
function putWithProgress(url: string, file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage refused the upload (${xhr.status}). Check the bucket's CORS settings.`)));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and the bucket CORS settings.'));
    xhr.send(file);
  });
}

/**
 * Uploads one file: a placeholder item is reported straight away (so it shows in the list with its preview),
 * then progress, then the ready item with its public URL. `update` always receives the full latest item.
 */
export async function uploadFile(token: string, file: File, update: (item: MediaItem) => void): Promise<MediaItem> {
  const previewUrl = URL.createObjectURL(file);
  let item: MediaItem = { id: `local-${crypto.randomUUID()}`, name: file.name, mime: file.type || 'application/octet-stream', kind: kindOf(file.type), bytes: file.size, previewUrl, status: 'uploading', progress: 0 };
  update(item);
  try {
    const dims = await measure(file, previewUrl);
    item = { ...item, ...dims };
    update(item);
    const started = await startUpload(token, { fileName: file.name, mime: item.mime, bytes: file.size });
    item = { ...item, assetId: started.id };
    update(item);
    await putWithProgress(started.uploadUrl, file, (progress) => update({ ...item, progress }));
    const done = await completeUpload(token, started.id, { width: dims.width, height: dims.height, duration: dims.duration });
    item = { ...item, status: 'ready', progress: 100, url: done.asset.public_url, bytes: Number(done.asset.bytes) || file.size };
  } catch (err) {
    item = { ...item, status: 'error', error: err instanceof Error ? err.message : 'Upload failed' };
  }
  update(item);
  return item;
}

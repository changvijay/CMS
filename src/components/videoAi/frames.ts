import type { Frame } from '../../services/videoAiApi';

/**
 * Still frames from a video, taken in the browser (nothing is uploaded to storage): dense over the first 5 seconds,
 * where the hook lives, then spread over the rest. JPEGs about 512 px wide keep the request small.
 */

const EARLY = [0, 1, 2, 3, 5];
const LATER = 5;
const WIDTH = 512;

function load(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error("This video can't be read in the browser. Try an MP4 (H.264) file."));
    v.src = src;
  });
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { v.removeEventListener('seeked', done); resolve(); };
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

/** The seconds to sample for a video of `duration` seconds. */
export function frameTimes(duration: number): number[] {
  const d = Math.max(0, duration - 0.05);
  const early = EARLY.filter((t) => t < d);
  const start = 6;
  const later = d > start ? Array.from({ length: LATER }, (_, i) => Math.round((start + ((d - start) * (i + 1)) / LATER) * 10) / 10) : [];
  return [...new Set([...early, ...later].map((t) => Math.min(t, d)))];
}

export async function extractFrames(src: string): Promise<{ frames: Frame[]; duration: number; width: number; height: number }> {
  const v = await load(src);
  const duration = Number.isFinite(v.duration) ? v.duration : 0;
  const scale = Math.min(1, WIDTH / (v.videoWidth || WIDTH));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((v.videoWidth || WIDTH) * scale);
  canvas.height = Math.round((v.videoHeight || WIDTH) * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser cannot read video frames.');
  const frames: Frame[] = [];
  for (const t of frameTimes(duration)) {
    await seek(v, t);
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    let url: string;
    try {
      url = canvas.toDataURL('image/jpeg', 0.72);
    } catch {
      throw new Error("This saved video can't be read here. Pick the file again to analyse it.");
    }
    frames.push({ t: Math.round(t * 10) / 10, mime: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) });
  }
  const size = { width: v.videoWidth, height: v.videoHeight };
  v.removeAttribute('src');
  v.load();
  return { frames, duration: Math.round(duration * 10) / 10, ...size };
}

/** The whole file as base64, for providers that watch video (Gemini). Null when it is bigger than `maxMb`. */
export async function videoAsBase64(src: string, maxMb: number): Promise<{ mime: string; data: string } | null> {
  const blob = await (await fetch(src)).blob();
  if (blob.size > maxMb * 1024 * 1024) return null;
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
    r.onerror = () => reject(new Error('Could not read the video file.'));
    r.readAsDataURL(blob);
  });
  return { mime: blob.type || 'video/mp4', data };
}

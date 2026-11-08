import type { Issue, MediaItem, Platform, PostType } from './types';

/**
 * Media specs per platform and post type, checked in the browser before anything is submitted.
 * Sources: each platform's publishing API docs (Instagram Content Publishing, Pages API, LinkedIn Images/Videos/
 * Documents API, YouTube upload limits). Hard limits are errors; "recommended" shapes are warnings.
 */
const MB = 1024 * 1024;

interface Spec {
  formats: string[];          // allowed MIME types (prefix match, e.g. 'video/')
  maxBytes?: number;
  minSeconds?: number;
  maxSeconds?: number;
  minRatio?: number;          // width / height
  maxRatio?: number;
  ratioIsWarning?: boolean;   // outside the range still posts but gets cropped/letterboxed
  minWidth?: number;
  label: string;
}

const IG_IMAGE: Spec = { formats: ['image/jpeg'], maxBytes: 8 * MB, minRatio: 4 / 5, maxRatio: 1.91, minWidth: 320, label: 'Instagram image' };
const IG_REEL: Spec = { formats: ['video/mp4', 'video/quicktime'], maxBytes: 300 * MB, minSeconds: 3, maxSeconds: 15 * 60, minRatio: 0.01, maxRatio: 10, label: 'Instagram reel' };
const IG_CAROUSEL_VIDEO: Spec = { formats: ['video/mp4', 'video/quicktime'], maxBytes: 100 * MB, minSeconds: 3, maxSeconds: 60, minRatio: 4 / 5, maxRatio: 16 / 9, label: 'Instagram carousel video' };
const IG_STORY_IMAGE: Spec = { formats: ['image/jpeg'], maxBytes: 8 * MB, label: 'Instagram story image' };
const IG_STORY_VIDEO: Spec = { formats: ['video/mp4', 'video/quicktime'], maxBytes: 100 * MB, minSeconds: 3, maxSeconds: 60, label: 'Instagram story video' };
const FB_PHOTO: Spec = { formats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], maxBytes: 10 * MB, label: 'Facebook photo' };
const FB_VIDEO: Spec = { formats: ['video/'], maxBytes: 10 * 1024 * MB, maxSeconds: 240 * 60, label: 'Facebook video' };
const FB_REEL: Spec = { formats: ['video/mp4', 'video/quicktime'], maxBytes: 1024 * MB, minSeconds: 3, maxSeconds: 90, minRatio: 9 / 16 - 0.01, maxRatio: 9 / 16 + 0.01, ratioIsWarning: true, minWidth: 540, label: 'Facebook reel' };
const FB_STORY_VIDEO: Spec = { formats: ['video/mp4', 'video/quicktime'], maxBytes: 1024 * MB, minSeconds: 3, maxSeconds: 60, label: 'Facebook story video' };
const LI_IMAGE: Spec = { formats: ['image/jpeg', 'image/png', 'image/gif'], maxBytes: 20 * MB, label: 'LinkedIn image' };
const LI_VIDEO: Spec = { formats: ['video/mp4'], maxBytes: 500 * MB, minSeconds: 3, maxSeconds: 30 * 60, label: 'LinkedIn video' };
const LI_DOC: Spec = { formats: ['application/pdf'], maxBytes: 100 * MB, label: 'LinkedIn document' };
const YT_VIDEO: Spec = { formats: ['video/'], maxBytes: 256 * 1024 * MB, maxSeconds: 12 * 60 * 60, label: 'YouTube video' };
// Shorts must be vertical or square; a wider video uploads as a normal video.
const YT_SHORT: Spec = { formats: ['video/'], maxBytes: 256 * 1024 * MB, maxSeconds: 180, maxRatio: 1, label: 'YouTube Short' };

export const THUMBNAIL_RULES: Partial<Record<Platform, Spec>> = {
  youtube: { formats: ['image/jpeg', 'image/png'], maxBytes: 2 * MB, minRatio: 16 / 9 - 0.02, maxRatio: 16 / 9 + 0.02, ratioIsWarning: true, minWidth: 640, label: 'YouTube thumbnail' },
  instagram: { formats: ['image/jpeg'], maxBytes: 8 * MB, label: 'Instagram reel cover' },
  facebook: { formats: ['image/jpeg', 'image/png'], maxBytes: 10 * MB, label: 'Facebook video thumbnail' },
  linkedin: { formats: ['image/jpeg', 'image/png'], maxBytes: 20 * MB, label: 'LinkedIn thumbnail' },
};

/** The spec for one file in one post type. */
export function specFor(platform: Platform, postType: PostType, item: MediaItem): Spec | null {
  const video = item.kind === 'video';
  switch (`${platform}:${postType}`) {
    case 'instagram:image': return IG_IMAGE;
    case 'instagram:reel': return IG_REEL;
    case 'instagram:carousel': return video ? IG_CAROUSEL_VIDEO : IG_IMAGE;
    case 'instagram:story': return video ? IG_STORY_VIDEO : IG_STORY_IMAGE;
    case 'facebook:photo': case 'facebook:multi_photo': return FB_PHOTO;
    case 'facebook:video': return FB_VIDEO;
    case 'facebook:reel': return FB_REEL;
    case 'facebook:story': return video ? FB_STORY_VIDEO : FB_PHOTO;
    case 'linkedin:image': case 'linkedin:multi_image': return LI_IMAGE;
    case 'linkedin:video': return LI_VIDEO;
    case 'linkedin:document': return LI_DOC;
    case 'youtube:video': return YT_VIDEO;
    case 'youtube:short': return YT_SHORT;
    default: return null;
  }
}

const fmtBytes = (b: number) => (b >= 1024 * MB ? `${(b / 1024 / MB).toFixed(1)} GB` : `${Math.round(b / MB)} MB`);
const fmtSecs = (s: number) => (s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);
const fmtRatio = (r: number) => {
  const known: [number, string][] = [[0.8, '4:5'], [1, '1:1'], [1.91, '1.91:1'], [16 / 9, '16:9'], [9 / 16, '9:16'], [0.01, '1:100'], [10, '10:1']];
  return known.find(([v]) => Math.abs(v - r) < 0.02)?.[1] ?? r.toFixed(2);
};

/** Problems with one file against a spec. */
export function checkFile(item: MediaItem, spec: Spec): Issue[] {
  const issues: Issue[] = [];
  const name = item.name || 'File';
  if (!spec.formats.some((f) => item.mime === f || (f.endsWith('/') && item.mime.startsWith(f)))) {
    issues.push({ level: 'error', message: `${name}: ${spec.label} must be ${spec.formats.map((f) => f.replace('image/', '').replace('video/', '').replace('application/', '').replace('quicktime', 'mov') || 'any video').join(', ').toUpperCase()}.` });
  }
  if (spec.maxBytes && item.bytes > spec.maxBytes) issues.push({ level: 'error', message: `${name}: larger than the ${fmtBytes(spec.maxBytes)} ${spec.label} limit.` });
  const d = item.duration;
  if (d != null && spec.minSeconds && d < spec.minSeconds) issues.push({ level: 'error', message: `${name}: shorter than ${fmtSecs(spec.minSeconds)} (${spec.label}).` });
  if (d != null && spec.maxSeconds && d > spec.maxSeconds) issues.push({ level: 'error', message: `${name}: longer than ${fmtSecs(spec.maxSeconds)} (${spec.label}).` });
  if (item.width && item.height) {
    const r = item.width / item.height;
    if ((spec.minRatio && r < spec.minRatio) || (spec.maxRatio && r > spec.maxRatio)) {
      const range = spec.minRatio && spec.maxRatio && Math.abs(spec.maxRatio - spec.minRatio) < 0.05 ? fmtRatio((spec.minRatio + spec.maxRatio) / 2) : `${fmtRatio(spec.minRatio ?? 0)} to ${fmtRatio(spec.maxRatio ?? 0)}`;
      issues.push({ level: spec.ratioIsWarning ? 'warn' : 'error', message: `${name}: shape ${item.width}×${item.height} is outside ${range} for ${spec.label}${spec.ratioIsWarning ? ' (it will be cropped or letterboxed)' : ''}.` });
    }
    if (spec.minWidth && item.width < spec.minWidth) issues.push({ level: 'warn', message: `${name}: ${item.width}px wide; ${spec.label} looks best at ${spec.minWidth}px or more.` });
  }
  return issues;
}

/** Shorts are vertical (or square) videos up to 3 minutes. */
export const isShortsCandidate = (item: MediaItem | undefined) =>
  Boolean(item && item.kind === 'video' && item.width && item.height && item.height >= item.width && item.duration != null && item.duration <= 180);

export function checkMedia(platform: Platform, postType: PostType, items: MediaItem[]): Issue[] {
  const issues: Issue[] = [];
  for (const item of items) {
    if (item.status === 'uploading') issues.push({ level: 'error', message: `${item.name}: still uploading.` });
    if (item.status === 'error') issues.push({ level: 'error', message: `${item.name}: upload failed${item.error ? ` (${item.error})` : ''}. Remove it and try again.` });
    const spec = specFor(platform, postType, item);
    if (spec) issues.push(...checkFile(item, spec));
  }
  return issues;
}

export function checkThumbnail(platform: Platform, item: MediaItem | null | undefined): Issue[] {
  if (!item) return [];
  const spec = THUMBNAIL_RULES[platform];
  return spec ? checkFile(item, spec) : [];
}

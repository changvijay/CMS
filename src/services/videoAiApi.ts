import { sendJson } from './api';

/** AI video reports (server/routes/videoAi.js). Reading never calls the AI; only update/preupload do. */

export type VideoPlatform = 'instagram' | 'youtube' | 'facebook' | 'linkedin';

export interface Correction { area: string; wrong: string; why: string; fix: string; example: string }

export interface VideoReportBody {
  parsed: boolean;
  score: number | null;
  verdict: string;
  highlights?: string[];
  worked?: string[];
  didnt_work?: string[];
  engagement?: { summary: string; rate_note: string };
  hook?: { score: number | null; notes: string };
  retention?: { available: boolean; summary: string };
  reasons_underperformed?: string[];
  comparison?: { summary: string; vs_median: string[] };
  next_video?: string[];
  /** What is wrong, why, how to fix it, and a sample to copy. */
  corrections?: Correction[];
  action_steps?: { views: string[]; reach: string[]; engagement: string[]; growth: string[] };
  first_seconds?: Record<'hook' | 'opening' | 'pacing' | 'captions' | 'storytelling' | 'quality', string>;
  watched_video?: boolean;
}

/** The numbers the AI was given (published reports). Shape follows server/services/videoAnalysis.js. */
export interface PublishedMetrics {
  platform: VideoPlatform;
  video: { id: string; title: string | null; type: string | null; permalink: string | null; published_at: string | null; age_days: number | null };
  metrics: Record<string, number | null>;
  growth?: { date: string; views: number | null }[];
  retention_curve_pct?: Record<string, number | null>;
  comparison?: {
    compared_with: number;
    median: Record<string, number>;
    best: { title: string | null; views: number | null; engagement_rate_pct: number | null };
    rank_by_views?: number;
    vs_median?: Record<string, { this: number; median: number }>;
  } | null;
  unavailable: { metric: string; reason: string }[];
}

export interface VideoReport {
  id: string;
  kind: 'published' | 'preupload';
  platform: VideoPlatform | null;
  account_id: string | null;
  media_id: string | null;
  title: string | null;
  thumbnail_url: string | null;
  provider: string;
  model: string;
  score: number | null;
  report: VideoReportBody;
  metrics_used: (PublishedMetrics & Record<string, unknown>) | null;
  created_at: string;
}

export interface ReportHistoryItem { id: string; score: number | null; created_at: string; provider: string }

export interface VideoAiCapabilities {
  provider: string | null;
  model: string | null;
  ready_providers: string[];
  sees_images: string[];
  watches_video: string[];
  max_video_mb: number;
}

export interface RecentReport {
  id: string; kind: 'published' | 'preupload'; platform: VideoPlatform | null; account_id: string | null; media_id: string | null;
  title: string | null; thumbnail_url: string | null; provider: string; score: number | null; verdict: string | null; created_at: string;
}

export interface Frame { t: number; mime: string; data: string }

export interface PreUploadInput {
  frames: Frame[];
  video?: { mime: string; data: string } | null;
  durationSec?: number | null;
  width?: number | null;
  height?: number | null;
  title?: string;
  caption?: string;
  platforms?: VideoPlatform[];
  scriptId?: string | null;
  fileName?: string;
  provider?: string;
}

const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

export const getVideoAiCapabilities = (token: string) => sendJson<VideoAiCapabilities>(token, 'GET', 'video-ai/capabilities');
export const getVideoReport = (token: string, platform: VideoPlatform, accountId: string, mediaId: string) =>
  sendJson<{ report: VideoReport | null; history: ReportHistoryItem[] }>(token, 'GET', `video-ai/reports?${qs({ platform, accountId, mediaId })}`);
export const getVideoReportById = async (token: string, id: string) => (await sendJson<{ report: VideoReport }>(token, 'GET', `video-ai/reports/${encodeURIComponent(id)}`)).report;
export const listRecentReports = async (token: string) => (await sendJson<{ reports: RecentReport[] }>(token, 'GET', 'video-ai/reports/recent')).reports;
export const updateVideoReport = (token: string, platform: VideoPlatform, accountId: string, mediaId: string, provider?: string) =>
  sendJson<{ report: VideoReport; sync_error: { message: string } | null }>(token, 'POST', 'video-ai/published/update', { platform, accountId, mediaId, provider });
export const analyzeBeforeUpload = async (token: string, input: PreUploadInput) => (await sendJson<{ report: VideoReport }>(token, 'POST', 'video-ai/preupload', input)).report;

/** The page for one published video's report. */
export const reportPath = (platform: string, accountId: string | number, mediaId: string) =>
  `/analysis/${platform}/${encodeURIComponent(String(accountId))}/${encodeURIComponent(mediaId)}`;

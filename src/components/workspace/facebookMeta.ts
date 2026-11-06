import type { FacebookMetric } from '../../services/api';

export interface FbMetricInfo {
  key: FacebookMetric;
  label: string;
  help: string;
  lowerIsBetter?: boolean;
}

export const FB_METRICS: Record<FacebookMetric, FbMetricInfo> = {
  views: { key: 'views', label: 'Views', help: 'How many times your Page and its posts, reels and stories were seen. Repeat views count.' },
  reach: { key: 'reach', label: 'Reach', help: 'How many different people saw your content each day, added up over the range (a person seen on two days counts twice).' },
  engagements: { key: 'engagements', label: 'Engagements', help: 'Reactions, comments, shares and clicks on your posts.' },
  reactions: { key: 'reactions', label: 'Reactions', help: 'Likes, loves, wows and the other reactions on your posts.' },
  follows: { key: 'follows', label: 'New follows', help: 'People who started following your Page.' },
  unfollows: { key: 'unfollows', label: 'Unfollows', help: 'People who stopped following your Page.', lowerIsBetter: true },
  followers_total: { key: 'followers_total', label: 'Total followers', help: 'Followers at the end of each day.' },
  page_visits: { key: 'page_visits', label: 'Page visits', help: 'How many times your Page profile was opened.' },
  actions: { key: 'actions', label: 'Actions on Page', help: 'Clicks on your contact info and call-to-action button (website, call, directions, message).' },
  new_conversations: { key: 'new_conversations', label: 'New conversations', help: 'People who started a Messenger conversation with your Page.' },
  video_views: { key: 'video_views', label: 'Video views', help: 'Views of 3 seconds or more on your Page’s videos and reels.' },
  video_views_organic: { key: 'video_views_organic', label: 'Organic video views', help: 'Video views that did not come from ads.' },
  video_views_paid: { key: 'video_views_paid', label: 'Paid video views', help: 'Video views that came from ads.' },
  video_autoplayed: { key: 'video_autoplayed', label: 'Autoplayed', help: 'Video views that started on their own in the feed.' },
  video_click_to_play: { key: 'video_click_to_play', label: 'Click to play', help: 'Video views where the person pressed play.' },
  video_complete_30s: { key: 'video_complete_30s', label: '30-second views', help: 'Views that lasted at least 30 seconds (or the whole video if shorter).' },
  video_repeat_views: { key: 'video_repeat_views', label: 'Repeat views', help: 'Views by people who had already watched the video.' },
  watch_minutes: { key: 'watch_minutes', label: 'Minutes watched', help: 'Total time people spent watching your videos and reels.' },
};

/** Metrics you can plot on the daily chart, in menu order. */
export const CHARTABLE: FacebookMetric[] = [
  'views', 'reach', 'engagements', 'reactions', 'page_visits', 'actions', 'follows', 'unfollows', 'followers_total',
  'new_conversations', 'video_views', 'watch_minutes', 'video_complete_30s',
];

export const REACTION_LABEL: Record<string, string> = {
  like: 'Like', love: 'Love', wow: 'Wow', haha: 'Haha', sorry: 'Sad', anger: 'Angry', care: 'Care',
  REACTION_LIKE: 'Like', REACTION_LOVE: 'Love', REACTION_WOW: 'Wow', REACTION_HAHA: 'Haha', REACTION_SORRY: 'Sad', REACTION_ANGER: 'Angry', REACTION_CARE: 'Care',
};

const POST_TYPE_LABEL: Record<string, string> = {
  added_video: 'Video',
  added_photos: 'Photo',
  mobile_status_update: 'Text',
  shared_story: 'Shared link',
  created_note: 'Note',
  created_event: 'Event',
  published_story: 'Story',
  wall_post: 'Post',
};

export const postTypeLabel = (type: string | null) => (type ? POST_TYPE_LABEL[type] ?? type.replace(/_/g, ' ') : 'Post');

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Weekday (0 = Sunday) of an ISO time in India time. */
export function istWeekday(iso: string): number {
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000);
  return d.getUTCDay();
}

/** Hour (0-23) of an ISO time in India time. */
export function istHour(iso: string): number {
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000);
  return d.getUTCHours();
}

export const ratio = (a: number | null | undefined, b: number | null | undefined) => (a && b ? Math.round((a / b) * 1000) / 10 : null);

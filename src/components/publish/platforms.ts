import type { Platform, PostType } from './types';

/** Everything the wizard knows about each platform: names, post types and text limits. */
export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook Page',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
};

export const PLATFORM_BLURB: Record<Platform, string> = {
  instagram: 'Image, carousel, reel or story',
  facebook: 'Text, link, photos, video, reel or story',
  linkedin: 'Personal profile or company page',
  youtube: 'Video upload, Shorts included',
};

export const PLATFORM_ORDER: Platform[] = ['instagram', 'facebook', 'linkedin', 'youtube'];

export interface PostTypeInfo {
  id: PostType;
  label: string;
  hint: string;
  /** What media the type takes: none, exactly one image/video/pdf, or a list. */
  media: 'none' | 'optional' | 'image' | 'video' | 'image_or_video' | 'images' | 'mixed' | 'pdf';
  min?: number;
  max?: number;
}

export const POST_TYPES: Record<Platform, PostTypeInfo[]> = {
  instagram: [
    { id: 'image', label: 'Image', hint: 'One photo in the feed', media: 'image', min: 1, max: 1 },
    { id: 'carousel', label: 'Carousel', hint: '2 to 10 photos or videos', media: 'mixed', min: 2, max: 10 },
    { id: 'reel', label: 'Reel', hint: 'One vertical video', media: 'video', min: 1, max: 1 },
    { id: 'story', label: 'Story', hint: 'One photo or video for 24 hours', media: 'image_or_video', min: 1, max: 1 },
  ],
  facebook: [
    { id: 'text', label: 'Text', hint: 'A status update', media: 'none' },
    { id: 'link', label: 'Link', hint: 'Shares a link with its preview card', media: 'none' },
    { id: 'photo', label: 'Photo', hint: 'One photo', media: 'image', min: 1, max: 1 },
    { id: 'multi_photo', label: 'Multi-photo', hint: '2 or more photos in one post', media: 'images', min: 2, max: 30 },
    { id: 'video', label: 'Video', hint: 'A regular page video', media: 'video', min: 1, max: 1 },
    { id: 'reel', label: 'Reel', hint: 'Short vertical video (3 to 90 seconds)', media: 'video', min: 1, max: 1 },
    { id: 'story', label: 'Story', hint: 'One photo or video for 24 hours', media: 'image_or_video', min: 1, max: 1 },
  ],
  linkedin: [
    { id: 'none', label: 'Text only', hint: 'Just the post text', media: 'none' },
    { id: 'image', label: 'Image', hint: 'One image', media: 'image', min: 1, max: 1 },
    { id: 'multi_image', label: 'Multi-image', hint: '2 to 20 images', media: 'images', min: 2, max: 20 },
    { id: 'video', label: 'Video', hint: 'One video', media: 'video', min: 1, max: 1 },
    { id: 'document', label: 'Document', hint: 'A PDF shown as a swipeable document', media: 'pdf', min: 1, max: 1 },
    { id: 'article', label: 'Article', hint: 'A link with a title, description and thumbnail', media: 'none' },
    { id: 'poll', label: 'Poll', hint: 'A question with 2 to 4 options', media: 'none' },
  ],
  youtube: [
    { id: 'video', label: 'Video', hint: 'Vertical videos of 3 minutes or less become Shorts', media: 'video', min: 1, max: 1 },
  ],
};

export const defaultPostType = (p: Platform): PostType => POST_TYPES[p][0].id;
export const postTypeInfo = (p: Platform, t: PostType) => POST_TYPES[p].find((x) => x.id === t) ?? POST_TYPES[p][0];

/** Character limits (counted as the platforms count them: by characters, not bytes). */
export const LIMITS = {
  igCaption: 2200,
  igHashtags: 30,
  igMentions: 20,
  igCollaborators: 3,
  fbMessage: 63206,
  liCommentary: 3000,
  liPollQuestion: 140,
  liPollOption: 30,
  liDocumentTitle: 400,
  liArticleTitle: 400,
  liArticleDescription: 4086,
  ytTitle: 100,
  ytDescription: 5000,
  ytTags: 500,
  dmText: 1000,
  publicReply: 300,
};

/** Facebook schedules natively 10 minutes to 30 days ahead; YouTube via publishAt. Everything else uses our queue. */
export const FB_NATIVE_SCHEDULE: PostType[] = ['text', 'link', 'photo', 'multi_photo', 'video', 'reel'];
export const nativelyScheduled = (p: Platform, t: PostType) => p === 'youtube' || (p === 'facebook' && FB_NATIVE_SCHEDULE.includes(t));

export const YT_LANGUAGES: { code: string; label: string }[] = [
  { code: '', label: 'Not set' },
  { code: 'ta', label: 'Tamil' },
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'te', label: 'Telugu' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'kn', label: 'Kannada' },
  { code: 'bn', label: 'Bengali' },
  { code: 'mr', label: 'Marathi' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'ar', label: 'Arabic' },
  { code: 'ja', label: 'Japanese' },
];

/**
 * Facebook audience locales use numeric ids. Two well-known ones are offered as shortcuts; any other id can be typed
 * (look it up with the Marketing API's targeting search, type=adlocale).
 */
export const FB_LOCALES: { id: number; label: string }[] = [
  { id: 6, label: 'English (US)' },
  { id: 24, label: 'English (UK)' },
];

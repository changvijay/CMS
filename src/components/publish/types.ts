/** Shared types for the Social Post wizard. */
export type Platform = 'instagram' | 'facebook' | 'linkedin' | 'youtube';

export type IgType = 'image' | 'carousel' | 'reel' | 'story';
export type FbType = 'text' | 'link' | 'photo' | 'multi_photo' | 'video' | 'reel' | 'story';
export type LiType = 'none' | 'image' | 'multi_image' | 'video' | 'document' | 'article' | 'poll';
export type YtType = 'video';
export type PostType = IgType | FbType | LiType | YtType;

/** One uploaded (or uploading) file. `url` is the public storage link once the upload has finished. */
export interface MediaItem {
  /** Stable id for the list (set when the file is picked); `assetId` is the stored file's id on the server. */
  id: string;
  assetId?: string;
  name: string;
  mime: string;
  kind: 'image' | 'video' | 'document';
  bytes: number;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  url?: string;
  previewUrl?: string;
  status: 'uploading' | 'ready' | 'error';
  progress?: number;
  error?: string;
}

export interface Place {
  id: string;
  name: string;
  detail?: string;
}

/** Filled once at the top of step 3; flows into every platform tab. */
export interface SharedFields {
  title: string;
  description: string;
  hashtags: string[];
  keywords: string[];
  media: MediaItem[];
  thumbnail: MediaItem | null;
  link: string;
  location: Place | null;
  scheduleAt: string; // local "YYYY-MM-DDTHH:mm" from the date-time picker, '' when not scheduled
}

export interface UserTag {
  username: string;
  x?: number;
  y?: number;
}

/** Per-file settings that belong to one platform (alt text, Instagram people tags). */
export interface PerMedia {
  alt_text?: string;
  user_tags?: UserTag[];
}

/**
 * One platform tab. Synced fields are not stored: they are derived from the shared fields until the user
 * edits them here, which copies the value into `values` and adds the key to `unlinked`.
 */
export interface PlatformDraft {
  postType: PostType;
  values: Record<string, unknown>;
  unlinked: string[];
  perMedia: Record<string, PerMedia>;
}

export interface DmButton {
  title: string;
  url: string;
}

export interface AutoReplySettings {
  enabled: boolean;
  trigger: 'any' | 'keywords';
  keywords: string[];
  public_replies: string[];
  send_dm: boolean;
  dm_text: string;
  link_url: string;
  dm_buttons: DmButton[];
  quick_replies: string[];
  require_follow: boolean;
  active_from: string;
  active_until: string;
  disclose_automation: boolean;
}

export type StepId = 'platforms' | 'accounts' | 'content' | 'autoreply' | 'review';

export interface WizardState {
  step: StepId;
  platforms: Platform[];
  accounts: Partial<Record<Platform, string[]>>;
  shared: SharedFields;
  drafts: Partial<Record<Platform, PlatformDraft>>;
  autoReply: AutoReplySettings;
  activeTab?: Platform;
  /** "platform:id" -> display name, kept so the progress page can name accounts without reloading them. */
  accountNames?: Record<string, string>;
}

export interface PublishAccount {
  id: string;
  platform: Platform;
  name: string;
  handle: string | null;
  avatar: string | null;
  type: string;
  tokenStatus: 'ok' | 'expired' | 'missing_scope' | 'error';
  tokenMessage: string | null;
  reconnect?: 'instagram' | 'facebook' | 'linkedin' | 'linkedin_person' | 'youtube';
  igLinked?: boolean;
}

export interface Issue {
  level: 'error' | 'warn' | 'info';
  message: string;
}

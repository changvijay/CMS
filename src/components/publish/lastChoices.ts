import { emptyDraft } from './mapping';
import type { AutoReplySettings, Platform, PlatformDraft, WizardState } from './types';

/**
 * Remembers what the user picked on their last published post (platforms, accounts, post types, options like
 * "Trial reel" or "Not made for kids", and the schedule time) so the next new post starts with the same choices.
 * Only settings are kept: text, media and tags are always new for each post.
 */

const KEY = 'publish:lastChoices:v1';

/** Settings worth repeating, per platform. Everything else on a tab is content for that one post. */
const SETTINGS: Record<Platform, string[]> = {
  instagram: ['share_to_feed', 'trial', 'trial_graduation', 'collaborators'],
  facebook: ['published', 'targeting', 'feed_targeting'],
  linkedin: ['visibility', 'reshare_disabled', 'lifecycle'],
  youtube: ['category_id', 'privacy', 'made_for_kids', 'embeddable', 'license', 'public_stats_viewable', 'default_language', 'playlist_id', 'notify_subscribers'],
};

export interface LastChoices {
  platforms: Platform[];
  accounts: Partial<Record<Platform, string[]>>;
  drafts: Partial<Record<Platform, Pick<PlatformDraft, 'postType' | 'values'>>>;
  autoReply?: Partial<AutoReplySettings>;
  /** "HH:mm" of the last scheduled post, or '' when it was published right away. */
  scheduleTime: string;
}

export function readLastChoices(): LastChoices | null {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && Array.isArray(parsed.platforms) ? parsed : null;
  } catch {
    return null;
  }
}

/** Called after a post is submitted. Platforms not used this time keep their earlier settings. */
export function rememberChoices(state: WizardState): void {
  const prev = readLastChoices();
  const drafts = { ...(prev?.drafts ?? {}) };
  for (const p of state.platforms) {
    const d = state.drafts[p] ?? emptyDraft(p);
    const values: Record<string, unknown> = {};
    for (const k of SETTINGS[p]) if (k in d.values) values[k] = d.values[k];
    drafts[p] = { postType: d.postType, values };
  }
  // Dates are tied to one post, so the auto-reply window is not repeated.
  const autoReply: Partial<AutoReplySettings> = { ...state.autoReply };
  delete autoReply.active_from;
  delete autoReply.active_until;
  const next: LastChoices = {
    platforms: state.platforms,
    accounts: { ...(prev?.accounts ?? {}), ...state.accounts },
    drafts,
    autoReply: state.platforms.includes('instagram') ? autoReply : prev?.autoReply,
    scheduleTime: state.shared.scheduleAt ? state.shared.scheduleAt.slice(11, 16) : '',
  };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full or blocked: nothing to remember */ }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The next time "HH:mm" comes round at least 15 minutes from now, as a date-time picker value. */
export function nextAt(time: string, now = new Date()): string {
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  const at = new Date(now);
  at.setHours(h, m, 0, 0);
  if (at.getTime() - now.getTime() < 15 * 60 * 1000) at.setDate(at.getDate() + 1);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** A new post's starting state, filled with the last choices. */
export function applyLastChoices(base: WizardState, last: LastChoices | null = readLastChoices()): WizardState {
  if (!last) return base;
  const drafts: WizardState['drafts'] = {};
  for (const [p, d] of Object.entries(last.drafts) as [Platform, LastChoices['drafts'][Platform]][]) {
    if (d) drafts[p] = { ...emptyDraft(p), postType: d.postType, values: { ...d.values } };
  }
  return {
    ...base,
    platforms: last.platforms,
    accounts: { ...last.accounts },
    drafts,
    autoReply: { ...base.autoReply, ...last.autoReply },
    shared: { ...base.shared, scheduleAt: last.scheduleTime ? nextAt(last.scheduleTime) : '' },
  };
}

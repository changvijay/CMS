import { fieldState, resetField, setField } from '../mapping';
import type { PerMedia, Platform, PlatformDraft, PostType, PublishAccount, SharedFields } from '../types';

export interface TabProps {
  token: string;
  draft: PlatformDraft;
  shared: SharedFields;
  accounts: PublishAccount[];
  onDraft: (d: PlatformDraft) => void;
}

/** Field access for one platform tab: read a field (synced or not), change it, reset it, set per-file settings. */
export function useTab(platform: Platform, { draft, shared, onDraft }: Pick<TabProps, 'draft' | 'shared' | 'onDraft'>) {
  const field = <T,>(key: string) => {
    const s = fieldState<T>(platform, draft, shared, key);
    return {
      ...s,
      set: (value: T) => onDraft(setField(platform, draft, key, value)),
      reset: () => onDraft(resetField(draft, key)),
      /** Props for <Field>/<TextField> that show the Synced badge and Reset link. */
      sync: { synced: s.synced, syncable: s.syncable, onReset: () => onDraft(resetField(draft, key)), warning: s.warning },
    };
  };
  const perMedia = (id: string) => draft.perMedia[id] ?? {};
  const setPerMedia = (id: string, patch: PerMedia) => onDraft({ ...draft, perMedia: { ...draft.perMedia, [id]: { ...draft.perMedia[id], ...patch } } });
  const setType = (postType: PostType) => onDraft({ ...draft, postType });
  return { field, perMedia, setPerMedia, setType, type: draft.postType };
}

import { useState } from 'react';
import { getConnectUrl } from '../../services/api';
import type { AutoReplySettings, MediaItem, StepId, WizardState } from './types';

/** Small shared helpers for the wizard (kept out of component files so fast refresh works). */
export const timezoneName = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const mediaSrc = (m: MediaItem) => m.url || m.previewUrl || '';

export const stepsFor = (s: Pick<WizardState, 'platforms'>): StepId[] =>
  ['platforms', 'accounts', 'content', ...(s.platforms.includes('instagram') ? ['autoreply' as const] : []), 'review'];

export const defaultAutoReply = (): AutoReplySettings => ({
  enabled: false,
  trigger: 'keywords',
  keywords: [],
  public_replies: ['Sent you a DM {username} 📩', 'Check your DMs {username}!', 'Done {username}, look in your inbox 🙌'],
  send_dm: true,
  dm_text: 'Hi {username}! Here is the link you asked for 👇',
  link_url: '',
  dm_buttons: [],
  quick_replies: [],
  require_follow: false,
  active_from: '',
  active_until: '',
  disclose_automation: true,
});

export type ConnectKind = 'facebook' | 'youtube' | 'linkedin' | 'linkedin_person';

/** Starts a "Connect …" sign-in and comes back to this wizard. Saves the draft first so nothing is lost. */
export function useConnect(token: string, beforeLeave: () => Promise<string | null>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const connect = async (kind: ConnectKind) => {
    setBusy(true);
    setError(null);
    try {
      const id = await beforeLeave();
      window.location.href = await getConnectUrl(token, kind, id ? `/publish/${id}` : '/publish');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start sign-in');
      setBusy(false);
    }
  };
  return { connect, error, busy };
}

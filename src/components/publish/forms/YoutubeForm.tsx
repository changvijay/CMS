import { useEffect, useState } from 'react';
import { getYoutubeCategories, getYoutubePlaylists } from '../../../services/api';
import { ChipsInput, Field, MediaPicker, Segmented, Select, SingleMedia, TextField, Toggle } from '../fields';
import { LIMITS, POST_TYPES, YT_LANGUAGES } from '../platforms';
import { mediaForType, youtubeTagCost } from '../mapping';
import { isShortsCandidate } from '../mediaRules';
import { useTab, type TabProps } from './useTab';
import type { MediaItem, YtType } from '../types';

// Used until the live list loads (or if it can't): YouTube's long-standing category ids.
const FALLBACK_CATEGORIES = [
  { id: '22', title: 'People & Blogs' }, { id: '27', title: 'Education' }, { id: '25', title: 'News & Politics' },
  { id: '28', title: 'Science & Technology' }, { id: '24', title: 'Entertainment' }, { id: '26', title: 'Howto & Style' },
];

export function YoutubeForm(props: TabProps) {
  const { token, accounts, shared } = props;
  const { field, setType, type } = useTab('youtube', props);
  const isShort = type === 'short';
  const title = field<string>('title');
  const description = field<string>('description');
  const tags = field<string[]>('tags');
  const media = field<MediaItem[]>('media');
  const thumbnail = field<MediaItem | null>('thumbnail');
  const kids = field<boolean | null>('made_for_kids');
  const [categories, setCategories] = useState(FALLBACK_CATEGORIES);
  const [playlists, setPlaylists] = useState<{ id: string; title: string }[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const accountId = accounts[0]?.id;

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    Promise.all([getYoutubeCategories(token, accountId), getYoutubePlaylists(token, accountId)])
      .then(([c, p]) => { if (!cancelled) { if (c.categories.length) setCategories(c.categories); setPlaylists(p.playlists); } })
      .catch((err) => { if (!cancelled) setLookupError(err instanceof Error ? err.message : 'Could not load categories and playlists'); });
    return () => { cancelled = true; };
  }, [token, accountId]);

  const video = mediaForType('youtube', type, media.value || [])[0];
  const tagCost = youtubeTagCost(tags.value || []);

  return (
    <div className="pf-form">
      <Field label="Post type" tip="Choose this first: Shorts and full videos have different rules.">
        <Segmented<YtType> label="YouTube post type" value={type as YtType} onChange={setType} options={POST_TYPES.youtube.map((t) => ({ value: t.id as YtType, label: t.label, hint: t.hint }))} />
      </Field>

      <Field label={isShort ? 'Short video (vertical, up to 3 min)' : 'Video file'} {...media.sync}>
        <MediaPicker token={token} value={media.value || []} onChange={media.set} accept="video/*" single label={isShort ? 'Add the Short' : 'Add the video'} />
      </Field>
      {isShort
        ? <p className="pf-note">YouTube makes a video a Short when it is vertical (or square) and 3 minutes or less. #Shorts is added to the title for you if it is missing.</p>
        : isShortsCandidate(video) && <p className="pf-note">This video is vertical and {Math.round(video?.duration ?? 0)} seconds long, so YouTube will show it as a Short. Switch the post type to Short if that is what you want.</p>}

      <TextField label="Title" value={title.value || ''} onChange={title.set} limit={LIMITS.ytTitle} {...title.sync} tip="Up to 100 characters. No < or >." />
      <TextField label="Description" multiline rows={8} value={description.value || ''} onChange={description.set} limit={LIMITS.ytDescription} {...description.sync}
        tip="Up to 5,000 characters. The shared link and hashtags are added at the end. The first 3 hashtags show above the title." />
      <Field label="Tags" count={tagCost} limit={LIMITS.ytTags} {...tags.sync} tip="Help search find typos and spelling variants. YouTube counts all tags together toward 500 characters.">
        <ChipsInput value={tags.value || []} onChange={tags.set} placeholder="tag, then Enter" />
      </Field>
      {!isShort && (
        <Field label="Custom thumbnail" {...thumbnail.sync} tip="JPG or PNG, under 2 MB, 1280×720 recommended. Your channel must be verified to use custom thumbnails.">
          <SingleMedia token={token} value={thumbnail.value} onChange={thumbnail.set} label="Upload a thumbnail" />
        </Field>
      )}

      {lookupError && <p className="pf-hint">{lookupError}</p>}
      <div className="pf-grid2">
        <Field label="Category">
          <Select value={String(field('category_id').value)} onChange={(v) => field('category_id').set(v)} options={categories.map((c) => ({ value: c.id, label: c.title }))} />
        </Field>
        <Field label="Playlist">
          <Select value={String(field('playlist_id').value ?? '')} onChange={(v) => field('playlist_id').set(v)} options={[{ value: '', label: 'None' }, ...playlists.map((p) => ({ value: p.id, label: p.title }))]} />
        </Field>
        <Field label="Visibility" tip={shared.scheduleAt ? 'Scheduled videos upload as private and YouTube makes them public at the scheduled time.' : undefined}>
          {shared.scheduleAt
            ? <p className="pf-hint">Private until the scheduled time, then public.</p>
            : <Segmented label="YouTube privacy" value={String(field('privacy').value) as 'public' | 'unlisted' | 'private'} onChange={(v) => field('privacy').set(v)} options={[{ value: 'public', label: 'Public' }, { value: 'unlisted', label: 'Unlisted' }, { value: 'private', label: 'Private' }]} />}
        </Field>
        <Field label="Video language">
          <Select value={String(field('default_language').value ?? '')} onChange={(v) => field('default_language').set(v)} options={YT_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />
        </Field>
      </div>

      <Field label="Is this video made for kids?" tip="Required by law (COPPA). Made-for-kids videos have comments and personalised ads turned off." error={kids.value === null || kids.value === undefined ? 'Choose one.' : null}>
        <Segmented label="Made for kids" value={kids.value === true ? 'yes' : kids.value === false ? 'no' : ''} onChange={(v) => kids.set(v === 'yes')} options={[{ value: 'no', label: 'No, not made for kids' }, { value: 'yes', label: 'Yes, made for kids' }]} />
      </Field>

      <details className="pf-advanced">
        <summary>More options</summary>
        <Field label="License">
          <Select value={String(field('license').value)} onChange={(v) => field('license').set(v)} options={[{ value: 'youtube', label: 'Standard YouTube License' }, { value: 'creativeCommon', label: 'Creative Commons - Attribution' }]} />
        </Field>
        <Toggle label="Allow embedding" checked={field<boolean>('embeddable').value !== false} onChange={(v) => field('embeddable').set(v)} />
        <Toggle label="Show the view count publicly" checked={field<boolean>('public_stats_viewable').value !== false} onChange={(v) => field('public_stats_viewable').set(v)} />
        <Toggle label="Notify subscribers" checked={field<boolean>('notify_subscribers').value !== false} onChange={(v) => field('notify_subscribers').set(v)} tip="Off uploads quietly (useful for many uploads in a row)." />
      </details>
    </div>
  );
}

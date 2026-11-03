import { useId } from 'react';
import { ChipsInput, Field, MediaPicker, PlaceSearch, Segmented, SingleMedia, TextField, TextInput, Toggle } from '../fields';
import { FB_LOCALES, LIMITS, POST_TYPES } from '../platforms';
import { mediaForType } from '../mapping';
import { useTab, type TabProps } from './useTab';
import type { FbType, MediaItem, Place } from '../types';

interface Audience { countries: string[]; age_min: string; age_max: string; locales: number[] }

function AudienceFields({ value, onChange }: { value: Partial<Audience> | undefined; onChange: (a: Audience) => void }) {
  const a: Audience = { countries: [], age_min: '', age_max: '', locales: [], ...(value ?? {}) };
  return (
    <div className="pf-grid2">
      <Field label="Countries" tip="Two-letter country codes, e.g. IN, US, AE.">
        <ChipsInput value={a.countries} onChange={(countries) => onChange({ ...a, countries: countries.map((c) => c.toUpperCase().slice(0, 2)) })} placeholder="IN, then Enter" />
      </Field>
      <Field label="Languages (locale ids)" tip="Facebook's numeric locale ids. 6 = English (US), 24 = English (UK). Other ids: Marketing API targeting search (type=adlocale).">
        <ChipsInput value={a.locales.map(String)} onChange={(l) => onChange({ ...a, locales: l.map(Number).filter(Number.isFinite) })} placeholder="6, then Enter" />
        <div className="pf-chip-suggest">
          {FB_LOCALES.filter((l) => !a.locales.includes(l.id)).map((l) => <button key={l.id} type="button" onClick={() => onChange({ ...a, locales: [...a.locales, l.id] })}>+ {l.label}</button>)}
        </div>
      </Field>
      <Field label="Minimum age">
        <TextInput type="number" value={a.age_min} onChange={(age_min) => onChange({ ...a, age_min })} placeholder="13" />
      </Field>
      <Field label="Maximum age">
        <TextInput type="number" value={a.age_max} onChange={(age_max) => onChange({ ...a, age_max })} placeholder="65" />
      </Field>
    </div>
  );
}

export function FacebookForm(props: TabProps) {
  const { token, shared } = props;
  const { field, perMedia, setPerMedia, setType, type } = useTab('facebook', props);
  const placeId = useId();
  const message = field<string>('message');
  const link = field<string>('link');
  const media = field<MediaItem[]>('media');
  const thumbnail = field<MediaItem | null>('thumbnail');
  const place = field<Place | null>('place');
  const title = field<string>('title');
  const description = field<string>('description');
  const tags = field<string[]>('tags');
  const published = field<boolean>('published');
  const targeting = field<Audience>('targeting');
  const feedTargeting = field<Audience>('feed_targeting');
  const hasMedia = !['text', 'link'].includes(type);
  const used = mediaForType('facebook', type, media.value || []);
  const accept = ['video', 'reel'].includes(type) ? 'video/*' : type === 'story' ? 'image/*,video/*' : 'image/jpeg,image/png,image/gif,image/webp';

  return (
    <div className="pf-form">
      <Field label="Post type" tip="Choose this first: each type supports different fields.">
        <Segmented<FbType> label="Facebook post type" value={type as FbType} onChange={setType} options={POST_TYPES.facebook.map((t) => ({ value: t.id as FbType, label: t.label, hint: t.hint }))} />
      </Field>

      {type === 'story' ? (
        <p className="pf-note">Facebook stories have no text and cannot be scheduled by Facebook, so a scheduled story is posted by this app at the chosen time.</p>
      ) : (
        <TextField label={type === 'photo' ? 'Caption' : 'Message'} multiline rows={6} value={message.value || ''} onChange={message.set} limit={LIMITS.fbMessage} {...message.sync} />
      )}

      {type === 'link' && <TextField label="Link" value={link.value || ''} onChange={link.set} placeholder="https://…" {...link.sync} tip="Facebook builds the preview card from the page's title and image." />}

      {hasMedia && (
        <Field label={type === 'multi_photo' ? 'Photos (in order)' : 'Media'} {...media.sync}>
          <MediaPicker token={token} value={media.value || []} onChange={media.set} accept={accept} />
        </Field>
      )}
      {['photo', 'multi_photo'].includes(type) && used.map((m) => (
        <Field key={m.id} label={`Alt text · ${m.name}`} tip="Describes the photo for screen readers. Without it Facebook writes one automatically.">
          <TextInput value={perMedia(m.id).alt_text || ''} onChange={(alt_text) => setPerMedia(m.id, { alt_text })} />
        </Field>
      ))}

      {['video', 'reel'].includes(type) && <TextField label="Video title" value={title.value || ''} onChange={title.set} {...title.sync} />}
      {type === 'video' && (
        <>
          <TextField label="Video description" multiline value={description.value || ''} onChange={description.set} {...description.sync} tip="Shown under the video. Leave it synced to reuse the shared description." />
          <Field label="Thumbnail" {...thumbnail.sync}>
            <SingleMedia token={token} value={thumbnail.value} onChange={thumbnail.set} label="Upload a thumbnail" />
          </Field>
        </>
      )}

      {type !== 'story' && (
        <>
          <Field label="Place" htmlFor={placeId} tip="Checks the post in at a place." {...place.sync}>
            <PlaceSearch id={placeId} token={token} value={place.value} onChange={place.set} />
          </Field>
          <Field label="Tag people or Pages (ids)" tip="Facebook needs numeric user or Page ids here, and a place must be set for people tags to show.">
            <ChipsInput value={tags.value || []} onChange={tags.set} placeholder="id, then Enter" />
          </Field>
          {!shared.scheduleAt && (
            <Toggle label="Publish visibly" checked={published.value !== false} onChange={published.set} tip="Off creates an unpublished (hidden) post you can use as a dark post or publish later from Meta Business Suite." />
          )}
          <details className="pf-advanced">
            <summary>Audience restrictions</summary>
            <p className="pf-hint">Who is allowed to see the post. Leave empty for everyone.</p>
            <AudienceFields value={targeting.value} onChange={targeting.set} />
            <h4>Feed targeting</h4>
            <p className="pf-hint">Who Facebook favours in News Feed (others can still find it on your Page).</p>
            <AudienceFields value={feedTargeting.value} onChange={feedTargeting.set} />
          </details>
        </>
      )}
    </div>
  );
}

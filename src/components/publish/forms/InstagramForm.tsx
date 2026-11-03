import { useEffect, useId, useState } from 'react';
import { searchProducts } from '../../../services/api';
import { Field, MediaPicker, PlaceSearch, ChipsInput, Segmented, SingleMedia, TextField, TextInput, Toggle, Select } from '../fields';
import { UserTagPicker } from '../UserTagPicker';
import { LIMITS, POST_TYPES } from '../platforms';
import { countHashtags, countMentions, mediaForType } from '../mapping';
import { useTab, type TabProps } from './useTab';
import type { IgType, MediaItem, Place } from '../types';

interface ProductTag { product_id: string; name?: string }

/** Instagram Shopping product search. Needs a Facebook Page linked to the account and a product catalog. */
function ProductTags({ token, accountId, value, onChange }: { token: string; accountId?: string; value: ProductTag[]; onChange: (v: ProductTag[]) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; image?: string }[]>([]);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!accountId || q.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await searchProducts(token, accountId, q.trim());
        if (cancelled) return;
        setResults(r.products);
        setNote(r.shop ? (r.products.length ? null : 'No products match.') : 'This account has no product catalog (Instagram Shopping is not set up).');
      } catch (err) {
        if (!cancelled) setNote(err instanceof Error ? err.message : 'Product search failed');
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, token, accountId]);

  return (
    <div>
      <input className="pf-input" value={q} placeholder="Search your catalog" onChange={(e) => setQ(e.target.value)} />
      {note && <p className="pf-hint">{note}</p>}
      {results.length > 0 && (
        <ul className="pf-place-results">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { if (!value.some((v) => v.product_id === p.id)) onChange([...value, { product_id: p.id, name: p.name }]); setQ(''); setResults([]); }}>
                <b>{p.name}</b><small>id {p.id}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.length > 0 && (
        <div className="pf-chips static">
          {value.map((p) => <span key={p.product_id} className="pf-chip">🛍 {p.name || p.product_id}<button type="button" aria-label="Remove product" onClick={() => onChange(value.filter((x) => x.product_id !== p.product_id))}>×</button></span>)}
        </div>
      )}
    </div>
  );
}

export function InstagramForm(props: TabProps) {
  const { token, shared, accounts } = props;
  const { field, perMedia, setPerMedia, setType, type } = useTab('instagram', props);
  const ids = { location: useId(), collab: useId(), offset: useId(), audio: useId() };
  const caption = field<string>('caption');
  const media = field<MediaItem[]>('media');
  const cover = field<MediaItem | null>('cover');
  const location = field<Place | null>('location');
  const collaborators = field<string[]>('collaborators');
  const products = field<ProductTag[]>('product_tags');
  const isStory = type === 'story';
  const isReel = type === 'reel';
  const used = mediaForType('instagram', type, media.value || []);
  const accept = isReel ? 'video/mp4,video/quicktime' : type === 'image' ? 'image/jpeg' : 'image/jpeg,video/mp4,video/quicktime';

  return (
    <div className="pf-form">
      <Field label="Post type" tip="Choose this first: each type supports different fields.">
        <Segmented<IgType> label="Instagram post type" value={type as IgType} onChange={setType} options={POST_TYPES.instagram.map((t) => ({ value: t.id as IgType, label: t.label, hint: t.hint }))} />
      </Field>

      {isStory ? (
        <p className="pf-note">Stories have no caption, and the API cannot add link stickers, polls or music. Add those in the Instagram app after posting if you need them.</p>
      ) : (
        <TextField
          label="Caption" multiline rows={6} value={caption.value || ''} onChange={caption.set} limit={LIMITS.igCaption} {...caption.sync}
          tip="Up to 2,200 characters, 30 hashtags and 20 @mentions. Only the first ~125 characters show before “more”."
        />
      )}
      {!isStory && (
        <p className="pf-counters">
          <span className={countHashtags(caption.value) > LIMITS.igHashtags ? 'over' : ''}># {countHashtags(caption.value)} / {LIMITS.igHashtags}</span>
          <span className={countMentions(caption.value) > LIMITS.igMentions ? 'over' : ''}>@ {countMentions(caption.value)} / {LIMITS.igMentions}</span>
        </p>
      )}
      {shared.link && !isStory && <p className="pf-note">Links in Instagram captions are not clickable. Put {shared.link} in your bio and say “link in bio”.</p>}

      <Field label={type === 'carousel' ? 'Carousel items (2 to 10, in order)' : 'Media'} tip="Instagram downloads the file from our storage. Photos must be JPEG." {...media.sync}>
        <MediaPicker token={token} value={media.value || []} onChange={media.set} accept={accept} />
      </Field>

      {used.map((m, i) => (
        <details key={m.id} className="pf-permedia" open={used.length === 1}>
          <summary>{used.length > 1 ? `Item ${i + 1}: ` : ''}{m.name} · tags{m.kind === 'image' && !isStory ? ' & alt text' : ''}</summary>
          {m.kind === 'image' && !isStory && (
            <Field label="Alt text" tip="Describes the image for people using screen readers.">
              <TextInput value={perMedia(m.id).alt_text || ''} onChange={(alt_text) => setPerMedia(m.id, { alt_text })} placeholder="e.g. Bar chart of Nifty returns by year" />
            </Field>
          )}
          {(m.kind === 'image' || isReel || isStory) && (
            <Field label="Tag people" tip={m.kind === 'image' && !isStory ? 'Click on the photo to place a tag. Up to 20 people.' : 'Tagged accounts are notified. Videos have no tag position.'}>
              <UserTagPicker item={m} tags={perMedia(m.id).user_tags || []} onChange={(user_tags) => setPerMedia(m.id, { user_tags })} withPosition={m.kind === 'image' && !isStory} />
            </Field>
          )}
        </details>
      ))}

      {isReel && (
        <>
          <Field label="Cover image" tip="A JPEG shown on your grid and in the Reels tab. Without one, the frame at the offset below is used." {...cover.sync}>
            <SingleMedia token={token} value={cover.value} onChange={cover.set} accept="image/jpeg" label="Upload a cover (JPEG)" />
          </Field>
          {!cover.value && (
            <Field label="Cover frame (milliseconds)" htmlFor={ids.offset} tip="Which moment of the video becomes the cover, e.g. 2500 = 2.5 seconds in.">
              <TextInput id={ids.offset} type="number" value={String(field('thumb_offset').value ?? '')} onChange={(v) => field('thumb_offset').set(v)} placeholder="0" />
            </Field>
          )}
          <Toggle label="Also show in the main feed" checked={field<boolean>('share_to_feed').value} onChange={(v) => field('share_to_feed').set(v)} tip="Off = the reel only appears in the Reels tab." />
          <Field label="Audio name" htmlFor={ids.audio} tip="Renames the original audio of the reel (e.g. “Chang Research Base · IPO explainer”). Can only be set once.">
            <TextInput id={ids.audio} value={String(field('audio_name').value ?? '')} onChange={(v) => field('audio_name').set(v)} placeholder="Original audio" />
          </Field>
          <Toggle label="Trial reel" checked={field<boolean>('trial').value} onChange={(v) => field('trial').set(v)} tip="Shown to non-followers first. You decide later whether it goes to followers." />
          {field<boolean>('trial').value && (
            <Field label="After the trial">
              <Select value={String(field('trial_graduation').value)} onChange={(v) => field('trial_graduation').set(v)} options={[{ value: 'MANUAL', label: 'I will decide (manual)' }, { value: 'SS_PERFORMANCE', label: 'Share with followers automatically if it performs well' }]} />
            </Field>
          )}
        </>
      )}

      {!isStory && (
        <>
          <Field label="Location" htmlFor={ids.location} tip="Uses Facebook place search, so a Facebook Page must be connected." {...location.sync}>
            <PlaceSearch id={ids.location} token={token} value={location.value} onChange={location.set} />
          </Field>
          <Field label="Collaborators" htmlFor={ids.collab} tip="Up to 3 accounts. They get an invite; once accepted the post shows on their profile too.">
            <ChipsInput id={ids.collab} value={collaborators.value || []} onChange={collaborators.set} max={LIMITS.igCollaborators} placeholder="username, then Enter" />
          </Field>
          <Field label="Product tags" tip="Only for accounts with Instagram Shopping and a Facebook Page linked.">
            <ProductTags token={token} accountId={accounts[0]?.id} value={products.value || []} onChange={products.set} />
          </Field>
        </>
      )}
    </div>
  );
}

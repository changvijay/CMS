import { Field, MediaPicker, Segmented, Select, SingleMedia, TextField, TextInput, Toggle } from '../fields';
import { LIMITS, POST_TYPES } from '../platforms';
import { charCount, mediaForType } from '../mapping';
import { useTab, type TabProps } from './useTab';
import type { LiType, MediaItem } from '../types';

interface Poll { question: string; options: string[]; duration: string }
const DURATIONS = [
  { value: 'ONE_DAY', label: '1 day' },
  { value: 'THREE_DAYS', label: '3 days' },
  { value: 'SEVEN_DAYS', label: '1 week' },
  { value: 'FOURTEEN_DAYS', label: '2 weeks' },
];

export function LinkedInForm(props: TabProps) {
  const { token, accounts } = props;
  const { field, perMedia, setPerMedia, setType, type } = useTab('linkedin', props);
  const commentary = field<string>('commentary');
  const media = field<MediaItem[]>('media');
  const thumbnail = field<MediaItem | null>('thumbnail');
  const title = field<string>('title');
  const articleUrl = field<string>('article_url');
  const articleTitle = field<string>('article_title');
  const articleDescription = field<string>('article_description');
  const articleThumb = field<MediaItem | null>('article_thumbnail');
  const docTitle = field<string>('document_title');
  const poll = field<Poll>('poll');
  const visibility = field<string>('visibility');
  const p = poll.value || { question: '', options: ['', ''], duration: 'THREE_DAYS' };
  const setPoll = (patch: Partial<Poll>) => poll.set({ ...p, ...patch });
  const onlyCompanies = accounts.length > 0 && accounts.every((a) => a.type !== 'Personal');
  const used = mediaForType('linkedin', type, media.value || []);
  const accept = type === 'video' ? 'video/mp4' : type === 'document' ? 'application/pdf' : 'image/jpeg,image/png,image/gif';

  return (
    <div className="pf-form">
      {accounts.length > 0 && (
        <p className="pf-note">Posting as {accounts.map((a) => `${a.name} (${a.type === 'Personal' ? 'personal profile' : 'company page'})`).join(', ')}.</p>
      )}
      <Field label="Content" tip="Choose this first: each type supports different fields.">
        <Segmented<LiType> label="LinkedIn content type" value={type as LiType} onChange={setType} options={POST_TYPES.linkedin.map((t) => ({ value: t.id as LiType, label: t.label, hint: t.hint }))} />
      </Field>

      <TextField label="Post text" multiline rows={7} value={commentary.value || ''} onChange={commentary.set} limit={LIMITS.liCommentary} {...commentary.sync}
        tip="Up to 3,000 characters. Only the first ~210 show before “see more”. #hashtags stay clickable." />

      {['image', 'multi_image', 'video', 'document'].includes(type) && (
        <Field label={type === 'document' ? 'PDF document' : type === 'multi_image' ? 'Images (2 to 20, in order)' : 'Media'} {...media.sync}>
          <MediaPicker token={token} value={media.value || []} onChange={media.set} accept={accept} />
        </Field>
      )}
      {['image', 'multi_image'].includes(type) && used.map((m) => (
        <Field key={m.id} label={`Alt text · ${m.name}`} tip="Describes the image for screen readers.">
          <TextInput value={perMedia(m.id).alt_text || ''} onChange={(alt_text) => setPerMedia(m.id, { alt_text })} />
        </Field>
      ))}
      {type === 'video' && (
        <>
          <TextField label="Video title" value={title.value || ''} onChange={title.set} {...title.sync} />
          <Field label="Video thumbnail" {...thumbnail.sync}>
            <SingleMedia token={token} value={thumbnail.value} onChange={thumbnail.set} label="Upload a thumbnail" />
          </Field>
        </>
      )}
      {type === 'document' && <TextField label="Document title" value={docTitle.value || ''} onChange={docTitle.set} limit={LIMITS.liDocumentTitle} tip="Shown above the swipeable document. Required." />}

      {type === 'article' && (
        <>
          <TextField label="Article link" value={articleUrl.value || ''} onChange={articleUrl.set} placeholder="https://…" {...articleUrl.sync} />
          <TextField label="Article title" value={articleTitle.value || ''} onChange={articleTitle.set} limit={LIMITS.liArticleTitle} {...articleTitle.sync} />
          <TextField label="Article description" multiline rows={3} value={articleDescription.value || ''} onChange={articleDescription.set} limit={LIMITS.liArticleDescription} {...articleDescription.sync} />
          <Field label="Article thumbnail" tip="LinkedIn does not scrape the link for you through the API, so upload the image to show.">
            <SingleMedia token={token} value={articleThumb.value} onChange={articleThumb.set} label="Upload a thumbnail" />
          </Field>
        </>
      )}

      {type === 'poll' && (
        <div className="pf-poll">
          <TextField label="Question" value={p.question} onChange={(question) => setPoll({ question })} limit={LIMITS.liPollQuestion} />
          {p.options.map((o, i) => (
            <Field key={i} label={`Option ${i + 1}`} count={charCount(o)} limit={LIMITS.liPollOption}
              extra={p.options.length > 2 ? <button type="button" className="pf-link" onClick={() => setPoll({ options: p.options.filter((_, j) => j !== i) })}>Remove</button> : undefined}>
              <TextInput value={o} onChange={(v) => setPoll({ options: p.options.map((x, j) => (j === i ? v : x)) })} />
            </Field>
          ))}
          {p.options.length < 4 && <button type="button" className="btn btn-secondary" onClick={() => setPoll({ options: [...p.options, ''] })}>+ Add option</button>}
          <Field label="Poll runs for">
            <Select value={p.duration} onChange={(duration) => setPoll({ duration })} options={DURATIONS} />
          </Field>
        </div>
      )}

      <div className="pf-grid2">
        <Field label="Who can see it" tip="Connections-only works for personal profiles. Company page posts are public.">
          <Select value={visibility.value} onChange={visibility.set} options={[
            { value: 'PUBLIC', label: 'Anyone' },
            ...(onlyCompanies ? [] : [{ value: 'CONNECTIONS', label: 'Connections only' }]),
            { value: 'LOGGED_IN', label: 'Signed-in LinkedIn members' },
          ]} />
        </Field>
        <Field label="Save as">
          <Segmented label="LinkedIn lifecycle" value={String(field('lifecycle').value) as 'PUBLISHED' | 'DRAFT'} onChange={(v) => field('lifecycle').set(v)} options={[{ value: 'PUBLISHED', label: 'Published' }, { value: 'DRAFT', label: 'LinkedIn draft' }]} />
        </Field>
      </div>
      <Toggle label="Turn off reposts" checked={Boolean(field('reshare_disabled').value)} onChange={(v) => field('reshare_disabled').set(v)} tip="Stops others from resharing this post." />
    </div>
  );
}

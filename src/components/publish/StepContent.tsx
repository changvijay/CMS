import { useId } from 'react';
import { ChipsInput, Field, Issues, MediaPicker, PlaceSearch, SingleMedia, TextField } from './fields';
import { InstagramForm } from './forms/InstagramForm';
import { FacebookForm } from './forms/FacebookForm';
import { LinkedInForm } from './forms/LinkedInForm';
import { YoutubeForm } from './forms/YoutubeForm';
import { Preview } from './Previews';
import { PlatformIcon } from './PlatformIcon';
import { PLATFORM_LABEL } from './platforms';
import { emptyDraft } from './mapping';
import { timezoneName } from './helpers';
import { validateDraft, validateSchedule } from './validate';
import type { Platform, PlatformDraft, PublishAccount, SharedFields } from './types';
import type { TabProps } from './forms/useTab';

const FORMS: Record<Platform, (p: TabProps) => React.JSX.Element> = { instagram: InstagramForm, facebook: FacebookForm, linkedin: LinkedInForm, youtube: YoutubeForm };

function SharedSection({ token, shared, onChange }: { token: string; shared: SharedFields; onChange: (patch: Partial<SharedFields>) => void }) {
  const ids = { hashtags: useId(), keywords: useId(), location: useId(), schedule: useId() };
  return (
    <section className="viz-panel pf-shared">
      <div className="viz-panel-head">
        <div>
          <h3>Shared fields</h3>
          <p className="ws-sub">Fill these once. They fill the matching field on every platform tab below, trimmed to each platform's limits.</p>
        </div>
      </div>
      <div className="pf-grid2">
        <TextField label="Title" value={shared.title} onChange={(title) => onChange({ title })} tip="YouTube title, the first line of captions, and LinkedIn article/video titles." placeholder="e.g. Tata Capital IPO in 60 seconds" />
        <TextField label="Link" value={shared.link} onChange={(link) => onChange({ link })} tip="Facebook link post, LinkedIn article, end of the YouTube description. Instagram captions can't hold clickable links." placeholder="https://…" />
      </div>
      <TextField label="Description" multiline rows={5} value={shared.description} onChange={(description) => onChange({ description })} tip="The body of captions and the YouTube description." />
      <div className="pf-grid2">
        <Field label="Hashtags" htmlFor={ids.hashtags} tip="Added to the end of captions. On YouTube they also become tags.">
          <ChipsInput id={ids.hashtags} value={shared.hashtags} onChange={(hashtags) => onChange({ hashtags })} prefix="#" placeholder="#ipo, then Enter" />
        </Field>
        <Field label="Tags / keywords" htmlFor={ids.keywords} tip="YouTube tags. Elsewhere they are added as hashtags (spaces removed).">
          <ChipsInput id={ids.keywords} value={shared.keywords} onChange={(keywords) => onChange({ keywords })} placeholder="stock market, then Enter" />
        </Field>
      </div>
      <Field label="Media" tip="Photos, videos or a PDF. Each platform uses the files its post type takes. Drag to reorder with the arrows.">
        <MediaPicker token={token} value={shared.media} onChange={(media) => onChange({ media })} />
      </Field>
      <div className="pf-grid2">
        <Field label="Thumbnail / cover" tip="Reel cover, Facebook/LinkedIn video thumbnail, YouTube custom thumbnail.">
          <SingleMedia token={token} value={shared.thumbnail} onChange={(thumbnail) => onChange({ thumbnail })} accept="image/jpeg,image/png" label="Upload a thumbnail" />
        </Field>
        <Field label="Location" htmlFor={ids.location} tip="Instagram location and Facebook place (search needs a connected Facebook Page).">
          <PlaceSearch id={ids.location} token={token} value={shared.location} onChange={(location) => onChange({ location })} />
        </Field>
      </div>
      <Field label="Schedule time" htmlFor={ids.schedule} tip={`Leave empty to publish now. Times are in your timezone (${timezoneName()}). Facebook and YouTube hold the schedule themselves; Instagram and LinkedIn are posted by this app at that time.`}>
        <div className="pf-schedule">
          <input id={ids.schedule} type="datetime-local" className="pf-input" value={shared.scheduleAt} onChange={(e) => onChange({ scheduleAt: e.target.value })} />
          {shared.scheduleAt && <button type="button" className="btn btn-secondary" onClick={() => onChange({ scheduleAt: '' })}>Clear</button>}
          <small>{timezoneName()}</small>
        </div>
      </Field>
    </section>
  );
}

export function StepContent({ token, platforms, shared, drafts, accounts, active, onShared, onDraft, onTab }: {
  token: string;
  platforms: Platform[];
  shared: SharedFields;
  drafts: Partial<Record<Platform, PlatformDraft>>;
  accounts: Partial<Record<Platform, PublishAccount[]>>;
  active: Platform;
  onShared: (patch: Partial<SharedFields>) => void;
  onDraft: (p: Platform, d: PlatformDraft) => void;
  onTab: (p: Platform) => void;
}) {
  const draftOf = (p: Platform) => drafts[p] ?? emptyDraft(p);
  const Form = FORMS[active];
  const draft = draftOf(active);
  const issues = [
    ...validateDraft(active, draft, shared),
    ...validateSchedule(shared.scheduleAt, [{ platform: active, postType: draft.postType }]),
  ];

  return (
    <div>
      <SharedSection token={token} shared={shared} onChange={onShared} />

      <div className="pf-tabs" role="tablist" aria-label="Platforms">
        {platforms.map((p) => {
          const errors = validateDraft(p, draftOf(p), shared).filter((i) => i.level === 'error').length;
          return (
            <button key={p} role="tab" type="button" aria-selected={p === active} className={p === active ? 'active' : ''} onClick={() => onTab(p)}>
              <PlatformIcon platform={p} size={16} /> {PLATFORM_LABEL[p]}
              {errors > 0 && <span className="pf-tab-badge" aria-label={`${errors} problems`}>{errors}</span>}
            </button>
          );
        })}
      </div>

      <div className="pf-tab-body">
        <div className="pf-tab-form">
          <Form token={token} draft={draft} shared={shared} accounts={accounts[active] ?? []} onDraft={(d) => onDraft(active, d)} />
          <Issues items={issues} />
        </div>
        <aside className="pf-preview" aria-label={`${PLATFORM_LABEL[active]} preview`}>
          <p className="pf-preview-label">Preview</p>
          <Preview platform={active} draft={draft} shared={shared} account={(accounts[active] ?? [])[0]} />
        </aside>
      </div>
    </div>
  );
}

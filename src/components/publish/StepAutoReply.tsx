import { ChipsInput, Field, Issues, Segmented, TextField, TextInput, Toggle } from './fields';
import { LIMITS } from './platforms';
import { charCount } from './mapping';
import { validateAutoReply } from './validate';
import type { AutoReplySettings } from './types';

/** Step 4: keyword (or any-comment) auto-replies for the new Instagram post. */
export function StepAutoReply({ value, onChange }: { value: AutoReplySettings; onChange: (patch: Partial<AutoReplySettings>) => void }) {
  const a = value;
  const setReply = (i: number, text: string) => onChange({ public_replies: a.public_replies.map((r, j) => (j === i ? text : r)) });
  const setButton = (i: number, patch: Partial<{ title: string; url: string }>) => onChange({ dm_buttons: a.dm_buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

  return (
    <div className="pf-autoreply">
      <Toggle label="Auto-reply to comments on this Instagram post" checked={a.enabled} onChange={(enabled) => onChange({ enabled })} tip="Starts working the moment Instagram publishes the post." />
      {!a.enabled && <p className="pf-hint">Optional. Turn it on to answer comments automatically, e.g. send a link to everyone who comments “LINK”.</p>}

      {a.enabled && (
        <>
          <Field label="When someone comments">
            <Segmented label="Trigger" value={a.trigger} onChange={(trigger) => onChange({ trigger })} options={[{ value: 'keywords', label: 'Comment contains a keyword' }, { value: 'any', label: 'Any comment' }]} />
          </Field>
          {a.trigger === 'keywords' && (
            <Field label="Keywords" tip="Case-insensitive whole words, in any language. Several keywords: any one of them matches.">
              <ChipsInput value={a.keywords} onChange={(keywords) => onChange({ keywords })} placeholder="link, then Enter" />
            </Field>
          )}

          <section className="pf-block">
            <h4>1 · Public reply under the comment</h4>
            <p className="pf-hint">One of these is picked at random for each comment, so the replies don't look like spam. {'{username}'} becomes @their_name. Leave all empty for no public reply.</p>
            {a.public_replies.map((r, i) => (
              <Field key={i} label={`Variant ${i + 1}`} count={charCount(r)} limit={LIMITS.publicReply}
                extra={<button type="button" className="pf-link" onClick={() => onChange({ public_replies: a.public_replies.filter((_, j) => j !== i) })}>Remove</button>}>
                <TextInput value={r} onChange={(v) => setReply(i, v)} />
              </Field>
            ))}
            {a.public_replies.length < 10 && <button type="button" className="btn btn-secondary" onClick={() => onChange({ public_replies: [...a.public_replies, ''] })}>+ Add variant</button>}
          </section>

          <section className="pf-block">
            <h4>2 · Private reply by DM</h4>
            <Toggle label="Send a DM" checked={a.send_dm} onChange={(send_dm) => onChange({ send_dm })} tip="Uses Instagram's Private Replies: one DM per comment, within 7 days of the comment." />
            {a.send_dm && (
              <>
                <TextField label="DM text" multiline rows={4} value={a.dm_text} onChange={(dm_text) => onChange({ dm_text })} limit={LIMITS.dmText} tip="{username} and {{link}} work here. If {{link}} is not in the text, the link is added at the end." />
                <TextField label="Link" value={a.link_url} onChange={(link_url) => onChange({ link_url })} placeholder="https://…" />
                <Field label="Link buttons (up to 3)" tip="Shown as tappable buttons under the message. They need https:// links.">
                  {a.dm_buttons.map((b, i) => (
                    <div key={i} className="pf-row">
                      <TextInput value={b.title} onChange={(title) => setButton(i, { title })} placeholder="Button text" maxLength={20} />
                      <TextInput value={b.url} onChange={(url) => setButton(i, { url })} placeholder="https://…" />
                      <button type="button" className="pf-link" onClick={() => onChange({ dm_buttons: a.dm_buttons.filter((_, j) => j !== i) })}>Remove</button>
                    </div>
                  ))}
                  {a.dm_buttons.length < 3 && <button type="button" className="btn btn-secondary" onClick={() => onChange({ dm_buttons: [...a.dm_buttons, { title: '', url: '' }] })}>+ Add button</button>}
                </Field>
                <Field label="Quick replies" tip="Tappable suggestions under the DM (up to 13, 20 characters each).">
                  <ChipsInput value={a.quick_replies} onChange={(quick_replies) => onChange({ quick_replies })} max={13} placeholder="e.g. More info, then Enter" />
                </Field>
                <Toggle label="Ask them to follow before sending the link" checked={a.require_follow} onChange={(require_follow) => onChange({ require_follow })} />
                {a.require_follow && (
                  <p className="pf-note">Instagram's API can't check whether a commenter follows you until they message you. So the first DM asks them to follow and shows an “I followed ✅” button. When they tap it, the app checks they follow and then sends your DM and link.</p>
                )}
                <Toggle label="Add “(Automated reply)” to the DM" checked={a.disclose_automation} onChange={(disclose_automation) => onChange({ disclose_automation })} />
              </>
            )}
          </section>

          <div className="pf-grid2">
            <Field label="Active from" tip="Leave empty to start as soon as the post is live.">
              <input type="datetime-local" className="pf-input" value={a.active_from} onChange={(e) => onChange({ active_from: e.target.value })} />
            </Field>
            <Field label="Active until" tip="Leave empty to keep answering. Private replies only work within 7 days of a comment anyway.">
              <input type="datetime-local" className="pf-input" value={a.active_until} onChange={(e) => onChange({ active_until: e.target.value })} />
            </Field>
          </div>
          <p className="pf-note">
            How it works: Instagram sends each new comment to this app (webhook, signature checked). Each comment gets one reply at most, even if Instagram sends it twice.
            If Instagram's rate limit is hit, the reply waits and is retried automatically (up to 3 times). Every reply is logged on the post's page.
          </p>
          <Issues items={validateAutoReply(a)} />
        </>
      )}
    </div>
  );
}

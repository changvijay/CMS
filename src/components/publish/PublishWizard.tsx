import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createDraft, deletePost, getPost, getPublishAccounts, listPosts, saveDraft, submitPost, type PostSummary } from '../../services/api';
import '../../assets/css/workspace.css';
import './publish.css';
import { Issues } from './fields';
import { StepAccounts, StepPlatforms } from './StepSelect';
import { StepContent } from './StepContent';
import { StepAutoReply } from './StepAutoReply';
import { defaultAutoReply, stepsFor, timezoneName } from './helpers';
import { PostProgress, StepReview } from './StepReview';
import { PlatformIcon } from './PlatformIcon';
import { PLATFORM_LABEL } from './platforms';
import { buildFields, emptyDraft } from './mapping';
import { hasErrors, scheduleIso, validateAutoReply, validateDraft, validateSchedule } from './validate';
import type { AutoReplySettings, Issue, MediaItem, Platform, PlatformDraft, PublishAccount, SharedFields, StepId, WizardState } from './types';

const STEP_TITLE: Record<StepId, string> = { platforms: 'Platform', accounts: 'Account', content: 'Content', autoreply: 'Auto reply', review: 'Review' };

const emptyShared = (): SharedFields => ({ title: '', description: '', hashtags: [], keywords: [], media: [], thumbnail: null, link: '', location: null, scheduleAt: '' });
const initialState = (): WizardState => ({ step: 'platforms', platforms: [], accounts: {}, shared: emptyShared(), drafts: {}, autoReply: defaultAutoReply() });

type Action =
  | { type: 'load'; state: WizardState }
  | { type: 'patch'; patch: Partial<WizardState> }
  | { type: 'shared'; patch: Partial<SharedFields> }
  | { type: 'draft'; platform: Platform; draft: PlatformDraft }
  | { type: 'autoReply'; patch: Partial<AutoReplySettings> };

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case 'load': return action.state;
    case 'patch': return { ...state, ...action.patch };
    case 'shared': return { ...state, shared: { ...state.shared, ...action.patch } };
    case 'draft': return { ...state, drafts: { ...state.drafts, [action.platform]: action.draft } };
    case 'autoReply': return { ...state, autoReply: { ...state.autoReply, ...action.patch } };
  }
}

/** Uploads that were still running (or local previews) can't survive a reload, so drafts keep only finished files. */
function cleanMedia<T extends MediaItem | null>(m: T): T {
  if (!m) return m;
  return (m.status === 'ready' && m.url ? { ...m, previewUrl: undefined } : null) as T;
}
function hydrate(saved: Partial<WizardState> | undefined): WizardState {
  const base = initialState();
  if (!saved || !saved.platforms) return base;
  const shared = { ...base.shared, ...saved.shared };
  shared.media = (shared.media || []).map(cleanMedia).filter(Boolean) as MediaItem[];
  shared.thumbnail = cleanMedia(shared.thumbnail);
  return { ...base, ...saved, shared, autoReply: { ...base.autoReply, ...saved.autoReply } };
}

/** "?facebook=connected&name=…" after coming back from a Connect button. */
function readReturnNotice(): { ok: string | null; error: string | null } {
  const q = new URLSearchParams(window.location.search);
  for (const k of ['facebook', 'youtube', 'linkedin']) {
    const v = q.get(k);
    if (v === 'connected') return { ok: `${k === 'youtube' ? 'YouTube' : k === 'facebook' ? 'Facebook' : 'LinkedIn'} connected${q.get('name') ? `: ${q.get('name')}` : ''}.`, error: null };
    if (v === 'error') return { ok: null, error: q.get('message') || 'Connection failed.' };
  }
  return { ok: null, error: null };
}

function RecentPosts({ token }: { token: string }) {
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    listPosts(token).then((r) => { if (!cancelled) setPosts(r.posts); }).catch(() => { if (!cancelled) setPosts([]); });
    return () => { cancelled = true; };
  }, [token, tick]);
  if (!posts?.length) return null;
  const remove = async (p: PostSummary) => {
    if (!window.confirm('Delete this draft?')) return;
    await deletePost(token, p.id).catch(() => {});
    setTick((t) => t + 1);
  };
  return (
    <details className="viz-panel pf-recent">
      <summary>Your posts and drafts ({posts.length})</summary>
      <ul>
        {posts.slice(0, 15).map((p) => (
          <li key={p.id}>
            <Link to={`/publish/${p.id}`}>{p.title || 'Untitled'}</Link>
            <span className="pf-recent-icons">{p.targets.map((t, i) => <PlatformIcon key={i} platform={t.platform} size={14} />)}</span>
            <span className={`pf-status ${p.status}`}>{p.status === 'scheduled' && p.schedule_at ? `scheduled ${new Date(p.schedule_at).toLocaleString()}` : p.status}</span>
            <small className="pf-hint">{new Date(p.updated_at).toLocaleDateString()}</small>
            {p.status === 'draft' && <button type="button" className="pf-link" onClick={() => remove(p)}>Delete</button>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Stepper({ steps, current, onGo, reachable }: { steps: StepId[]; current: StepId; onGo: (s: StepId) => void; reachable: (s: StepId) => boolean }) {
  const at = steps.indexOf(current);
  return (
    <ol className="pf-stepper" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s} className={i < at ? 'done' : i === at ? 'current' : ''}>
          <button type="button" disabled={!reachable(s)} onClick={() => onGo(s)} aria-current={i === at ? 'step' : undefined}>
            <span className="pf-step-n">{i < at ? '✓' : i + 1}</span>
            <span className="pf-step-label">{STEP_TITLE[s]}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export default function PublishWizard({ token }: { token: string }) {
  const { postId } = useParams();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [mode, setMode] = useState<'loading' | 'wizard' | 'progress'>(postId ? 'loading' : 'wizard');
  const [accounts, setAccounts] = useState<Partial<Record<Platform, PublishAccount[]>>>({});
  const [blockers, setBlockers] = useState<Issue[]>([]);
  const [saved, setSaved] = useState<{ at: Date | null; error: string | null }>({ at: null, error: null });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string[] | null>(null);
  const [notice] = useState(readReturnNotice);
  const draftId = useRef<string | null>(postId ?? null);
  const loadedFor = useRef<string | null>(null);

  // Open a draft, or show progress for a post that was already submitted.
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
    if (!postId) {
      // "New post" from a finished post: start over.
      if (loadedFor.current !== null) { dispatch({ type: 'load', state: initialState() }); draftId.current = null; }
      loadedFor.current = '';
      return;
    }
    if (loadedFor.current === postId) return;
    loadedFor.current = postId;
    draftId.current = postId;
    let cancelled = false;
    getPost(token, postId).then((d) => {
      if (cancelled) return;
      if (d.post.status === 'draft') {
        dispatch({ type: 'load', state: hydrate(d.post.wizard_state) });
        setMode('wizard');
      } else {
        setMode('progress');
      }
    }).catch(() => { if (!cancelled) navigate('/publish', { replace: true }); });
    return () => { cancelled = true; };
  }, [postId, token, navigate]);

  // Accounts are needed by the forms and previews even when a draft is reopened past step 2.
  const platformKey = state.platforms.join(',');
  useEffect(() => {
    if (mode !== 'wizard' || !platformKey || state.step === 'platforms' || state.step === 'accounts') return;
    let cancelled = false;
    getPublishAccounts(token, platformKey.split(',') as Platform[]).then((r) => { if (!cancelled) setAccounts(r.accounts); }).catch(() => {});
    return () => { cancelled = true; };
  }, [token, platformKey, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async (): Promise<string | null> => {
    if (!state.platforms.length) return draftId.current;
    try {
      if (draftId.current) await saveDraft(token, draftId.current, state);
      else {
        const r = await createDraft(token, state);
        draftId.current = String(r.post.id);
        loadedFor.current = draftId.current;
        setMode('wizard'); // the previous post may have been showing its progress view
        navigate(`/publish/${draftId.current}`, { replace: true });
      }
      setSaved({ at: new Date(), error: null });
      return draftId.current;
    } catch (err) {
      setSaved({ at: null, error: err instanceof Error ? err.message : 'Could not save the draft' });
      return draftId.current;
    }
  }, [state, token, navigate]);

  // Autosave 1.5 s after the last change.
  const first = useRef(true);
  useEffect(() => {
    if (mode !== 'wizard') return;
    if (first.current) { first.current = false; return; }
    const uploading = state.shared.media.some((m) => m.status === 'uploading');
    const t = setTimeout(() => { if (!uploading) save(); }, 1500);
    return () => clearTimeout(t);
  }, [state, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const steps = stepsFor(state);
  const at = Math.max(0, steps.indexOf(state.step));
  const active: Platform = state.activeTab && state.platforms.includes(state.activeTab) ? state.activeTab : state.platforms[0];
  const chosen = (p: Platform) => (accounts[p] ?? []).filter((a) => (state.accounts[p] ?? []).includes(a.id) && a.tokenStatus === 'ok');

  /** What stops leaving a step. */
  const blockersFor = (step: StepId): Issue[] => {
    const err = (message: string): Issue => ({ level: 'error', message });
    if (step === 'platforms') return state.platforms.length ? [] : [err('Choose at least one platform.')];
    if (step === 'accounts') return state.platforms.filter((p) => !chosen(p).length).map((p) => err(`Choose a ${PLATFORM_LABEL[p]} account with a working connection.`));
    if (step === 'content') {
      const list: Issue[] = validateSchedule(state.shared.scheduleAt, state.platforms.map((p) => ({ platform: p, postType: (state.drafts[p] ?? emptyDraft(p)).postType })));
      for (const p of state.platforms) for (const i of validateDraft(p, state.drafts[p] ?? emptyDraft(p), state.shared)) if (i.level === 'error') list.push({ ...i, message: `${PLATFORM_LABEL[p]}: ${i.message}` });
      return list;
    }
    if (step === 'autoreply') return validateAutoReply(state.autoReply).filter((i) => i.level === 'error');
    return [];
  };
  const reachable = (s: StepId) => steps.indexOf(s) <= at || steps.slice(0, steps.indexOf(s)).every((x) => !hasErrors(blockersFor(x)));
  const go = (s: StepId) => { setBlockers([]); dispatch({ type: 'patch', patch: { step: s } }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const next = () => {
    const b = blockersFor(state.step);
    if (hasErrors(b)) { setBlockers(b); return; }
    go(steps[at + 1]);
  };

  const submit = async () => {
    for (const s of steps) {
      const b = blockersFor(s);
      if (hasErrors(b)) { setBlockers(b); go(s); return; }
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const accountNames: Record<string, string> = {};
      for (const p of state.platforms) for (const a of chosen(p)) accountNames[`${p}:${a.id}`] = a.name;
      const wizard: WizardState = { ...state, accountNames };
      const id = await save() ?? (await createDraft(token, wizard)).post.id;
      const targets = state.platforms.flatMap((p) => {
        const draft = state.drafts[p] ?? emptyDraft(p);
        const fields = buildFields(p, draft, state.shared);
        return chosen(p).map((a) => ({ platform: p, accountId: a.id, postType: draft.postType, fields }));
      });
      const ar = state.autoReply;
      const autoReply = state.platforms.includes('instagram') && ar.enabled
        ? { ...ar, active_from: scheduleIso(ar.active_from), active_until: scheduleIso(ar.active_until), quick_replies: ar.quick_replies.map((title) => ({ title })) }
        : null;
      await submitPost(token, String(id), { targets, scheduleAt: scheduleIso(state.shared.scheduleAt), timezone: timezoneName(), autoReply, wizard });
      loadedFor.current = String(id);
      setMode('progress');
      navigate(`/publish/${id}`, { replace: true });
    } catch (err) {
      const e = err as Error & { errors?: string[] };
      setSubmitError(e.errors?.length ? e.errors : [e.message || 'Publishing failed']);
    } finally {
      setSubmitting(false);
    }
  };

  // A plain /publish is always a fresh wizard, whatever the last post was.
  const view = postId ? mode : 'wizard';
  if (view === 'loading') return <div className="session-loader"><div className="spinner large" /></div>;

  return (
    <div className="ws pf-page">
      <main className="ws-main">
        <div className="ws-pagehead">
          <div>
            <h2>Social Post</h2>
            <p className="ws-sub">{view === 'progress' ? 'Publishing status for each platform.' : 'Write once, publish to Instagram, Facebook, LinkedIn and YouTube with every option each platform offers.'}</p>
          </div>
          {view === 'progress'
            ? <Link className="btn btn-primary" to="/publish">New post</Link>
            : <span className="pf-saved" role="status">{saved.error ? <span className="pf-error">{saved.error}</span> : saved.at ? `Draft saved ${saved.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span>}
        </div>

        {notice.ok && <div className="ws-notice ok" role="status">{notice.ok}</div>}
        {notice.error && <div className="error-banner"><span>{notice.error}</span></div>}

        {view === 'progress' && postId ? <PostProgress token={token} postId={postId} /> : (
          <>
            {state.step === 'platforms' && <RecentPosts token={token} />}
            <Stepper steps={steps} current={state.step} onGo={go} reachable={reachable} />

            <section className="pf-step">
              <h3 className="pf-step-title">{at + 1}. {state.step === 'platforms' ? 'Select platforms' : state.step === 'accounts' ? 'Select accounts' : state.step === 'content' ? 'Write the post' : state.step === 'autoreply' ? 'Instagram auto reply' : 'Review & publish'}</h3>

              {state.step === 'platforms' && (
                <StepPlatforms token={token} selected={state.platforms} beforeLeave={save} onChange={(platforms) => dispatch({ type: 'patch', patch: { platforms } })} />
              )}
              {state.step === 'accounts' && (
                <StepAccounts
                  token={token} platforms={state.platforms} selected={state.accounts} beforeLeave={save}
                  onChange={(a) => dispatch({ type: 'patch', patch: { accounts: a } })}
                  onLoaded={(loaded) => {
                    setAccounts(loaded);
                    // Pre-select when a platform has exactly one working account.
                    const auto = { ...state.accounts };
                    let changed = false;
                    for (const p of state.platforms) {
                      const ok = (loaded[p] ?? []).filter((x) => x.tokenStatus === 'ok');
                      if (!(auto[p] ?? []).length && ok.length === 1) { auto[p] = [ok[0].id]; changed = true; }
                    }
                    if (changed) dispatch({ type: 'patch', patch: { accounts: auto } });
                  }}
                />
              )}
              {state.step === 'content' && active && (
                <StepContent
                  token={token} platforms={state.platforms} shared={state.shared} drafts={state.drafts}
                  accounts={Object.fromEntries(state.platforms.map((p) => [p, chosen(p)]))}
                  active={active}
                  onShared={(patch) => dispatch({ type: 'shared', patch })}
                  onDraft={(platform, draft) => dispatch({ type: 'draft', platform, draft })}
                  onTab={(activeTab) => dispatch({ type: 'patch', patch: { activeTab } })}
                />
              )}
              {state.step === 'autoreply' && <StepAutoReply value={state.autoReply} onChange={(patch) => dispatch({ type: 'autoReply', patch })} />}
              {state.step === 'review' && (
                <StepReview platforms={state.platforms} shared={state.shared} drafts={state.drafts} accounts={accounts} selected={state.accounts} autoReply={state.autoReply} />
              )}
            </section>

            <Issues items={blockers} />
            {submitError && <div className="error-banner pf-submit-error"><span>{submitError.map((m) => <span key={m}>{m}<br /></span>)}</span></div>}

            <div className="pf-nav">
              <button type="button" className="btn btn-secondary" disabled={at === 0} onClick={() => go(steps[at - 1])}>Back</button>
              <div className="pf-nav-right">
                <button type="button" className="btn btn-secondary" disabled={!state.platforms.length} onClick={() => save()}>Save draft</button>
                {state.step !== 'review'
                  ? <button type="button" className="btn btn-primary" onClick={next}>Next</button>
                  : (
                    <button type="button" className="btn btn-primary" disabled={submitting} onClick={submit}>
                      {submitting ? 'Sending…' : state.shared.scheduleAt ? `Schedule for ${new Date(state.shared.scheduleAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : 'Publish now'}
                    </button>
                  )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

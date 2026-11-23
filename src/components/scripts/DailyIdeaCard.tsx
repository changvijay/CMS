import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowClockwise, ArrowRight, CaretDown, CheckCircle, Copy, Fire, Plus } from '@phosphor-icons/react';
import { acceptDailyIdea, getDailyIdea, listNiches, type DailyIdea } from '../../services/scriptsApi';
import { errorMessage } from '../../utils/errors';
import { useLive } from '../workspace/useLive';
import { KEY, refreshScripts, toast, useAiSettings } from './util';

/** Today's AI script idea for a niche. Generated once a day per niche on the server; "New idea" asks again. */
export default function DailyIdeaCard({ token }: { token: string }) {
  const navigate = useNavigate();
  const ai = useAiSettings(token);
  const niches = useLive(() => listNiches(token), `${KEY}niches`);
  const [open, setOpen] = useState(false);
  const [nicheId, setNicheId] = useState<string | null>(null);
  const [idea, setIdea] = useState<DailyIdea | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Only the newest request may update the card (switching niche quickly drops older answers).
  const latest = useRef(0);

  const list = niches.data ?? [];
  const hasAi = Boolean(ai.data?.active_provider);
  if (ai.loading || niches.loading) return null;
  if (!hasAi || !list.length) {
    return (
      <div className="sv-idea sv-idea-setup">
        <span className="sv-idea-badge" aria-hidden="true"><Fire size={20} weight="fill" /></span>
        <span className="body-6"><b className="body-4">Get a fresh script idea every day.</b> {hasAi ? 'Add your content niche' : 'Connect an AI provider and add your niche'} and the assistant suggests a trend based idea, with hooks and captions in your language.</span>
        <Link className="sv-btn sv-btn-ghost sv-btn-sm" to={`/scripts/settings?section=${hasAi ? 'niches' : 'ai'}`}>Set up <ArrowRight size={14} aria-hidden="true" /></Link>
      </div>
    );
  }

  const current = nicheId ?? ai.data?.active_niche_id ?? list[0].id;

  const load = async (id: string, refresh = false) => {
    const mine = ++latest.current;
    setLoading(true);
    setError('');
    try {
      const res = await getDailyIdea(token, id, refresh);
      if (mine === latest.current) setIdea(res.idea);
    } catch (err) {
      if (mine === latest.current) setError(errorMessage(err, 'Could not generate today’s idea.'));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  };

  const toggle = () => {
    setOpen((o) => !o);
    if (!open && !idea && !loading) load(current);
  };

  const accept = async () => {
    if (!idea) return;
    try {
      const { script_id } = await acceptDailyIdea(token, idea.id);
      setIdea({ ...idea, accepted_script_id: script_id });
      refreshScripts();
      toast('Idea added to your scripts', 'ok', { label: 'Open', run: () => navigate(`/scripts/library/${script_id}`) });
    } catch (err) {
      toast(errorMessage(err, 'Could not add the idea.'), 'error');
    }
  };

  return (
    <section className={`sv-idea ${open ? 'open' : ''}`}>
      <button type="button" className="sv-idea-toggle" aria-expanded={open} onClick={toggle}>
        <span className="sv-idea-badge" aria-hidden="true"><Fire size={20} weight="fill" /></span>
        <span className="sv-grow">
          <span className="title-3">Today’s idea</span>
          <span className="caption-2 sv-soft sv-ellipsis">{idea && !open ? idea.title : 'A trend based script idea for your niche, refreshed daily'}</span>
        </span>
        <CaretDown size={18} className="sv-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="sv-idea-body">
          {list.length > 1 && (
            <div className="sv-chiprow" role="group" aria-label="Niche">
              {list.map((n) => (
                <button key={n.id} type="button" className={`sv-chip ${current === n.id ? 'active' : ''}`} aria-pressed={current === n.id}
                  onClick={() => { setNicheId(n.id); setIdea(null); load(n.id); }}>{n.title}</button>
              ))}
            </div>
          )}
          {loading && (
            <div className="sv-idea-card" aria-busy="true">
              <span className="sv-skel short" /><span className="sv-skel" style={{ height: 24, width: '70%' }} /><span className="sv-skel" /><span className="sv-skel" style={{ width: '85%' }} />
              <span className="caption-5 sv-soft">Looking at what your audience cares about today…</span>
            </div>
          )}
          {error && !loading && (
            <div className="sv-banner error" role="alert">{error} <button type="button" className="sv-link" onClick={() => load(current, true)}>Try again</button></div>
          )}
          {idea && !loading && (
            <article className="sv-idea-card">
              <span className="caption-4 sv-soft">{idea.niche} · {idea.language}</span>
              <h3 className="heading-6">{idea.title}</h3>
              <p className="body-6">{idea.description}</p>
              {(idea.hook_mechanism || idea.retention_strategy) && (
                <dl className="sv-idea-notes">
                  {idea.hook_mechanism && <div><dt className="caption-3">Hook</dt><dd className="body-6">{idea.hook_mechanism}</dd></div>}
                  {idea.retention_strategy && <div><dt className="caption-3">Keeps them watching</dt><dd className="body-6">{idea.retention_strategy}</dd></div>}
                </dl>
              )}
              {idea.captions.length > 0 && (
                <ul className="sv-captions">
                  {idea.captions.map((c, i) => (
                    <li key={i}>
                      <span className="body-6">{c}</span>
                      <button type="button" className="sv-icon-btn" aria-label="Copy caption" onClick={() => { navigator.clipboard?.writeText(c); toast('Caption copied', 'info'); }}><Copy size={14} /></button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="sv-actions">
                {idea.accepted_script_id ? (
                  <button type="button" className="sv-btn sv-btn-ghost" onClick={() => navigate(`/scripts/library/${idea.accepted_script_id}`)}><CheckCircle size={16} weight="fill" aria-hidden="true" /> Added. Open script</button>
                ) : (
                  <button type="button" className="sv-btn sv-btn-primary" onClick={accept}><Plus size={16} weight="bold" aria-hidden="true" /> Add to my scripts</button>
                )}
                <button type="button" className="sv-btn sv-btn-ghost" onClick={() => load(current, true)}><ArrowClockwise size={16} aria-hidden="true" /> Another idea</button>
              </div>
            </article>
          )}
        </div>
      )}
    </section>
  );
}

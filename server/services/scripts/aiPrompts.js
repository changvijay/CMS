/** Prompts for the Scripts AI assistant, copied from ScriptVault (services/ai/prompts.ts, AIContext, DailyAIIdeaCard). */

export const ACTION_META = {
  trend_idea: { key: 'trend_idea', label: 'Niche Trend Idea & Captions', emoji: '🔥', description: 'Current trend idea, viral hooks & captions in your language' },
  enhance: { key: 'enhance', label: 'Enhance Script', emoji: '✨', description: 'Make it more compelling and natural' },
  hooks: { key: 'hooks', label: 'Add Hook', emoji: '🎣', description: 'Add one attention-grabbing opening line' },
  grammar: { key: 'grammar', label: 'Fix Grammar', emoji: '📝', description: 'Correct grammar, spelling & punctuation' },
  cta: { key: 'cta', label: 'Improve CTA', emoji: '🎯', description: 'Strengthen the call to action' },
  tone: { key: 'tone', label: 'Improve Tone', emoji: '😊', description: 'Make it warmer and more conversational' },
  shorten: { key: 'shorten', label: 'Shorten Script', emoji: '✂️', description: 'Trim to about 2–2.5 minutes spoken (300–400 words)' },
  expand: { key: 'expand', label: 'Expand Script', emoji: '📈', description: 'Add context, examples & smoother transitions' },
};

export const DEFAULT_ACTION_ORDER = ['trend_idea', 'enhance', 'hooks', 'grammar', 'cta', 'tone', 'shorten', 'expand'];

export const isAction = (k) => Object.hasOwn(SYSTEM_PROMPTS, k);

export const SYSTEM_PROMPTS = {
  enhance:
    'Rewrite this short-form script (Reels/TikTok/Shorts) following these script-writing rules:\n' +
    '1. Must open with a strong hook in the first line — curiosity, tension, bold claim, or relatable pain point.\n' +
    '2. Must use engaging, emotional, and conversational language throughout — not flat or written-essay tone.\n' +
    '3. Must end with a clear, natural call to action.\n' +
    'Keep the original idea, message, and intent unchanged — only improve how it\'s delivered. Return only the enhanced script.',

  hooks:
    'Add ONE new hook line at the very top of this script, before the existing first line. ' +
    'The hook must grab attention within 1-3 seconds using curiosity, tension, a bold statement, or a relatable pain point, ' +
    'matching the tone and language of the existing script. ' +
    'Do not change, remove, or rewrite anything else in the script. Return the full script with the new hook line added at the top.',

  grammar:
    'Fix only spelling, grammar, and punctuation mistakes in this script. ' +
    'Do not change the wording, sentence structure, ideas, or script content in any other way. ' +
    'Return only the corrected script.',

  cta:
    'Rewrite only the ending of this script to include a strong call to action, following these rules:\n' +
    '1. The CTA must be clear and specific (follow, comment, share, save — whichever fits the content).\n' +
    '2. It must feel natural and match the script\'s existing tone, not sound like an ad.\n' +
    'Do not change any other part of the script. Return the full script with only the ending updated.',

  tone:
    'Rewrite this script using warmer, more conversational, and emotionally engaging language, following these rules:\n' +
    '1. Use natural, spoken-style phrasing, not formal or written-style sentences.\n' +
    '2. Add emotional and engagement-driving words where it fits naturally.\n' +
    '3. Keep the same sentence structure and order as much as possible.\n' +
    'Do not change the original message, idea, or intent. Return only the revised script.',

  shorten:
    'Rewrite this script so that when spoken aloud at a natural pace (~150-160 words per minute, ' +
    'typical for short-form video), it runs approximately 2 to 2.5 minutes — roughly 300 to 400 words total. ' +
    'Follow these rules:\n' +
    '1. Keep the opening hook intact.\n' +
    '2. Keep the closing CTA intact.\n' +
    '3. Preserve every core idea, key point, and main message from the original script — do not drop or summarize away the substance.\n' +
    '4. Tighten wording and remove only truly redundant, repetitive, or filler lines to hit the target length.\n' +
    'Do not rewrite the sentences that remain — keep their original wording. Return only the shortened script, ' +
    'and stay within the 300-400 word range.',

  expand:
    'Expand this script by adding new sentences for context, examples, and smoother transitions, following these rules:\n' +
    '1. Do not remove or rewrite any existing sentence — only insert new material.\n' +
    '2. Keep the existing hook and CTA exactly as they are.\n' +
    '3. New material must match the existing tone and voice.\n' +
    'Return only the expanded script.',

  trend_idea:
    'Generate ONE new short-form script concept based on current trends for our target niche and language. ' +
    'The concept must follow these script-writing rules:\n' +
    '1. Hook — a strong attention-grabbing opener in the first line.\n' +
    '2. Engagement — emotional, relatable, conversational language throughout.\n' +
    '3. CTA — a clear call to action at the end.\n' +
    'Include:\n' +
    '1) 🔥 Viral Hooks (3 options, under 12 words each, in the target language)\n' +
    '2) 💡 Trend Analysis & Script Outline (why this works right now, with a beat-by-beat outline: hook → build → payoff → CTA)\n' +
    '3) 📢 Viral Captions & Hashtags tailored for our target audience reach (e.g., if language is Tamil, provide high-reach ' +
    'Tamil captions, slang, and cultural hashtags).\n\n' +
    'Output everything formatted cleanly in the target audience language.',
};

export const DEFAULT_NICHES = [
  {
    title: '🚀 Tech & AI Reviews (Tamil)', language: 'Tamil',
    description: 'We create Tamil tech reviews targeted at young professionals and students in Tamil Nadu. Use engaging Tamil slang, cultural references, and high-retention hooks.',
  },
  {
    title: '💰 Personal Finance & Wealth', language: 'English',
    description: 'Actionable money-saving and investing tips for Gen Z and Millennials. Crisp, energetic tone with clear data takeaways.',
  },
  {
    title: '🧠 Productivity & Study Hacks', language: 'Hindi',
    description: 'Study and productivity routines tailored for Indian students and professionals. Energetic Hindi narration with viral captions.',
  },
];

/** The niche rules appended to every system prompt (empty when the user has no niche). */
export function nicheContext(niche) {
  if (!niche) return '';
  const lang = niche.language || 'English';
  return `
---
CRITICAL CONTENT NICHE & TARGET AUDIENCE RULES:
You are communicating with the user for their content niche: "${niche.title}".
Niche Content & Audience Context: "${niche.description}".
Target Audience Language: "${lang}".
IMPORTANT INSTRUCTION: You MUST tailor all answers, suggestions, edits, captions, hooks, and ideas strictly for this niche audience format, in the target language (${lang}), using current market trends and language-specific cultural reach/captions (e.g., if language is Tamil, provide high Tamil-reached audience captions, slang, and trend analysis).
---
`;
}

export const actionSystemPrompt = (action, niche) => `${SYSTEM_PROMPTS[action]}\n${nicheContext(niche)}`;

export function customSystemPrompt(prompt, niche) {
  return `You are a professional AI assistant. Edit or answer the user's script/question strictly according to the following custom instructions:
"${prompt}"

${nicheContext(niche)}

Return ONLY the final output or edited script content without any conversational filler, markdown formatting (unless appropriate for structured captions/ideas), or explanations. Do not include introductory text like "Here is the script."`;
}

export function dailyIdeaPrompt(niche, today) {
  const lang = niche.language || 'English';
  return `You are a viral content strategist who has studied thousands of top-performing short-form videos across TikTok, Reels, and Shorts. You specialize in the niche "${niche.title}" and understand exactly what makes audiences stop scrolling, watch to the end, and share.
TASK: Generate ONE specific, high-performing video/script concept for TODAY (${today}).
CONTEXT
- Niche: "${niche.title}"
- Audience & format: "${niche.description}"
- Output language for audience-facing text: "${lang}"
THINKING PROCESS (apply silently before writing the JSON — do not output this reasoning):
1. What's currently trending or seasonally relevant in this niche right now (this week/month), not a generic evergreen topic?
2. What specific hook (first 1-3 seconds) would stop this exact audience from scrolling? Name the hook mechanism (e.g. pattern interrupt, controversial claim, relatable pain point, curiosity gap, before/after).
3. What's the retention structure — how does the video escalate or pay off so people watch to the end?
4. What single clear action or takeaway should the viewer leave with?
QUALITY BAR — reject and redo internally if the idea:
- Could apply to almost any niche (too generic)
- Has no clear reason to be posted TODAY specifically vs any random day
- Doesn't name a concrete hook mechanism
- Uses cliché phrasing like "You won't believe..." or "Number 5 will shock you"
LANGUAGE RULES:
- "title" and "captions" must be written naturally in "${lang}" (not translated word-for-word from English — write as a native speaker of that market would).
- "description", "hook_mechanism", and "retention_strategy" must be in English (internal strategy notes for the creator).
OUTPUT FORMAT — return ONLY valid, parsable JSON. No markdown, no code fences, no commentary before or after:
{
  "niche": "${niche.title}",
  "language": "${lang}",
  "title": "Catchy, high-retention script title in ${lang}",
  "hook_mechanism": "Name the specific psychological hook used (e.g. curiosity gap, pattern interrupt, relatable pain point) and why it works for this audience",
  "description": "2-3 sentences: the current trend/timing angle, the core script arc, and why it's specifically relevant today",
  "retention_strategy": "1-2 sentences on how the script keeps viewers watching to the end (pacing, escalation, payoff)",
  "captions": [
    "🔥 Viral hook caption in ${lang} — should work as on-screen text or opening line",
    "📢 Engaging call-to-action caption in ${lang}",
    "#trend #viral #${lang.toLowerCase()}"
  ]
}`;
}

export const dailyIdeaUserMessage = (niche) => `Target Niche: ${niche.title} (${niche.language}) | Context: ${niche.description}`;

const clip = (s, n) => String(s ?? '').trim().slice(0, n);

/** Reads the model's answer: JSON when it is there, otherwise "title: / description: / captions:" lines. */
export function parseDailyIdea(raw, fallbackNiche, fallbackLang = 'English') {
  const text = String(raw ?? '');
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found');
    const p = JSON.parse(match[0]);
    return {
      title: clip(p.title, 200) || 'New Trend Script Concept',
      description: clip(p.description, 4000),
      hook_mechanism: clip(p.hook_mechanism, 1000),
      retention_strategy: clip(p.retention_strategy, 1000),
      niche: clip(p.niche, 120) || fallbackNiche,
      language: clip(p.language, 40) || fallbackLang,
      captions: Array.isArray(p.captions) ? p.captions.map((c) => clip(c, 500)).filter(Boolean).slice(0, 10) : [],
    };
  } catch {
    const lines = text.replace(/```json/gi, '').replace(/```/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    let title = '';
    let description = '';
    const captions = [];
    let section = '';
    const tidy = (s) => s.replace(/['",]$/, '').trim();
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.startsWith('title:')) { section = 'title'; title += `${tidy(line.slice(6))} `; }
      else if (lower.startsWith('description:')) { section = 'description'; description += `${line.slice(12).trim()}\n`; }
      else if (lower.startsWith('captions:')) { section = 'captions'; const c = tidy(line.slice(9)); if (c) captions.push(c); }
      else if (lower.startsWith('niche:') || lower.startsWith('language:')) section = 'ignore';
      else if (section === 'title') title += `${tidy(line)} `;
      else if (section === 'description' || section === '') description += `${line}\n`;
      else if (section === 'captions') { const c = tidy(line.replace(/^[-*•]\s*/, '')); if (c) captions.push(c); }
    }
    return {
      title: clip(title, 200) || 'New Trend Script Concept',
      description: clip(description, 4000),
      hook_mechanism: '',
      retention_strategy: '',
      niche: fallbackNiche,
      language: fallbackLang,
      captions: captions.slice(0, 10),
    };
  }
}

/** The notes of the script created when an idea is accepted (same layout as ScriptVault). */
export function ideaToNotes(idea, date) {
  const captions = idea.captions?.length ? `\n\n## 📢 Target Audience Captions & Hashtags\n${idea.captions.map((c) => `- ${c}`).join('\n')}` : '';
  const hook = idea.hook_mechanism ? `\n\n**Hook:** ${idea.hook_mechanism}` : '';
  const retention = idea.retention_strategy ? `\n\n**Retention:** ${idea.retention_strategy}` : '';
  return `# ${idea.title}\n\n**Niche:** ${idea.niche}\n**Language:** ${idea.language || 'English'}\n**Generated:** ${date}\n\n## Content Outline & Trend Analysis\n${idea.description}${hook}${retention}${captions}`;
}

// ---------------------------------------------------------------- video analysis

const REPORT_SHAPE = `{
  "score": 0-100 integer (overall performance),
  "verdict": "one sentence summary",
  "highlights": ["short key facts, each tied to a number given"],
  "worked": ["what worked well and why"],
  "didnt_work": ["what did not work and why"],
  "engagement": { "summary": "audience engagement analysis", "rate_note": "how the engagement rate compares" },
  "hook": { "score": 0-100 integer, "notes": "hook effectiveness: first 3-5 seconds" },
  "retention": { "available": true|false, "summary": "watch-time / retention analysis, or why it can't be judged" },
  "reasons_underperformed": ["possible reasons, framed as likely, not certain"],
  "comparison": { "summary": "how it compares with the creator's previous videos", "vs_median": ["metric: this vs median"] },
  "next_video": ["specific recommendations for the next video"],
  "action_steps": { "views": ["..."], "reach": ["..."], "engagement": ["..."], "growth": ["..."] },
  "corrections": [
    {
      "area": "hook | opening | caption | title | thumbnail | pacing | storytelling | cta | audio | visuals | length | hashtags | posting",
      "wrong": "exactly what is wrong, quoting the real line, caption or moment when you have it",
      "why": "why it hurts performance, tied to a number when one is given",
      "fix": "how to correct it, in one or two steps",
      "example": "a ready-to-use sample: the rewritten hook line / caption / title / CTA, or the re-cut opening described shot by shot"
    }
  ]
}`;

const PREUPLOAD_EXTRA = `,
  "first_seconds": { "hook": "...", "opening": "what happens in the first 3-5 seconds", "pacing": "...", "captions": "on-screen text / captions", "storytelling": "...", "quality": "visual / audio quality" }`;

const REPORT_RULES = `
RULES (follow every one):
- Use ONLY the numbers in the data. Never invent, estimate or round up a metric. If a number is missing, say "not available" and do not judge that part.
- Never promise views, reach or going viral. Talk about likelihood and what to change.
- Be specific and practical: name the exact moment, line, number or habit to change. No generic advice like "post consistently" unless the data shows why.
- Keep each list to at most 5 short items.
- CORRECTIONS ARE REQUIRED: for every item in "didnt_work" (and anything else that is wrong), add a "corrections" entry that says what is wrong, why, how to fix it, and a concrete sample in "example" the creator can copy (e.g. the rewritten first line they should say, a new caption, a new title, a better CTA, or the new opening shot by shot). Write the example in the creator's language and niche style.
- If the score is below 60, give at least 3 corrections, starting with the one that would help most. If the score is 60 or more, still correct anything weak (at least 1).
- Never give a correction without an example. "Make the hook stronger" alone is not allowed; write the stronger hook.
- Return ONLY valid, parsable JSON in exactly this shape. No markdown, no code fences, no text before or after.`;

/** System prompt for a report on a video that is already published, from its real platform numbers. */
export function publishedReportPrompt(niche) {
  return `You are a senior short-form and YouTube performance analyst. You explain to a creator why one of their published videos performed the way it did, using the analytics their platform returned and how it compares with their own previous videos.
The score reflects how this video performed for THIS creator (vs their median), not vs the whole platform: 50 = typical for them, above 70 = clearly better than usual, below 30 = clearly worse.
${REPORT_RULES}
${REPORT_SHAPE}
${nicheContext(niche)}`;
}

/** System prompt for checking a video before it is posted, from frames (and the video itself when the model can watch it). */
export function preUploadPrompt(niche, { watchesVideo }) {
  return `You are a senior short-form video editor and growth analyst. A creator is about to post a video and wants to know, before uploading, how likely it is to perform well and what to fix.
You are given ${watchesVideo ? 'the video itself plus' : ''} still frames taken from it (each labelled with its second; the first 5 seconds are sampled densely), its length and size, the caption/title they plan to use, the platforms, and (when available) the creator's typical numbers.
Judge the hook, the opening 3-5 seconds, content quality, storytelling, pacing, captions/on-screen text and engagement potential.${watchesVideo ? ' You can hear the audio: judge the voice, delivery and music too.' : ' You cannot hear audio: say so where it matters and judge only what is visible.'}
The score is the likelihood of performing well for this creator (50 = typical). "retention" and "comparison" are predictions here: say so.
${REPORT_RULES}
${REPORT_SHAPE.replace(/\n}$/, `${PREUPLOAD_EXTRA}\n}`)}
${nicheContext(niche)}`;
}

const list = (v, n = 5, len = 400) => (Array.isArray(v) ? v.map((x) => clip(typeof x === 'string' ? x : JSON.stringify(x), len)).filter(Boolean).slice(0, n) : []);
const score = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
};

/** Reads the model's report. Never throws: an answer that isn't JSON becomes a report holding just that text. */
export function parseVideoReport(raw) {
  const text = String(raw ?? '');
  let p;
  try {
    const match = text.replace(/```json/gi, '').replace(/```/g, '').match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found');
    p = JSON.parse(match[0]);
  } catch {
    return { score: null, verdict: clip(text, 4000) || 'The AI did not return a report. Try again.', parsed: false };
  }
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const steps = obj(p.action_steps);
  const fs = obj(p.first_seconds);
  const report = {
    parsed: true,
    score: score(p.score),
    verdict: clip(p.verdict, 400),
    highlights: list(p.highlights),
    worked: list(p.worked),
    didnt_work: list(p.didnt_work),
    engagement: { summary: clip(obj(p.engagement).summary, 1200), rate_note: clip(obj(p.engagement).rate_note, 400) },
    hook: { score: score(obj(p.hook).score), notes: clip(obj(p.hook).notes, 1200) },
    retention: { available: Boolean(obj(p.retention).available), summary: clip(obj(p.retention).summary, 1200) },
    reasons_underperformed: list(p.reasons_underperformed),
    comparison: { summary: clip(obj(p.comparison).summary, 1200), vs_median: list(obj(p.comparison).vs_median, 8, 200) },
    next_video: list(p.next_video),
    corrections: (Array.isArray(p.corrections) ? p.corrections : []).filter((c) => c && typeof c === 'object').slice(0, 8).map((c) => ({
      area: clip(c.area, 40).toLowerCase(),
      wrong: clip(c.wrong, 600),
      why: clip(c.why, 600),
      fix: clip(c.fix, 800),
      example: clip(c.example, 1500),
    })).filter((c) => c.wrong || c.fix || c.example),
    action_steps: { views: list(steps.views), reach: list(steps.reach), engagement: list(steps.engagement), growth: list(steps.growth) },
  };
  if (Object.keys(fs).length) {
    report.first_seconds = Object.fromEntries(['hook', 'opening', 'pacing', 'captions', 'storytelling', 'quality'].map((k) => [k, clip(fs[k], 800)]));
  }
  return report;
}

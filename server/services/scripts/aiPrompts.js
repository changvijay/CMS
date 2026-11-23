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

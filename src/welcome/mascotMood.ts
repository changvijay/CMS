// Pixel, the landing page mascot: which face to show, and what to say when clicked.
// Pure functions so the rules can be tested without a browser.

export const MASCOT_NAME = 'Pixel';

export type Mood =
  | 'clicked' | 'dizzy' | 'shy' | 'excited' | 'surprised' | 'sleepy' | 'playful'
  | 'wow' | 'love' | 'thinking' | 'happy';

export type Section = 'hero' | 'features' | 'tour' | 'how' | 'results' | 'pricing' | 'faq' | 'other';

export const CLICK_MS = 2500; // happy face after a click
export const SLEEP_MS = 10000; // no pointer or scroll for this long: falls asleep
export const SURPRISE_MS = 700; // quick surprised blink on waking

export interface MoodState {
  now: number;
  clickedAt: number; // -Infinity when never clicked
  lastActivity: number; // last pointer move or scroll
  wokeAt: number; // when it last woke from sleep
  overMascot: boolean;
  overCta: boolean;
  fastPointer: boolean;
  dizzy: boolean; // just did a flip after the mouse was shaken
  section: Section;
}

const SECTION_MOOD: Partial<Record<Section, Mood>> = {
  results: 'wow',
  pricing: 'love',
  faq: 'thinking',
};

/**
 * Highest priority first: a click, a dizzy flip, being caught, a button, sleep, waking,
 * a fast chase, then the section on screen.
 */
export function pickMood(s: MoodState): Mood {
  if (s.now - s.clickedAt < CLICK_MS) return 'clicked';
  if (s.dizzy) return 'dizzy';
  if (s.overMascot) return 'shy';
  if (s.overCta) return 'excited';
  if (s.now - s.lastActivity >= SLEEP_MS) return 'sleepy';
  if (s.now - s.wokeAt < SURPRISE_MS) return 'surprised';
  if (s.fastPointer) return 'playful';
  return SECTION_MOOD[s.section] ?? 'happy';
}

/**
 * The mouse was shaken: at least four left/right direction changes at speed within the window.
 * `turns` holds the times of recent direction changes.
 */
export function isShake(turns: number[], now: number, windowMs = 900): boolean {
  return turns.filter((t) => now - t <= windowMs).length >= 4;
}

export const LINES: Record<Section, string[]> = {
  hero: [
    `Hi, I am ${MASCOT_NAME}. I watch your numbers so you do not have to.`,
    'Four platforms, one dashboard. My ears can only take one tab.',
    'Those cables? Your data, running home to me.',
  ],
  features: [
    'Five jobs, one dashboard. Fewer tabs, happier you.',
    'I rank what to post next. Treats are optional.',
    'Comment "link" and I fetch it. Good boy energy.',
  ],
  tour: [
    'This is the Strategy tab. It tells you what to fix first.',
    'Write once, post to four places. Paws save time.',
    'Auto replies never sleep. I do, sometimes.',
  ],
  how: [
    'Connect, update, follow the plan. Even I can do it.',
    'Three steps. I counted them on my paws.',
    'Numbers refresh every night while you sleep.',
  ],
  results: [
    'Those are real numbers. I sniffed them twice.',
    'Reach up 1,340.9%. I wagged my tail for that one.',
    'A real account runs on the studio today.',
  ],
  pricing: [
    'Two tools cost ₹40,090. I come with ₹7,999. Just saying.',
    'One plan, every feature. No surprise bills.',
    'That stamp? I put it there myself.',
  ],
  faq: [
    'Ask away. Fetching answers is my favourite game.',
    'Still curious? The user manual has every screen.',
    'Good questions get a head tilt from me.',
  ],
  other: [
    `Hi, I am ${MASCOT_NAME}. Press me any time for a tip.`,
    'I follow your cursor. It is my favourite toy.',
    'Scroll on, I will keep watch.',
  ],
};

/**
 * The line for the n-th click (0 based) in a section. Every third click also offers
 * the waiting list link.
 */
export function lineFor(section: Section, clickIndex: number): { text: string; showCta: boolean } {
  const lines = LINES[section] ?? LINES.other;
  const i = ((clickIndex % lines.length) + lines.length) % lines.length;
  return { text: lines[i], showCta: clickIndex % 3 === 2 };
}

/** Maps a section element id to a mascot section. */
export function sectionFromId(id: string): Section {
  switch (id) {
    case 'features': return 'features';
    case 'tour': return 'tour';
    case 'how': return 'how';
    case 'results': return 'results';
    case 'pricing': return 'pricing';
    case 'faq': return 'faq';
    case 'hero': return 'hero';
    default: return 'other';
  }
}

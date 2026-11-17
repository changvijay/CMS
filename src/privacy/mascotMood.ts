// Pixel, the site mascot: which face to show, and what to say when clicked.
// Copied from ChangMarketReport for the CMS Studio privacy policy page (/privacy). Pure functions so the rules stay easy to test.

export const MASCOT_NAME = "Pixel";

export type Mood =
  | "clicked" | "dizzy" | "shy" | "excited" | "surprised" | "sleepy" | "playful"
  | "wow" | "love" | "thinking" | "happy";

export type Section = "intro" | "collect" | "use" | "share" | "keep" | "rights" | "contact" | "other";

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
  collect: "thinking",
  share: "shy",
  rights: "love",
};

/**
 * Highest priority first: a click, a dizzy flip, being caught, a button, sleep, waking,
 * a fast chase, then the page on screen.
 */
export function pickMood(s: MoodState): Mood {
  if (s.now - s.clickedAt < CLICK_MS) return "clicked";
  if (s.dizzy) return "dizzy";
  if (s.overMascot) return "shy";
  if (s.overCta) return "excited";
  if (s.now - s.lastActivity >= SLEEP_MS) return "sleepy";
  if (s.now - s.wokeAt < SURPRISE_MS) return "surprised";
  if (s.fastPointer) return "playful";
  return SECTION_MOOD[s.section] ?? "happy";
}

/**
 * The mouse was shaken: at least four left/right direction changes at speed within the window.
 * `turns` holds the times of recent direction changes.
 */
export function isShake(turns: number[], now: number, windowMs = 900): boolean {
  return turns.filter((t) => now - t <= windowMs).length >= 4;
}

export const LINES: Record<Section, string[]> = {
  intro: [
    `Hi, I am ${MASCOT_NAME}. I read this whole policy so you can skim it.`,
    "Short version: your data runs your studio, and nothing else.",
    "No ads, no trackers, no selling. I checked the code myself.",
  ],
  collect: [
    "Only the photos you pick. I never peek at the rest of your gallery.",
    "No camera, no microphone, no location. My ears stay down.",
    "Your password is scrambled before it is stored. Even I cannot read it.",
  ],
  use: [
    "Your numbers are used to draw your charts. That is the whole job.",
    "Comment summaries are worked out on our own server. No outside AI.",
    "Posts only go out when you press publish or schedule them.",
  ],
  share: [
    "We only talk to Instagram, Facebook, YouTube and LinkedIn when you ask.",
    "Nobody buys your data from us. Not even for treats.",
    "Google Cloud keeps the server and your uploads safe.",
  ],
  keep: [
    "Daily stats older than 30 days are cleared out every night.",
    "Disconnect an account and its stored history goes with it.",
    "Your sign-in key lives in the phone's secure vault.",
  ],
  rights: [
    "Want everything deleted? One email does it.",
    "You can disconnect any account from More, Connected accounts.",
    "Ask for a copy of your data any time.",
  ],
  contact: [
    "Questions? Write to us. A real person reads every email.",
    "We reply within 30 days, usually much sooner.",
    "Thanks for reading to the end. Gold star for you.",
  ],
  other: [
    `Hi, I am ${MASCOT_NAME}. Press me any time for a tip.`,
    "I follow your cursor. It is my favourite toy.",
    "Scroll on, I will keep watch.",
  ],
};

/** The line for the n-th click (0 based) on a page. Every third click also offers a page link. */
export function lineFor(section: Section, clickIndex: number): { text: string; showCta: boolean } {
  const lines = LINES[section] ?? LINES.other;
  const i = ((clickIndex % lines.length) + lines.length) % lines.length;
  return { text: lines[i], showCta: clickIndex % 3 === 2 };
}

/** Maps a section element id on the privacy page to a mascot section. */
export function sectionFromId(id: string): Section {
  const known: Section[] = ["intro", "collect", "use", "share", "keep", "rights", "contact"];
  return (known as string[]).includes(id) ? (id as Section) : "other";
}

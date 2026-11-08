// Pixel, the landing page mascot.
// With a mouse (and motion allowed) Pixel plays around the cursor like a pet on a short
// leash: it trails about 10px away, hops while it runs, leans into turns, flips when you
// shake the mouse, and does little tricks when you stop. Clicks pass straight through it;
// rest the cursor on Pixel for a moment to catch it, then press it for a tip.
// On touch screens, or with reduced motion, Pixel sits in the bottom right corner instead.
// Faces and colours live in the CSS (data-mood); this file picks the mood and moves things.
import { CLICK_MS, SLEEP_MS, isShake, lineFor, pickMood, sectionFromId, type Mood, type Section } from './mascotMood';

const OLD_HIDE_KEY = 'pixel-hidden'; // set by the removed × button; cleared so Pixel comes back
const SECTION_IDS = ['hero', 'features', 'tour', 'how', 'results', 'pricing', 'compare', 'faq'];

const GAP = 10; // px between the cursor and Pixel's edge
const PERCH_SCALE = 1.5; // size while sitting on the hero screenshot
const SPRING = 0.09; // pull toward the target each frame
const DAMPING = 0.78; // velocity kept each frame (lower is calmer)
const CATCH_MS = 250; // rest the cursor on Pixel this long to make it pressable
const TALK_RANGE = 220; // Pixel waits beside an open bubble until the cursor goes this far

// What each mood adds on top of the tracking: where the eyes rest, head tilt, ear lift.
const POSE: Partial<Record<Mood, { eyeX?: number; eyeY?: number; tilt?: number; earL?: number; earR?: number; track?: boolean }>> = {
  shy: { eyeY: 4, track: false, tilt: 4 },
  thinking: { eyeX: 3, eyeY: -4, track: false, tilt: -4 },
  sleepy: { track: false, earL: 10, earR: -10, tilt: 6 },
  dizzy: { track: false, tilt: 8 },
  playful: { earL: -10, earR: 10 },
  excited: { earL: -18, earR: 18 },
  clicked: { earL: -12, earR: 12 },
  love: { earL: -8, earR: 8 },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function startMascot({ reduce }: { reduce: boolean }) {
  try { localStorage.removeItem(OLD_HIDE_KEY); } catch { /* storage blocked: nothing to clear */ }
  const found = document.getElementById('mascot');
  if (!found) return null;
  const root: HTMLElement = found;

  const fig = root.querySelector<HTMLElement>('.mascot-fig');
  const btn = root.querySelector<HTMLButtonElement>('.mascot-btn');
  const bubbleText = root.querySelector<HTMLElement>('.mascot-bubble p');
  const bubbleCta = root.querySelector<HTMLElement>('.mascot-cta');
  const head = root.querySelector<SVGGElement>('.pixel-head');
  const eyes = root.querySelector<SVGGElement>('.pixel-eyes');
  const earL = root.querySelector<SVGGElement>('.pixel-ear-l');
  const earR = root.querySelector<SVGGElement>('.pixel-ear-r');
  const anchor = document.querySelector<HTMLElement>('.mascot-anchor');
  if (!fig || !btn || !bubbleText || !bubbleCta || !head || !eyes || !earL || !earR) return null;

  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const follow = finePointer && !reduce; // mouse: plays around the cursor
  const roams = !finePointer && !reduce; // touch: zigzags across the screen while you scroll
  const moves = follow || roams;
  if (follow) root.classList.add('is-following');
  if (roams) root.classList.add('is-roaming');
  root.hidden = false;

  // ---------- State ----------
  const now = () => performance.now();
  const s = {
    clickedAt: -Infinity, lastActivity: now(), wokeAt: -Infinity, dizzyUntil: 0,
    overMascot: false, overCta: false, fastUntil: 0, section: 'hero' as Section,
  };
  let mood: Mood = 'happy';
  const clicks: Partial<Record<Section, number>> = {};
  const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, inside: false, speed: 0 };
  const cur = { ex: 0, ey: 0, hx: 0, hy: 0, rot: 0 };
  const ears = { l: 0, lv: 0, r: 0, rv: 0 };
  let lastMove = { x: 0, y: 0, t: 0, dir: 0 };
  let lastPointerAt = -Infinity;
  const turns: number[] = [];
  let talking = false;

  // Moving modes: `pos` is Pixel's feet (bottom centre) in viewport pixels.
  type Mode = 'perched' | 'following' | 'roaming' | 'home';
  const pos = { x: 0, y: 0, vx: 0, vy: 0, scale: 1, phase: 0 };
  let mode: Mode = 'home';
  const perchScale = roams ? 1.2 : PERCH_SCALE;

  // Roaming: a zigzag of random points on alternate sides of the screen; scrolling walks it.
  const ROAM_STEP = 220; // px of scroll per zigzag leg
  const ROAM_REST_MS = 2000; // after this long without scrolling, walk back to the corner
  const roam = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, t: 0, side: 1, lastAt: -Infinity, talkScroll: 0 };
  const rand = (lo: number, hi: number) => lo + Math.random() * Math.max(0, hi - lo);
  const nextRoamPoint = () => {
    const { w } = size();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    roam.side *= -1;
    const x = roam.side < 0 ? rand(w / 2 + 12, vw * 0.38) : rand(vw * 0.62, vw - w / 2 - 12);
    return { x, y: rand(vh * 0.32, vh * 0.86) };
  };

  const size = () => ({ w: root.offsetWidth, h: root.offsetHeight });
  const homePoint = () => ({ x: window.innerWidth - 24 - size().w / 2, y: window.innerHeight - 24 });
  const perchPoint = () => {
    if (!anchor) return null;
    const r = anchor.getBoundingClientRect();
    return r.top > 40 && r.top < window.innerHeight + 40 ? { x: r.left, y: r.top } : null;
  };

  const setMood = () => {
    const t = now();
    const next = pickMood({ now: t, ...s, fastPointer: t < s.fastUntil, dizzy: t < s.dizzyUntil });
    if (next !== mood) {
      mood = next;
      root.dataset.mood = next;
      kick();
    }
  };

  const markActivity = () => {
    const t = now();
    if (t - s.lastActivity >= SLEEP_MS) s.wokeAt = t; // was asleep: wake with a surprised blink
    s.lastActivity = t;
  };

  const act = (name: 'act-jump' | 'act-spin', ms: number) => {
    root.classList.remove('act-jump', 'act-spin');
    void root.offsetWidth; // restart the animation if it is already running
    root.classList.add(name);
    window.setTimeout(() => root.classList.remove(name), ms);
  };

  // ---------- Movement (follow and roaming modes) ----------
  const step = () => {
    const { w, h } = size();
    let tx = pos.x;
    let ty = pos.y;
    let tScale = 1;

    if (mode === 'perched') {
      const p = perchPoint();
      if (p) { tx = p.x; ty = p.y; tScale = perchScale; } else mode = 'home';
    }
    if (mode === 'roaming') {
      if (!talking) {
        tx = roam.a.x + (roam.b.x - roam.a.x) * roam.t;
        ty = roam.a.y + (roam.b.y - roam.a.y) * roam.t;
      }
      // Look where it is going.
      pointer.x = pos.x + pos.vx * 30 + (roam.b.x - pos.x) * 0.3;
      pointer.y = pos.y - h / 2 + pos.vy * 30;
    }
    if (mode === 'home') {
      const p = homePoint();
      tx = p.x; ty = p.y;
    }
    if (mode === 'following') {
      // Pull Pixel's centre to within GAP of the cursor, trailing behind it. Inside that
      // distance it stays put, so the cursor can walk up to it.
      const cx = pos.x;
      const cy = pos.y - h / 2;
      const dx = pointer.x - cx;
      const dy = pointer.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      // Distance from Pixel's centre to its own edge in the cursor's direction, plus the gap,
      // plus room for the arrow pointer when Pixel sits below and right of it.
      const ux = dx / d;
      const uy = dy / d;
      const toEdge = Math.min(w / 2 / Math.max(Math.abs(ux), 1e-3), h / 2 / Math.max(Math.abs(uy), 1e-3));
      const arrow = 32 * Math.max(0, -ux) * Math.max(0, -uy);
      const reach = toEdge + GAP + arrow;
      // A slow, deliberate approach lets you catch Pixel; otherwise it keeps its distance.
      const slowApproach = now() - lastPointerAt < 300 && pointer.speed < 0.35;
      if (talking && d < TALK_RANGE) { pos.vx *= 0.6; pos.vy *= 0.6; } // wait beside the bubble
      else if (d <= reach && (s.overMascot || slowApproach)) { pos.vx *= 0.6; pos.vy *= 0.6; }
      else { tx = pointer.x - (dx / d) * reach; ty = pointer.y - (dy / d) * reach + h / 2; }
      if (talking && d >= TALK_RANGE) closeBubble();
    }

    tx = clamp(tx, w / 2 + 8, window.innerWidth - w / 2 - 8);
    ty = clamp(ty, h + 8, window.innerHeight - 8);

    pos.vx = (pos.vx + (tx - pos.x) * SPRING) * DAMPING;
    pos.vy = (pos.vy + (ty - pos.y) * SPRING) * DAMPING;
    pos.x += pos.vx;
    pos.y += pos.vy;
    pos.scale += (tScale - pos.scale) * 0.15;

    // Hop while running, squash a little on each landing, lean into the turn.
    const speed = Math.hypot(pos.vx, pos.vy);
    const running = speed > 0.6;
    pos.phase += speed * 0.09;
    const air = Math.abs(Math.sin(pos.phase));
    const hop = running ? -air * Math.min(9, speed * 0.9) : 0;
    const squash = running ? 1 - (1 - air) * 0.08 : 1;
    const lean = clamp(pos.vx * 1.6, -16, 16);
    // Running flaps the ears.
    ears.lv -= pos.vx * 0.25;
    ears.rv -= pos.vx * 0.25;

    root.style.transform = `translate3d(${(pos.x - w / 2).toFixed(1)}px, ${(pos.y - h).toFixed(1)}px, 0)`;
    fig.style.transform = `translateY(${hop.toFixed(2)}px) rotate(${lean.toFixed(2)}deg) scale(${(pos.scale * (2 - squash)).toFixed(3)}, ${(pos.scale * squash).toFixed(3)})`;
    fig.style.setProperty('--s', pos.scale.toFixed(3));

    return speed > 0.05 || Math.abs(tScale - pos.scale) > 0.005 || Math.hypot(tx - pos.x, ty - pos.y) > 0.5;
  };

  // ---------- Animation loop: runs only while something is moving ----------
  let raf = 0;
  const frame = () => {
    raf = 0;
    const moving = moves ? step() : false;

    const box = btn.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height * 0.45;
    const pose = POSE[mood] ?? {};
    const track = pose.track !== false;

    const dx = pointer.x - cx;
    const dy = pointer.y - cy;
    const dist = Math.hypot(dx, dy);
    const k = Math.min(1, dist / (moves ? 70 : 260));
    const a = Math.atan2(dy, dx);
    const ex = track ? Math.cos(a) * 6 * k : pose.eyeX ?? 0;
    const ey = track ? Math.sin(a) * 4 * k : pose.eyeY ?? 0;
    const rot = (track ? clamp(dx / 70, -8, 8) : 0) + (pose.tilt ?? 0);

    const ease = reduce ? 1 : 0.14;
    cur.ex += (ex - cur.ex) * ease;
    cur.ey += (ey - cur.ey) * ease;
    cur.hx += (ex * 0.5 - cur.hx) * ease;
    cur.hy += (ey * 0.5 - cur.hy) * ease;
    cur.rot += (rot - cur.rot) * ease;

    // Ears hang from the head and swing the other way when it turns, on a spring.
    const earTargetL = -cur.rot * 1.4 + (pose.earL ?? 0);
    const earTargetR = -cur.rot * 1.4 + (pose.earR ?? 0);
    if (reduce) {
      ears.l = earTargetL; ears.r = earTargetR; ears.lv = 0; ears.rv = 0;
    } else {
      ears.lv = (ears.lv + (earTargetL - ears.l) * 0.12) * 0.8;
      ears.rv = (ears.rv + (earTargetR - ears.r) * 0.12) * 0.8;
      ears.l = clamp(ears.l + ears.lv, -40, 40);
      ears.r = clamp(ears.r + ears.rv, -40, 40);
    }

    head.style.transform = `translate(${cur.hx.toFixed(2)}px, ${cur.hy.toFixed(2)}px) rotate(${cur.rot.toFixed(2)}deg)`;
    eyes.style.transform = `translate(${(cur.ex - cur.hx).toFixed(2)}px, ${(cur.ey - cur.hy).toFixed(2)}px)`;
    earL.style.transform = `translate(${cur.hx.toFixed(2)}px, ${cur.hy.toFixed(2)}px) rotate(${ears.l.toFixed(2)}deg)`;
    earR.style.transform = `translate(${cur.hx.toFixed(2)}px, ${cur.hy.toFixed(2)}px) rotate(${ears.r.toFixed(2)}deg)`;

    const settled = Math.abs(ex - cur.ex) + Math.abs(ey - cur.ey) + Math.abs(rot - cur.rot) < 0.05
      && Math.abs(ears.lv) + Math.abs(ears.rv) < 0.02;
    if (!document.hidden && (moving || !settled || now() - lastPointerAt < 2000)) kick();
  };
  function kick() {
    if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  }

  // ---------- Catching: rest the cursor on Pixel to make it pressable ----------
  let catchTimer = 0;
  const setOver = (over: boolean) => {
    if (over === s.overMascot) return;
    s.overMascot = over;
    window.clearTimeout(catchTimer);
    if (over) catchTimer = window.setTimeout(() => root.classList.add('catchable'), CATCH_MS);
    else if (!talking) root.classList.remove('catchable');
    setMood();
  };

  // ---------- Pointer, scroll and hover ----------
  window.addEventListener('pointermove', (e) => {
    const t = now();
    if (e.pointerType !== 'touch') {
      const dt = Math.max(1, t - lastMove.t);
      const vx = (e.clientX - lastMove.x) / dt;
      const speed = Math.hypot(e.clientX - lastMove.x, e.clientY - lastMove.y) / dt;
      if (lastMove.t && speed > 2.2) s.fastUntil = t + 600;
      // A shake: quick left/right reversals.
      const dir = Math.abs(vx) > 1 ? Math.sign(vx) : 0;
      if (dir && lastMove.dir && dir !== lastMove.dir) {
        turns.push(t);
        while (turns.length && t - turns[0] > 900) turns.shift();
        if (follow && isShake(turns, t) && t > s.dizzyUntil) {
          s.dizzyUntil = t + 1400;
          turns.length = 0;
          act('act-spin', 800);
        }
      }
      lastMove = { x: e.clientX, y: e.clientY, t, dir: dir || lastMove.dir };
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.inside = true;
      pointer.speed = lastMove.t ? speed : 0;
      lastPointerAt = t;
      if (follow) {
        if (mode !== 'following') mode = 'following'; // the first move: jump off the screenshot
        const r = btn.getBoundingClientRect();
        setOver(e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
      }
    }
    markActivity();
    setMood();
    kick();
  }, { passive: true });

  // Cursor left the window: run home to the corner.
  document.documentElement.addEventListener('mouseleave', () => {
    pointer.inside = false;
    if (follow) { mode = 'home'; setOver(false); kick(); }
  });

  // Touch: look at the last tap, and up or down with the scroll.
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') { pointer.x = e.clientX; pointer.y = e.clientY; lastPointerAt = now(); kick(); }
    markActivity();
  }, { passive: true });
  let lastScrollY = window.scrollY;
  window.addEventListener('scroll', () => {
    markActivity();
    const dy = Math.abs(window.scrollY - lastScrollY);
    if (roams) {
      if (talking) {
        // A bubble is open: Pixel waits, and a real scroll closes the bubble.
        roam.talkScroll += dy;
        if (roam.talkScroll > 120) closeBubble();
      } else {
        if (mode !== 'roaming') {
          mode = 'roaming';
          roam.a = { x: pos.x, y: pos.y };
          roam.b = nextRoamPoint();
          roam.t = 0;
        }
        roam.t += dy / ROAM_STEP;
        while (roam.t >= 1) { roam.t -= 1; roam.a = roam.b; roam.b = nextRoamPoint(); }
      }
      roam.lastAt = now();
      lastPointerAt = now();
    } else if (!finePointer) {
      const box = btn.getBoundingClientRect();
      const down = window.scrollY > lastScrollY;
      pointer.x = box.left + box.width / 2;
      pointer.y = box.top + (down ? 400 : -400);
      lastPointerAt = now();
    }
    lastScrollY = window.scrollY;
    setMood();
    kick();
  }, { passive: true });

  document.addEventListener('pointerover', (e) => {
    const el = e.target instanceof Element ? e.target : null;
    if (!follow) s.overMascot = Boolean(el?.closest('.mascot-btn'));
    s.overCta = !el?.closest('.mascot') && Boolean(el?.closest('.btn-primary'));
    setMood();
  });
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) { if (!follow) s.overMascot = false; s.overCta = false; setMood(); }
  });

  // ---------- Which section is on screen ----------
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) s.section = sectionFromId(en.target.id);
    setMood();
  }, { rootMargin: '-45% 0px -50% 0px' });
  SECTION_IDS.forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });

  // ---------- Time based moods, blinking, and tricks while you rest ----------
  setInterval(() => {
    if (document.hidden) return;
    // Scrolling stopped a while ago: walk back to the corner so Pixel does not cover the page.
    if (roams && mode === 'roaming' && !talking && now() - roam.lastAt > ROAM_REST_MS) { mode = 'home'; kick(); }
    setMood();
  }, 400);
  const blink = () => {
    if (!document.hidden && mood !== 'sleepy' && mood !== 'clicked' && mood !== 'dizzy') {
      root.classList.add('blink');
      setTimeout(() => root.classList.remove('blink'), 140);
    }
    setTimeout(blink, 3000 + Math.random() * 3000);
  };
  setTimeout(blink, 2500);

  if (follow) {
    const play = () => {
      const t = now();
      const resting = mode === 'following' && t - lastPointerAt > 1200 && !talking;
      if (!document.hidden && resting && mood !== 'sleepy' && mood !== 'dizzy') {
        const roll = Math.random();
        if (roll < 0.45) act('act-jump', 700);
        else if (roll < 0.85) { ears.lv += 22; ears.rv -= 22; }
        else act('act-spin', 800);
        kick();
      }
      window.setTimeout(play, 3500 + Math.random() * 2500);
    };
    window.setTimeout(play, 4000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { markActivity(); setMood(); kick(); } });

  // ---------- Click: a short line, with the waiting list every third time ----------
  let bubbleTimer = 0;
  function closeBubble() {
    talking = false;
    roam.talkScroll = 0;
    root.classList.remove('talking');
    if (!s.overMascot) root.classList.remove('catchable');
    window.clearTimeout(bubbleTimer);
  }
  const placeBubble = () => {
    const r = root.getBoundingClientRect();
    root.classList.toggle('bubble-left', r.left + r.width < 260);
    root.classList.toggle('bubble-below', r.top < 150);
  };
  btn.addEventListener('click', () => {
    const n = clicks[s.section] ?? 0;
    clicks[s.section] = n + 1;
    const { text, showCta } = lineFor(s.section, n);
    bubbleText.textContent = text;
    bubbleCta.hidden = !showCta;
    placeBubble();
    talking = true;
    roam.talkScroll = 0;
    root.classList.add('talking');
    s.clickedAt = now();
    markActivity();
    setMood();
    window.clearTimeout(bubbleTimer);
    bubbleTimer = window.setTimeout(closeBubble, 6000);
    window.setTimeout(setMood, CLICK_MS + 50);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBubble(); });
  document.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Node && !root.contains(e.target)) closeBubble();
  });

  // ---------- Start ----------
  if (moves) {
    const p = perchPoint();
    const start = p ?? homePoint();
    mode = p ? 'perched' : 'home';
    pos.x = start.x;
    pos.y = start.y;
    pos.scale = p ? perchScale : 1;
    step();
  }
  root.dataset.mood = mood;
  kick();
  return { root, fig, moves };
}

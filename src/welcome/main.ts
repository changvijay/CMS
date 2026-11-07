// Motion layer for the landing page. The page works without it: the inline script in
// welcome/index.html already handles the menu, scroll reveals and the tagline.
// The scroll layouts (sticky tour, stacked cards, sticky tagline) switch on through the
// "motion" class on <html>, so without this script the page keeps its plain layout.
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { startMascot } from './mascot'

gsap.registerPlugin(ScrollTrigger)

const root = document.documentElement
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string) => gsap.utils.toArray<T>(sel)

// Closest GSAP ease to the page's base curve, cubic-bezier(0.22, 1, 0.36, 1).
const EASE = 'power4.out'
const MOTION = '(prefers-reduced-motion: no-preference)'

// ---------- 3D hero scene, loaded after first paint so it never delays the page ----------
const fx = $('.hero-fx')
const canvas = $<HTMLCanvasElement>('#heroCanvas')
const stage = $('.frame-stage')
const frame = $('.frame')
if (fx && canvas && stage && frame) {
  const load = () => import('./scene').then((m) => m.startHeroScene({ fx, canvas, stage, frame, reduce }))
  if ('requestIdleCallback' in window) window.requestIdleCallback(load, { timeout: 1200 })
  else setTimeout(load, 300)
}

// ---------- Pixel, the mascot (moves itself: follows a mouse, zigzags on touch scroll) ----------
startMascot({ reduce })

// ---------- Nav gets a firmer surface once the page moves ----------
const nav = $('#nav')
ScrollTrigger.create({ start: 32, end: 'max', onToggle: (self) => nav?.classList.toggle('scrolled', self.isActive) })

const mm = gsap.matchMedia()

mm.add(MOTION, () => {
  root.classList.add('motion')
  const restore: Array<() => void> = [() => root.classList.remove('motion')]

  // ---------- Hero intro ----------
  // The inline head script hides these with the "intro" class until this runs.
  if (root.classList.contains('intro')) {
    const show = { opacity: 1, y: 0 }
    gsap.timeline({ defaults: { ease: EASE, duration: 1 }, onComplete: () => root.classList.remove('intro') })
      .fromTo('.hero .badge', { opacity: 0, y: 16 }, { ...show, duration: 0.8 })
      .fromTo('.hero h1 .line > span', { y: 0, yPercent: 110 }, { y: 0, yPercent: 0, duration: 1.1, stagger: 0.09 }, '-=0.6')
      .fromTo('.hero .lead', { opacity: 0, y: 24 }, show, '-=0.8')
      .fromTo('.hero .hero-cta', { opacity: 0, y: 24 }, show, '-=0.85')
      .fromTo('.frame-stage', { opacity: 0, y: 80 }, { ...show, duration: 1.4 }, '-=0.8')
      .fromTo('.node-chip', { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.9, stagger: 0.08 }, '-=1.2')
      .fromTo('#heroCanvas', { opacity: 0 }, { opacity: 1, duration: 1.2 }, '<')
  }

  // Platform chips float gently.
  $$('.node-chip').forEach((chip, i) => {
    gsap.to(chip, { y: -8, duration: 2.6 + i * 0.35, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: i * 0.2 })
  })

  // ---------- Hero exit: copy drifts slower than the page and fades, the screenshot stands up ----------
  gsap.to('.hero-copy', {
    y: 140, opacity: 0, ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: '+=560', scrub: true },
  })
  gsap.fromTo('.frame', { rotateX: 24, scale: 0.92 }, {
    rotateX: 0, scale: 1, ease: 'none',
    scrollTrigger: { trigger: '.frame-stage', start: 'top bottom', end: 'top 20%', scrub: 0.8 },
  })
  gsap.to('.hero-fx', {
    opacity: 0, ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: '+=640', scrub: true },
  })

  // ---------- Reading progress ----------
  gsap.to('.progress span', { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } })

  // ---------- Parallax: section headings move a little slower than the page ----------
  // Kicker, heading and subtitle move together so they never overlap.
  $$('.section-head').forEach((head) => {
    gsap.fromTo(head.children, { y: 32 }, {
      y: -32, ease: 'none',
      scrollTrigger: { trigger: head, start: 'top bottom', end: 'bottom top', scrub: true },
    })
  })

  // ---------- Sticky tagline: the line holds still while its words light up in order ----------
  const words = $$('#tagline .w')
  if (words.length) {
    ;(window as Window & { taglineObserver?: IntersectionObserver }).taglineObserver?.disconnect()
    ScrollTrigger.create({
      trigger: '.tagline', start: 'top top', end: 'bottom bottom',
      onUpdate: (self) => {
        const lit = Math.round(Math.min(1, self.progress * 1.15) * words.length)
        words.forEach((w, i) => w.classList.toggle('on', i < lit))
      },
    })
    gsap.fromTo('#tagline', { scale: 0.92, opacity: 0.6 }, {
      scale: 1, opacity: 1, ease: 'none',
      scrollTrigger: { trigger: '.tagline', start: 'top bottom', end: 'top top', scrub: true },
    })
  }

  // ---------- Stacked cards: each step sticks, the ones underneath sink back ----------
  const cards = $$('.stack-card')
  const last = cards[cards.length - 1]
  const stickyTop = (el: HTMLElement) => parseFloat(getComputedStyle(el).top) || 0
  cards.slice(0, -1).forEach((card, i) => {
    const inner = card.querySelector('.stack-inner')
    if (!inner || !last) return
    const scrollTrigger = {
      trigger: card, start: () => `top ${stickyTop(card)}`,
      endTrigger: last, end: () => `top ${stickyTop(last)}`,
      scrub: true, invalidateOnRefresh: true,
    }
    // The card stays solid so nothing shows through; only its content dims.
    gsap.to(inner, { scale: 1 - (cards.length - 1 - i) * 0.05, ease: 'none', scrollTrigger })
    gsap.to(inner.children, { opacity: 0.35, ease: 'none', scrollTrigger: { ...scrollTrigger } })
  })

  // ---------- Results: the case card rises into place, numbers count up once ----------
  gsap.fromTo('.case', { opacity: 0.3, y: 64, scale: 0.94 }, {
    opacity: 1, y: 0, scale: 1, ease: 'none',
    scrollTrigger: { trigger: '.case', start: 'top bottom', end: 'top 55%', scrub: 0.8 },
  })
  $$('.stat .value').forEach((el) => {
    const final = el.textContent ?? ''
    const match = final.match(/^([\d,]+(?:\.(\d+))?)(.*)$/)
    if (!match) return
    const end = Number(match[1].replace(/,/g, ''))
    const decimals = match[2]?.length ?? 0
    const suffix = match[3]
    const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix
    const counter = { v: 0 }
    el.textContent = fmt(0)
    gsap.to(counter, {
      v: end, duration: 1.6, ease: 'power3.out',
      onUpdate: () => { el.textContent = fmt(counter.v) },
      onComplete: () => { el.textContent = final },
      scrollTrigger: { trigger: el, start: 'top 85%', once: true },
    })
    restore.push(() => { el.textContent = final })
  })

  // ---------- Final call to action zooms into place ----------
  gsap.fromTo('.cta', { scale: 0.9, opacity: 0.4, y: 48 }, {
    scale: 1, opacity: 1, y: 0, ease: 'none',
    scrollTrigger: { trigger: '.cta', start: 'top bottom', end: 'top 45%', scrub: 0.8 },
  })

  // ---------- Pricing: the receipt gets crossed out and stamped, then the price drops ----------
  // Without this script the section shows its finished state: struck amounts, stamp and real price.
  const pricing = $('.pricing-grid')
  const priceNow = $('.price-now')
  if (pricing && priceNow) {
    const strikes = $$('.receipt .strike')
    const extras = $$('.price-old, .save')
    const finalPrice = priceNow.textContent ?? ''
    const from = 40090
    const to = Number(finalPrice.replace(/,/g, ''))
    const inr = (v: number) => Math.round(v).toLocaleString('en-IN')
    const counter = { v: from }

    gsap.set(strikes, { scaleX: 0 })
    // Grows from its right edge so it never reaches past a phone screen.
    gsap.set('.stamp', { opacity: 0, scale: 1.35, rotate: -16, transformOrigin: '100% 50%' })
    gsap.set(extras, { opacity: 0, y: 8 })
    const missing = $$('.rc-missing li')
    gsap.set(missing, { opacity: 0, x: -12 })
    priceNow.textContent = inr(from)

    const tl = gsap.timeline({ paused: true })
      .to(strikes, { scaleX: 1, duration: 0.45, ease: 'power3.out', stagger: 0.32 })
      .to(missing, { opacity: 1, x: 0, duration: 0.5, ease: EASE, stagger: 0.12 }, '-=0.1')
      .to('.stamp', { opacity: 1, scale: 1, rotate: -8, duration: 0.55, ease: EASE }, '+=0.05')
      .to('.price-old', { opacity: 1, y: 0, duration: 0.5, ease: EASE }, '<')
      .to(counter, {
        v: to, duration: 1.8, ease: 'expo.out',
        onUpdate: () => { priceNow.textContent = inr(counter.v) },
        onComplete: () => { priceNow.textContent = finalPrice },
      }, '<0.1')
      .to('.save', { opacity: 1, y: 0, duration: 0.6, ease: EASE }, '-=1')
    ScrollTrigger.create({ trigger: pricing, start: 'top 65%', once: true, onEnter: () => { tl.play() } })

    // The receipt lies slightly askew and straightens as it scrolls up.
    gsap.fromTo('.receipt', { rotate: -3, y: 48 }, {
      rotate: 0, y: 0, ease: 'none',
      scrollTrigger: { trigger: pricing, start: 'top bottom', end: 'top 35%', scrub: 0.8 },
    })

    restore.push(() => {
      tl.progress(1).kill()
      priceNow.textContent = finalPrice
      gsap.set([...strikes, '.stamp', ...extras, ...missing], { clearProps: 'all' })
    })
  }

  // If the visitor turns on reduced motion mid visit, put the plain page back.
  return () => restore.forEach((fn) => fn())
})

// ---------- Product tour, wide screens: sticky scrollytelling ----------
// Copy scrolls on the left; one screenshot stays pinned on the right and hands over
// to the next with a tilt, while the whole device turns slowly across the section.
mm.add(`${MOTION} and (min-width: 1025px)`, () => {
  const spots = $$('.story .spot')
  const shots = $$('.story-shot')
  const count = $('.story-count')
  if (!spots.length || spots.length !== shots.length) return

  gsap.set(shots, { opacity: 0, transformPerspective: 1600 })
  gsap.set(shots[0], { opacity: 1 })
  const tl = gsap.timeline({
    defaults: { ease: 'none', duration: 0.5 },
    scrollTrigger: { trigger: '.story-steps', start: 'top center', end: 'bottom center', scrub: 0.6 },
  })
  tl.set({}, {}, spots.length) // timeline length = one unit per story
  for (let i = 1; i < shots.length; i++) {
    tl.to(shots[i - 1], { opacity: 0, yPercent: -10, rotateX: 14, scale: 0.88 }, i - 0.25)
      .fromTo(shots[i], { opacity: 0, yPercent: 14, rotateX: -14, scale: 0.92 }, { opacity: 1, yPercent: 0, rotateX: 0, scale: 1 }, i - 0.25)
  }

  gsap.fromTo('.story-device', { rotateY: -7, rotateX: 4 }, {
    rotateY: 7, rotateX: -2, ease: 'none', transformPerspective: 1800,
    scrollTrigger: { trigger: '.story', start: 'top bottom', end: 'bottom top', scrub: true },
  })
  gsap.fromTo('.story-bar span', { scaleX: 1 / spots.length }, {
    scaleX: 1, ease: 'none',
    scrollTrigger: { trigger: '.story-steps', start: 'top center', end: 'bottom center', scrub: true },
  })

  spots.forEach((spot, i) => {
    ScrollTrigger.create({
      trigger: spot, start: 'top center', end: 'bottom center',
      onToggle: (self) => {
        spot.classList.toggle('is-active', self.isActive)
        if (self.isActive && count) count.textContent = String(i + 1).padStart(2, '0')
      },
    })
  })
  return () => spots.forEach((s) => s.classList.remove('is-active'))
})

// ---------- Product tour, narrow screens: screenshots turn to face you, images drift ----------
mm.add(`${MOTION} and (max-width: 1024px)`, () => {
  $$('.story .spot').forEach((spot) => {
    const shot = spot.querySelector('.shot')
    const img = spot.querySelector('.shot img')
    const side = spot.classList.contains('rev') ? 1 : -1
    if (shot) {
      gsap.fromTo(shot, { rotateY: 10 * side, rotateX: 6, y: 48, transformPerspective: 1400 }, {
        rotateY: 0, rotateX: 0, y: 0, ease: 'none',
        scrollTrigger: { trigger: spot, start: 'top bottom', end: 'center 60%', scrub: 0.8 },
      })
    }
    if (img) {
      gsap.fromTo(img, { yPercent: -4, scale: 1.1 }, {
        yPercent: 4, scale: 1.1, ease: 'none',
        scrollTrigger: { trigger: spot, start: 'top bottom', end: 'bottom top', scrub: true },
      })
    }
  })
})

// ---------- What you get, two or more columns: the cards are dealt like a hand ----------
// They start as one fanned, tilted deck in the middle of the grid and fly out to their
// places as the section scrolls up, the top card first.
mm.add(`${MOTION} and (min-width: 721px)`, () => {
  const grid = $('.benefits')
  const cards = $$('.benefits .benefit')
  if (!grid || !cards.length) return
  const mid = (cards.length - 1) / 2
  // Distance from each card's resting place to the deck in the grid's centre (layout values, so transforms never skew it).
  const toDeck = (el: HTMLElement) => ({
    x: grid.clientWidth / 2 - (el.offsetLeft + el.offsetWidth / 2),
    y: grid.clientHeight / 2 - (el.offsetTop + el.offsetHeight / 2) + 40,
  })

  gsap.set(cards, { zIndex: (i: number) => cards.length - i, transformPerspective: 1200 })
  gsap.timeline({
    // No invalidateOnRefresh: re-measuring would drop the start position of cards not yet dealt.
    scrollTrigger: { trigger: grid, start: 'top 85%', end: 'center 50%', scrub: 1 },
  }).fromTo(cards, {
    x: (_: number, el: HTMLElement) => toDeck(el).x,
    y: (_: number, el: HTMLElement) => toDeck(el).y,
    rotate: (i: number) => (i - mid) * 7,
    rotateX: 28,
    scale: 0.74,
  }, {
    x: 0, y: 0, rotate: 0, rotateX: 0, scale: 1,
    duration: 1, ease: 'power3.out', stagger: 0.16,
  })

  return () => gsap.set(cards, { clearProps: 'zIndex' })
})

// ---------- What you get, one column: each card swings in from alternating sides ----------
// The card turns on its own outer edge, like a door, so it never reaches past the screen
// (a phone widens the whole page for anything that does).
mm.add(`${MOTION} and (max-width: 720px)`, () => {
  $$('.benefits .benefit').forEach((card, i) => {
    const side = i % 2 ? 1 : -1
    gsap.fromTo(card, {
      rotateY: 55 * side, rotate: 3 * side, y: 48, opacity: 0, scale: 0.92,
      transformPerspective: 900, transformOrigin: side < 0 ? '0% 50%' : '100% 50%',
    }, {
      rotateY: 0, rotate: 0, y: 0, opacity: 1, scale: 1, ease: 'power3.out',
      scrollTrigger: { trigger: card, start: 'top 95%', end: 'top 60%', scrub: 0.8 },
    })
  })
})

// ---------- Pointer effects: only for a mouse or trackpad, never for touch ----------
mm.add(`${MOTION} and (pointer: fine)`, () => {
  // Platform chips shift with the pointer, each at its own depth.
  const chips = $$('.node').map((node) => ({
    depth: Number(node.dataset.depth ?? 1),
    x: gsap.quickTo(node, 'x', { duration: 1, ease: 'power3.out' }),
    y: gsap.quickTo(node, 'y', { duration: 1, ease: 'power3.out' }),
  }))
  const onMove = (e: PointerEvent) => {
    const px = e.clientX / window.innerWidth - 0.5
    const py = e.clientY / window.innerHeight - 0.5
    chips.forEach((c) => { c.x(px * 24 * c.depth); c.y(py * 16 * c.depth) })
  }
  window.addEventListener('pointermove', onMove, { passive: true })

  // Feature cards and the pricing plan tilt toward the pointer.
  const cleanups = $$('.benefit-card, [data-tilt]').map((card) => {
    gsap.set(card, { transformPerspective: 900 })
    const rx = gsap.quickTo(card, 'rotationX', { duration: 0.6, ease: 'power3.out' })
    const ry = gsap.quickTo(card, 'rotationY', { duration: 0.6, ease: 'power3.out' })
    const move = (e: PointerEvent) => {
      const r = card.getBoundingClientRect()
      ry(((e.clientX - r.left) / r.width - 0.5) * 8)
      rx(-((e.clientY - r.top) / r.height - 0.5) * 8)
    }
    const leave = () => { rx(0); ry(0) }
    card.addEventListener('pointermove', move)
    card.addEventListener('pointerleave', leave)
    return () => { card.removeEventListener('pointermove', move); card.removeEventListener('pointerleave', leave) }
  })

  // Main buttons lean toward the pointer. Uses the CSS translate property so the
  // button's own hover and press transforms keep working.
  $$('.magnetic').forEach((btn) => {
    const p = { x: 0, y: 0 }
    let box: DOMRect | null = null
    const apply = () => { btn.style.translate = `${p.x}px ${p.y}px` }
    btn.addEventListener('pointerenter', () => { box = btn.getBoundingClientRect() })
    btn.addEventListener('pointermove', (e) => {
      if (!box) return
      gsap.to(p, { x: (e.clientX - box.left - box.width / 2) * 0.25, y: (e.clientY - box.top - box.height / 2) * 0.35, duration: 0.5, ease: 'power3.out', overwrite: true, onUpdate: apply })
    })
    btn.addEventListener('pointerleave', () => {
      box = null
      gsap.to(p, { x: 0, y: 0, duration: 0.7, ease: EASE, overwrite: true, onUpdate: apply })
    })
  })

  return () => {
    window.removeEventListener('pointermove', onMove)
    cleanups.forEach((fn) => fn())
  }
})

// Layout can shift once web fonts arrive; re-measure the scroll triggers then.
document.fonts?.ready.then(() => ScrollTrigger.refresh())

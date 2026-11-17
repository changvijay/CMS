// The CMS Studio privacy policy page (/privacy). Only job here: bring Pixel to life and tell it
// which part of the policy is on screen.
import './mascot.css';
import { startMascot } from './mascot';
import { sectionFromId } from './mascotMood';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.getElementById('mascot');

// Every third click suggests somewhere else on the site.
const LINKS = [
  { href: '/', label: 'See CMS Analytics Studio' },
  { href: '/manual/', label: 'Read the user manual' },
  { href: '/login#waitlist', label: 'Join the waiting list' },
];
let tip = 0;

const pixel = root ? startMascot(root, { reduce, cta: () => LINKS[tip++ % LINKS.length] }) : null;

if (pixel) {
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) pixel.setSection(sectionFromId(en.target.id));
  }, { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll<HTMLElement>('main section[id]').forEach((el) => io.observe(el));
}

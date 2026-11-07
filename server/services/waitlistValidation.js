// Checks a waiting list sign-up and turns it into clean values for the database.
// Pure function, so the route and the tests share one set of rules.

export const MAX_ACCOUNTS = 50; // per platform
export const MAX_LINKS = 30;
const MAX_LINK_LENGTH = 300;

export const ACCOUNT_FIELDS = ['instagram', 'facebook', 'linkedin', 'youtube'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** "+91 98765-43210" -> "+919876543210". Digits only, with a leading + kept. */
export function normalizePhone(value) {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  return raw.startsWith('+') ? `+${digits}` : digits;
}

/**
 * Splits the links field on commas or new lines, adds https:// where it is missing,
 * and drops blanks and repeats. Accepts a string or an array.
 */
export function parseLinks(value) {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(/[,\n]/);
  const seen = new Set();
  const links = [];
  for (const part of parts) {
    const text = String(part ?? '').trim();
    if (!text) continue;
    const href = /^https?:\/\//i.test(text) ? text : `https://${text.replace(/^\/+/, '')}`;
    const key = href.toLowerCase().replace(/\/+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(href);
  }
  return links;
}

function isValidLink(href) {
  if (href.length > MAX_LINK_LENGTH) return false;
  try {
    const url = new URL(href);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.') && !/\s/.test(href);
  } catch {
    return false;
  }
}

function toCount(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

/**
 * @returns {{ ok: true, value: object } | { ok: false, errors: Record<string, string> }}
 */
export function validateWaitlist(body) {
  const input = body && typeof body === 'object' ? body : {};
  const errors = {};

  const email = String(input.email ?? '').trim().toLowerCase();
  if (!email) errors.email = 'Enter your email address.';
  else if (email.length > 255 || !EMAIL_RE.test(email)) errors.email = 'Enter a valid email address, like name@example.com.';

  const phone = normalizePhone(input.phone);
  const phoneDigits = phone.replace(/\D/g, '').length;
  if (!String(input.phone ?? '').trim()) errors.phone = 'Enter your contact number.';
  else if (/[^\d\s+\-().]/.test(String(input.phone)) || phoneDigits < 10 || phoneDigits > 15) {
    errors.phone = 'Enter a contact number with 10 to 15 digits, for example +91 98765 43210.';
  }

  const counts = {};
  for (const field of ACCOUNT_FIELDS) {
    const n = toCount(input[field]);
    if (Number.isNaN(n) || n < 0 || n > MAX_ACCOUNTS) errors[field] = `Enter a whole number from 0 to ${MAX_ACCOUNTS}.`;
    else counts[field] = n;
  }
  if (ACCOUNT_FIELDS.every((f) => counts[f] === 0)) {
    errors.accounts = 'Add at least one account you want to connect.';
  }

  const links = parseLinks(input.links);
  if (!links.length) errors.links = 'Add the links of the accounts you will manage, separated by commas.';
  else if (links.length > MAX_LINKS) errors.links = `Add up to ${MAX_LINKS} links.`;
  else {
    const bad = links.find((l) => !isValidLink(l));
    if (bad) errors.links = `This does not look like a link: ${bad.replace(/^https:\/\//, '').slice(0, 60)}`;
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { email, phone, ...counts, links } };
}

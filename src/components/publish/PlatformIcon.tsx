import type { Platform } from './types';

/** Simple brand-coloured marks so each platform is recognisable at a glance. */
export function PlatformIcon({ platform, size = 20 }: { platform: Platform; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
  if (platform === 'instagram') {
    return (
      <svg {...common} fill="none" stroke="#c2347f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
      </svg>
    );
  }
  if (platform === 'facebook') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="11" fill="#1877f2" />
        <path d="M13.4 19v-6h2l.3-2.4h-2.3V9.1c0-.7.2-1.2 1.2-1.2h1.2V5.8c-.2 0-1-.1-1.8-.1-1.8 0-3 1.1-3 3.1v1.8h-2V13h2v6h2.4z" fill="#fff" />
      </svg>
    );
  }
  if (platform === 'linkedin') {
    return (
      <svg {...common}>
        <rect x="1" y="1" width="22" height="22" rx="4" fill="#0a66c2" />
        <path d="M7 10h2.5v7.5H7zM8.25 6.2a1.45 1.45 0 1 1 0 2.9 1.45 1.45 0 0 1 0-2.9zM11 10h2.4v1c.4-.7 1.3-1.2 2.5-1.2 2.4 0 2.9 1.5 2.9 3.6v4.1h-2.5v-3.6c0-.9 0-2-1.2-2s-1.5.9-1.5 1.9v3.7H11z" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="1" y="4" width="22" height="16" rx="5" fill="#ff0000" />
      <path d="M10 8.5v7l6-3.5z" fill="#fff" />
    </svg>
  );
}

import { useEffect, useRef, useState } from 'react';

/**
 * Turns true once the element comes near the screen and stays true. Use it as `useLive`'s `enabled`
 * flag so sections further down the page only fetch when someone scrolls to them.
 */
export function useInView<T extends Element = HTMLDivElement>(rootMargin = '300px') {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return [ref, inView] as const;
}

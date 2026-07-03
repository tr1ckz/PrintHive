import { useSyncExternalStore } from 'react';

/**
 * Reactive matchMedia hook. Drives the md structural switch
 * (bottom nav ↔ sidebar, dashboard priority stack ↔ grid layout).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

export const useIsDesktop = () => useMediaQuery('(min-width: 768px)');

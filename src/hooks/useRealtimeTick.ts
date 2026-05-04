import { useEffect, useRef } from 'react';
import { usePrinterStore } from '../stores/usePrinterStore';

interface RealtimeTickOptions {
  minIntervalMs?: number;
}

export function useRealtimeTick(callback: () => void, options: RealtimeTickOptions = {}) {
  const { minIntervalMs = 4000 } = options;
  const callbackRef = useRef(callback);
  const lastRunRef = useRef(0);
  const pendingRef = useRef<number | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const unsubscribe = usePrinterStore.subscribe(
      (state) => state.lastMessageAt,
      (lastMessageAt) => {
        if (!lastMessageAt) {
          return;
        }

        // Avoid churn while the page is in the background.
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
          return;
        }

        const now = Date.now();
        if (now - lastRunRef.current < minIntervalMs) {
          return;
        }

        if (pendingRef.current) {
          return;
        }

        lastRunRef.current = now;
        pendingRef.current = window.setTimeout(() => {
          pendingRef.current = null;
          try {
            callbackRef.current();
          } catch {
            // Ignore callback errors to keep the UI alive.
          }
        }, 0);
      }
    );

    return () => {
      if (pendingRef.current) {
        window.clearTimeout(pendingRef.current);
      }
      unsubscribe();
    };
  }, [minIntervalMs]);
}

export default useRealtimeTick;

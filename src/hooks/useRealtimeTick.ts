import { useEffect, useRef } from 'react';
import { usePrinterStore } from '../stores/usePrinterStore';

interface RealtimeTickOptions {
  minIntervalMs?: number;
}

export function useRealtimeTick(callback: () => void, options: RealtimeTickOptions = {}) {
  const { minIntervalMs = 4000 } = options;
  const callbackRef = useRef(callback);
  const lastRunRef = useRef(0);

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

        const now = Date.now();
        if (now - lastRunRef.current < minIntervalMs) {
          return;
        }

        lastRunRef.current = now;
        callbackRef.current();
      }
    );

    return () => {
      unsubscribe();
    };
  }, [minIntervalMs]);
}

export default useRealtimeTick;

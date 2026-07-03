import { useEffect, useState } from 'react';
import { API_ENDPOINTS } from '../config/api';
import { fetchWithRetry } from '../utils/fetchWithRetry';

interface LoadingSplashProps {
  message?: string;
  progress?: number;
  onComplete?: () => void;
  checkServerHealth?: boolean;
}

function LoadingSplash({ 
  message, 
  progress, 
  onComplete,
  checkServerHealth = false
}: LoadingSplashProps) {
  const [serverReady, setServerReady] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [showRefreshButton, setShowRefreshButton] = useState(false);

  // 10-second countdown fallback using recursive timeouts
  useEffect(() => {
    if (!checkServerHealth || serverReady || countdown <= 0) return;

    const timer = window.setTimeout(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setShowRefreshButton(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [checkServerHealth, serverReady, countdown]);

  // Auto-refresh when server comes back up
  useEffect(() => {
    if (!checkServerHealth) return;

    let cancelled = false;
    let pollTimeout: number | undefined;
    let reloadTimeout: number | undefined;

    const checkServer = async () => {
      try {
        const response = await fetchWithRetry(API_ENDPOINTS.AUTH.HEALTH, { 
          method: 'GET',
          cache: 'no-cache',
        });
        if (response.ok) {
          if (cancelled) return;
          setServerReady(true);
          // Auto-refresh after brief delay
          reloadTimeout = window.setTimeout(() => {
            if (!cancelled) {
              window.location.reload();
            }
          }, 500);
        }
      } catch (error) {
        // Server not ready yet, keep checking
        pollTimeout = window.setTimeout(checkServer, 1000);
      }
    };

    // Start checking immediately
    checkServer();

    return () => {
      cancelled = true;
      if (pollTimeout) window.clearTimeout(pollTimeout);
      if (reloadTimeout) window.clearTimeout(reloadTimeout);
    };
  }, [checkServerHealth]);

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center overflow-hidden bg-base bg-cover bg-center animate-[ph-fade-in_0.3s_ease-out]"
      style={{ backgroundImage: `linear-gradient(var(--bg-overlay), var(--bg-overlay)), url(/images/splash.png)` }}
    >
      <div className="relative z-[2] px-8 text-center animate-[ph-fade-up_0.6s_var(--ease-out)_both]">
        {checkServerHealth && !serverReady && (
          <>
            <div className="rounded-lg bg-card px-8 py-4 text-3xl font-bold tabular-nums tracking-tight text-fg shadow-lg ring-1 ring-line animate-[ph-pulse-glow_1s_ease-in-out_infinite]">
              {countdown}s
            </div>
            {showRefreshButton && (
              <div className="fixed inset-x-0 bottom-1/4 flex justify-center animate-[ph-fade-up_0.4s_var(--ease-out)_both]">
                <button
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-8 text-base font-semibold text-accent-contrast shadow-glow transition-transform hover:-translate-y-0.5"
                  onClick={() => window.location.reload()}
                >
                  Refresh
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {progress !== undefined && (
        <div className="absolute inset-x-0 bottom-1/4 z-[2] mx-auto w-[min(90%,400px)]">
          <div className="h-9 overflow-hidden rounded-full bg-white/6 ring-1 ring-line">
            <div
              className="flex h-full items-center justify-center rounded-full bg-accent shadow-glow transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            >
              <span className="text-sm font-bold tabular-nums text-accent-contrast">{progress}%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LoadingSplash;

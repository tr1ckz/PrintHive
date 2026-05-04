type TelemetryLevel = 'info' | 'warn' | 'error';

interface TelemetryPayload {
  level: TelemetryLevel;
  source: string;
  message: string;
  details?: Record<string, unknown>;
}

const endpoint = '/api/client-telemetry';
let initialized = false;
let lastSentAt = 0;

function postTelemetry(payload: TelemetryPayload) {
  const now = Date.now();
  // Basic throttling to avoid flooding when errors cascade.
  if (now - lastSentAt < 800) {
    return;
  }
  lastSentAt = now;

  const body = JSON.stringify({
    ...payload,
    path: window.location.pathname,
    href: window.location.href,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
  });

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(endpoint, blob);
      return;
    }
  } catch {
    // Fall through to fetch
  }

  void fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // Ignore telemetry transport failures.
  });
}

export function reportClientTelemetry(payload: TelemetryPayload) {
  postTelemetry(payload);
}

export function initClientTelemetry() {
  if (initialized) {
    return;
  }
  initialized = true;

  window.addEventListener('error', (event) => {
    postTelemetry({
      level: 'error',
      source: 'window.error',
      message: event.message || 'Unhandled window error',
      details: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { message?: string } | string | null | undefined;
    const message = typeof reason === 'string'
      ? reason
      : reason?.message || 'Unhandled promise rejection';

    postTelemetry({
      level: 'error',
      source: 'window.unhandledrejection',
      message,
    });
  });

  let lastBeat = performance.now();
  window.setInterval(() => {
    const now = performance.now();
    const driftMs = now - lastBeat - 5000;
    lastBeat = now;

    // If timer drift is very high, UI thread was likely blocked/freezing.
    if (driftMs > 1500) {
      postTelemetry({
        level: 'warn',
        source: 'ui.lag',
        message: 'Detected significant main-thread lag',
        details: {
          driftMs: Math.round(driftMs),
          visibility: document.visibilityState,
        },
      });
    }
  }, 5000);
}

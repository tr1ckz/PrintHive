import { useEffect, useMemo } from 'react';

interface ToastProps {
  message: string;
  type: 'success' | 'error';
  onClose: () => void;
  duration?: number;
}

function Toast({ message, type, onClose, duration }: ToastProps) {
  // Auto-calculate duration if not provided: 50ms per character, min 3s, max 10s
  const calcDuration = useMemo(
    () => duration || Math.min(Math.max(message.length * 50, 3000), 10000),
    [message, duration]
  );

  useEffect(() => {
    const timer = setTimeout(onClose, calcDuration);
    return () => clearTimeout(timer);
  }, [calcDuration, onClose]);

  const tone = type === 'success' ? 'text-success' : 'text-danger';

  return (
    <div
      role="status"
      className="fixed bottom-20 md:bottom-6 right-4 left-4 sm:left-auto z-[70] sm:w-auto sm:max-w-sm flex items-center gap-3 bg-elevated rounded-lg shadow-xl px-4 py-3 animate-[ph-fade-up_0.25s_var(--ease-out)]"
    >
      <span className={`shrink-0 ${tone}`}>
        {type === 'success' ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <div className="min-w-0 flex-1 text-sm text-fg-soft">{message}</div>
      <button
        onClick={onClose}
        aria-label="Dismiss notification"
        className="shrink-0 inline-flex size-11 sm:size-8 items-center justify-center rounded-md text-muted hover:text-fg hover:bg-white/5 transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

export default Toast;

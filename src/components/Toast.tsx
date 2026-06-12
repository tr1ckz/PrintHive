import { useEffect, useMemo } from 'react';
import './Toast.css';

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

  return (
    <div
      className={`toast toast-${type}`}
      role="status"
      style={{ ['--toast-duration' as string]: `${calcDuration}ms` }}
    >
      <div className="toast-icon">
        {type === 'success' ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
      <div className="toast-message">{message}</div>
      <button className="toast-close" onClick={onClose} aria-label="Dismiss notification">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <div className="toast-progress" aria-hidden="true" />
    </div>
  );
}

export default Toast;

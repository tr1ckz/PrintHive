import React from 'react';

interface ModalProps {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Extra class(es) appended to the panel, e.g. a width override like "sm:max-w-2xl" */
  contentClassName?: string;
}

/**
 * The app-standard overlay modal, self-contained in Tailwind (overlay tier:
 * elevated surface + soft shadow over a blurred scrim — no borders). Renders
 * as a bottom sheet on phones and a centered dialog from `sm` up. Click
 * outside closes; clicks inside are swallowed.
 */
const Modal: React.FC<ModalProps> = ({ title, onClose, children, contentClassName }) => (
  <div
    className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-overlay backdrop-blur-sm p-0 sm:p-4"
    onClick={onClose}
  >
    <div
      role="dialog"
      aria-modal="true"
      className={[
        'w-full sm:max-w-lg max-h-[90dvh] flex flex-col bg-elevated rounded-t-xl sm:rounded-xl shadow-xl',
        'animate-[ph-fade-up_0.2s_var(--ease-out)]',
        contentClassName || '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-3 p-5 pb-3 shrink-0">
        <h2 className="min-w-0 flex-1 text-base font-semibold text-fg truncate">{title}</h2>
        <button
          className="shrink-0 inline-flex size-11 sm:size-9 items-center justify-center rounded-md text-muted hover:text-fg hover:bg-white/5 transition-colors -mt-1 -mr-1.5"
          onClick={onClose}
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:pb-5">
        {children}
      </div>
    </div>
  </div>
);

export default Modal;

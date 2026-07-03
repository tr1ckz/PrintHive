import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type ModalVariant = 'primary' | 'secondary' | 'danger';

type ModalAction = {
  label: string;
  variant?: ModalVariant;
  autoClose?: boolean;
  onClick?: () => void | Promise<void>;
};

type ModalSize = 'sm' | 'md' | 'lg';

interface ModalOptions {
  title: string;
  description?: string;
  content?: ReactNode;
  actions?: ModalAction[];
  size?: ModalSize;
  closeOnBackdrop?: boolean;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: Extract<ModalVariant, 'primary' | 'danger'>;
  onConfirm: () => void | Promise<void>;
}

interface ModalContextValue {
  openModal: (options: ModalOptions) => void;
  closeModal: () => void;
  confirm: (options: ConfirmOptions) => void;
}

const ModalContext = createContext<ModalContextValue | undefined>(undefined);

const sizeClass: Record<ModalSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
};

const actionClass: Record<ModalVariant, string> = {
  primary: 'bg-accent hover:bg-accent-strong text-accent-contrast',
  secondary: 'bg-white/5 hover:bg-white/10 text-fg-soft',
  danger: 'bg-danger hover:opacity-90 text-white',
};

export function ModalProvider({ children }: { children: ReactNode }) {
  const [activeModal, setActiveModal] = useState<ModalOptions | null>(null);

  const closeModal = useCallback(() => {
    setActiveModal(null);
  }, []);

  const openModal = useCallback((options: ModalOptions) => {
    setActiveModal(options);
  }, []);

  const confirm = useCallback(
    ({
      title,
      message,
      confirmText = 'Confirm',
      cancelText = 'Cancel',
      confirmVariant = 'primary',
      onConfirm,
    }: ConfirmOptions) => {
      openModal({
        title,
        description: message,
        size: 'sm',
        actions: [
          {
            label: cancelText,
            variant: 'secondary',
            onClick: closeModal,
          },
          {
            label: confirmText,
            variant: confirmVariant,
            onClick: onConfirm,
          },
        ],
      });
    },
    [closeModal, openModal]
  );

  useEffect(() => {
    if (!activeModal) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeModal();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [activeModal, closeModal]);

  const contextValue = useMemo(
    () => ({
      openModal,
      closeModal,
      confirm,
    }),
    [openModal, closeModal, confirm]
  );

  const handleAction = async (action: ModalAction) => {
    try {
      await action.onClick?.();
    } finally {
      if (action.autoClose !== false) {
        closeModal();
      }
    }
  };

  return (
    <ModalContext.Provider value={contextValue}>
      {children}
      {activeModal && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-overlay backdrop-blur-sm p-0 sm:p-4"
              onClick={() => {
                if (activeModal.closeOnBackdrop !== false) {
                  closeModal();
                }
              }}
            >
              <div
                className={`w-full ${sizeClass[activeModal.size || 'md']} max-h-[90dvh] flex flex-col bg-elevated rounded-t-xl sm:rounded-xl shadow-xl animate-[ph-fade-up_0.2s_var(--ease-out)]`}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
              >
                <div className="flex items-start gap-3 p-5 pb-0">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold text-fg">{activeModal.title}</h3>
                    {activeModal.description ? (
                      <p className="mt-1 text-sm text-fg-soft">{activeModal.description}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="shrink-0 inline-flex size-11 sm:size-9 items-center justify-center rounded-md text-muted hover:text-fg hover:bg-white/5 transition-colors -mt-1.5 -mr-1.5"
                    onClick={closeModal}
                    aria-label="Close modal"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>

                {activeModal.content ? (
                  <div className="flex-1 overflow-y-auto px-5 pt-4 text-sm text-fg-soft">{activeModal.content}</div>
                ) : null}

                <div className="flex gap-2 justify-end p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:pb-5">
                  {(activeModal.actions?.length
                    ? activeModal.actions
                    : [{ label: 'Close', variant: 'secondary' as ModalVariant, onClick: closeModal }]
                  ).map((action) => (
                    <button
                      key={`${action.label}-${action.variant || 'primary'}`}
                      type="button"
                      className={`min-h-11 px-4 rounded-md text-sm font-semibold transition-colors ${actionClass[action.variant || 'primary']}`}
                      onClick={() => void handleAction(action)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const context = useContext(ModalContext);

  if (!context) {
    throw new Error('useModal must be used within a ModalProvider');
  }

  return context;
}

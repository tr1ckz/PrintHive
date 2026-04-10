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
import './ModalProvider.css';

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
              className="global-modal-backdrop"
              onClick={() => {
                if (activeModal.closeOnBackdrop !== false) {
                  closeModal();
                }
              }}
            >
              <div
                className={`global-modal global-modal-${activeModal.size || 'md'}`}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
              >
                <div className="global-modal-header">
                  <div>
                    <h3>{activeModal.title}</h3>
                    {activeModal.description ? <p>{activeModal.description}</p> : null}
                  </div>
                  <button type="button" className="global-modal-close" onClick={closeModal} aria-label="Close modal">
                    ×
                  </button>
                </div>

                {activeModal.content ? <div className="global-modal-body">{activeModal.content}</div> : null}

                <div className="global-modal-actions">
                  {(activeModal.actions?.length
                    ? activeModal.actions
                    : [{ label: 'Close', variant: 'secondary', onClick: closeModal }]
                  ).map((action) => (
                    <button
                      key={`${action.label}-${action.variant || 'primary'}`}
                      type="button"
                      className={`global-modal-btn ${action.variant || 'primary'}`}
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

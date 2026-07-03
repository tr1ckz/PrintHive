interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Legacy class name ('btn-delete' | 'btn-warning' | 'btn-success' | 'btn-confirm') — mapped to a tone */
  confirmButtonClass?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const toneFor = (legacyClass: string) => {
  if (legacyClass.includes('delete') || legacyClass.includes('danger')) return 'bg-danger hover:opacity-90 text-white';
  if (legacyClass.includes('warning')) return 'bg-warning hover:opacity-90 text-black';
  if (legacyClass.includes('success')) return 'bg-success hover:opacity-90 text-black';
  return 'bg-accent hover:bg-accent-strong text-accent-contrast';
};

function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmButtonClass = 'btn-confirm',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-overlay backdrop-blur-sm p-0 sm:p-4"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-label={title}
        className="w-full sm:w-auto sm:min-w-[22rem] sm:max-w-md bg-elevated rounded-t-xl sm:rounded-xl shadow-xl p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:pb-5 animate-[ph-fade-up_0.2s_var(--ease-out)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-fg">{title}</h3>
        <p className="mt-2 text-sm text-fg-soft">{message}</p>
        <div className="mt-5 flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="min-h-11 px-4 rounded-md text-sm font-medium text-fg-soft bg-white/5 hover:bg-white/10 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`min-h-11 px-4 rounded-md text-sm font-semibold transition-colors ${toneFor(confirmButtonClass)}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;

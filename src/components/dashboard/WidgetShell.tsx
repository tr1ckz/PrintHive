import React from 'react';
import { ArrowDown, ArrowUp, ChevronRight, EyeOff } from 'lucide-react';

interface WidgetShellProps {
  title: string;
  /** Small count/status pill beside the title */
  badge?: React.ReactNode;
  /** Header link, e.g. "History" — the one way out of a widget */
  actionLabel?: string;
  onAction?: () => void;
  isEditMode?: boolean;
  onHide?: () => void;
  onMoveEarlier?: () => void;
  onMoveLater?: () => void;
  children: React.ReactNode;
}

const editButtonClass =
  'inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/5 hover:text-fg disabled:pointer-events-none disabled:opacity-30';

/**
 * Dashboard widget chrome: one card surface, a slim header, and a body that
 * is always as tall as its content. The shell never scrolls or clips — a
 * widget that could grow without bound caps its own row count instead.
 */
function WidgetShell({
  title,
  badge,
  actionLabel,
  onAction,
  isEditMode = false,
  onHide,
  onMoveEarlier,
  onMoveLater,
  children,
}: WidgetShellProps) {
  return (
    <article
      className={`rounded-lg bg-card ${isEditMode ? 'ring-1 ring-accent/30' : ''}`}
      aria-label={title}
    >
      <header className="flex min-h-11 items-center justify-between gap-2 pl-4 pr-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[13px] font-semibold text-fg">{title}</h3>
          {badge}
        </div>

        {isEditMode ? (
          <div className="flex shrink-0 items-center">
            {onMoveEarlier || onMoveLater ? (
              <>
                <button type="button" onClick={onMoveEarlier} disabled={!onMoveEarlier} aria-label={`Move ${title} earlier`} title="Move earlier" className={editButtonClass}>
                  <ArrowUp className="size-4" aria-hidden />
                </button>
                <button type="button" onClick={onMoveLater} disabled={!onMoveLater} aria-label={`Move ${title} later`} title="Move later" className={editButtonClass}>
                  <ArrowDown className="size-4" aria-hidden />
                </button>
              </>
            ) : null}
            {onHide ? (
              <button type="button" onClick={onHide} aria-label={`Hide ${title}`} title="Hide widget" className={editButtonClass}>
                <EyeOff className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>
        ) : actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex min-h-8 shrink-0 items-center gap-0.5 rounded-md pl-2 pr-1 text-xs font-medium text-muted transition-colors hover:bg-white/5 hover:text-fg"
          >
            {actionLabel}
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </header>

      <div className="px-4 pb-4">{children}</div>
    </article>
  );
}

export default WidgetShell;

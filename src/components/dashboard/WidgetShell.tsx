import React from 'react';

interface WidgetShellProps {
  title: string;
  isEditMode?: boolean;
  onHide?: () => void;
  children: React.ReactNode;
}

/**
 * Dashboard widget chrome: the raised card tier (bg shift + soft shadow,
 * no border) with a slim uppercase header. The header keeps the
 * `.widget-drag-handle` class in edit mode — it is the contract with
 * react-grid-layout's `draggableHandle` prop; never rename it.
 */
function WidgetShell({ title, isEditMode = false, onHide, children }: WidgetShellProps) {
  return (
    <article className="group relative flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-card shadow-sm transition duration-200 hover:shadow-md">
      <header
        className={`${
          isEditMode ? 'widget-drag-handle cursor-grab active:cursor-grabbing bg-accent/5' : 'cursor-default'
        } flex shrink-0 items-center justify-between gap-2 px-4 pt-3 pb-1.5`}
      >
        <div className="flex min-w-0 items-center gap-2">
          {isEditMode && (
            <span className="inline-flex select-none text-[10px] text-muted" aria-hidden>
              ⠿
            </span>
          )}
          <h3 className="truncate text-xs font-semibold uppercase tracking-widest text-muted">{title}</h3>
        </div>

        {isEditMode && onHide ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onHide(); }}
            className="widget-no-drag inline-flex min-h-8 items-center justify-center rounded px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted hover:text-fg hover:bg-white/5 transition-colors"
          >
            Hide
          </button>
        ) : null}
      </header>

      {/* Widgets carry their own inner padding */}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </article>
  );
}

export default WidgetShell;

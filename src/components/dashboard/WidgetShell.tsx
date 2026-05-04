import React from 'react';

interface WidgetShellProps {
  title: string;
  isEditMode?: boolean;
  onHide?: () => void;
  children: React.ReactNode;
}

function WidgetShell({ title, isEditMode = false, onHide, children }: WidgetShellProps) {
  return (
    <article className="h-full overflow-hidden rounded-md border border-white/15 bg-[linear-gradient(180deg,rgba(18,20,25,0.98),rgba(11,13,18,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_12px_22px_rgba(0,0,0,0.25)]">
      <header className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.02] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {isEditMode ? (
            <button
              type="button"
              className="widget-drag-handle inline-flex h-5 w-5 items-center justify-center rounded border border-white/20 bg-black/20 text-[10px] font-bold text-white/70"
              title="Drag widget"
            >
              ::
            </button>
          ) : null}
          <h3 className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-white/90">{title}</h3>
        </div>

        {isEditMode && onHide ? (
          <button
            type="button"
            onClick={onHide}
            className="inline-flex h-6 items-center justify-center rounded border border-white/25 bg-white/5 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/75 hover:border-white/40 hover:text-white"
          >
            Hide
          </button>
        ) : null}
      </header>

      <div className="h-[calc(100%-42px)] overflow-auto p-3">{children}</div>
    </article>
  );
}

export default WidgetShell;

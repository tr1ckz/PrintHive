import React from 'react';

interface WidgetShellProps {
  title: string;
  isEditMode?: boolean;
  onHide?: () => void;
  children: React.ReactNode;
}

function WidgetShell({ title, isEditMode = false, onHide, children }: WidgetShellProps) {
  return (
    <article className="widget-shell-outer group relative flex h-full min-h-0 flex-col overflow-hidden rounded-[4px] border border-neutral-800 bg-neutral-950 transition-[border-color,transform] duration-200 hover:-translate-y-[2px] hover:border-neutral-600">
      <header className="widget-drag-handle flex shrink-0 cursor-grab items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-950 px-5 py-3 active:cursor-grabbing">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-flex h-5 w-5 select-none items-center justify-center rounded-[3px] border border-neutral-700 bg-neutral-950 text-[10px] font-bold text-neutral-500"
            aria-hidden
          >
            ⠿
          </span>
          <h3 className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-white">{title}</h3>
        </div>

        {isEditMode && onHide ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onHide(); }}
            className="widget-no-drag ops-micro-btn inline-flex h-7 items-center justify-center rounded-[3px] border border-neutral-700 bg-neutral-950 px-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-300 hover:border-neutral-600 hover:text-white"
          >
            Hide
          </button>
        ) : null}
      </header>

      <div className="widget-shell-body min-h-0 flex-1 overflow-auto">{children}</div>
    </article>
  );
}

export default WidgetShell;

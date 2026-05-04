import React from 'react';

interface WidgetShellProps {
  title: string;
  isEditMode?: boolean;
  onHide?: () => void;
  children: React.ReactNode;
}

function WidgetShell({ title, isEditMode = false, onHide, children }: WidgetShellProps) {
  return (
    <article className="group relative flex h-full min-h-0 flex-col overflow-hidden rounded-[4px] border border-[#2f3743] bg-[#131922] transition-colors duration-150 hover:border-[#445064]">
      <header className="widget-drag-handle flex shrink-0 cursor-grab items-center justify-between gap-3 border-b border-[#232d39] bg-[#121821] px-6 py-4 active:cursor-grabbing">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-flex h-5 w-5 select-none items-center justify-center rounded-[3px] border border-[#334155] bg-[#0f141b] text-[10px] font-bold text-slate-500"
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
            className="widget-no-drag inline-flex h-7 items-center justify-center rounded-[3px] border border-[#374151] bg-[#10161f] px-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-300 hover:border-[#4b5563] hover:text-white"
          >
            Hide
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6 md:p-6">{children}</div>
    </article>
  );
}

export default WidgetShell;

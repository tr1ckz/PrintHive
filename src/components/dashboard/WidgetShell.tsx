import React from 'react';

interface WidgetShellProps {
  title: string;
  isEditMode?: boolean;
  onHide?: () => void;
  children: React.ReactNode;
}

function WidgetShell({ title, isEditMode = false, onHide, children }: WidgetShellProps) {
  return (
    <article className="group relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/14 bg-[linear-gradient(165deg,rgba(19,22,28,0.97)_0%,rgba(10,12,17,0.98)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_16px_34px_rgba(0,0,0,0.34)] transition-[border-color,box-shadow] duration-200 hover:border-white/22 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_22px_34px_rgba(0,0,0,0.38)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-[linear-gradient(90deg,rgba(var(--theme-accent-rgb),0.85),rgba(var(--theme-accent-rgb),0.1),rgba(var(--theme-accent-rgb),0.85))] opacity-65" />

      <header className="widget-drag-handle flex shrink-0 cursor-grab items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-6 py-4 active:cursor-grabbing">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-flex h-5 w-5 select-none items-center justify-center rounded border border-white/20 bg-black/30 text-[10px] font-bold text-white/50"
            aria-hidden
          >
            ⠿
          </span>
          <h3 className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-white/90">{title}</h3>
        </div>

        {isEditMode && onHide ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onHide(); }}
            className="widget-no-drag inline-flex h-6 items-center justify-center rounded border border-white/25 bg-white/5 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/75 hover:border-white/40 hover:text-white"
          >
            Hide
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-7 md:p-8">{children}</div>

      <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-[linear-gradient(180deg,rgba(var(--theme-accent-rgb),0),rgba(var(--theme-accent-rgb),0.3),rgba(var(--theme-accent-rgb),0))] opacity-40" />
    </article>
  );
}

export default WidgetShell;

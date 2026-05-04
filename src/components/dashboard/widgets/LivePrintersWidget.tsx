import { useMemo, useState } from 'react';

export interface LivePrinterRow {
  id: string;
  name: string;
  model: string;
  status: string;
  online: boolean;
  progress: number;
  currentPrint: string | null;
}

interface LivePrintersWidgetProps {
  printers: LivePrinterRow[];
  density?: 'compact' | 'comfortable' | 'expanded';
  onOpenPrinters: () => void;
}

function LivePrintersWidget({ printers, density = 'comfortable', onOpenPrinters }: LivePrintersWidgetProps) {
  const [scope, setScope] = useState<'all' | 'online' | 'active'>('all');

  const filtered = useMemo(() => {
    if (scope === 'online') return printers.filter((printer) => printer.online);
    if (scope === 'active') return printers.filter((printer) => printer.online && printer.currentPrint);
    return printers;
  }, [printers, scope]);

  const limit = density === 'compact' ? 4 : density === 'expanded' ? 8 : 6;
  const visibleRows = filtered.slice(0, limit);

  if (printers.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 rounded border border-dashed border-white/20 text-xs text-white/55">
        <p>No printers configured.</p>
        <button
          type="button"
          onClick={onOpenPrinters}
          className="rounded border border-white/20 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-white/70"
        >
          Open Printers
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5 rounded border border-white/15 bg-black/20 p-1.5">
          {(['all', 'online', 'active'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setScope(item)}
              className={`rounded px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${scope === item ? 'bg-white/15 text-white' : 'text-white/60'}`}
            >
              {item}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onOpenPrinters}
          className="rounded border border-white/20 bg-white/5 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/75 hover:border-white/35"
        >
          Open
        </button>
      </div>

      <div className="space-y-2.5">
        {visibleRows.map((printer) => (
          <div key={printer.id} className="rounded border border-white/15 bg-white/[0.03] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-white/90">{printer.name}</p>
                <p className="truncate text-[10px] uppercase tracking-[0.1em] text-white/45">{printer.model}</p>
              </div>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] ${printer.online ? 'border-emerald-400/45 bg-emerald-500/10 text-emerald-200' : 'border-white/20 bg-black/20 text-white/65'}`}
              >
                {printer.online ? 'Online' : 'Offline'}
              </span>
            </div>

            <div className="mt-2 h-2 overflow-hidden rounded border border-white/10 bg-black/25">
              <div className="h-full bg-[linear-gradient(90deg,rgba(var(--theme-accent-rgb),0.92),rgba(var(--theme-accent-rgb),0.4))]" style={{ width: `${Math.max(0, Math.min(100, printer.progress || 0))}%` }} />
            </div>

            <div className="mt-1 flex items-center justify-between text-[10px] uppercase tracking-[0.08em] text-white/55">
              <span className="truncate">{printer.currentPrint || printer.status || 'Idle'}</span>
              <span>{Math.max(0, Math.min(100, printer.progress || 0))}%</span>
            </div>
          </div>
        ))}
      </div>

      {filtered.length > limit ? (
        <p className="text-[10px] uppercase tracking-[0.08em] text-white/45">Showing {limit} of {filtered.length} printers.</p>
      ) : null}
    </div>
  );
}

export default LivePrintersWidget;

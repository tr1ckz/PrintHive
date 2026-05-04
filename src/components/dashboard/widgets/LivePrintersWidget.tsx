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
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-[4px] border border-dashed border-neutral-800 p-5 text-xs text-neutral-500">
        <p>No printers configured.</p>
        <button
          type="button"
          onClick={onOpenPrinters}
          className="ops-micro-btn rounded-[4px] border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.08em] text-white"
        >
          Open Printers
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 rounded-[4px] border border-neutral-800 bg-neutral-900 p-3">
          {(['all', 'online', 'active'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setScope(item)}
              className={`ops-micro-btn rounded-[3px] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${scope === item ? 'bg-neutral-800 text-white' : 'text-neutral-400'}`}
            >
              {item}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onOpenPrinters}
          className="ops-micro-btn rounded-[4px] border border-neutral-800 bg-neutral-900 px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white hover:border-neutral-700"
        >
          Open
        </button>
      </div>

      <div className="space-y-2 rounded-[4px] border border-neutral-800 bg-neutral-900 p-3">
        {visibleRows.map((printer) => (
          <div key={printer.id} className="ops-clickable-card rounded-[3px] border border-transparent px-2 py-2.5 last:border-b-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex items-center gap-1.5">
                {printer.online && printer.currentPrint ? (
                  <span className="ops-pulse-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden />
                ) : printer.online ? (
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" aria-hidden />
                ) : (
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-600" aria-hidden />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold leading-tight text-white/90">{printer.name}</p>
                  <p className="truncate ops-tertiary-text">{printer.model}</p>
                </div>
              </div>
              <span
                className={`shrink-0 rounded-[3px] border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${printer.online ? 'border-emerald-500/55 text-emerald-400' : 'border-rose-500/50 text-rose-500'}`}
              >
                {printer.online ? 'Online' : 'Offline'}
              </span>
            </div>

            <div className="mt-1.5 h-1.5 overflow-hidden rounded-[3px] border border-neutral-800 bg-neutral-950">
              <div className={`h-full ${printer.online ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${Math.max(0, Math.min(100, printer.progress || 0))}%` }} />
            </div>

            <div className="mt-1.5 flex items-center justify-between ops-tertiary-text">
              <span className="truncate">{printer.currentPrint || printer.status || 'Idle'}</span>
              <span className="ops-data-value">{Math.max(0, Math.min(100, printer.progress || 0))}%</span>
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

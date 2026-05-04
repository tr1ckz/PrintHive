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
      <div className="flex h-full flex-col items-center justify-center gap-2 rounded-[4px] border border-dashed border-neutral-800 text-xs text-neutral-500">
        <p>No printers configured.</p>
        <button
          type="button"
          onClick={onOpenPrinters}
          className="rounded-[4px] border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.08em] text-white"
        >
          Open Printers
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 rounded-[4px] border border-neutral-800 bg-neutral-900 p-2">
          {(['all', 'online', 'active'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setScope(item)}
              className={`rounded-[3px] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${scope === item ? 'bg-neutral-800 text-white' : 'text-neutral-400'}`}
            >
              {item}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onOpenPrinters}
          className="rounded-[4px] border border-neutral-800 bg-neutral-900 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-white hover:border-neutral-700"
        >
          Open
        </button>
      </div>

      <div className="space-y-4 rounded-[4px] border border-neutral-800 bg-neutral-900 p-4">
        {visibleRows.map((printer) => (
          <div key={printer.id} className="border-b border-neutral-800 py-3 last:border-b-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight text-white/90">{printer.name}</p>
                <p className="mt-1 truncate ops-tertiary-text">{printer.model}</p>
              </div>
              <span
                className={`rounded-[3px] border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${printer.online ? 'border-orange-500/50 text-orange-300' : 'border-neutral-700 text-neutral-400'}`}
              >
                {printer.online ? 'Online' : 'Offline'}
              </span>
            </div>

            <div className="mt-2 h-2 overflow-hidden rounded-[3px] border border-neutral-800 bg-neutral-950">
              <div className="h-full bg-orange-500" style={{ width: `${Math.max(0, Math.min(100, printer.progress || 0))}%` }} />
            </div>

            <div className="mt-2 flex items-center justify-between ops-tertiary-text">
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

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
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-md border border-dashed border-line p-5 text-xs text-muted">
        <p>No printers configured.</p>
        <button
          type="button"
          onClick={onOpenPrinters}
          className="min-h-9 rounded-md border border-line bg-white/[0.04] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.08em] text-fg"
        >
          Open Printers
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 rounded-md border border-line bg-white/[0.04] p-3">
          {(['all', 'online', 'active'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setScope(item)}
              className={`min-h-9 rounded px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${scope === item ? 'bg-white/10 text-fg' : 'text-fg-faint'}`}
            >
              {item}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onOpenPrinters}
          className="min-h-9 rounded-md border border-line bg-white/[0.04] px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-fg hover:border-line-strong"
        >
          Open
        </button>
      </div>

      <div className="space-y-2 rounded-md border border-line bg-white/[0.04] p-3">
        {visibleRows.map((printer) => (
          <div key={printer.id} className="transition-colors hover:bg-white/[0.06] rounded border border-transparent px-2 py-2.5 last:border-b-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex items-center gap-1.5">
                {printer.online && printer.currentPrint ? (
                  <span className="animate-pulse inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden />
                ) : printer.online ? (
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-success/70" aria-hidden />
                ) : (
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-white/25" aria-hidden />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold leading-tight text-fg/90">{printer.name}</p>
                  <p className="truncate text-xs text-muted">{printer.model}</p>
                </div>
              </div>
              <span
                className={`shrink-0 rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${printer.online ? 'border-success/55 text-success' : 'border-danger/50 text-danger'}`}
              >
                {printer.online ? 'Online' : 'Offline'}
              </span>
            </div>

            <div className="mt-1.5 h-1.5 overflow-hidden rounded border border-line bg-transparent">
              <div className={`h-full ${printer.online ? 'bg-success' : 'bg-danger'}`} style={{ width: `${Math.max(0, Math.min(100, printer.progress || 0))}%` }} />
            </div>

            <div className="mt-1.5 flex items-center justify-between text-xs text-muted">
              <span className="truncate">{printer.currentPrint || printer.status || 'Idle'}</span>
              <span className="tabular-nums text-fg-soft">{Math.max(0, Math.min(100, printer.progress || 0))}%</span>
            </div>
          </div>
        ))}
      </div>

      {filtered.length > limit ? (
        <p className="text-[10px] uppercase tracking-[0.08em] text-fg/45">Showing {limit} of {filtered.length} printers.</p>
      ) : null}
    </div>
  );
}

export default LivePrintersWidget;

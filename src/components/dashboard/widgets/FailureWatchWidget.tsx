export interface FailureWatchRow {
  id: string;
  title: string;
  printer: string;
  startedAt: string;
}

interface FailureWatchWidgetProps {
  rows: FailureWatchRow[];
  failed24hCount: number;
  onOpenHistory: () => void;
}

function FailureWatchWidget({ rows, failed24hCount, onOpenHistory }: FailureWatchWidgetProps) {
  const visibleRows = rows.slice(0, 8);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className={`rounded-[4px] border p-4 ${failed24hCount > 0 ? 'border-rose-500/40 ops-card-tint-failure' : 'border-neutral-800 bg-neutral-900'}`}>
        <p className="ops-secondary-text">Failures (24h)</p>
        <p className={`mt-1.5 text-3xl font-bold leading-tight ${failed24hCount > 0 ? 'text-rose-400' : 'text-white'}`}>{failed24hCount}</p>
      </div>

      {visibleRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
          No recent failed prints.
        </div>
      ) : (
        <div className="space-y-1 rounded-[4px] border border-rose-500/30 ops-card-tint-failure p-3">
          {visibleRows.map((row) => (
            <div key={row.id} className="border-b border-rose-950/40 py-2 last:border-b-0">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-bold text-white">{row.title}</p>
                <span className="shrink-0 rounded-[3px] border border-rose-500/50 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-rose-400">
                  Failed
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-neutral-500 text-xs">
                <span className="truncate">{row.printer}</span>
                <span aria-hidden>•</span>
                <span>{row.startedAt}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onOpenHistory}
        className="widget-no-drag mt-auto rounded-[4px] border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white hover:border-neutral-700"
      >
        Open Print History
      </button>
    </div>
  );
}

export default FailureWatchWidget;

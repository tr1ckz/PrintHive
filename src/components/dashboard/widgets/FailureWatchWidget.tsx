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
      <div className="rounded-[4px] border border-slate-700 bg-slate-900 px-4 py-3.5">
        <p className="ops-secondary-text">Failures (24h)</p>
        <p className="mt-1.5 text-3xl font-bold leading-tight text-white">{failed24hCount}</p>
      </div>

      {visibleRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
          No recent failed prints.
        </div>
      ) : (
        <div className="ops-list rounded-[4px] border border-slate-700 bg-slate-900 px-4 py-3">
          {visibleRows.map((row) => (
            <div key={row.id} className="py-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-bold text-white">{row.title}</p>
                <span className="rounded-[3px] border border-rose-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-rose-300">
                  Failed
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 ops-tertiary-text">
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
        className="widget-no-drag mt-auto rounded-[4px] border border-slate-700 bg-slate-900 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-200 hover:border-slate-500"
      >
        Open Print History
      </button>
    </div>
  );
}

export default FailureWatchWidget;

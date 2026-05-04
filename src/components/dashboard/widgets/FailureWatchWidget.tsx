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
    <div className="flex h-full flex-col gap-3">
      <div className="rounded border border-rose-400/35 bg-rose-500/10 px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-[0.1em] text-rose-200/85">Failure Watch</p>
        <p className="mt-1 text-lg font-bold text-white">{failed24hCount} in last 24h</p>
      </div>

      {visibleRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
          No recent failed prints.
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibleRows.map((row) => (
            <div key={row.id} className="rounded border border-rose-400/25 bg-black/20 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-semibold text-white/90">{row.title}</p>
                <span className="rounded border border-rose-300/40 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-rose-100">
                  Failed
                </span>
              </div>
              <p className="truncate text-[10px] uppercase tracking-[0.09em] text-white/55">{row.printer} · {row.startedAt}</p>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onOpenHistory}
        className="widget-no-drag mt-auto rounded border border-white/20 bg-white/5 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/75 hover:border-white/35"
      >
        Open Print History
      </button>
    </div>
  );
}

export default FailureWatchWidget;

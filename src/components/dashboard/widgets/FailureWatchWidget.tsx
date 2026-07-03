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
    <div className="flex h-full flex-col gap-2.5">
      <div className={`rounded-md border p-4 ${failed24hCount > 0 ? 'border-danger/40 bg-danger/5' : 'border-line bg-white/[0.04]'}`}>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Failures (24h)</p>
        <p className={`mt-1 text-3xl font-bold leading-tight ${failed24hCount > 0 ? 'text-danger' : 'text-fg'}`}>{failed24hCount}</p>
      </div>

      {visibleRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-fg/50">
          No recent failed prints.
        </div>
      ) : (
        <div className="space-y-1 rounded-md border border-danger/30 bg-danger/5 p-2.5">
          {visibleRows.map((row) => (
            <div key={row.id} className="border-b border-danger/20 py-1.5 last:border-b-0">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-bold text-fg">{row.title}</p>
                <span className="shrink-0 rounded border border-danger/50 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-danger">
                  Failed
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-muted text-xs">
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
        className="widget-no-drag mt-auto rounded-md border border-line bg-white/[0.04] px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-fg hover:border-line-strong"
      >
        Open Print History
      </button>
    </div>
  );
}

export default FailureWatchWidget;

export interface QueuePressureSummary {
  pressureScore: number;
  activeJobs: number;
  overdueTasks: number;
  offlinePrinters: number;
  recommendation: string;
}

interface QueuePressureWidgetProps {
  summary: QueuePressureSummary;
  density?: 'compact' | 'comfortable' | 'expanded';
  onRefresh: () => void;
  onOpenMaintenance: () => void;
  onOpenPrinters: () => void;
}

function QueuePressureWidget({ summary, density = 'comfortable', onRefresh, onOpenMaintenance, onOpenPrinters }: QueuePressureWidgetProps) {
  return (
    <div className="flex h-full flex-col gap-2.5">
      <div className="rounded-md border border-line bg-white/[0.04] p-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Queue Pressure</p>
        <p className="mt-1 text-3xl font-bold leading-tight text-fg">{summary.pressureScore}%</p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded border border-line-strong bg-white/10">
          <div className="h-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, summary.pressureScore || 0))}%` }} />
        </div>
        <p className="mt-1 text-[11px] leading-[1.35] text-muted">{summary.recommendation}</p>
      </div>

      <div className={`grid gap-3 text-center ${density === 'compact' ? 'grid-cols-3' : 'grid-cols-3'}`}>
        <div className="rounded-md border border-line bg-white/[0.04] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Active</p>
          <p className="mt-1.5 text-base font-semibold leading-tight text-fg/90">{summary.activeJobs}</p>
        </div>
        <div className="rounded-md border border-line bg-white/[0.04] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Overdue</p>
          <p className="mt-1.5 text-base font-semibold leading-tight text-fg/90">{summary.overdueTasks}</p>
        </div>
        <div className="rounded-md border border-line bg-white/[0.04] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Offline</p>
          <p className="mt-1.5 text-base font-semibold leading-tight text-fg/90">{summary.offlinePrinters}</p>
        </div>
      </div>

      <div className="mt-auto grid grid-cols-1 gap-2">
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-md bg-accent px-3.5 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-accent-contrast hover:bg-accent-strong"
        >
          Refresh Inputs
        </button>
        {density !== 'compact' ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onOpenPrinters}
              className="rounded-md border border-line bg-white/[0.04] px-3.5 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-fg hover:border-line-strong"
            >
              Printers
            </button>
            <button
              type="button"
              onClick={onOpenMaintenance}
              className="rounded-md border border-line bg-white/[0.04] px-3.5 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-fg hover:border-line-strong"
            >
              Maintenance
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default QueuePressureWidget;

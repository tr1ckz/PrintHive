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
  const tone =
    summary.pressureScore >= 75
      ? 'text-rose-200 border-rose-400/45 bg-rose-500/10'
      : summary.pressureScore >= 45
        ? 'text-amber-200 border-amber-400/45 bg-amber-500/10'
        : 'text-emerald-200 border-emerald-400/45 bg-emerald-500/10';

  return (
    <div className="flex h-full flex-col gap-4">
      <div className={`rounded border px-4 py-3.5 ${tone}`}>
        <p className="text-[10px] uppercase tracking-[0.12em] leading-[1.45]">Queue Pressure</p>
        <p className="mt-1.5 text-3xl font-bold leading-tight">{summary.pressureScore}%</p>
        <p className="mt-1.5 text-[11px] leading-[1.45] text-white/80">{summary.recommendation}</p>
      </div>

      <div className={`grid gap-3 text-center ${density === 'compact' ? 'grid-cols-3' : 'grid-cols-3'}`}>
        <div className="rounded border border-white/15 bg-white/[0.03] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.1em] leading-[1.45] text-white/45">Active</p>
          <p className="mt-1.5 text-base font-semibold leading-tight text-white/90">{summary.activeJobs}</p>
        </div>
        <div className="rounded border border-white/15 bg-white/[0.03] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.1em] leading-[1.45] text-white/45">Overdue</p>
          <p className="mt-1.5 text-base font-semibold leading-tight text-white/90">{summary.overdueTasks}</p>
        </div>
        <div className="rounded border border-white/15 bg-white/[0.03] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.1em] leading-[1.45] text-white/45">Offline</p>
          <p className="mt-1.5 text-base font-semibold leading-tight text-white/90">{summary.offlinePrinters}</p>
        </div>
      </div>

      <div className="mt-auto grid grid-cols-1 gap-2">
        <button
          type="button"
          onClick={onRefresh}
          className="rounded border border-white/20 bg-white/5 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/80 hover:border-white/35"
        >
          Refresh Inputs
        </button>
        {density !== 'compact' ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onOpenPrinters}
              className="rounded border border-white/20 bg-white/5 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/75 hover:border-white/35"
            >
              Printers
            </button>
            <button
              type="button"
              onClick={onOpenMaintenance}
              className="rounded border border-white/20 bg-white/5 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/75 hover:border-white/35"
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

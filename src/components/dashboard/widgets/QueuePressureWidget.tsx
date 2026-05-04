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
  const toneClass =
    summary.pressureScore >= 75
      ? 'text-rose-300'
      : summary.pressureScore >= 45
        ? 'text-amber-300'
        : 'text-emerald-300';

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-[4px] border border-slate-700 bg-slate-900 px-4 py-3.5">
        <p className="ops-secondary-text">Queue Pressure</p>
        <p className={`mt-1.5 text-3xl font-bold leading-tight ${toneClass}`}>{summary.pressureScore}%</p>
        <p className="mt-1.5 text-[11px] leading-[1.45] text-slate-400">{summary.recommendation}</p>
      </div>

      <div className={`grid gap-3 text-center ${density === 'compact' ? 'grid-cols-3' : 'grid-cols-3'}`}>
        <div className="rounded-[4px] border border-slate-700 bg-slate-900 px-3 py-2.5">
          <p className="ops-secondary-text">Active</p>
          <p className="mt-1.5 text-base font-semibold leading-tight text-white/90">{summary.activeJobs}</p>
        </div>
        <div className="rounded-[4px] border border-slate-700 bg-slate-900 px-3 py-2.5">
          <p className="ops-secondary-text">Overdue</p>
          <p className="mt-1.5 text-base font-semibold leading-tight text-white/90">{summary.overdueTasks}</p>
        </div>
        <div className="rounded-[4px] border border-slate-700 bg-slate-900 px-3 py-2.5">
          <p className="ops-secondary-text">Offline</p>
          <p className="mt-1.5 text-base font-semibold leading-tight text-white/90">{summary.offlinePrinters}</p>
        </div>
      </div>

      <div className="mt-auto grid grid-cols-1 gap-2">
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-[4px] border border-slate-700 bg-slate-900 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-200 hover:border-slate-500"
        >
          Refresh Inputs
        </button>
        {density !== 'compact' ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onOpenPrinters}
              className="rounded-[4px] border border-slate-700 bg-slate-900 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-200 hover:border-slate-500"
            >
              Printers
            </button>
            <button
              type="button"
              onClick={onOpenMaintenance}
              className="rounded-[4px] border border-slate-700 bg-slate-900 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-200 hover:border-slate-500"
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

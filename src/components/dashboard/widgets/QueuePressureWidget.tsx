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
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-[4px] border border-neutral-800 bg-neutral-900 p-4">
        <p className="ops-secondary-text">Queue Pressure</p>
        <p className="mt-1.5 text-3xl font-bold leading-tight text-white">{summary.pressureScore}%</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-[3px] border border-neutral-700 bg-neutral-800">
          <div className="h-full bg-orange-500" style={{ width: `${Math.max(0, Math.min(100, summary.pressureScore || 0))}%` }} />
        </div>
        <p className="mt-1.5 text-[11px] leading-[1.45] text-neutral-500">{summary.recommendation}</p>
      </div>

      <div className={`grid gap-3 text-center ${density === 'compact' ? 'grid-cols-3' : 'grid-cols-3'}`}>
        <div className="rounded-[4px] border border-neutral-800 bg-neutral-900 px-4 py-3">
          <p className="ops-secondary-text">Active</p>
          <p className="mt-1.5 text-base font-semibold leading-tight text-white/90">{summary.activeJobs}</p>
        </div>
        <div className="rounded-[4px] border border-neutral-800 bg-neutral-900 px-4 py-3">
          <p className="ops-secondary-text">Overdue</p>
          <p className="mt-1.5 text-base font-semibold leading-tight text-white/90">{summary.overdueTasks}</p>
        </div>
        <div className="rounded-[4px] border border-neutral-800 bg-neutral-900 px-4 py-3">
          <p className="ops-secondary-text">Offline</p>
          <p className="mt-1.5 text-base font-semibold leading-tight text-white/90">{summary.offlinePrinters}</p>
        </div>
      </div>

      <div className="mt-auto grid grid-cols-1 gap-2">
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-[4px] border border-orange-500 bg-orange-500 px-3.5 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-white hover:bg-orange-600"
        >
          Refresh Inputs
        </button>
        {density !== 'compact' ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onOpenPrinters}
              className="rounded-[4px] border border-neutral-800 bg-neutral-900 px-3.5 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-white hover:border-neutral-700"
            >
              Printers
            </button>
            <button
              type="button"
              onClick={onOpenMaintenance}
              className="rounded-[4px] border border-neutral-800 bg-neutral-900 px-3.5 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-white hover:border-neutral-700"
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

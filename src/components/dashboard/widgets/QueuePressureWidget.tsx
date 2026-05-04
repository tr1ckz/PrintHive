export interface QueuePressureSummary {
  pressureScore: number;
  activeJobs: number;
  overdueTasks: number;
  offlinePrinters: number;
  recommendation: string;
}

interface QueuePressureWidgetProps {
  summary: QueuePressureSummary;
  onRefresh: () => void;
}

function QueuePressureWidget({ summary, onRefresh }: QueuePressureWidgetProps) {
  const tone =
    summary.pressureScore >= 75
      ? 'text-rose-200 border-rose-400/45 bg-rose-500/10'
      : summary.pressureScore >= 45
        ? 'text-amber-200 border-amber-400/45 bg-amber-500/10'
        : 'text-emerald-200 border-emerald-400/45 bg-emerald-500/10';

  return (
    <div className="flex h-full flex-col gap-3">
      <div className={`rounded border p-3 ${tone}`}>
        <p className="text-[10px] uppercase tracking-[0.1em]">Queue Pressure</p>
        <p className="mt-1 text-2xl font-bold">{summary.pressureScore}%</p>
        <p className="mt-1 text-[11px] text-white/80">{summary.recommendation}</p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded border border-white/15 bg-white/[0.03] p-2">
          <p className="text-[10px] uppercase tracking-[0.08em] text-white/45">Active</p>
          <p className="mt-1 text-sm font-semibold text-white/90">{summary.activeJobs}</p>
        </div>
        <div className="rounded border border-white/15 bg-white/[0.03] p-2">
          <p className="text-[10px] uppercase tracking-[0.08em] text-white/45">Overdue</p>
          <p className="mt-1 text-sm font-semibold text-white/90">{summary.overdueTasks}</p>
        </div>
        <div className="rounded border border-white/15 bg-white/[0.03] p-2">
          <p className="text-[10px] uppercase tracking-[0.08em] text-white/45">Offline</p>
          <p className="mt-1 text-sm font-semibold text-white/90">{summary.offlinePrinters}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={onRefresh}
        className="mt-auto rounded border border-white/20 bg-white/5 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/80 hover:border-white/35"
      >
        Refresh Inputs
      </button>
    </div>
  );
}

export default QueuePressureWidget;

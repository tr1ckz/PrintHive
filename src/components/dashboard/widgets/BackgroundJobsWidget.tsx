export interface BackgroundJobRow {
  id: string;
  name: string;
  running: boolean;
  processed: number;
  total: number;
  completed: number;
  failed: number;
}

interface BackgroundJobsWidgetProps {
  jobs: BackgroundJobRow[];
  density?: 'compact' | 'comfortable' | 'expanded';
  onOpenLibrary: () => void;
  onOpenHistory: () => void;
}

function BackgroundJobsWidget({ jobs, density = 'comfortable', onOpenLibrary, onOpenHistory }: BackgroundJobsWidgetProps) {
  const activeJobs = jobs.filter((job) => job.running);
  const visibleJobs = activeJobs.slice(0, density === 'compact' ? 2 : density === 'expanded' ? 4 : 3);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-[4px] border border-neutral-800 bg-neutral-900 p-4">
        <p className="ops-secondary-text">Pipeline</p>
        <p className="mt-1.5 text-2xl font-bold leading-tight text-white">{activeJobs.length} active</p>
      </div>

      {visibleJobs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
          No background jobs running.
        </div>
      ) : (
        <div className="space-y-4 rounded-[4px] border border-neutral-800 bg-neutral-900 p-4">
          {visibleJobs.map((job) => {
            const pct = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;
            return (
              <div key={job.id} className="border-b border-neutral-800 py-3 last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold leading-tight text-white">{job.name}</p>
                  <span className="ops-tertiary-text">{pct}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-[3px] border border-neutral-800 bg-neutral-950">
                  <div className="h-full bg-orange-500" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                </div>
                <p className="mt-2 ops-tertiary-text">{job.completed} done | {job.failed} failed</p>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-auto grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onOpenLibrary}
          className="rounded-[4px] border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white hover:border-neutral-700"
        >
          Library
        </button>
        <button
          type="button"
          onClick={onOpenHistory}
          className="rounded-[4px] border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white hover:border-neutral-700"
        >
          History
        </button>
      </div>
    </div>
  );
}

export default BackgroundJobsWidget;

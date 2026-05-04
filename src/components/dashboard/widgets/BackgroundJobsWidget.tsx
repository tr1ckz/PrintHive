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
    <div className="flex h-full flex-col gap-3">
      <div className="rounded border border-white/15 bg-black/20 px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-[0.1em] text-white/55">Pipeline</p>
        <p className="mt-1 text-lg font-bold text-white">{activeJobs.length} active</p>
      </div>

      {visibleJobs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
          No background jobs running.
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibleJobs.map((job) => {
            const pct = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;
            return (
              <div key={job.id} className="rounded border border-white/15 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-semibold text-white/90">{job.name}</p>
                  <span className="text-[10px] uppercase tracking-[0.08em] text-white/65">{pct}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded border border-white/10 bg-black/25">
                  <div className="h-full bg-[linear-gradient(90deg,rgba(var(--theme-accent-rgb),0.92),rgba(var(--theme-accent-rgb),0.4))]" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                </div>
                <p className="mt-1.5 text-[10px] uppercase tracking-[0.08em] text-white/50">{job.completed} done | {job.failed} failed</p>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-auto grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onOpenLibrary}
          className="rounded border border-white/20 bg-white/5 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/75 hover:border-white/35"
        >
          Library
        </button>
        <button
          type="button"
          onClick={onOpenHistory}
          className="rounded border border-white/20 bg-white/5 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/75 hover:border-white/35"
        >
          History
        </button>
      </div>
    </div>
  );
}

export default BackgroundJobsWidget;

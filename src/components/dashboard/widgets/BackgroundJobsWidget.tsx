import { Inbox } from 'lucide-react';

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
      <div className="rounded-md border border-line bg-white/[0.04] p-5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Pipeline</p>
        <p className="mt-1.5 text-2xl font-bold leading-tight text-fg">{activeJobs.length} active</p>
      </div>

      {visibleJobs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded border border-dashed border-line-strong bg-transparent/40 p-5 text-xs text-muted">
          <Inbox className="h-4 w-4 text-muted" aria-hidden />
          <p className="italic">No background jobs running.</p>
        </div>
      ) : (
        <div className="space-y-4 rounded-md border border-line bg-white/[0.04] p-5">
          {visibleJobs.map((job) => {
            const pct = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;
            return (
              <div key={job.id} className="border-b border-line py-4 last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold leading-tight text-fg">{job.name}</p>
                  <span className="text-xs text-muted">{pct}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded border border-line-strong bg-white/10">
                  <div className="h-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                </div>
                <p className="mt-2 text-xs text-muted">{job.completed} done | {job.failed} failed</p>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-auto grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onOpenLibrary}
          className="rounded-md border border-line bg-white/[0.04] px-3.5 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-fg hover:border-line-strong"
        >
          Library
        </button>
        <button
          type="button"
          onClick={onOpenHistory}
          className="rounded-md border border-line bg-white/[0.04] px-3.5 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-fg hover:border-line-strong"
        >
          History
        </button>
      </div>
    </div>
  );
}

export default BackgroundJobsWidget;

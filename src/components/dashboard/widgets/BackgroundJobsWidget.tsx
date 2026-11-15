import ProgressBar from '../../common/ProgressBar';
import { EmptyLine, MoreLine } from '../primitives';

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
}

const MAX_ROWS = 4;

function BackgroundJobsWidget({ jobs }: BackgroundJobsWidgetProps) {
  const activeJobs = jobs.filter((job) => job.running);

  if (activeJobs.length === 0) {
    return <EmptyLine>No background jobs running.</EmptyLine>;
  }

  return (
    <div>
      <ul className="divide-y divide-line">
        {activeJobs.slice(0, MAX_ROWS).map((job) => {
          const pct = job.total > 0 ? Math.max(0, Math.min(100, Math.round((job.processed / job.total) * 100))) : 0;
          return (
            <li key={job.id} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-[13px] font-medium text-fg">{job.name}</p>
                <span className="shrink-0 text-xs tabular-nums text-fg-soft">{pct}%</span>
              </div>
              <ProgressBar value={pct} size="xs" className="mt-1.5" />
              <p className="mt-1.5 text-xs tabular-nums text-muted">
                {job.processed} of {job.total} processed
                {job.failed > 0 ? <span className="text-danger"> · {job.failed} failed</span> : null}
              </p>
            </li>
          );
        })}
      </ul>
      {activeJobs.length > MAX_ROWS ? <MoreLine>+{activeJobs.length - MAX_ROWS} more jobs</MoreLine> : null}
    </div>
  );
}

export default BackgroundJobsWidget;

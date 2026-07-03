import { useState } from 'react';

export interface ActivityRow {
  id: string;
  title: string;
  printer: string;
  status: string;
  startedAt: string;
  durationLabel: string;
  weightLabel: string;
  thumbnailUrl?: string | null;
  progressPct?: number;
}

interface ActivityStreamWidgetProps {
  rows: ActivityRow[];
  density?: 'compact' | 'comfortable' | 'expanded';
}

function ActivityStreamWidget({ rows, density = 'comfortable' }: ActivityStreamWidgetProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed' | 'running'>('all');

  const filteredRows = rows.filter((row) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'success') return row.status.toLowerCase() === 'success';
    if (statusFilter === 'failed') return row.status.toLowerCase() === 'failed';
    return row.status.toLowerCase() === 'running';
  });

  const rowLimit = density === 'compact' ? 4 : density === 'expanded' ? 12 : 8;
  const visibleRows = filteredRows.slice(0, rowLimit);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded border border-dashed border-white/20 p-5 text-xs text-fg/50">
        No recent activity to display.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5 rounded-md border border-line bg-white/[0.04] p-2">
        {(['all', 'running', 'success', 'failed'] as const).map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setStatusFilter(filter)}
            className={`min-h-9 rounded px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${statusFilter === filter ? 'bg-white/10 text-fg' : 'text-fg-faint'}`}
          >
            {filter}
          </button>
        ))}
      </div>

      <div className={`grid gap-2 ${density === 'compact' ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
      {visibleRows.map((row) => {
        const statusKey = row.status.toLowerCase();
        const isSuccess = statusKey === 'success' || statusKey === 'finished' || statusKey === 'complete' || statusKey === 'completed';
        const isFailure = statusKey === 'failed' || statusKey === 'failure' || statusKey === 'error' || statusKey === 'cancelled' || statusKey === 'canceled';
        const isRunning = statusKey === 'running';

        const badgeClass = isRunning
          ? 'border-warning/60 bg-warning/15 text-warning'
          : isSuccess
          ? 'border-success/60 bg-success/15 text-success'
          : isFailure
          ? 'border-danger/60 bg-danger/15 text-danger'
          : 'border-line-strong bg-white/10 text-fg-soft';

        const progressBarClass = isRunning ? 'bg-warning' : isSuccess ? 'bg-success' : isFailure ? 'bg-danger' : 'bg-white/20';
        const cardLeftBorder = isRunning ? 'border-l-warning' : isSuccess ? 'border-l-success' : isFailure ? 'border-l-danger' : 'border-l-line-strong';
        const cardTint = isRunning ? 'bg-warning/5' : isSuccess ? 'bg-success/5' : isFailure ? 'bg-danger/5' : '';
        const progressPct = Math.max(6, Math.min(100, row.progressPct ?? (isRunning ? 50 : 100)));

        return (
          <article key={row.id} className={`transition-colors hover:bg-white/[0.06] ${cardTint} relative rounded-md border border-line border-l-[3px] ${cardLeftBorder} bg-white/[0.04] p-2.5`}>
            <span className={`absolute right-2 top-2 z-10 shrink-0 rounded border bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${badgeClass}`}>
              {isRunning ? (
                <span className="inline-flex items-center gap-1">
                  <span className="animate-pulse inline-block h-1.5 w-1.5 rounded-full bg-warning" />
                  {row.status}
                </span>
              ) : row.status}
            </span>

            <div className="relative mb-2 h-20 overflow-hidden rounded-md border border-line bg-transparent">
              {row.thumbnailUrl ? (
                <img
                  src={row.thumbnailUrl}
                  alt={row.title}
                  loading="lazy"
                  decoding="async"
                  fetchPriority="low"
                  className="h-full w-full object-cover object-center"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                />
              ) : null}

              <div className="absolute inset-0 bg-black/25" />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-start justify-between gap-2 pr-20">
                <p className="truncate text-sm font-bold text-fg">{row.title}</p>
              </div>
              <p className="text-xs font-semibold tracking-wider text-fg-faint uppercase truncate">{row.printer}</p>

              <div className="h-1.5 overflow-hidden rounded border border-line-strong bg-white/10">
                <div
                  className={`h-full ${progressBarClass}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-muted text-xs">
                <span className="truncate">{row.startedAt}</span>
                <span aria-hidden>•</span>
                <span>{row.durationLabel}</span>
                <span aria-hidden>•</span>
                <span>{row.weightLabel}</span>
              </div>
            </div>
          </article>
        );
      })}
      </div>

      {filteredRows.length > rowLimit ? (
        <p className="text-xs text-muted">
          Showing {rowLimit} of {filteredRows.length} rows for this filter.
        </p>
      ) : null}

    </div>
  );
}

export default ActivityStreamWidget;

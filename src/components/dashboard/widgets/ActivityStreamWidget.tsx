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
      <div className="flex h-full items-center justify-center rounded border border-dashed border-white/20 p-5 text-xs text-white/50">
        No recent activity to display.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5 rounded-[4px] border border-neutral-800 bg-neutral-900 p-2">
        {(['all', 'running', 'success', 'failed'] as const).map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setStatusFilter(filter)}
            className={`ops-micro-btn rounded-[3px] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${statusFilter === filter ? 'bg-neutral-800 text-white' : 'text-neutral-400'}`}
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
          ? 'border-amber-500/60 bg-amber-500/15 text-amber-400'
          : isSuccess
          ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-400'
          : isFailure
          ? 'border-rose-500/60 bg-rose-500/15 text-rose-500'
          : 'border-neutral-700 bg-neutral-800 text-neutral-300';

        const progressBarClass = isRunning ? 'bg-amber-500' : isSuccess ? 'bg-emerald-500' : isFailure ? 'bg-rose-500' : 'bg-neutral-500';
        const cardLeftBorder = isRunning ? 'border-l-amber-500' : isSuccess ? 'border-l-emerald-500' : isFailure ? 'border-l-rose-500' : 'border-l-neutral-700';
        const cardTint = isRunning ? 'ops-card-tint-warning' : isSuccess ? 'ops-card-tint-success' : isFailure ? 'ops-card-tint-failure' : '';
        const progressPct = Math.max(6, Math.min(100, row.progressPct ?? (isRunning ? 50 : 100)));

        return (
          <article key={row.id} className={`ops-clickable-card ${cardTint} relative rounded-[4px] border border-neutral-800 border-l-[3px] ${cardLeftBorder} bg-neutral-900 p-2.5`}>
            <span className={`absolute right-2 top-2 z-10 shrink-0 rounded-[3px] border bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${badgeClass}`}>
              {isRunning ? (
                <span className="inline-flex items-center gap-1">
                  <span className="ops-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                  {row.status}
                </span>
              ) : row.status}
            </span>

            <div className="relative mb-2 h-20 overflow-hidden rounded-[4px] border border-neutral-800 bg-neutral-950">
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
                <p className="truncate text-sm font-bold text-white">{row.title}</p>
              </div>
              <p className="text-xs font-semibold tracking-wider text-neutral-400 uppercase truncate">{row.printer}</p>

              <div className="h-1.5 overflow-hidden rounded-[3px] border border-neutral-700 bg-neutral-800">
                <div
                  className={`h-full ${progressBarClass}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              <div className="ops-data-value flex flex-wrap items-center gap-1.5 text-neutral-500 text-xs">
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
        <p className="ops-tertiary-text">
          Showing {rowLimit} of {filteredRows.length} rows for this filter.
        </p>
      ) : null}

    </div>
  );
}

export default ActivityStreamWidget;

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
      <div className="flex h-full items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
        No recent activity to display.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 rounded-[4px] border border-neutral-800 bg-neutral-900 p-2">
        {(['all', 'running', 'success', 'failed'] as const).map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setStatusFilter(filter)}
            className={`rounded-[3px] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${statusFilter === filter ? 'bg-neutral-800 text-white' : 'text-neutral-400'}`}
          >
            {filter}
          </button>
        ))}
      </div>

      <div className={`grid gap-4 ${density === 'compact' ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
      {visibleRows.map((row) => {
        const statusKey = row.status.toLowerCase();
        const badgeClass =
          statusKey === 'running'
            ? 'border-orange-500/60 bg-orange-500/20 text-white'
            : 'border-neutral-700 bg-neutral-800 text-neutral-200';
        const progressPct = Math.max(6, Math.min(100, row.progressPct ?? (statusKey === 'running' ? 50 : 100)));

        return (
          <article key={row.id} className="rounded-[4px] border border-neutral-800 bg-neutral-900 p-4">
            <div className="relative mb-3 h-28 overflow-hidden rounded-[4px] border border-neutral-800 bg-neutral-950">
              {row.thumbnailUrl ? (
                <img
                  src={row.thumbnailUrl}
                  alt={row.title}
                  loading="lazy"
                  className="h-full w-full object-cover"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                />
              ) : null}

              <div className="absolute inset-0 bg-black/25" />
            </div>

            <div className="space-y-4 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-sm font-bold text-white">{row.title}</p>
                <span className={`shrink-0 rounded-[3px] border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${badgeClass}`}>
                  {row.status}
                </span>
              </div>
              <p className="text-xs font-semibold tracking-wider text-neutral-400 uppercase truncate">{row.printer}</p>

              <div className="h-1.5 overflow-hidden rounded-[3px] border border-neutral-800 bg-neutral-950">
                <div
                  className={`h-full ${statusKey === 'running' ? 'bg-orange-500' : 'bg-neutral-500'}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-neutral-500 text-xs">
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

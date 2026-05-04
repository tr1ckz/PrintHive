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
      <div className="flex flex-wrap gap-2 rounded-[4px] border border-slate-700 bg-slate-900 p-2">
        {(['all', 'running', 'success', 'failed'] as const).map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setStatusFilter(filter)}
            className={`rounded-[3px] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${statusFilter === filter ? 'bg-slate-700 text-white' : 'text-slate-400'}`}
          >
            {filter}
          </button>
        ))}
      </div>

      <div className={`grid gap-3 ${density === 'compact' ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
      {visibleRows.map((row) => {
        const statusKey = row.status.toLowerCase();
        const badgeClass =
          statusKey === 'success'
            ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
            : statusKey === 'failed'
              ? 'border-rose-400/40 bg-rose-500/15 text-rose-100'
              : 'border-amber-400/40 bg-amber-500/15 text-amber-100';
        const progressPct = Math.max(6, Math.min(100, row.progressPct ?? (statusKey === 'running' ? 50 : 100)));

        return (
          <article key={row.id} className="overflow-hidden rounded-[4px] border border-slate-700 bg-slate-900">
            <div className="relative h-28 overflow-hidden border-b border-slate-800 bg-slate-950">
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

              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_45%,rgba(0,0,0,0.35)_100%)]" />
            </div>

            <div className="space-y-3 px-4 py-3.5">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-sm font-bold text-white">{row.title}</p>
                <span className={`shrink-0 rounded-[3px] border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${badgeClass}`}>
                  {row.status}
                </span>
              </div>
              <p className="ops-secondary-text truncate">{row.printer}</p>

              <div className="h-1.5 overflow-hidden rounded-[3px] border border-slate-700 bg-slate-950">
                <div
                  className={`h-full ${statusKey === 'failed' ? 'bg-rose-400' : statusKey === 'running' ? 'bg-amber-300' : 'bg-emerald-400'}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5 ops-tertiary-text">
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

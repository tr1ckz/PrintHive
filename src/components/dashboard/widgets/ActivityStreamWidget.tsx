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
    <div className="space-y-3.5">
      <div className="flex flex-wrap gap-1.5 rounded border border-white/15 bg-black/20 p-1.5">
        {(['all', 'running', 'success', 'failed'] as const).map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setStatusFilter(filter)}
            className={`rounded px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusFilter === filter ? 'bg-white/15 text-white' : 'text-white/60'}`}
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
          <article key={row.id} className="overflow-hidden rounded border border-white/15 bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="relative h-28 overflow-hidden border-b border-white/10 bg-[linear-gradient(160deg,rgba(var(--theme-accent-rgb),0.18),rgba(20,24,31,0.95))]">
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

              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_42%,rgba(0,0,0,0.74)_100%)]" />

              <span className={`absolute right-2 top-2 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.09em] ${badgeClass}`}>
                {row.status}
              </span>

              <div className="absolute bottom-2 left-3 right-3">
                <p className="truncate pr-20 text-sm font-bold text-white">{row.title}</p>
              </div>
            </div>

            <div className="space-y-2.5 px-3 py-3">
              <p className="truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-white/45">{row.printer}</p>

              <div className="h-1.5 overflow-hidden rounded border border-white/15 bg-black/30">
                <div
                  className={`h-full ${statusKey === 'failed' ? 'bg-rose-400/90' : statusKey === 'running' ? 'bg-amber-300/90' : 'bg-emerald-400/90'}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              <div className="flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-[0.08em] text-white/42">
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
        <p className="text-[10px] uppercase tracking-[0.08em] text-white/45">
          Showing {rowLimit} of {filteredRows.length} rows for this filter.
        </p>
      ) : null}

    </div>
  );
}

export default ActivityStreamWidget;

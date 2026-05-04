import { useState } from 'react';

export interface ActivityRow {
  id: string;
  title: string;
  printer: string;
  status: string;
  startedAt: string;
  durationLabel: string;
  weightLabel: string;
}

interface ActivityStreamWidgetProps {
  rows: ActivityRow[];
  density?: 'compact' | 'comfortable' | 'expanded';
}

function ActivityStreamWidget({ rows, density = 'comfortable' }: ActivityStreamWidgetProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed' | 'running'>('all');
  const [selectedRow, setSelectedRow] = useState<ActivityRow | null>(null);

  const filteredRows = rows.filter((row) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'success') return row.status.toLowerCase() === 'success';
    if (statusFilter === 'failed') return row.status.toLowerCase() === 'failed';
    return row.status.toLowerCase() === 'running';
  });

  const rowLimit = density === 'compact' ? 6 : density === 'expanded' ? 12 : 9;
  const visibleRows = filteredRows.slice(0, rowLimit);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
        No recent activity to display.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1 rounded border border-white/15 bg-black/20 p-1">
        {(['all', 'running', 'success', 'failed'] as const).map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setStatusFilter(filter)}
            className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusFilter === filter ? 'bg-white/15 text-white' : 'text-white/60'}`}
          >
            {filter}
          </button>
        ))}
      </div>

      {visibleRows.map((row) => {
        const isExpanded = expandedId === row.id;
        return (
          <div key={row.id} className="rounded border border-white/15 bg-white/[0.03]">
            <button
              type="button"
              onClick={() => setExpandedId(isExpanded ? null : row.id)}
              className="flex w-full items-center justify-between gap-3 px-2 py-2 text-left"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-white/90">{row.title}</p>
                <p className="truncate text-[10px] uppercase tracking-[0.1em] text-white/50">{row.printer}</p>
              </div>
              <span className="rounded border border-white/20 bg-black/30 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-white/75">
                {row.status}
              </span>
            </button>

            {isExpanded ? (
              <div className="grid grid-cols-3 gap-2 border-t border-white/10 px-2 py-2 text-[10px] uppercase tracking-[0.08em] text-white/55">
                <div>
                  <p className="text-white/40">Started</p>
                  <p className="mt-1 text-white/80">{row.startedAt}</p>
                </div>
                <div>
                  <p className="text-white/40">Duration</p>
                  <p className="mt-1 text-white/80">{row.durationLabel}</p>
                </div>
                <div>
                  <p className="text-white/40">Weight</p>
                  <p className="mt-1 text-white/80">{row.weightLabel}</p>
                </div>
              </div>
            ) : null}

            {isExpanded ? (
              <div className="border-t border-white/10 px-2 py-2">
                <button
                  type="button"
                  onClick={() => setSelectedRow(row)}
                  className="rounded border border-white/20 bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/75 hover:border-white/35"
                >
                  Drill Down
                </button>
              </div>
            ) : null}
          </div>
        );
      })}

      {filteredRows.length > rowLimit ? (
        <p className="text-[10px] uppercase tracking-[0.08em] text-white/45">
          Showing {rowLimit} of {filteredRows.length} rows for this filter.
        </p>
      ) : null}

      {selectedRow ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-md rounded-md border border-white/20 bg-[linear-gradient(180deg,rgba(18,20,25,0.98),rgba(11,13,18,0.98))] p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-white">Activity Detail</h4>
              <button
                type="button"
                onClick={() => setSelectedRow(null)}
                className="rounded border border-white/20 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-white/70"
              >
                Close
              </button>
            </div>
            <div className="space-y-2 text-xs text-white/80">
              <p><span className="text-white/45">Title:</span> {selectedRow.title}</p>
              <p><span className="text-white/45">Printer:</span> {selectedRow.printer}</p>
              <p><span className="text-white/45">Status:</span> {selectedRow.status}</p>
              <p><span className="text-white/45">Started:</span> {selectedRow.startedAt}</p>
              <p><span className="text-white/45">Duration:</span> {selectedRow.durationLabel}</p>
              <p><span className="text-white/45">Weight:</span> {selectedRow.weightLabel}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ActivityStreamWidget;

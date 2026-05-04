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
}

function ActivityStreamWidget({ rows }: ActivityStreamWidgetProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
        No recent activity to display.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
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
          </div>
        );
      })}
    </div>
  );
}

export default ActivityStreamWidget;

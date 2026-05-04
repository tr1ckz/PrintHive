import { useMemo, useState } from 'react';

export interface ScheduleItem {
  id: string;
  title: string;
  printer: string;
  dueLabel: string;
  overdue: boolean;
  hoursUntilDue: number | null;
}

interface UpcomingScheduleWidgetProps {
  items: ScheduleItem[];
  density?: 'compact' | 'comfortable' | 'expanded';
}

function UpcomingScheduleWidget({ items, density = 'comfortable' }: UpcomingScheduleWidgetProps) {
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);

  const filtered = useMemo(
    () => (showOverdueOnly ? items.filter((item) => item.overdue) : items),
    [items, showOverdueOnly]
  );

  const limit = density === 'compact' ? 6 : density === 'expanded' ? 12 : 9;
  const visibleItems = filtered.slice(0, limit);

  return (
    <div className="flex h-full flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="ops-secondary-text">Maintenance Queue</p>
        <button
          type="button"
          onClick={() => setShowOverdueOnly((current) => !current)}
          className="rounded-[4px] border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white hover:border-neutral-700"
        >
          {showOverdueOnly ? 'All' : 'Overdue'}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
          No scheduled maintenance tasks.
        </div>
      ) : (
        <div className="space-y-1 rounded-[4px] border border-neutral-800 bg-neutral-900 p-2.5">
          {visibleItems.map((item) => {
            const dueBadgeClass = item.overdue
              ? 'border-rose-500/50 text-rose-400'
              : item.hoursUntilDue !== null && item.hoursUntilDue <= 168
              ? 'border-amber-500/50 text-amber-400'
              : 'border-neutral-700 text-neutral-400';
            return (
              <div key={item.id} className="border-b border-neutral-800 py-2 last:border-b-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-white">{item.title}</p>
                    <p className="mt-0.5 truncate text-neutral-500 text-xs">{item.printer}</p>
                  </div>
                  <span className={`shrink-0 rounded-[3px] border px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] ${dueBadgeClass}`}>
                    {item.dueLabel}
                  </span>
                </div>
              </div>
            );
          })}

          {filtered.length > limit ? (
            <p className="text-[10px] uppercase tracking-[0.08em] text-white/45">Showing {limit} of {filtered.length} tasks.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default UpcomingScheduleWidget;

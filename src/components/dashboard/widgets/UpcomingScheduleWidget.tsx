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
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="ops-secondary-text">Maintenance Queue</p>
        <button
          type="button"
          onClick={() => setShowOverdueOnly((current) => !current)}
          className="rounded-[4px] border border-neutral-800 bg-neutral-900 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-white hover:border-neutral-700"
        >
          {showOverdueOnly ? 'All' : 'Overdue'}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
          No scheduled maintenance tasks.
        </div>
      ) : (
        <div className="space-y-4 rounded-[4px] border border-neutral-800 bg-neutral-900 p-5">
          {visibleItems.map((item) => (
            <div key={item.id} className="border-b border-neutral-800 py-3 last:border-b-0">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white">{item.title}</p>
                  <p className="mt-1 truncate text-neutral-500 text-xs">{item.printer}</p>
                </div>
                <span className="rounded-[3px] border border-neutral-700 px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-neutral-300">
                  {item.dueLabel}
                </span>
              </div>
            </div>
          ))}

          {filtered.length > limit ? (
            <p className="text-[10px] uppercase tracking-[0.08em] text-white/45">Showing {limit} of {filtered.length} tasks.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default UpcomingScheduleWidget;

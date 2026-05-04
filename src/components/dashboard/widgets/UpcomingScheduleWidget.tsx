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
          className="rounded-[4px] border border-slate-700 bg-slate-900 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-200 hover:border-slate-500"
        >
          {showOverdueOnly ? 'All' : 'Overdue'}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
          No scheduled maintenance tasks.
        </div>
      ) : (
        <div className="ops-list rounded-[4px] border border-slate-700 bg-slate-900 px-4 py-3">
          {visibleItems.map((item) => (
            <div key={item.id} className="py-1">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white">{item.title}</p>
                  <p className="mt-1 truncate ops-tertiary-text">{item.printer}</p>
                </div>
                <span className={`rounded-[3px] border px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] ${item.overdue ? 'border-rose-700 text-rose-300' : 'border-slate-700 text-slate-300'}`}>
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

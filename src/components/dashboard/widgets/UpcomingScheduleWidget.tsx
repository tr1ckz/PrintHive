import { useMemo, useState } from 'react';
import { EmptyLine, MoreLine, Pill, Segmented, type Tone } from '../primitives';

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
}

type Scope = 'all' | 'overdue';

const MAX_ROWS = 5;
const DUE_SOON_HOURS = 168;

function UpcomingScheduleWidget({ items }: UpcomingScheduleWidgetProps) {
  const [scope, setScope] = useState<Scope>('all');

  const overdueCount = useMemo(() => items.filter((item) => item.overdue).length, [items]);
  // The filter only earns its place when it would hide something.
  const canFilter = overdueCount > 0 && overdueCount < items.length;
  const filtered = canFilter && scope === 'overdue' ? items.filter((item) => item.overdue) : items;

  if (items.length === 0) {
    return <EmptyLine>No maintenance tasks scheduled.</EmptyLine>;
  }

  return (
    <div>
      {canFilter ? (
        <div className="pb-2">
          <Segmented<Scope>
            label="Filter maintenance tasks"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: 'All' },
              { value: 'overdue', label: 'Overdue' },
            ]}
          />
        </div>
      ) : null}

      <ul className="divide-y divide-line">
        {filtered.slice(0, MAX_ROWS).map((item) => {
          const tone: Tone = item.overdue
            ? 'danger'
            : item.hoursUntilDue !== null && item.hoursUntilDue <= DUE_SOON_HOURS
              ? 'warning'
              : 'neutral';
          return (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-fg">{item.title}</p>
                <p className="truncate text-xs text-muted">{item.printer}</p>
              </div>
              <Pill tone={tone}>{item.dueLabel}</Pill>
            </li>
          );
        })}
      </ul>

      {filtered.length > MAX_ROWS ? <MoreLine>+{filtered.length - MAX_ROWS} more tasks</MoreLine> : null}
    </div>
  );
}

export default UpcomingScheduleWidget;

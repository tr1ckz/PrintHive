import { EmptyLine, MoreLine } from '../primitives';

export interface FailureWatchRow {
  id: string;
  title: string;
  printer: string;
  startedAt: string;
}

interface FailureWatchWidgetProps {
  rows: FailureWatchRow[];
}

const MAX_ROWS = 4;

function FailureWatchWidget({ rows }: FailureWatchWidgetProps) {
  if (rows.length === 0) {
    return <EmptyLine tone="success">No failed prints in recent history.</EmptyLine>;
  }

  return (
    <div>
      <ul className="divide-y divide-line">
        {rows.slice(0, MAX_ROWS).map((row) => (
          <li key={row.id} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-fg">{row.title}</p>
              <p className="truncate text-xs text-muted">{row.printer}</p>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted">{row.startedAt}</span>
          </li>
        ))}
      </ul>
      {rows.length > MAX_ROWS ? <MoreLine>+{rows.length - MAX_ROWS} more in History</MoreLine> : null}
    </div>
  );
}

export default FailureWatchWidget;

import { useState } from 'react';
import { Box } from 'lucide-react';
import { EmptyLine, MoreLine, Segmented, StatusLabel, type Tone } from '../primitives';

export interface ActivityRow {
  id: string;
  title: string;
  printer: string;
  status: string;
  startedAt: string;
  durationLabel: string;
  weightLabel: string | null;
  thumbnailUrl?: string | null;
}

interface ActivityStreamWidgetProps {
  rows: ActivityRow[];
}

type StatusFilter = 'all' | 'running' | 'success' | 'failed';

const MAX_ROWS = 7;

const SUCCESS_STATES = new Set(['success', 'finished', 'complete', 'completed']);
const FAILURE_STATES = new Set(['failed', 'failure', 'error', 'cancelled', 'canceled']);

function classify(status: string): { filter: StatusFilter | null; tone: Tone; pulse: boolean } {
  const key = status.toLowerCase();
  if (key === 'running') return { filter: 'running', tone: 'accent', pulse: true };
  if (SUCCESS_STATES.has(key)) return { filter: 'success', tone: 'success', pulse: false };
  if (FAILURE_STATES.has(key)) return { filter: 'failed', tone: 'danger', pulse: false };
  return { filter: null, tone: 'neutral', pulse: false };
}

function Thumbnail({ url }: { url?: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/5 text-disabled">
      {url && !failed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Box className="size-4" aria-hidden />
      )}
    </span>
  );
}

function ActivityStreamWidget({ rows }: ActivityStreamWidgetProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  if (rows.length === 0) {
    return <EmptyLine>No prints recorded yet.</EmptyLine>;
  }

  const classified = rows.map((row) => ({ row, ...classify(row.status) }));
  // Only offer filters that would actually narrow the list.
  const options: Array<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: 'All' },
    ...(['running', 'success', 'failed'] as const)
      .filter((value) => classified.some((entry) => entry.filter === value))
      .map((value) => ({ value, label: value === 'running' ? 'Running' : value === 'success' ? 'Succeeded' : 'Failed' })),
  ];
  const activeFilter = options.some((option) => option.value === statusFilter) ? statusFilter : 'all';
  const filtered = activeFilter === 'all' ? classified : classified.filter((entry) => entry.filter === activeFilter);
  const visible = filtered.slice(0, MAX_ROWS);

  return (
    <div>
      {options.length > 2 ? (
        <div className="pb-2">
          <Segmented<StatusFilter> label="Filter prints by result" value={activeFilter} onChange={setStatusFilter} options={options} />
        </div>
      ) : null}

      <ul className="divide-y divide-line">
        {visible.map(({ row, tone, pulse }) => (
          <li key={row.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
            <Thumbnail url={row.thumbnailUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-fg">{row.title}</p>
              <p className="truncate text-xs tabular-nums text-muted">
                {[row.printer, row.startedAt, row.durationLabel, row.weightLabel].filter(Boolean).join(' · ')}
              </p>
            </div>
            <StatusLabel tone={tone} pulse={pulse}>{row.status}</StatusLabel>
          </li>
        ))}
      </ul>

      {filtered.length > MAX_ROWS ? <MoreLine>+{filtered.length - MAX_ROWS} more in History</MoreLine> : null}
    </div>
  );
}

export default ActivityStreamWidget;

import { useMemo, useState } from 'react';
import ProgressBar from '../../common/ProgressBar';
import { EmptyLine, MoreLine, Segmented, StatusLabel, type Tone } from '../primitives';

/** Live LAN link health reported by /api/printers/status (absent for cloud-only printers). */
export interface PrinterConnection {
  connected?: boolean;
  connectedSince?: string | number | null;
  lastMessageAt?: string | number | null;
  drops?: number;
  lastDropAt?: string | number | null;
  lastDropReason?: string | null;
}

export interface LivePrinterRow {
  id: string;
  name: string;
  model: string;
  status: string;
  online: boolean;
  progress: number;
  currentPrint: string | null;
  connection?: PrinterConnection | null;
}

interface LivePrintersWidgetProps {
  printers: LivePrinterRow[];
}

type Scope = 'all' | 'online' | 'active';

const MAX_ROWS = 8;
/** Below this the filter is noise — the whole fleet is already on screen. */
const FILTER_THRESHOLD = 4;

const PRINTING_STATES = new Set(['RUNNING', 'PRINTING', 'PREPARE', 'SLICING']);
const PAUSED_STATES = new Set(['PAUSE', 'PAUSED']);
const ERROR_STATES = new Set(['FAILED', 'ERROR']);

export interface PrinterState {
  label: string;
  tone: Tone;
  pulse: boolean;
  /** Whether a job is in flight, i.e. progress is meaningful */
  busy: boolean;
}

/** Maps the API's `online` + raw `status` onto the dashboard's four states. */
export function describePrinterState(online: boolean, status: string | null | undefined, hasJob: boolean): PrinterState {
  if (!online) return { label: 'Offline', tone: 'neutral', pulse: false, busy: false };
  const key = String(status || '').toUpperCase();
  if (ERROR_STATES.has(key)) return { label: 'Error', tone: 'danger', pulse: false, busy: false };
  if (PAUSED_STATES.has(key)) return { label: 'Paused', tone: 'warning', pulse: false, busy: true };
  if (PRINTING_STATES.has(key) || hasJob) return { label: 'Printing', tone: 'accent', pulse: true, busy: true };
  if (key === 'FINISH' || key === 'SUCCESS') return { label: 'Finished', tone: 'success', pulse: false, busy: false };
  return { label: 'Idle', tone: 'success', pulse: false, busy: false };
}

/**
 * Quiet link-health note for a row's second line: only speaks up when the
 * LAN connection has been unstable, so healthy printers stay uncluttered.
 */
function connectionHint(online: boolean, connection?: PrinterConnection | null): string | null {
  if (!connection) return null;
  const drops = Number(connection.drops || 0);
  if (!online && connection.connected === false && (drops > 0 || connection.connectedSince)) {
    return 'Reconnecting…';
  }
  if (drops > 0) {
    return `${drops} connection drop${drops === 1 ? '' : 's'}`;
  }
  return null;
}

function LivePrintersWidget({ printers }: LivePrintersWidgetProps) {
  const [scope, setScope] = useState<Scope>('all');

  const filtered = useMemo(() => {
    if (scope === 'online') return printers.filter((printer) => printer.online);
    if (scope === 'active') return printers.filter((printer) => printer.online && printer.currentPrint);
    return printers;
  }, [printers, scope]);

  if (printers.length === 0) {
    return <EmptyLine>No printers configured yet.</EmptyLine>;
  }

  const visibleRows = filtered.slice(0, MAX_ROWS);

  return (
    <div>
      {printers.length >= FILTER_THRESHOLD ? (
        <div className="pb-2">
          <Segmented<Scope>
            label="Filter printers"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: 'All' },
              { value: 'online', label: 'Online' },
              { value: 'active', label: 'Printing' },
            ]}
          />
        </div>
      ) : null}

      {visibleRows.length === 0 ? (
        <EmptyLine>No printers match this filter.</EmptyLine>
      ) : (
        <ul className="divide-y divide-line">
          {visibleRows.map((printer) => {
            const state = describePrinterState(printer.online, printer.status, Boolean(printer.currentPrint));
            const progress = Math.max(0, Math.min(100, Math.round(printer.progress || 0)));
            const hint = connectionHint(printer.online, printer.connection);
            return (
              <li key={printer.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`truncate text-[13px] font-medium ${printer.online ? 'text-fg' : 'text-fg-soft'}`}>{printer.name}</p>
                    <p className="truncate text-xs text-muted">
                      {state.busy && printer.currentPrint ? printer.currentPrint : printer.model}
                      {hint ? <span className="text-warning"> · {hint}</span> : null}
                    </p>
                  </div>
                  <StatusLabel tone={state.tone} pulse={state.pulse}>
                    {state.busy ? `${state.label} ${progress}%` : state.label}
                  </StatusLabel>
                </div>
                {state.busy ? (
                  <ProgressBar value={progress} tone={state.tone === 'warning' ? 'warning' : 'accent'} size="xs" className="mt-2" />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {filtered.length > MAX_ROWS ? <MoreLine>+{filtered.length - MAX_ROWS} more printers</MoreLine> : null}
    </div>
  );
}

export default LivePrintersWidget;

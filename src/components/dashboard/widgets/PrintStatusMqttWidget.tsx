import ProgressBar from '../../common/ProgressBar';
import { EmptyLine, MoreLine, Pill } from '../primitives';
import { describePrinterState } from './LivePrintersWidget';

export interface MqttPrinterRow {
  id: string;
  name: string;
  online: boolean;
  mqttConnected: boolean;
  status: string;
  progress: number;
  currentPrint: string | null;
  nozzleTemp?: number;
  bedTemp?: number;
}

interface PrintStatusMqttWidgetProps {
  rows: MqttPrinterRow[];
}

const MAX_ROWS = 6;

function PrintStatusMqttWidget({ rows }: PrintStatusMqttWidgetProps) {
  if (rows.length === 0) {
    return <EmptyLine>No printer telemetry available.</EmptyLine>;
  }

  return (
    <div>
      <ul className="divide-y divide-line">
        {rows.slice(0, MAX_ROWS).map((row) => {
          const state = describePrinterState(row.online, row.status, Boolean(row.currentPrint));
          const progress = Math.max(0, Math.min(100, Math.round(Number(row.progress || 0))));
          return (
            <li key={row.id} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-fg">{row.name}</p>
                  <p className="truncate text-xs tabular-nums text-muted">
                    {row.mqttConnected
                      ? `${state.busy && row.currentPrint ? row.currentPrint : state.label} · Nozzle ${Math.round(Number(row.nozzleTemp || 0))}° · Bed ${Math.round(Number(row.bedTemp || 0))}°`
                      : 'No live telemetry'}
                  </p>
                </div>
                <Pill tone={row.mqttConnected ? 'success' : 'neutral'}>{row.mqttConnected ? 'Connected' : 'Disconnected'}</Pill>
              </div>
              {row.mqttConnected && state.busy ? <ProgressBar value={progress} size="xs" className="mt-2" /> : null}
            </li>
          );
        })}
      </ul>
      {rows.length > MAX_ROWS ? <MoreLine>+{rows.length - MAX_ROWS} more printers</MoreLine> : null}
    </div>
  );
}

export default PrintStatusMqttWidget;

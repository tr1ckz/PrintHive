import { ChevronRight } from 'lucide-react';
import { Dot, EmptyLine, type Tone } from '../primitives';

export interface FleetAlertsData {
  totalPrinters: number;
  offlineNames: string[];
  overdueTaskNames: string[];
}

interface FleetAlertsWidgetProps {
  data: FleetAlertsData;
  onOpenPrinters: () => void;
  onOpenMaintenance: () => void;
}

interface AlertItem {
  key: string;
  tone: Tone;
  title: string;
  detail: string;
  onOpen: () => void;
}

function summarizeNames(names: string[], max = 3): string {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max} more`;
}

/** The exceptions digest: what is wrong right now, and where to go fix it. */
export function buildFleetAlerts(data: FleetAlertsData, handlers: Pick<FleetAlertsWidgetProps, 'onOpenPrinters' | 'onOpenMaintenance'>): AlertItem[] {
  const items: AlertItem[] = [];
  const offline = data.offlineNames.length;
  const overdue = data.overdueTaskNames.length;

  if (offline > 0) {
    items.push({
      key: 'offline',
      tone: 'danger',
      title: offline === data.totalPrinters && offline > 1
        ? `All ${offline} printers offline`
        : `${offline} printer${offline === 1 ? '' : 's'} offline`,
      detail: summarizeNames(data.offlineNames),
      onOpen: handlers.onOpenPrinters,
    });
  }

  if (overdue > 0) {
    items.push({
      key: 'overdue',
      tone: 'warning',
      title: `${overdue} maintenance task${overdue === 1 ? '' : 's'} overdue`,
      detail: summarizeNames(data.overdueTaskNames),
      onOpen: handlers.onOpenMaintenance,
    });
  }

  return items;
}

function FleetAlertsWidget({ data, onOpenPrinters, onOpenMaintenance }: FleetAlertsWidgetProps) {
  const items = buildFleetAlerts(data, { onOpenPrinters, onOpenMaintenance });

  if (items.length === 0) {
    return (
      <EmptyLine tone="success">
        {data.totalPrinters === 0 ? 'Nothing to report.' : 'All clear — every printer is online and maintenance is up to date.'}
      </EmptyLine>
    );
  }

  return (
    <ul className="-mx-2 -mb-2">
      {items.map((item) => (
        <li key={item.key}>
          <button
            type="button"
            onClick={item.onOpen}
            className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-white/5"
          >
            <Dot tone={item.tone} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-fg">{item.title}</span>
              <span className="block truncate text-xs text-muted">{item.detail}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

export default FleetAlertsWidget;

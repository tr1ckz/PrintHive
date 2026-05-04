export interface FleetAlertsData {
  totalPrinters: number;
  onlinePrinters: number;
  activePrints: number;
  overdueMaintenance: number;
  offlineNames: string[];
}

interface FleetAlertsWidgetProps {
  data: FleetAlertsData;
  onOpenPrinters: () => void;
  onOpenMaintenance: () => void;
}

function FleetAlertsWidget({ data, onOpenPrinters, onOpenMaintenance }: FleetAlertsWidgetProps) {
  const offlineCount = Math.max(0, data.totalPrinters - data.onlinePrinters);
  const visibleOffline = data.offlineNames.slice(0, 4);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-[4px] border border-neutral-800 bg-neutral-900 p-4">
          <p className="ops-secondary-text">Offline</p>
          <p className="mt-1 text-2xl font-bold text-white">{offlineCount}</p>
        </div>
        <div className="rounded-[4px] border border-neutral-800 bg-neutral-900 p-4">
          <p className="ops-secondary-text">Overdue</p>
          <p className="mt-1 text-2xl font-bold text-white">{data.overdueMaintenance}</p>
        </div>
      </div>

      <div className="rounded-[4px] border border-neutral-800 bg-neutral-900 p-4">
        <p className="ops-secondary-text">Active Prints</p>
        <p className="mt-1 text-xl font-bold text-white">{data.activePrints}<span className="text-neutral-500">/{data.totalPrinters || 0}</span></p>
      </div>

      {visibleOffline.length > 0 ? (
        <div className="space-y-4 rounded-[4px] border border-neutral-800 bg-neutral-900 p-4">
          <p className="ops-secondary-text">Offline Printers</p>
          {visibleOffline.map((name) => (
            <p key={name} className="truncate border-b border-neutral-800 py-3 text-sm font-semibold text-white last:border-b-0">{name}</p>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-[4px] border border-dashed border-neutral-800 bg-neutral-900 text-xs text-neutral-500">
          Fleet is healthy.
        </div>
      )}

      <div className="mt-auto grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onOpenPrinters}
          className="widget-no-drag rounded-[4px] border border-neutral-800 bg-neutral-900 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white hover:border-neutral-700"
        >
          Printers
        </button>
        <button
          type="button"
          onClick={onOpenMaintenance}
          className="widget-no-drag rounded-[4px] border border-neutral-800 bg-neutral-900 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white hover:border-neutral-700"
        >
          Maintenance
        </button>
      </div>
    </div>
  );
}

export default FleetAlertsWidget;

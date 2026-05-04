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
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-[4px] border border-slate-700 bg-slate-900 p-3">
          <p className="ops-secondary-text">Offline</p>
          <p className="mt-1 text-2xl font-bold text-white">{offlineCount}</p>
        </div>
        <div className="rounded-[4px] border border-slate-700 bg-slate-900 p-3">
          <p className="ops-secondary-text">Overdue</p>
          <p className="mt-1 text-2xl font-bold text-white">{data.overdueMaintenance}</p>
        </div>
      </div>

      <div className="rounded-[4px] border border-slate-700 bg-slate-900 p-3">
        <p className="ops-secondary-text">Active Prints</p>
        <p className="mt-1 text-xl font-bold text-white">{data.activePrints}<span className="text-slate-500">/{data.totalPrinters || 0}</span></p>
      </div>

      {visibleOffline.length > 0 ? (
        <div className="ops-list rounded-[4px] border border-slate-700 bg-slate-900 px-4 py-3">
          <p className="ops-secondary-text">Offline Printers</p>
          {visibleOffline.map((name) => (
            <p key={name} className="truncate py-1 text-sm font-semibold text-white">{name}</p>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-[4px] border border-dashed border-slate-700 bg-slate-900 text-xs text-slate-500">
          Fleet is healthy.
        </div>
      )}

      <div className="mt-auto grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onOpenPrinters}
          className="widget-no-drag rounded-[4px] border border-slate-700 bg-slate-900 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-200 hover:border-slate-500"
        >
          Printers
        </button>
        <button
          type="button"
          onClick={onOpenMaintenance}
          className="widget-no-drag rounded-[4px] border border-slate-700 bg-slate-900 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-200 hover:border-slate-500"
        >
          Maintenance
        </button>
      </div>
    </div>
  );
}

export default FleetAlertsWidget;

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
        <div className="rounded border border-white/15 bg-black/20 p-2">
          <p className="text-[10px] uppercase tracking-[0.1em] text-white/55">Offline</p>
          <p className={`mt-1 text-lg font-bold ${offlineCount > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{offlineCount}</p>
        </div>
        <div className="rounded border border-white/15 bg-black/20 p-2">
          <p className="text-[10px] uppercase tracking-[0.1em] text-white/55">Overdue</p>
          <p className={`mt-1 text-lg font-bold ${data.overdueMaintenance > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{data.overdueMaintenance}</p>
        </div>
      </div>

      <div className="rounded border border-white/15 bg-white/[0.03] p-2">
        <p className="text-[10px] uppercase tracking-[0.09em] text-white/50">Active prints</p>
        <p className="mt-1 text-sm font-semibold text-white/90">{data.activePrints} / {data.totalPrinters || 0} printers</p>
      </div>

      {visibleOffline.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-[0.1em] text-white/55">Offline printers</p>
          {visibleOffline.map((name) => (
            <p key={name} className="truncate rounded border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">{name}</p>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-emerald-400/30 bg-emerald-500/10 text-xs text-emerald-100">
          Fleet is healthy.
        </div>
      )}

      <div className="mt-auto grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onOpenPrinters}
          className="widget-no-drag rounded border border-white/20 bg-white/5 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/75 hover:border-white/35"
        >
          Printers
        </button>
        <button
          type="button"
          onClick={onOpenMaintenance}
          className="widget-no-drag rounded border border-white/20 bg-white/5 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/75 hover:border-white/35"
        >
          Maintenance
        </button>
      </div>
    </div>
  );
}

export default FleetAlertsWidget;

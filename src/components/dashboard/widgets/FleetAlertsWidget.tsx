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
        <div className={`rounded-md border p-4 ${offlineCount > 0 ? 'border-danger/40 bg-danger/5' : 'border-line bg-white/[0.04]'}`}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Offline</p>
          <p className={`mt-1 text-3xl font-bold leading-tight ${offlineCount > 0 ? 'text-danger' : 'text-fg'}`}>{offlineCount}</p>
        </div>
        <div className={`rounded-md border p-4 ${data.overdueMaintenance > 0 ? 'border-warning/40 bg-warning/5' : 'border-line bg-white/[0.04]'}`}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Overdue</p>
          <p className={`mt-1 text-3xl font-bold leading-tight ${data.overdueMaintenance > 0 ? 'text-warning' : 'text-fg'}`}>{data.overdueMaintenance}</p>
        </div>
      </div>

      <div className="rounded-md border border-line bg-white/[0.04] p-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Active Prints</p>
        <p className="mt-1 text-2xl font-bold text-fg">{data.activePrints}<span className="text-muted">/{data.totalPrinters || 0}</span></p>
      </div>

      {visibleOffline.length > 0 ? (
        <div className="space-y-1 rounded-md border border-danger/30 bg-danger/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Offline Printers</p>
          {visibleOffline.map((name) => (
            <p key={name} className="truncate border-b border-danger/20 py-1.5 text-sm font-semibold text-danger last:border-b-0">{name}</p>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-success/30 bg-success/10 text-xs text-success">
          Fleet is healthy.
        </div>
      )}

      <div className="mt-auto grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onOpenPrinters}
          className="widget-no-drag rounded-md border border-line bg-white/[0.04] px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg hover:border-line-strong"
        >
          Printers
        </button>
        <button
          type="button"
          onClick={onOpenMaintenance}
          className="widget-no-drag rounded-md border border-line bg-white/[0.04] px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg hover:border-line-strong"
        >
          Maintenance
        </button>
      </div>
    </div>
  );
}

export default FleetAlertsWidget;

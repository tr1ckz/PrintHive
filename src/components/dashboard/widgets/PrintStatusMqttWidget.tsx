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
  density?: 'compact' | 'comfortable' | 'expanded';
  onOpenPrinters: () => void;
}

function PrintStatusMqttWidget({ rows, density = 'comfortable', onOpenPrinters }: PrintStatusMqttWidgetProps) {
  const limit = density === 'compact' ? 3 : density === 'expanded' ? 7 : 5;
  const visibleRows = rows.slice(0, limit);

  const mqttConnected = rows.filter((row) => row.mqttConnected).length;
  const printing = rows.filter((row) => (row.status || '').toUpperCase() === 'RUNNING').length;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="ops-clickable-card rounded-[4px] border border-neutral-800 bg-neutral-900 p-5">
          <p className="ops-secondary-text">MQTT Links</p>
          <p className={`ops-data-value mt-1.5 text-2xl font-bold leading-tight ${mqttConnected === (rows.length || 0) ? 'text-emerald-400' : 'text-amber-400'}`}>{mqttConnected}/{rows.length || 0}</p>
        </div>
        <div className="ops-clickable-card rounded-[4px] border border-neutral-800 bg-neutral-900 p-5">
          <p className="ops-secondary-text">Printing</p>
          <p className={`ops-data-value mt-1.5 text-2xl font-bold leading-tight ${printing > 0 ? 'text-emerald-400' : 'text-white'}`}>{printing}</p>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
          No printer telemetry available.
        </div>
      ) : (
        <div className="space-y-2 rounded-[4px] border border-neutral-800 bg-neutral-900 p-3">
          {visibleRows.map((row) => {
            const progress = Math.max(0, Math.min(100, Number(row.progress || 0)));
            return (
              <article key={row.id} className="ops-clickable-card rounded-[3px] border border-transparent px-2 py-2.5 last:border-b-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold leading-tight text-white">{row.name}</p>
                    <p className="mt-1 truncate ops-tertiary-text">
                      {row.currentPrint || row.status || 'Idle'}
                    </p>
                  </div>
                  <span className={`rounded-[3px] border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${row.mqttConnected ? 'border-emerald-500/55 text-emerald-400' : 'border-rose-500/50 text-rose-500'}`}>
                    {row.mqttConnected ? 'MQTT' : 'No MQTT'}
                  </span>
                </div>

                <div className="mt-1.5 h-1.5 overflow-hidden rounded-[3px] border border-neutral-700 bg-neutral-800">
                  <div className={`h-full ${row.mqttConnected ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${progress}%` }} />
                </div>

                <div className="mt-1.5 flex items-center justify-between ops-tertiary-text">
                  <span className="ops-data-value">{progress}%</span>
                  <span className="ops-data-value">
                    N {Math.round(Number(row.nozzleTemp || 0))}°C / B {Math.round(Number(row.bedTemp || 0))}°C
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={onOpenPrinters}
        className="widget-no-drag ops-micro-btn mt-auto rounded-[4px] border border-neutral-800 bg-neutral-900 px-3.5 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-white hover:border-neutral-700"
      >
        Open Printers
      </button>
    </div>
  );
}

export default PrintStatusMqttWidget;

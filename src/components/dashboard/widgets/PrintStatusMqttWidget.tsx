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
        <div className="rounded-[4px] border border-slate-700 bg-slate-900 px-4 py-3.5">
          <p className="ops-secondary-text">MQTT Links</p>
          <p className="mt-1.5 text-2xl font-bold leading-tight text-white">{mqttConnected}/{rows.length || 0}</p>
        </div>
        <div className="rounded-[4px] border border-slate-700 bg-slate-900 px-4 py-3.5">
          <p className="ops-secondary-text">Printing</p>
          <p className="mt-1.5 text-2xl font-bold leading-tight text-white">{printing}</p>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
          No printer telemetry available.
        </div>
      ) : (
        <div className="ops-list rounded-[4px] border border-slate-700 bg-slate-900 px-4 py-3">
          {visibleRows.map((row) => {
            const progress = Math.max(0, Math.min(100, Number(row.progress || 0)));
            return (
              <article key={row.id} className="py-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold leading-tight text-white">{row.name}</p>
                    <p className="mt-1 truncate ops-tertiary-text">
                      {row.currentPrint || row.status || 'Idle'}
                    </p>
                  </div>
                  <span className={`rounded-[3px] border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${row.mqttConnected ? 'border-emerald-700 text-emerald-300' : 'border-slate-700 text-slate-400'}`}>
                    {row.mqttConnected ? 'MQTT' : 'No MQTT'}
                  </span>
                </div>

                <div className="mt-2 h-2 overflow-hidden rounded-[3px] border border-slate-700 bg-slate-950">
                  <div className="h-full bg-slate-400" style={{ width: `${progress}%` }} />
                </div>

                <div className="mt-2.5 flex items-center justify-between ops-tertiary-text">
                  <span>{progress}%</span>
                  <span>
                    N {Math.round(Number(row.nozzleTemp || 0))}C / B {Math.round(Number(row.bedTemp || 0))}C
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
        className="widget-no-drag mt-auto rounded-[4px] border border-slate-700 bg-slate-900 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-200 hover:border-slate-500"
      >
        Open Printers
      </button>
    </div>
  );
}

export default PrintStatusMqttWidget;

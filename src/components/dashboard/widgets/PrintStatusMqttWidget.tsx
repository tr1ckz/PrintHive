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
    <div className="flex h-full flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div className="transition-colors hover:bg-white/[0.06] rounded-md border border-line bg-white/[0.04] p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">MQTT Links</p>
          <p className={`mt-1 text-2xl font-bold leading-tight ${mqttConnected === (rows.length || 0) ? 'text-success' : 'text-warning'}`}>{mqttConnected}/{rows.length || 0}</p>
        </div>
        <div className="transition-colors hover:bg-white/[0.06] rounded-md border border-line bg-white/[0.04] p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Printing</p>
          <p className={`mt-1 text-2xl font-bold leading-tight ${printing > 0 ? 'text-success' : 'text-fg'}`}>{printing}</p>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-fg/50">
          No printer telemetry available.
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-line bg-white/[0.04] p-3">
          {visibleRows.map((row) => {
            const progress = Math.max(0, Math.min(100, Number(row.progress || 0)));
            return (
              <article key={row.id} className="transition-colors hover:bg-white/[0.06] rounded border border-transparent px-2 py-2.5 last:border-b-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold leading-tight text-fg">{row.name}</p>
                    <p className="mt-1 truncate text-xs text-muted">
                      {row.currentPrint || row.status || 'Idle'}
                    </p>
                  </div>
                  <span className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${row.mqttConnected ? 'border-success/55 text-success' : 'border-danger/50 text-danger'}`}>
                    {row.mqttConnected ? 'MQTT' : 'No MQTT'}
                  </span>
                </div>

                <div className="mt-1.5 h-1.5 overflow-hidden rounded border border-line-strong bg-white/10">
                  <div className={`h-full ${row.mqttConnected ? 'bg-success' : 'bg-danger'}`} style={{ width: `${progress}%` }} />
                </div>

                <div className="mt-1.5 flex items-center justify-between text-xs text-muted">
                  <span className="tabular-nums text-fg-soft">{progress}%</span>
                  <span className="tabular-nums text-fg-soft">
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
        className="widget-no-drag min-h-9 mt-auto rounded-md border border-line bg-white/[0.04] px-3.5 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-fg hover:border-line-strong"
      >
        Open Printers
      </button>
    </div>
  );
}

export default PrintStatusMqttWidget;

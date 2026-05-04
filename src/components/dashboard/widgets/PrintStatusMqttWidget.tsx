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
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-cyan-400/30 bg-cyan-500/10 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.1em] text-cyan-100/85">MQTT Links</p>
          <p className="mt-1 text-lg font-bold text-white">{mqttConnected}/{rows.length || 0}</p>
        </div>
        <div className="rounded border border-emerald-400/30 bg-emerald-500/10 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.1em] text-emerald-100/85">Printing</p>
          <p className="mt-1 text-lg font-bold text-white">{printing}</p>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
          No printer telemetry available.
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibleRows.map((row) => {
            const progress = Math.max(0, Math.min(100, Number(row.progress || 0)));
            return (
              <article key={row.id} className="rounded border border-white/15 bg-white/[0.03] px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-white/90">{row.name}</p>
                    <p className="truncate text-[10px] uppercase tracking-[0.09em] text-white/50">
                      {row.currentPrint || row.status || 'Idle'}
                    </p>
                  </div>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] ${row.mqttConnected ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200' : 'border-white/20 bg-black/20 text-white/65'}`}>
                    {row.mqttConnected ? 'MQTT' : 'No MQTT'}
                  </span>
                </div>

                <div className="mt-2 h-2 overflow-hidden rounded border border-white/10 bg-black/25">
                  <div className="h-full bg-[linear-gradient(90deg,rgba(var(--theme-accent-rgb),0.92),rgba(var(--theme-accent-rgb),0.45))]" style={{ width: `${progress}%` }} />
                </div>

                <div className="mt-1.5 flex items-center justify-between text-[10px] uppercase tracking-[0.08em] text-white/55">
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
        className="widget-no-drag mt-auto rounded border border-white/20 bg-white/5 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/75 hover:border-white/35"
      >
        Open Printers
      </button>
    </div>
  );
}

export default PrintStatusMqttWidget;

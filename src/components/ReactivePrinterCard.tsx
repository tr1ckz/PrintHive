import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { API_ENDPOINTS } from '../config/api';
import FrigateCamera from './FrigateCamera';
import { usePrinterStore } from '../stores/usePrinterStore';

const normalizeProgress = (value: number | undefined | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return 0;

  let normalized = Number(value);
  if (normalized <= 1) normalized *= 100;

  normalized = Math.max(0, Math.min(100, normalized));
  return Math.round(normalized);
};

const formatBitrate = (bps?: number) => {
  if (!bps || Number.isNaN(bps)) return null;

  const mbps = bps / (1024 * 1024);
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;

  const kbps = bps / 1024;
  return `${Math.round(kbps)} Kbps`;
};

const getSpeedMode = (mode?: string | number, factor?: number) => {
  let name: string | null = null;
  let level = -1;

  if (typeof mode === 'number') level = mode;
  if (typeof mode === 'string') {
    const normalizedMode = mode.toLowerCase();
    if (normalizedMode.includes('lud')) level = 3, name = 'Ludicrous';
    else if (normalizedMode.includes('sport')) level = 2, name = 'Sport';
    else if (normalizedMode.includes('std') || normalizedMode.includes('standard')) level = 1, name = 'Standard';
    else if (normalizedMode.includes('silent')) level = 0, name = 'Silent';
  }

  if (level >= 0 && !name) name = ['Silent', 'Standard', 'Sport', 'Ludicrous'][level] || 'Standard';

  if (!name && typeof factor === 'number') {
    if (factor >= 160) name = 'Ludicrous';
    else if (factor >= 120) name = 'Sport';
    else if (factor >= 90) name = 'Standard';
    else name = 'Silent';
  }

  return name;
};

const formatRemainingTime = (minutes?: number) => {
  if (minutes === undefined || minutes === null || minutes <= 0) return '—';
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
};

const formatStatusLabel = (status?: string) => {
  if (!status) return 'Unknown';
  return status.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
};

const fanToPercent = (speed: number) => Math.ceil((speed / 15) * 100 / 10) * 10;

function TelemetryTile({ printerId, label, valueSelector }: { printerId: string; label: string; valueSelector: (printer: ReturnType<typeof usePrinterStore.getState>['printersById'][string] | undefined) => string | null; }) {
  const value = usePrinterStore((state) => valueSelector(state.printersById[printerId]));

  if (!value) {
    return null;
  }

  return (
    <div className="telemetry-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReactiveStatusPanel({ printerId }: { printerId: string }) {
  const {
    online,
    printStatus,
    taskName,
    gcodeState,
    progress,
    remainingTime,
    speedMode,
    endTime,
    errorMessage,
    layerNum,
    totalLayers,
    modelId,
    has3mf,
  } = usePrinterStore(useShallow((state) => {
    const printer = state.printersById[printerId];
    const task = printer?.current_task;

    return {
      online: Boolean(printer?.online),
      printStatus: printer?.print_status || '',
      taskName: task?.name || '',
      gcodeState: task?.gcode_state || '',
      progress: normalizeProgress(task?.progress),
      remainingTime: task?.remaining_time,
      speedMode: getSpeedMode(task?.speed_profile, task?.speed_factor),
      endTime: task?.end_time || null,
      errorMessage: task?.error_message || '',
      layerNum: task?.layer_num || 0,
      totalLayers: task?.total_layers || 0,
      modelId: task?.model_id || '',
      has3mf: Boolean(task?.has_3mf && task?.model_id),
    };
  }));

  return (
    <section className="printer-panel status-panel">
      <div className="panel-header-inline">
        <div>
          <span className="panel-kicker">Current Print</span>
          <h4>Status & ETA</h4>
        </div>
        <span className={`printer-state-chip ${String(printStatus || '').toLowerCase()}`}>
          {formatStatusLabel(printStatus || (online ? 'ONLINE' : 'OFFLINE'))}
        </span>
      </div>

      <div className="status-job-name">{taskName || (online ? 'No active print job' : 'Printer offline')}</div>
      {layerNum && totalLayers ? (
        <div className="status-job-meta">Layer {layerNum} of {totalLayers}</div>
      ) : (
        <div className="status-job-meta">State: {gcodeState || formatStatusLabel(printStatus)}</div>
      )}

      <div className="progress-bar printer-progress-bar">
        <div className="progress-fill" style={{ width: `${progress}%` }}></div>
      </div>

      <div className="status-metric-grid">
        <div className="status-metric-card">
          <span>Progress</span>
          <strong>{progress}%</strong>
        </div>
        <div className="status-metric-card">
          <span>Remaining</span>
          <strong>{formatRemainingTime(remainingTime)}</strong>
        </div>
        <div className="status-metric-card">
          <span>Mode</span>
          <strong>{speedMode || 'Standard'}</strong>
        </div>
      </div>

      {endTime || errorMessage ? (
        <div className="status-detail-row">
          {endTime ? (
            <span>ETA {new Date(endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          ) : null}
          {errorMessage ? <span title={errorMessage}>{errorMessage}</span> : null}
        </div>
      ) : null}

      {has3mf && modelId ? (
        <a
          href={API_ENDPOINTS.MODELS.LOCAL_DOWNLOAD(modelId)}
          className="printer-ghost-btn printer-inline-link"
          title="Download 3MF file"
          download
        >
          Download 3MF
        </a>
      ) : null}
    </section>
  );
}

function ReactiveTelemetryPanel({ printerId }: { printerId: string }) {
  const hasAnyTelemetry = usePrinterStore((state) => {
    const task = state.printersById[printerId]?.current_task;
    return Boolean(
      typeof task?.nozzle_temp === 'number' ||
      typeof task?.bed_temp === 'number' ||
      typeof task?.chamber_temp === 'number' ||
      typeof task?.wifi_signal === 'number' ||
      typeof task?.speed_factor === 'number' ||
      typeof task?.z_height === 'number' ||
      typeof task?.cooling_fan === 'number' ||
      typeof task?.aux_fan === 'number' ||
      typeof task?.chamber_fan === 'number'
    );
  });

  return (
    <section className="printer-panel telemetry-panel">
      <div className="panel-header-inline">
        <div>
          <span className="panel-kicker">Live Telemetry</span>
          <h4>Temps, Fans & Signals</h4>
        </div>
      </div>

      {hasAnyTelemetry ? (
        <div className="telemetry-mini-grid">
          <TelemetryTile
            printerId={printerId}
            label="Nozzle"
            valueSelector={(printer) => {
              const task = printer?.current_task;
              return typeof task?.nozzle_temp === 'number'
                ? `${Math.round(task.nozzle_temp)}°${typeof task?.nozzle_target === 'number' && task.nozzle_target > 0 ? ` / ${Math.round(task.nozzle_target)}°` : ''}`
                : null;
            }}
          />
          <TelemetryTile
            printerId={printerId}
            label="Bed"
            valueSelector={(printer) => {
              const task = printer?.current_task;
              return typeof task?.bed_temp === 'number'
                ? `${Math.round(task.bed_temp)}°${typeof task?.bed_target === 'number' && task.bed_target > 0 ? ` / ${Math.round(task.bed_target)}°` : ''}`
                : null;
            }}
          />
          <TelemetryTile
            printerId={printerId}
            label="Chamber"
            valueSelector={(printer) => {
              const task = printer?.current_task;
              return typeof task?.chamber_temp === 'number' ? `${Math.round(task.chamber_temp)}°C` : null;
            }}
          />
          <TelemetryTile
            printerId={printerId}
            label="Wi‑Fi"
            valueSelector={(printer) => {
              const task = printer?.current_task;
              return typeof task?.wifi_signal === 'number' ? `${task.wifi_signal} dBm` : null;
            }}
          />
          <TelemetryTile
            printerId={printerId}
            label="Speed"
            valueSelector={(printer) => {
              const task = printer?.current_task;
              return typeof task?.speed_factor === 'number' ? `${Math.round(task.speed_factor)}%` : null;
            }}
          />
          <TelemetryTile
            printerId={printerId}
            label="Z Height"
            valueSelector={(printer) => {
              const task = printer?.current_task;
              return typeof task?.z_height === 'number' ? `${task.z_height.toFixed(2)} mm` : null;
            }}
          />
          <TelemetryTile
            printerId={printerId}
            label="Fans"
            valueSelector={(printer) => {
              const task = printer?.current_task;
              if (
                typeof task?.cooling_fan !== 'number' &&
                typeof task?.aux_fan !== 'number' &&
                typeof task?.chamber_fan !== 'number'
              ) {
                return null;
              }

              return [
                typeof task?.cooling_fan === 'number' ? `Part ${fanToPercent(task.cooling_fan)}%` : null,
                typeof task?.aux_fan === 'number' ? `Aux ${fanToPercent(task.aux_fan)}%` : null,
                typeof task?.chamber_fan === 'number' ? `Chamber ${fanToPercent(task.chamber_fan)}%` : null,
              ].filter(Boolean).join(' • ');
            }}
          />
        </div>
      ) : (
        <div className="panel-empty compact">
          <strong>Awaiting telemetry</strong>
          <span>Values will appear as soon as the printer publishes them.</span>
        </div>
      )}
    </section>
  );
}

function ReactiveAmsPanel({ printerId }: { printerId: string }) {
  const { trays, activeTray } = usePrinterStore(useShallow((state) => {
    const printer = state.printersById[printerId];
    const taskAms = printer?.current_task?.ams;
    const ams = printer?.ams || taskAms;

    return {
      trays: ams?.trays || [],
      activeTray: ams?.active_tray,
    };
  }));

  return (
    <section className="printer-panel ams-panel">
      <div className="panel-header-inline">
        <div>
          <span className="panel-kicker">Filament</span>
          <h4>AMS Overview</h4>
        </div>
        {typeof activeTray === 'number' && activeTray !== 255 ? (
          <span className="panel-inline-chip active">Slot {activeTray}</span>
        ) : null}
      </div>

      {trays.length > 0 ? (
        <div className="ams-unified-grid">
          {trays.map((tray) => {
            const isActive = typeof activeTray === 'number' && activeTray !== 255 && Number(tray.slot) === activeTray;
            const colorHex = tray.color ? `#${tray.color.substring(0, 6)}` : '#71717a';
            const remainPercent = tray.remain != null && tray.remain >= 0 ? tray.remain : null;
            return (
              <div key={`${printerId}-${tray.slot}`} className={`ams-slot-card ${isActive ? 'active' : ''}`}>
                <div className="ams-slot-header">
                  <span>Slot {tray.slot}</span>
                  {remainPercent != null ? <strong>{remainPercent}%</strong> : <strong>—</strong>}
                </div>
                <div className="ams-slot-color" style={{ background: colorHex }} />
                <div className="ams-slot-name">{tray.sub_brands || tray.type || 'Empty'}</div>
                <div className="ams-slot-meta">
                  {typeof tray.humidity === 'number' ? `💧 ${Math.round(tray.humidity)}%` : 'Humidity —'}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel-empty compact">
          <strong>No AMS data</strong>
          <span>Static hardware details stay hidden until you need them.</span>
        </div>
      )}
    </section>
  );
}

function ReactiveCameraPanel({
  printerId,
  printerName,
  cameraSource,
  go2rtcUrl,
  frigateUrl,
}: {
  printerId: string;
  printerName: string;
  cameraSource: string;
  go2rtcUrl?: string;
  frigateUrl?: string;
}) {
  const { ipcamStatus, ipcamBitrate } = usePrinterStore(useShallow((state) => {
    const task = state.printersById[printerId]?.current_task;
    return {
      ipcamStatus: task?.ipcam_status ? String(task.ipcam_status) : '',
      ipcamBitrate: task?.ipcam_bitrate,
    };
  }));

  return (
    <section className="printer-panel camera-panel">
      <div className="panel-header-inline">
        <div>
          <span className="panel-kicker">Live View</span>
          <h4>Camera Feed</h4>
        </div>
        {ipcamStatus ? (
          <span className={`panel-inline-chip ${ipcamStatus.toLowerCase()}`}>
            {ipcamStatus}
          </span>
        ) : null}
      </div>

      {cameraSource ? (
        <div className="printer-camera-shell">
          <FrigateCamera
            go2rtcUrl={go2rtcUrl}
            frigateUrl={frigateUrl}
            cameraName={cameraSource}
            printerName={printerName}
            printerId={printerId}
          />
          <div className="camera-meta">
            {typeof ipcamBitrate === 'number' && ipcamBitrate > 0 ? (
              <span className="camera-bitrate">{formatBitrate(ipcamBitrate)}</span>
            ) : null}
            <span className="camera-source-badge">{cameraSource}</span>
          </div>
        </div>
      ) : (
        <div className="panel-empty">
          <strong>No camera stream configured</strong>
          <span>Add a raw RTSP URL, go2rtc stream name, or HLS URL to stream directly in the browser.</span>
        </div>
      )}
    </section>
  );
}

function ReactivePrinterCardComponent({
  printerId,
  go2rtcUrl,
  frigateUrl,
  defaultCameraName,
  onOpenHardware,
  onOpenConfig,
}: {
  printerId: string;
  go2rtcUrl?: string;
  frigateUrl?: string;
  defaultCameraName?: string;
  onOpenHardware: (printerId: string) => void;
  onOpenConfig: (printerId: string) => void;
}) {
  const { name, online, productName, cameraSource } = usePrinterStore(useShallow((state) => {
    const printer = state.printersById[printerId];
    return {
      name: printer?.name || 'Printer',
      online: Boolean(printer?.online),
      productName: printer?.dev_product_name || printer?.dev_model_name || 'Bambu printer',
      cameraSource: (printer?.camera_rtsp_url || defaultCameraName || '').trim(),
    };
  }));

  return (
    <article className="printer-bento-card">
      <div className="printer-card-top">
        <div className="printer-card-heading">
          <div className="printer-title-row">
            <h3>{name}</h3>
            <span className={`printer-connection-badge ${online ? 'online' : 'offline'}`}>
              <span className="status-dot"></span>
              {online ? 'Online' : 'Offline'}
            </span>
          </div>
          <p>{productName}</p>
        </div>

        <div className="printer-card-actions">
          <button type="button" className="printer-ghost-btn" onClick={() => onOpenHardware(printerId)}>
            Hardware Info
          </button>
          <button type="button" className="printer-primary-btn" onClick={() => onOpenConfig(printerId)}>
            Configure
          </button>
        </div>
      </div>

      <div className="printer-bento-grid">
        <ReactiveCameraPanel
          printerId={printerId}
          printerName={name}
          cameraSource={cameraSource}
          go2rtcUrl={go2rtcUrl}
          frigateUrl={frigateUrl}
        />
        <ReactiveStatusPanel printerId={printerId} />
        <ReactiveTelemetryPanel printerId={printerId} />
        <ReactiveAmsPanel printerId={printerId} />
      </div>
    </article>
  );
}

const ReactivePrinterCard = memo(ReactivePrinterCardComponent);

export default ReactivePrinterCard;

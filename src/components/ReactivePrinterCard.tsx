import { memo, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { CameraMode, CameraStreamType, Printer } from '../types';
import { API_ENDPOINTS } from '../config/api';
import { usePrinterStore } from '../stores/usePrinterStore';
import Card from './common/Card';
import StatusBadge, { statusToVariant } from './common/StatusBadge';
import ProgressBar from './common/ProgressBar';
import TemperatureGauge from './common/TemperatureGauge';
import CameraFeed from './printers/CameraFeed';
import AmsTray from './printers/AmsTray';

const normalizeProgress = (value: number | undefined | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return 0;

  let normalized = Number(value);
  if (normalized <= 1) normalized *= 100;

  normalized = Math.max(0, Math.min(100, normalized));
  return Math.round(normalized);
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
const EMPTY_AMS_TRAYS: NonNullable<Printer['ams']>['trays'] = [];

interface ReactivePrinterCardProps {
  printerId: string;
  cameraMode?: CameraMode;
  cameraStreamType?: CameraStreamType;
  builtinCamera?: boolean;
  frigateStreamUrl?: string;
  rtspUrl?: string;
  onOpenHardware: (printerId: string) => void;
}

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <h4 className="text-sm font-semibold text-fg-soft">{children}</h4>
);

/** Status + progress + ETA. The lead section on every viewport. */
function StatusSection({ printerId }: { printerId: string }) {
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

  const running = String(printStatus).toUpperCase() === 'RUNNING';

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Current Print</SectionLabel>
        <StatusBadge variant={statusToVariant(printStatus, online)}>
          {formatStatusLabel(printStatus || (online ? 'ONLINE' : 'OFFLINE'))}
        </StatusBadge>
      </div>

      <p className="mt-2 truncate text-sm font-medium text-fg">
        {taskName || (online ? 'No active print job' : 'Printer offline')}
      </p>
      <p className="text-xs text-muted tabular-nums">
        {layerNum && totalLayers ? `Layer ${layerNum} of ${totalLayers}` : `State: ${gcodeState || formatStatusLabel(printStatus)}`}
      </p>

      <ProgressBar value={progress} size="md" tone={running ? 'accent' : 'success'} className="mt-3" />

      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <p className="text-xs text-muted">Progress</p>
          <p className="text-lg font-semibold tabular-nums text-fg">{progress}%</p>
        </div>
        <div>
          <p className="text-xs text-muted">Remaining</p>
          <p className="text-lg font-semibold tabular-nums text-fg">{formatRemainingTime(remainingTime)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Mode</p>
          <p className="text-lg font-semibold text-fg">{speedMode || 'Standard'}</p>
        </div>
        {endTime ? (
          <div>
            <p className="text-xs text-muted">ETA</p>
            <p className="text-lg font-semibold tabular-nums text-fg">
              {new Date(endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <p className="mt-2 rounded-md bg-danger/10 px-2.5 py-1.5 text-xs text-danger" title={errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      {has3mf && modelId ? (
        <a
          href={API_ENDPOINTS.MODELS.LOCAL_DOWNLOAD(modelId)}
          className="mt-3 inline-flex min-h-11 md:min-h-9 items-center rounded-md bg-white/5 px-3 text-xs font-semibold text-fg-soft transition-colors hover:bg-white/10 hover:text-fg"
          title="Download 3MF file"
          download
        >
          Download 3MF
        </a>
      ) : null}
    </section>
  );
}

/** Live temps (gauges) + secondary signals. */
function TelemetrySection({ printerId }: { printerId: string }) {
  const {
    nozzleTemp, nozzleTarget, bedTemp, bedTarget, chamberTemp,
    wifiValue, speedValue, zHeightValue, fansValue,
  } = usePrinterStore(useShallow((state) => {
    const task = state.printersById[printerId]?.current_task;

    return {
      nozzleTemp: typeof task?.nozzle_temp === 'number' ? task.nozzle_temp : null,
      nozzleTarget: typeof task?.nozzle_target === 'number' ? task.nozzle_target : null,
      bedTemp: typeof task?.bed_temp === 'number' ? task.bed_temp : null,
      bedTarget: typeof task?.bed_target === 'number' ? task.bed_target : null,
      chamberTemp: typeof task?.chamber_temp === 'number' ? task.chamber_temp : null,
      wifiValue: typeof task?.wifi_signal === 'number' ? `${task.wifi_signal} dBm` : null,
      speedValue: typeof task?.speed_factor === 'number' ? `${Math.round(task.speed_factor)}%` : null,
      zHeightValue: typeof task?.z_height === 'number' ? `${task.z_height.toFixed(2)} mm` : null,
      fansValue:
        typeof task?.cooling_fan !== 'number' &&
        typeof task?.aux_fan !== 'number' &&
        typeof task?.chamber_fan !== 'number'
          ? null
          : [
              typeof task?.cooling_fan === 'number' ? `Part ${fanToPercent(task.cooling_fan)}%` : null,
              typeof task?.aux_fan === 'number' ? `Aux ${fanToPercent(task.aux_fan)}%` : null,
              typeof task?.chamber_fan === 'number' ? `Chamber ${fanToPercent(task.chamber_fan)}%` : null,
            ].filter(Boolean).join(' • '),
    };
  }));

  const hasTemps = nozzleTemp !== null || bedTemp !== null || chamberTemp !== null;
  const extras = [
    ['Wi‑Fi', wifiValue],
    ['Speed', speedValue],
    ['Z Height', zHeightValue],
    ['Fans', fansValue],
  ].filter(([, v]) => v) as Array<[string, string]>;

  if (!hasTemps && extras.length === 0) {
    return (
      <section>
        <SectionLabel>Telemetry</SectionLabel>
        <p className="mt-2 text-sm font-medium text-fg-soft">Awaiting telemetry</p>
        <p className="text-xs text-muted">Values will appear as soon as the printer publishes them.</p>
      </section>
    );
  }

  return (
    <section>
      <SectionLabel>Telemetry</SectionLabel>
      {hasTemps && (
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <TemperatureGauge label="Nozzle" current={nozzleTemp} target={nozzleTarget} max={320} />
          <TemperatureGauge label="Bed" current={bedTemp} target={bedTarget} max={120} />
          {chamberTemp !== null && <TemperatureGauge label="Chamber" current={chamberTemp} max={80} />}
        </div>
      )}
      {extras.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
          {extras.map(([label, value]) => (
            <div key={label} className="text-xs">
              <span className="text-muted">{label} </span>
              <span className="font-medium tabular-nums text-fg-soft">{value}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** AMS filament overview. */
function AmsSection({ printerId }: { printerId: string }) {
  const { trays, activeTray } = usePrinterStore(useShallow((state) => {
    const printer = state.printersById[printerId];
    const taskAms = printer?.current_task?.ams;
    const ams = printer?.ams || taskAms;

    return {
      trays: Array.isArray(ams?.trays) ? ams.trays : EMPTY_AMS_TRAYS,
      activeTray: typeof ams?.active_tray === 'number' ? ams.active_tray : null,
    };
  }));

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Filament · AMS</SectionLabel>
        {typeof activeTray === 'number' && activeTray !== 255 ? (
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">Slot {activeTray}</span>
        ) : null}
      </div>

      {trays.length > 0 ? (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {trays.map((tray) => (
            <AmsTray
              key={`${printerId}-${tray.slot}`}
              slot={tray.slot}
              color={tray.color}
              type={tray.type}
              subBrands={tray.sub_brands}
              remain={tray.remain}
              humidity={tray.humidity}
              active={typeof activeTray === 'number' && activeTray !== 255 && Number(tray.slot) === activeTray}
            />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">No AMS data reported.</p>
      )}
    </section>
  );
}

/** Camera section: wraps CameraFeed with the store-fed props. */
function CameraSection({
  printerId,
  printerName,
  cameraMode,
  cameraStreamType,
  builtinCamera,
  frigateStreamUrl,
  rtspUrl,
}: {
  printerId: string;
  printerName: string;
  cameraMode?: CameraMode;
  cameraStreamType?: CameraStreamType;
  builtinCamera?: boolean;
  frigateStreamUrl?: string;
  rtspUrl?: string;
}) {
  const { ipcamStatus, ipcamBitrate, printerCameraRtspUrl } = usePrinterStore(useShallow((state) => {
    const printer = state.printersById[printerId];
    const task = printer?.current_task;
    return {
      ipcamStatus: task?.ipcam_status ? String(task.ipcam_status) : '',
      ipcamBitrate: task?.ipcam_bitrate,
      printerCameraRtspUrl: printer?.camera_rtsp_url || '',
    };
  }));

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Live View</SectionLabel>
        {ipcamStatus ? (
          <span className={`text-xs font-medium ${ipcamStatus.toUpperCase() === 'ON' ? 'text-success' : 'text-muted'}`}>
            {ipcamStatus}
          </span>
        ) : null}
      </div>
      <div className="mt-2">
        <CameraFeed
          printerId={printerId}
          printerName={printerName}
          cameraMode={cameraMode}
          cameraStreamType={cameraStreamType}
          showBuiltin={builtinCamera}
          frigateStreamUrl={frigateStreamUrl}
          rtspUrl={rtspUrl}
          assignedRtspUrl={printerCameraRtspUrl}
          ipcamBitrate={ipcamBitrate}
        />
      </div>
    </section>
  );
}

/**
 * One printer = one card. Sections are whitespace-separated (no nested
 * boxes). DOM order is the mobile priority order — Status > Temps >
 * Camera > AMS — and xl rearranges into camera-left/status-right.
 */
function ReactivePrinterCardComponent({
  printerId,
  cameraMode,
  cameraStreamType,
  builtinCamera,
  frigateStreamUrl,
  rtspUrl,
  onOpenHardware,
}: ReactivePrinterCardProps) {
  const { name, online, productName } = usePrinterStore(useShallow((state) => {
    const printer = state.printersById[printerId];
    return {
      name: printer?.name || 'Printer',
      online: Boolean(printer?.online),
      productName: printer?.dev_product_name || printer?.dev_model_name || 'Bambu printer',
    };
  }));

  return (
    <Card glow={online} className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h3 className="truncate text-lg font-semibold tracking-tight text-fg">{name}</h3>
            <StatusBadge variant={online ? 'success' : 'offline'}>{online ? 'Online' : 'Offline'}</StatusBadge>
          </div>
          <p className="text-xs text-muted">{productName}</p>
        </div>
        <button
          type="button"
          onClick={() => onOpenHardware(printerId)}
          className="shrink-0 min-h-11 md:min-h-9 rounded-md bg-white/5 px-3 text-xs font-semibold text-fg-soft transition-colors hover:bg-white/10 hover:text-fg"
        >
          Hardware Info
        </button>
      </div>

      {/* Body: mobile stacks status/temps, camera, then AMS full width.
          xl = camera left / status+temps+AMS right (AMS fills the space under
          Telemetry instead of spanning a full-width row). */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.15fr_minmax(0,1fr)]">
        <div className="space-y-5 xl:order-2">
          <StatusSection printerId={printerId} />
          <TelemetrySection printerId={printerId} />
          {/* Desktop only: AMS under Telemetry */}
          <div className="hidden xl:block">
            <AmsSection printerId={printerId} />
          </div>
        </div>
        <div className="xl:order-1 xl:self-center">
          <CameraSection
            printerId={printerId}
            printerName={name}
            cameraMode={cameraMode}
            cameraStreamType={cameraStreamType}
            builtinCamera={builtinCamera}
            frigateStreamUrl={frigateStreamUrl}
            rtspUrl={rtspUrl}
          />
        </div>
        {/* Mobile/tablet only: AMS full width at the bottom */}
        <div className="xl:hidden xl:order-3">
          <AmsSection printerId={printerId} />
        </div>
      </div>
    </Card>
  );
}

const ReactivePrinterCard = memo(ReactivePrinterCardComponent);

export default ReactivePrinterCard;

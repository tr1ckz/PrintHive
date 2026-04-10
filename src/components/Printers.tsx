import { useState, useEffect, useCallback } from 'react';
import { Printer } from '../types';
import { API_ENDPOINTS } from '../config/api';
import fetchWithRetry from '../utils/fetchWithRetry';
import { useModal } from './ModalProvider';
import './Printers.css';
import LoadingScreen from './LoadingScreen';
import FrigateCamera from './FrigateCamera';

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

function Printers() {
  const { openModal } = useModal();
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedPrinter, setSelectedPrinter] = useState<Printer | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [cameraUrl, setCameraUrl] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [frigateUrl, setFrigateUrl] = useState('');
  const [defaultFrigateCameraName, setDefaultFrigateCameraName] = useState('');

  const fetchPrinters = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await fetchWithRetry(API_ENDPOINTS.PRINTERS.LIST, { credentials: 'include' });
      const data = await response.json();
      setPrinters(data.devices || []);
    } catch (err) {
      setError('Failed to load printers');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUiStreamSettings = useCallback(async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.UI, { credentials: 'include' });
      const data = await response.json();
      if (data.success) {
        setFrigateUrl(data.frigateUrl || '');
        setDefaultFrigateCameraName(data.frigateCameraName || '');
      }
    } catch (err) {
      console.error('Failed to load Frigate settings:', err);
    }
  }, []);

  useEffect(() => {
    void fetchPrinters();
    void loadUiStreamSettings();
  }, [fetchPrinters, loadUiStreamSettings]);

  const getCameraSource = useCallback((printer: Printer) => {
    return (printer.camera_rtsp_url || defaultFrigateCameraName || '').trim();
  }, [defaultFrigateCameraName]);

  const openConfigModal = (printer: Printer) => {
    setSelectedPrinter(printer);
    setCameraUrl(printer.camera_rtsp_url || '');
    setShowConfigModal(true);
  };

  const closeConfigModal = () => {
    setShowConfigModal(false);
    setSelectedPrinter(null);
    setCameraUrl('');
  };

  const saveConfig = async () => {
    if (!selectedPrinter) return;

    setSavingConfig(true);
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.PRINTERS.CONFIG, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dev_id: selectedPrinter.dev_id,
          name: selectedPrinter.name,
          camera_rtsp_url: cameraUrl
        }),
        credentials: 'include'
      });

      const data = await response.json();
      if (data.success) {
        closeConfigModal();
        await fetchPrinters();
      }
    } catch (err) {
      console.error('Failed to save printer config:', err);
    } finally {
      setSavingConfig(false);
    }
  };

  const onlineCount = printers.filter((printer) => printer.online).length;
  const activeJobs = printers.filter((printer) => printer.print_status === 'RUNNING').length;
  const cameraCount = printers.filter((printer) => Boolean(getCameraSource(printer))).length;

  const openHardwareModal = (printer: Printer) => {
    const details = [
      { label: 'Serial Number', value: printer.dev_id || '—' },
      { label: 'Model', value: printer.dev_model_name || printer.dev_product_name || '—' },
      { label: 'Product Name', value: printer.dev_product_name || '—' },
      { label: 'Nozzle', value: printer.nozzle_diameter ? `${printer.nozzle_diameter} mm` : '—' },
      { label: 'Structure', value: printer.dev_structure || '—' },
      { label: 'Access Code', value: printer.dev_access_code || 'Not available' },
      { label: 'Camera Source', value: getCameraSource(printer) || 'Not configured' },
    ];

    openModal({
      title: `${printer.name} hardware info`,
      description: 'Static identifiers are tucked into a modal so the live dashboard stays focused on what is changing right now.',
      content: (
        <div className="hardware-modal-grid">
          {details.map((detail) => (
            <div key={detail.label} className="hardware-modal-row">
              <span>{detail.label}</span>
              <strong>{detail.value}</strong>
            </div>
          ))}
        </div>
      ),
      actions: [{ label: 'Close', variant: 'secondary' }],
      size: 'md'
    });
  };

  if (loading) {
    return <LoadingScreen message="Building your printer overview..." variant="panel" />;
  }

  if (error) {
    return <div className="error-container">{error}</div>;
  }

  return (
    <div className="printers-container">
      <div className="page-header printers-page-header">
        <div className="printers-inline-summary">
          <span>{onlineCount} online</span>
          <span>{activeJobs} active jobs</span>
          <span>{cameraCount} camera feeds</span>
        </div>
        <button className="btn-refresh" onClick={fetchPrinters}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Refresh
        </button>
      </div>

      <div className="printer-summary-grid">
        <div className="printer-summary-card">
          <span className="summary-label">Online printers</span>
          <strong>{onlineCount}/{printers.length || 0}</strong>
          <p>Live devices ready for monitoring.</p>
        </div>
        <div className="printer-summary-card">
          <span className="summary-label">Active jobs</span>
          <strong>{activeJobs}</strong>
          <p>Current prints surfaced with ETA and progress.</p>
        </div>
        <div className="printer-summary-card">
          <span className="summary-label">Camera feeds</span>
          <strong>{cameraCount}</strong>
          <p>Configured views visible from the new bento grid.</p>
        </div>
      </div>

      {printers.length === 0 ? (
        <div className="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <h3>No printers found</h3>
          <p>Connect your printer to populate the new monitoring dashboard.</p>
        </div>
      ) : (
        <div className="printers-stack">
          {printers.map((printer) => {
            const task = printer.current_task;
            const progress = normalizeProgress(task?.progress);
            const trays = (printer.ams || task?.ams)?.trays || [];
            const activeTray = (printer.ams || task?.ams)?.active_tray;
            const speedMode = getSpeedMode(task?.speed_profile, task?.speed_factor);
            const cameraSource = getCameraSource(printer);
            const telemetryItems = [
              typeof task?.nozzle_temp === 'number'
                ? { label: 'Nozzle', value: `${Math.round(task.nozzle_temp)}°${typeof task.nozzle_target === 'number' && task.nozzle_target > 0 ? ` / ${Math.round(task.nozzle_target)}°` : ''}` }
                : null,
              typeof task?.bed_temp === 'number'
                ? { label: 'Bed', value: `${Math.round(task.bed_temp)}°${typeof task.bed_target === 'number' && task.bed_target > 0 ? ` / ${Math.round(task.bed_target)}°` : ''}` }
                : null,
              typeof task?.chamber_temp === 'number'
                ? { label: 'Chamber', value: `${Math.round(task.chamber_temp)}°C` }
                : null,
              typeof task?.wifi_signal === 'number'
                ? { label: 'Wi‑Fi', value: `${task.wifi_signal} dBm` }
                : null,
              typeof task?.speed_factor === 'number'
                ? { label: 'Speed', value: `${Math.round(task.speed_factor)}%` }
                : null,
              typeof task?.z_height === 'number'
                ? { label: 'Z Height', value: `${task.z_height.toFixed(2)} mm` }
                : null,
              typeof task?.cooling_fan === 'number' || typeof task?.aux_fan === 'number' || typeof task?.chamber_fan === 'number'
                ? {
                    label: 'Fans',
                    value: [
                      typeof task?.cooling_fan === 'number' ? `Part ${fanToPercent(task.cooling_fan)}%` : null,
                      typeof task?.aux_fan === 'number' ? `Aux ${fanToPercent(task.aux_fan)}%` : null,
                      typeof task?.chamber_fan === 'number' ? `Chamber ${fanToPercent(task.chamber_fan)}%` : null,
                    ].filter(Boolean).join(' • ')
                  }
                : null,
            ].filter(Boolean) as Array<{ label: string; value: string }>;

            return (
              <article key={printer.dev_id} className="printer-bento-card">
                <div className="printer-card-top">
                  <div className="printer-card-heading">
                    <div className="printer-title-row">
                      <h3>{printer.name}</h3>
                      <span className={`printer-connection-badge ${printer.online ? 'online' : 'offline'}`}>
                        <span className="status-dot"></span>
                        {printer.online ? 'Online' : 'Offline'}
                      </span>
                    </div>
                    <p>{printer.dev_product_name || printer.dev_model_name || 'Bambu printer'}</p>
                  </div>

                  <div className="printer-card-actions">
                    <button type="button" className="printer-ghost-btn" onClick={() => openHardwareModal(printer)}>
                      Hardware Info
                    </button>
                    <button type="button" className="printer-primary-btn" onClick={() => openConfigModal(printer)}>
                      Configure
                    </button>
                  </div>
                </div>

                <div className="printer-bento-grid">
                  <section className="printer-panel camera-panel">
                    <div className="panel-header-inline">
                      <div>
                        <span className="panel-kicker">Live View</span>
                        <h4>Camera Feed</h4>
                      </div>
                      {printer.current_task?.ipcam_status ? (
                        <span className={`panel-inline-chip ${String(printer.current_task.ipcam_status).toLowerCase()}`}>
                          {String(printer.current_task.ipcam_status)}
                        </span>
                      ) : null}
                    </div>

                    {cameraSource ? (
                      <div className="printer-camera-shell">
                        <FrigateCamera
                          frigateUrl={frigateUrl}
                          cameraName={cameraSource}
                          printerName={printer.name}
                        />
                        <div className="camera-meta">
                          {typeof printer.current_task?.ipcam_bitrate === 'number' && printer.current_task.ipcam_bitrate > 0 ? (
                            <span className="camera-bitrate">{formatBitrate(printer.current_task.ipcam_bitrate)}</span>
                          ) : null}
                          <span className="camera-source-badge">{cameraSource}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="panel-empty">
                        <strong>No Frigate stream configured</strong>
                        <span>Add a Frigate URL and camera name to stream directly in the browser.</span>
                      </div>
                    )}
                  </section>

                  <section className="printer-panel status-panel">
                    <div className="panel-header-inline">
                      <div>
                        <span className="panel-kicker">Current Print</span>
                        <h4>Status & ETA</h4>
                      </div>
                      <span className={`printer-state-chip ${String(printer.print_status || '').toLowerCase()}`}>
                        {formatStatusLabel(printer.print_status || (printer.online ? 'ONLINE' : 'OFFLINE'))}
                      </span>
                    </div>

                    <div className="status-job-name">{task?.name || (printer.online ? 'No active print job' : 'Printer offline')}</div>
                    {task?.layer_num && task?.total_layers ? (
                      <div className="status-job-meta">Layer {task.layer_num} of {task.total_layers}</div>
                    ) : (
                      <div className="status-job-meta">State: {task?.gcode_state || formatStatusLabel(printer.print_status)}</div>
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
                        <strong>{formatRemainingTime(task?.remaining_time)}</strong>
                      </div>
                      <div className="status-metric-card">
                        <span>Mode</span>
                        <strong>{speedMode || 'Standard'}</strong>
                      </div>
                    </div>

                    {task?.end_time || task?.error_message ? (
                      <div className="status-detail-row">
                        {task?.end_time ? (
                          <span>ETA {new Date(task.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        ) : null}
                        {task?.error_message ? <span title={task.error_message}>{task.error_message}</span> : null}
                      </div>
                    ) : null}

                    {task?.has_3mf && task?.model_id ? (
                      <a
                        href={API_ENDPOINTS.MODELS.LOCAL_DOWNLOAD(task.model_id)}
                        className="printer-ghost-btn printer-inline-link"
                        title="Download 3MF file"
                        download
                      >
                        Download 3MF
                      </a>
                    ) : null}
                  </section>

                  <section className="printer-panel telemetry-panel">
                    <div className="panel-header-inline">
                      <div>
                        <span className="panel-kicker">Live Telemetry</span>
                        <h4>Temps, Fans & Signals</h4>
                      </div>
                    </div>

                    {telemetryItems.length > 0 ? (
                      <div className="telemetry-mini-grid">
                        {telemetryItems.map((item) => (
                          <div key={`${printer.dev_id}-${item.label}`} className="telemetry-tile">
                            <span>{item.label}</span>
                            <strong>{item.value}</strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="panel-empty compact">
                        <strong>Awaiting telemetry</strong>
                        <span>Values will appear as soon as the printer publishes them.</span>
                      </div>
                    )}
                  </section>

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
                            <div key={`${printer.dev_id}-${tray.slot}`} className={`ams-slot-card ${isActive ? 'active' : ''}`}>
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
                </div>
              </article>
            );
          })}
        </div>
      )}

      {showConfigModal && selectedPrinter ? (
        <div className="modal-overlay" onClick={closeConfigModal}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Configure {selectedPrinter.name}</h2>
                <p className="modal-subcopy">Set a printer-specific Frigate camera name or direct HLS URL for this live tile.</p>
              </div>
              <button className="close-btn" onClick={closeConfigModal} aria-label="Close modal">×</button>
            </div>
            <div className="modal-body">
              <label className="modal-field">
                <span>Frigate Camera Name / HLS URL</span>
                <input
                  type="text"
                  value={cameraUrl}
                  onChange={(event) => setCameraUrl(event.target.value)}
                  placeholder="p1s_camera or http://frigate.local:5000/api/p1s_camera/hls.m3u8"
                  disabled={savingConfig}
                />
              </label>
              <small className="modal-help">
                For Frigate, enter the camera name here and keep the shared Frigate base URL in UI Settings.
              </small>
            </div>
            <div className="modal-footer">
              <button className="printer-ghost-btn" onClick={closeConfigModal} disabled={savingConfig}>
                Cancel
              </button>
              <button className="printer-primary-btn" onClick={saveConfig} disabled={savingConfig}>
                {savingConfig ? 'Saving…' : 'Save Feed'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default Printers;

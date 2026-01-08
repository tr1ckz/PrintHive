import { useState, useEffect, useRef, useCallback } from 'react';
import { Printer } from '../types';
import './Printers.css';
import LoadingScreen from './LoadingScreen';

function Printers() {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const cameraRefreshRef = useRef(0);
  const imageRefs = useRef<Map<string, HTMLImageElement>>(new Map());

  const refreshCameras = useCallback(() => {
    cameraRefreshRef.current += 1;
    imageRefs.current.forEach((img, deviceId) => {
      const printer = printers.find(p => p.dev_id === deviceId);
      if (printer?.camera_rtsp_url && img) {
        img.src = `/api/camera-snapshot?url=${encodeURIComponent(printer.camera_rtsp_url)}&t=${cameraRefreshRef.current}`;
      }
    });
  }, [printers]);

  useEffect(() => {
    fetchPrinters();
  }, []);

  useEffect(() => {
    if (printers.length === 0) return;
    
    // Refresh camera feeds every 2 seconds - without causing re-renders
    const interval = setInterval(refreshCameras, 2000);
    
    return () => clearInterval(interval);
  }, [printers, refreshCameras]);

  const fetchPrinters = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await fetch('/api/printers');
      const data = await response.json();
      setPrinters(data.devices || []);
    } catch (err) {
      setError('Failed to load printers');
    } finally {
      setLoading(false);
    }
  };

  const setImageRef = useCallback((deviceId: string) => (el: HTMLImageElement | null) => {
    if (el) {
      imageRefs.current.set(deviceId, el);
    } else {
      imageRefs.current.delete(deviceId);
    }
  }, []);

  const [amsExpanded, setAmsExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem('amsExpanded');
      if (raw) setAmsExpanded(JSON.parse(raw));
    } catch {}
  }, []);

  const toggleAms = (id: string) => {
    setAmsExpanded(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem('amsExpanded', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const normalizeProgress = (value: number | undefined | null) => {
    if (value === null || value === undefined || isNaN(value as any)) return 0;
    let v = Number(value);
    // Some firmwares report 0-1; convert to percentage
    if (v <= 1) v = v * 100;
    // Clamp and round
    v = Math.max(0, Math.min(100, v));
    return Math.round(v);
  };

  const formatBitrate = (bps?: number) => {
    if (!bps || isNaN(bps)) return null;
    const mbps = bps / (1024 * 1024);
    if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
    const kbps = bps / 1024;
    return `${Math.round(kbps)} Kbps`;
  };

  const getSpeedMode = (mode?: string | number, factor?: number) => {
    // Normalize common values from Bambu: spd_lv (0-3) or strings
    let name: string | null = null;
    let level = -1;
    if (typeof mode === 'number') level = mode;
    if (typeof mode === 'string') {
      const m = mode.toLowerCase();
      if (m.includes('lud')) level = 3, name = 'Ludicrous';
      else if (m.includes('sport')) level = 2, name = 'Sport';
      else if (m.includes('std') || m.includes('standard')) level = 1, name = 'Standard';
      else if (m.includes('silent')) level = 0, name = 'Silent';
    }
    if (level >= 0 && !name) name = ['Silent','Standard','Sport','Ludicrous'][level] || 'Standard';
    if (!name && typeof factor === 'number') {
      if (factor >= 160) name = 'Ludicrous';
      else if (factor >= 120) name = 'Sport';
      else if (factor >= 90) name = 'Standard';
      else name = 'Silent';
    }
    return name;
  };

  if (loading) {
    return <LoadingScreen message="Loading printers..." />;
  }

  if (error) {
    return <div className="error-container">{error}</div>;
  }

  return (
    <div className="printers-container">
      <div className="page-header">
        <div>
          <h1>Printers</h1>
          <p>Monitor your 3D printers</p>
        </div>
        <button className="btn-refresh" onClick={fetchPrinters}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Refresh
        </button>
      </div>

      {printers.length === 0 ? (
        <div className="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <h3>No printers found</h3>
          <p>Connect your printer to get started</p>
        </div>
      ) : (
        <div className="printers-grid">
          {printers.map((printer) => (
            <div key={printer.dev_id} className="printer-card">
              <div className="printer-header">
                <div>
                  <h3>{printer.name}</h3>
                  <p className="printer-model">{printer.dev_product_name}</p>
                </div>
                <div className={`status-badge ${printer.online ? 'online' : 'offline'}`}>
                  <span className="status-dot"></span>
                  {printer.online ? 'Online' : 'Offline'}
                </div>
              </div>

              {printer.camera_rtsp_url && (
                <div className="printer-camera">
                  <img
                    ref={setImageRef(printer.dev_id)}
                    src={`/api/camera-snapshot?url=${encodeURIComponent(printer.camera_rtsp_url)}&t=0`}
                    alt="Camera feed"
                    className="camera-feed"
                    style={{ transition: 'none' }}
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      const parent = target.parentElement;
                      if (parent && !parent.querySelector('.camera-error')) {
                        const errorDiv = document.createElement('div');
                        errorDiv.className = 'camera-error';
                        errorDiv.textContent = 'Camera feed unavailable';
                        parent.appendChild(errorDiv);
                      }
                    }}
                  />
                  {(printer.current_task?.rtsp_url || printer.current_task?.ipcam_status || printer.current_task?.ipcam_bitrate !== undefined) && (
                    <div className="camera-meta">
                      {printer.current_task?.ipcam_status && (
                        <span className={`camera-status ${String(printer.current_task.ipcam_status).toLowerCase()}`}>
                          <span className="dot-live"></span>
                          {String(printer.current_task.ipcam_status)}
                        </span>
                      )}
                      {typeof printer.current_task?.ipcam_bitrate === 'number' && (
                        printer.current_task.ipcam_bitrate > 0 ? (
                          <span className="camera-bitrate">{formatBitrate(printer.current_task.ipcam_bitrate)}</span>
                        ) : (
                          <span className="camera-status error"><span className="dot-live"></span>No bitrate</span>
                        )
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="printer-body">
                {printer.current_task && printer.print_status === 'RUNNING' && (
                  <div className="current-job">
                    <div className="job-header">
                      <img 
                        className="job-cover" 
                        src={`/api/job-cover/${printer.dev_id}`}
                        alt="Print preview"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const icon = e.currentTarget.nextElementSibling as HTMLElement;
                          if (icon) icon.style.display = 'inline-block';
                        }}
                      />
                      <span className="job-icon" style={{ display: 'none' }}>🖨️</span>
                      <div className="job-info">
                        <div className="job-name">{printer.current_task.name || 'Printing...'}</div>
                        {printer.current_task.layer_num && printer.current_task.total_layers && (
                          <div className="job-layers">Layer {printer.current_task.layer_num} / {printer.current_task.total_layers}</div>
                        )}
                      </div>
                      {printer.current_task.has_3mf && printer.current_task.model_id && (
                        <a 
                          href={`/api/local/download/${printer.current_task.model_id}`}
                          className="download-3mf-btn"
                          title="Download 3MF file"
                          download
                        >
                          📦
                        </a>
                      )}
                    </div>
                    {typeof printer.current_task.progress === 'number' && (
                      <div className="job-progress">
                        <div className="progress-bar">
                          <div className="progress-fill" style={{ width: `${normalizeProgress(printer.current_task.progress)}%` }}></div>
                        </div>
                        <div className="progress-info">
                          <span className="progress-percent">{normalizeProgress(printer.current_task.progress)}%</span>
                          {printer.current_task.remaining_time !== undefined && printer.current_task.remaining_time > 0 && (
                            <span className="progress-time">
                              {printer.current_task.remaining_time >= 60 
                                ? `${Math.floor(printer.current_task.remaining_time / 60)}h ${printer.current_task.remaining_time % 60}m remaining`
                                : `${printer.current_task.remaining_time}m remaining`
                              }
                            </span>
                          )}
                          {printer.current_task.end_time && (
                            <span className="progress-eta">ETA: {new Date(printer.current_task.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          )}
                        </div>
                        {(printer.current_task.nozzle_temp !== undefined || printer.current_task.bed_temp !== undefined || printer.current_task.speed_profile || printer.current_task.speed_factor !== undefined || printer.current_task.z_height !== undefined) && (
                          <div className="progress-extra" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem 1rem', marginTop: '0.5rem', color: 'rgba(255,255,255,0.8)' }}>
                            {typeof printer.current_task.nozzle_temp === 'number' && <span>Hotend: {Math.round(printer.current_task.nozzle_temp)}°C{typeof printer.current_task.nozzle_target === 'number' ? `/${Math.round(printer.current_task.nozzle_target)}°` : ''}</span>}
                            {typeof printer.current_task.bed_temp === 'number' && <span>Bed: {Math.round(printer.current_task.bed_temp)}°C{typeof printer.current_task.bed_target === 'number' ? `/${Math.round(printer.current_task.bed_target)}°` : ''}</span>}
                            {typeof printer.current_task.chamber_temp === 'number' && <span>Chamber: {Math.round(printer.current_task.chamber_temp)}°C</span>}
                            {typeof printer.current_task.env_temp === 'number' && <span>Env: {Math.round(printer.current_task.env_temp)}°C</span>}
                            {typeof printer.current_task.env_humidity === 'number' && <span>Humidity: {Math.round(printer.current_task.env_humidity)}%</span>}
                            {getSpeedMode(printer.current_task.speed_profile, printer.current_task.speed_factor) && (
                              <span className={`mode-badge mode-${getSpeedMode(printer.current_task.speed_profile, printer.current_task.speed_factor)!.toLowerCase()}`}> 
                                {getSpeedMode(printer.current_task.speed_profile, printer.current_task.speed_factor)}
                              </span>
                            )}
                            {typeof printer.current_task.speed_factor === 'number' && <span>Speed: {Math.round(printer.current_task.speed_factor)}%</span>}
                            {typeof printer.current_task.feedrate === 'number' && <span>Feedrate: {Math.round(printer.current_task.feedrate)}</span>}
                            {typeof printer.current_task.z_height === 'number' && <span>Z: {printer.current_task.z_height.toFixed(2)}mm</span>}
                          </div>
                        )}
                        {(printer.current_task.gcode_state || printer.current_task.error_message || typeof printer.current_task.print_error === 'number') && (
                          <div className="progress-state" style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.9rem', color: 'rgba(255,255,255,0.7)' }}>
                            {printer.current_task.gcode_state && <span>State: {printer.current_task.gcode_state}</span>}
                            {typeof printer.current_task.print_error === 'number' && printer.current_task.print_error > 0 && (
                              <span>Error: 0x{printer.current_task.print_error.toString(16).toUpperCase()}</span>
                            )}
                            {printer.current_task.error_message && <span title={printer.current_task.error_message}>Details: {printer.current_task.error_message}</span>}
                          </div>
                        )}
                        {printer.current_task.ams && (
                          <div className="progress-ams" style={{ marginTop: '0.5rem' }}>
                            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>AMS</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 0.75rem' }}>
                              {typeof printer.current_task.ams.active_tray === 'number' && <span className="chip subtle">Active Slot: {printer.current_task.ams.active_tray}</span>}
                              {(amsExpanded[printer.dev_id] ? printer.current_task.ams.trays : printer.current_task.ams.trays.slice(0,4)).map((t) => (
                                <span key={t.slot} className="ams-chip">
                                  <span className="color-dot" style={{ background: t.color || '#999' }} />
                                  S{t.slot}: {t.type || '—'}
                                  {t.color ? ` (${t.color})` : ''}
                                  {typeof t.humidity === 'number' ? ` • ${Math.round(t.humidity)}%` : ''}
                                  {typeof t.temp === 'number' ? ` • ${Math.round(t.temp)}°C` : ''}
                                </span>
                              ))}
                              {printer.current_task.ams.trays && printer.current_task.ams.trays.length > 4 && (
                                <button type="button" className="btn-link" onClick={() => toggleAms(printer.dev_id)}>
                                  {amsExpanded[printer.dev_id] ? 'Show less' : `Show all (${printer.current_task.ams.trays.length})`}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="printer-status">
                  <div className="status-icon">
                    {printer.print_status === 'SUCCESS' && '✓'}
                    {printer.print_status === 'IDLE' && '⏸'}
                    {printer.print_status === 'RUNNING' && '▶'}
                    {printer.print_status === 'FAILED' && '✕'}
                  </div>
                  <div>
                    <div className="status-label">Status</div>
                    <div className="status-value">{printer.print_status}</div>
                  </div>
                </div>

                <div className="printer-details">
                  <div className="detail-row">
                    <span className="detail-label">Serial Number</span>
                    <span className="detail-value mono">{printer.dev_id}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Model</span>
                    <span className="detail-value">{printer.dev_model_name}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Nozzle</span>
                    <span className="detail-value">{printer.nozzle_diameter}mm</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Structure</span>
                    <span className="detail-value">{printer.dev_structure}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Access Code</span>
                    <span className="detail-value mono">{printer.dev_access_code}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Printers;

import { useState, useEffect, useRef, useCallback } from 'react';
import { Printer } from '../types';
import { API_ENDPOINTS } from '../config/api';
import fetchWithRetry from '../utils/fetchWithRetry';
import './Printers.css';
import './PrintersEnhancements.css';
import LoadingScreen from './LoadingScreen';

function Printers() {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedPrinter, setSelectedPrinter] = useState<Printer | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [cameraUrl, setCameraUrl] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [cardSize, setCardSize] = useState<'small' | 'medium' | 'large' | 'xlarge'>('medium');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [hmsErrors, setHmsErrors] = useState<Record<string, any[]>>({});
  const [fanStatus, setFanStatus] = useState<Record<string, any>>({});
  const cameraRefreshRef = useRef(0);
  const imageRefs = useRef<Map<string, HTMLImageElement>>(new Map());
  const preloadRefs = useRef<Map<string, HTMLImageElement>>(new Map());

  const refreshCameras = useCallback(() => {
    cameraRefreshRef.current += 1;
    imageRefs.current.forEach((img, deviceId) => {
      const printer = printers.find(p => p.dev_id === deviceId);
      if (printer?.camera_rtsp_url && img) {
        const newUrl = `${API_ENDPOINTS.PRINTERS.CAMERA_SNAPSHOT}?url=${encodeURIComponent(printer.camera_rtsp_url)}&t=${cameraRefreshRef.current}`;
        
        // Preload the new image before swapping to prevent black flash
        const preloadImg = new Image();
        preloadImg.onload = () => {
          // Only update if the image element still exists
          if (imageRefs.current.has(deviceId)) {
            img.src = newUrl;
          }
        };
        preloadImg.onerror = () => {
          // Keep the old image on error - don't flash black
        };
        preloadImg.src = newUrl;
        preloadRefs.current.set(deviceId, preloadImg);
      }
    });
  }, [printers]);

  useEffect(() => {
    fetchPrinters();
    
    // Load saved preferences
    const savedSize = localStorage.getItem('printerCardSize');
    if (savedSize) setCardSize(savedSize as any);
    
    const savedView = localStorage.getItem('printerViewMode');
    if (savedView) setViewMode(savedView as any);
  }, []);

  useEffect(() => {
    if (printers.length === 0) return;
    
    // Fetch HMS errors and fan status for all printers
    printers.forEach(async (printer) => {
      try {
        const hmsResponse = await fetchWithRetry(`${API_ENDPOINTS.BASE}/hms-errors?device_id=${printer.dev_id}&limit=5`, { credentials: 'include' });
        const hmsData = await hmsResponse.json();
        setHmsErrors(prev => ({ ...prev, [printer.dev_id]: hmsData.errors || [] }));
        
        const fanResponse = await fetchWithRetry(`${API_ENDPOINTS.BASE}/fan-status/${printer.dev_id}`, { credentials: 'include' });
        const fanData = await fanResponse.json();
        setFanStatus(prev => ({ ...prev, [printer.dev_id]: fanData.fanStatus }));
      } catch (err) {
        console.error(`Failed to fetch additional data for ${printer.dev_id}:`, err);
      }
    });
    
    // Refresh camera feeds every 2 seconds - without causing re-renders
    const interval = setInterval(refreshCameras, 2000);
    
    return () => {
      clearInterval(interval);
      // Clear all image refs on unmount
      imageRefs.current.clear();
      preloadRefs.current.clear();
    };
  }, [printers, refreshCameras]);

  const fetchPrinters = async () => {
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
  };

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
      const response = await fetchWithRetry('/api/printers/config', {
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
        await fetchPrinters(); // Reload printers to show updated camera
      }
    } catch (err) {
      console.error('Failed to save printer config:', err);
    } finally {
      setSavingConfig(false);
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
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {/* View mode selector */}
          <div className="view-mode-selector">
            <button 
              className={`btn-icon ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => { setViewMode('grid'); localStorage.setItem('printerViewMode', 'grid'); }}
              title="Grid view"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="3" width="7" height="7" stroke="currentColor" strokeWidth="2"/>
                <rect x="14" y="3" width="7" height="7" stroke="currentColor" strokeWidth="2"/>
                <rect x="3" y="14" width="7" height="7" stroke="currentColor" strokeWidth="2"/>
                <rect x="14" y="14" width="7" height="7" stroke="currentColor" strokeWidth="2"/>
              </svg>
            </button>
            <button 
              className={`btn-icon ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => { setViewMode('list'); localStorage.setItem('printerViewMode', 'list'); }}
              title="List view"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <line x1="8" y1="6" x2="21" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <line x1="8" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <line x1="8" y1="18" x2="21" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <line x1="3" y1="6" x2="4" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <line x1="3" y1="12" x2="4" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <line x1="3" y1="18" x2="4" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          
          {/* Card size selector */}
          <select 
            className="size-selector"
            value={cardSize}
            onChange={(e) => {
              const size = e.target.value as any;
              setCardSize(size);
              localStorage.setItem('printerCardSize', size);
            }}
          >
            <option value="small">Small Cards</option>
            <option value="medium">Medium Cards</option>
            <option value="large">Large Cards</option>
            <option value="xlarge">XL Cards</option>
          </select>
          
          <button className="btn-refresh" onClick={fetchPrinters}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Refresh
          </button>
        </div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div className={`status-badge ${printer.online ? 'online' : 'offline'}`}>
                    <span className="status-dot"></span>
                    {printer.online ? 'Online' : 'Offline'}
                  </div>
                  <button 
                    className="btn-icon" 
                    onClick={() => openConfigModal(printer)}
                    title="Configure Printer"
                    style={{ padding: '8px', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '6px' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>

              {printer.camera_rtsp_url && (
                <div className="printer-camera">
                  <img
                    ref={setImageRef(printer.dev_id)}
                    src={`${API_ENDPOINTS.PRINTERS.CAMERA_SNAPSHOT}?url=${encodeURIComponent(printer.camera_rtsp_url)}&t=0`}
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
                {/* Always show AMS section if available */}
                {(printer.ams || printer.current_task?.ams) && (() => {
                  const amsData = printer.ams || printer.current_task?.ams;
                  const trays = amsData?.trays || [];
                  const activeTray = amsData?.active_tray;
                  const firstTray = trays[0];
                  return (
                    <div className="ams-container">
                      <div className="ams-header">
                        <span className="ams-header-icon">📦</span>
                        <span className="ams-header-title">AMS Filament</span>
                        <div className="ams-header-info">
                          {typeof firstTray?.humidity === 'number' && (
                            <span className="humidity" title="Humidity">
                              💧 {Math.round(firstTray.humidity)}%
                            </span>
                          )}
                          {typeof firstTray?.temp === 'number' && (
                            <span className="temp" title="Temperature">
                              🌡️ {Math.round(firstTray.temp)}°C
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="ams-trays-grid">
                        {trays.map((t) => {
                          const isActive = typeof activeTray === 'number' && activeTray !== 255 && Number(t.slot) === activeTray;
                          const colorHex = t.color ? `#${t.color.substring(0, 6)}` : '#666';
                          const remainPercent = t.remain != null && t.remain >= 0 ? t.remain : null;
                          // Determine fill color based on remaining percentage
                          const fillColor = remainPercent != null 
                            ? remainPercent > 50 ? '#22c55e' : remainPercent > 20 ? '#eab308' : '#ef4444'
                            : colorHex;
                          return (
                            <div key={t.slot} className={`ams-tray-card${isActive ? ' active' : ''}`} title={`Slot ${t.slot}: ${t.type || 'Unknown'}${t.sub_brands ? ` (${t.sub_brands})` : ''}`}>
                              <div className="ams-tray-slot">Slot {t.slot}</div>
                              <div className="ams-tray-color-bar" style={{ background: colorHex }} />
                              <div className="ams-tray-type">{t.sub_brands || t.type || 'Empty'}</div>
                              {remainPercent != null && (
                                <div className="ams-tray-remain">
                                  <div className="ams-tray-remain-bar">
                                    <div className="ams-tray-remain-fill" style={{ width: `${remainPercent}%`, background: fillColor }} />
                                  </div>
                                  <span className="ams-tray-remain-text">{remainPercent}%</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Live Telemetry Section */}
                {(printer.current_task || printer.ams) && (() => {
                  const task = printer.current_task;
                  const hasFans = task && (task.cooling_fan !== undefined || task.aux_fan !== undefined || task.chamber_fan !== undefined);
                  const hasTemps = task && (task.nozzle_temp !== undefined || task.bed_temp !== undefined || task.chamber_temp !== undefined);
                  const fanToPercent = (speed: number) => Math.ceil((speed / 15) * 100 / 10) * 10;
                  
                  if (!hasFans && !hasTemps && !task?.speed_factor && !task?.z_height) return null;
                  
                  return (
                    <div className="telemetry-container">
                      <div className="telemetry-header">
                        <span className="telemetry-header-icon">📊</span>
                        <span className="telemetry-header-title">Live Telemetry</span>
                        {typeof task?.wifi_signal === 'number' && (
                          <span className="telemetry-wifi" title="WiFi Signal">
                            📶 {task.wifi_signal} dBm
                          </span>
                        )}
                      </div>
                      <div className="telemetry-grid">
                        {/* Temperatures */}
                        {hasTemps && (
                          <div className="telemetry-section">
                            <div className="telemetry-section-title">🌡️ Temps</div>
                            <div className="telemetry-items">
                              {typeof task?.nozzle_temp === 'number' && (
                                <div className="telemetry-item">
                                  <span className="telemetry-label">Nozzle</span>
                                  <span className="telemetry-value">
                                    {Math.round(task.nozzle_temp)}°C
                                    {typeof task.nozzle_target === 'number' && task.nozzle_target > 0 && (
                                      <span className="telemetry-target">/{task.nozzle_target}°</span>
                                    )}
                                  </span>
                                </div>
                              )}
                              {typeof task?.bed_temp === 'number' && (
                                <div className="telemetry-item">
                                  <span className="telemetry-label">Bed</span>
                                  <span className="telemetry-value">
                                    {Math.round(task.bed_temp)}°C
                                    {typeof task.bed_target === 'number' && task.bed_target > 0 && (
                                      <span className="telemetry-target">/{task.bed_target}°</span>
                                    )}
                                  </span>
                                </div>
                              )}
                              {typeof task?.chamber_temp === 'number' && (
                                <div className="telemetry-item">
                                  <span className="telemetry-label">Chamber</span>
                                  <span className="telemetry-value">{Math.round(task.chamber_temp)}°C</span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        {/* Fans */}
                        {hasFans && (
                          <div className="telemetry-section">
                            <div className="telemetry-section-title">🌀 Fans</div>
                            <div className="telemetry-items">
                              {typeof task?.cooling_fan === 'number' && (
                                <div className="telemetry-item">
                                  <span className="telemetry-label">Part</span>
                                  <span className="telemetry-value fan-speed">
                                    <span className={`fan-indicator ${task.cooling_fan > 0 ? 'active' : ''}`}>●</span>
                                    {fanToPercent(task.cooling_fan)}%
                                  </span>
                                </div>
                              )}
                              {typeof task?.aux_fan === 'number' && (
                                <div className="telemetry-item">
                                  <span className="telemetry-label">Aux</span>
                                  <span className="telemetry-value fan-speed">
                                    <span className={`fan-indicator ${task.aux_fan > 0 ? 'active' : ''}`}>●</span>
                                    {fanToPercent(task.aux_fan)}%
                                  </span>
                                </div>
                              )}
                              {typeof task?.chamber_fan === 'number' && (
                                <div className="telemetry-item">
                                  <span className="telemetry-label">Chamber</span>
                                  <span className="telemetry-value fan-speed">
                                    <span className={`fan-indicator ${task.chamber_fan > 0 ? 'active' : ''}`}>●</span>
                                    {fanToPercent(task.chamber_fan)}%
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        {/* Speed & Position */}
                        {(task?.speed_factor !== undefined || task?.z_height !== undefined || task?.chamber_light !== undefined) && (
                          <div className="telemetry-section">
                            <div className="telemetry-section-title">⚡ Other</div>
                            <div className="telemetry-items">
                              {typeof task?.speed_factor === 'number' && (
                                <div className="telemetry-item">
                                  <span className="telemetry-label">Speed</span>
                                  <span className="telemetry-value">{Math.round(task.speed_factor)}%</span>
                                </div>
                              )}
                              {typeof task?.z_height === 'number' && (
                                <div className="telemetry-item">
                                  <span className="telemetry-label">Z</span>
                                  <span className="telemetry-value">{task.z_height.toFixed(2)}mm</span>
                                </div>
                              )}
                              {task?.chamber_light !== undefined && (
                                <div className="telemetry-item">
                                  <span className="telemetry-label">Light</span>
                                  <span className="telemetry-value">
                                    <span className={`light-indicator ${task.chamber_light === 'on' ? 'active' : ''}`}>💡</span>
                                    {task.chamber_light === 'on' ? 'On' : 'Off'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {printer.current_task && printer.print_status === 'RUNNING' && (
                  <div className="current-job">
                    <div className="job-header">
                      <img 
                        className="job-cover" 
                        src={API_ENDPOINTS.PRINTERS.JOB_COVER(printer.dev_id)}
                        alt="Print preview"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const icon = e.currentTarget.nextElementSibling as HTMLElement;
                          if (icon) icon.style.display = 'inline-block';
                          // Prevent React from logging this error
                          e.stopPropagation();
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
                          href={API_ENDPOINTS.MODELS.LOCAL_DOWNLOAD(printer.current_task.model_id)}
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
                        {printer.current_task.ams && Array.isArray(printer.current_task.ams.trays) && printer.current_task.ams.trays.length > 0 ? (
                          <div className="progress-ams" style={{ marginTop: '0.5rem' }}>
                            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>AMS (Current Print)</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 0.75rem' }}>
                              {typeof printer.current_task.ams.active_tray === 'number' && printer.current_task.ams.active_tray !== 255 && <span className="chip subtle">Active Slot: {printer.current_task.ams.active_tray}</span>}
                              {(amsExpanded[`print-${printer.dev_id}`] ? printer.current_task.ams.trays : printer.current_task.ams.trays.slice(0,2)).map((t) => (
                                <span key={`print-${t.slot}`} className="ams-chip" title={`Slot ${t.slot}: ${t.type || 'Unknown'}${t.sub_brands ? ` ${t.sub_brands}` : ''}${t.remain != null ? ` (${t.remain}% remaining)` : ''}`}>
                                  <span className="color-dot" style={{ background: `#${t.color}` || '#999' }} />
                                  S{t.slot}: {t.sub_brands || t.type || '—'} {typeof t.humidity === 'number' ? ` • ${Math.round(t.humidity)}%` : ''}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
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

      {/* Printer Configuration Modal */}
      {showConfigModal && selectedPrinter && (
        <div className="modal-overlay" onClick={closeConfigModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h2>Configure {selectedPrinter.name}</h2>
              <button className="close-btn" onClick={closeConfigModal}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Camera RTSP URL</label>
                <input
                  type="text"
                  value={cameraUrl}
                  onChange={(e) => setCameraUrl(e.target.value)}
                  placeholder="rtsps://192.168.x.x:322/streaming/live/1"
                  disabled={savingConfig}
                />
                <small style={{ display: 'block', marginTop: '5px', color: 'var(--text-secondary)' }}>
                  Configure a camera feed for this specific printer
                </small>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={closeConfigModal} disabled={savingConfig}>
                Cancel
              </button>
              <button className="btn-primary" onClick={saveConfig} disabled={savingConfig}>
                {savingConfig ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Printers;

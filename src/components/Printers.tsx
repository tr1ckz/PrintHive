import { useState, useEffect } from 'react';
import { Printer } from '../types';
import './Printers.css';
import LoadingScreen from './LoadingScreen';

function Printers() {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cameraRefresh, setCameraRefresh] = useState(0);

  useEffect(() => {
    fetchPrinters();
    
    // Refresh camera feeds every 2 seconds
    const interval = setInterval(() => {
      setCameraRefresh(prev => prev + 1);
    }, 2000);
    
    return () => clearInterval(interval);
  }, []);

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
                    key={cameraRefresh}
                    src={`/api/camera-snapshot?url=${encodeURIComponent(printer.camera_rtsp_url)}&t=${cameraRefresh}`}
                    alt="Camera feed"
                    className="camera-feed"
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
                          <div className="progress-fill" style={{ width: `${printer.current_task.progress}%` }}></div>
                        </div>
                        <div className="progress-info">
                          <span className="progress-percent">{printer.current_task.progress}%</span>
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

import { useState, useEffect, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import { Printer } from '../types';
import { API_ENDPOINTS } from '../config/api';
import fetchWithRetry from '../utils/fetchWithRetry';
import { useModal } from './ModalProvider';
import { usePrinterStore } from '../stores/usePrinterStore';
import './Printers.css';
import LoadingScreen from './LoadingScreen';
import ReactivePrinterCard from './ReactivePrinterCard';

function Printers() {
  const { openModal } = useModal();
  const [selectedPrinterId, setSelectedPrinterId] = useState<string | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [cameraUrl, setCameraUrl] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [go2rtcUrl, setGo2rtcUrl] = useState('');
  const [frigateUrl, setFrigateUrl] = useState('');
  const [defaultCameraName, setDefaultCameraName] = useState('');
  const loadPrinters = usePrinterStore((state) => state.loadInitialPrinters);
  const selectedPrinter = usePrinterStore((state) => (selectedPrinterId ? state.printersById[selectedPrinterId] || null : null));
  const { printerIds, loading, error, onlineCount, activeJobs, cameraCount, totalPrinters, socketStatus } = usePrinterStore(
    (state) => {
      const printers = state.printerOrder.map((id) => state.printersById[id]).filter(Boolean);
      return {
        printerIds: state.printerOrder,
        loading: state.loading,
        error: state.error,
        onlineCount: printers.filter((printer) => printer.online).length,
        activeJobs: printers.filter((printer) => {
          const status = String(printer.current_task?.gcode_state || printer.print_status || '').toUpperCase();
          return status === 'RUNNING' || status === 'PRINTING';
        }).length,
        cameraCount: printers.filter((printer) => Boolean((printer.camera_rtsp_url || defaultCameraName || '').trim())).length,
        totalPrinters: printers.length,
        socketStatus: state.socketStatus,
      };
    },
    shallow
  );

  const getCameraSource = useCallback((printer?: Printer | null) => {
    return (printer?.camera_rtsp_url || defaultCameraName || '').trim();
  }, [defaultCameraName]);

  const loadUiStreamSettings = useCallback(async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.UI, { credentials: 'include' });
      const data = await response.json();
      if (data.success) {
        setGo2rtcUrl(data.go2rtcUrl || '');
        setFrigateUrl(data.frigateUrl || '');
        setDefaultCameraName(data.go2rtcDefaultStream || data.frigateCameraName || '');
      }
    } catch (err) {
      console.error('Failed to load stream settings:', err);
    }
  }, []);

  useEffect(() => {
    if (printerIds.length === 0) {
      void loadPrinters();
    }
    void loadUiStreamSettings();
  }, [loadPrinters, loadUiStreamSettings, printerIds.length]);

  const openConfigModal = useCallback((printerId: string) => {
    const printer = usePrinterStore.getState().printersById[printerId];
    if (!printer) {
      return;
    }

    setSelectedPrinterId(printerId);
    setCameraUrl(printer.camera_rtsp_url || '');
    setShowConfigModal(true);
  }, []);

  const closeConfigModal = useCallback(() => {
    setShowConfigModal(false);
    setSelectedPrinterId(null);
    setCameraUrl('');
  }, []);

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
        await loadPrinters();
      }
    } catch (err) {
      console.error('Failed to save printer config:', err);
    } finally {
      setSavingConfig(false);
    }
  };

  const openHardwareModal = useCallback((printerId: string) => {
    const printer = usePrinterStore.getState().printersById[printerId];
    if (!printer) {
      return;
    }

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
  }, [getCameraSource, openModal]);

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
          <span>Live sync: {socketStatus === 'connected' ? 'Connected' : socketStatus === 'reconnecting' ? 'Reconnecting' : socketStatus === 'connecting' ? 'Connecting' : 'Offline'}</span>
        </div>
        <button className="btn-refresh" onClick={() => void loadPrinters()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Refresh
        </button>
      </div>

      <div className="printer-summary-grid">
        <div className="printer-summary-card">
          <span className="summary-label">Online printers</span>
          <strong>{onlineCount}/{totalPrinters || 0}</strong>
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

      {printerIds.length === 0 ? (
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
          {printerIds.map((printerId) => (
            <ReactivePrinterCard
              key={printerId}
              printerId={printerId}
              go2rtcUrl={go2rtcUrl}
              frigateUrl={frigateUrl}
              defaultCameraName={defaultCameraName}
              onOpenHardware={openHardwareModal}
              onOpenConfig={openConfigModal}
            />
          ))}
        </div>
      )}

      {showConfigModal && selectedPrinter ? (
        <div className="modal-overlay" onClick={closeConfigModal}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Configure {selectedPrinter.name}</h2>
                <p className="modal-subcopy">Set a printer-specific RTSP URL, go2rtc stream name, or HLS URL for this live tile.</p>
              </div>
              <button className="close-btn" onClick={closeConfigModal} aria-label="Close modal">×</button>
            </div>
            <div className="modal-body">
              <label className="modal-field">
                <span>Camera Source (RTSP / go2rtc / HLS)</span>
                <input
                  type="text"
                  value={cameraUrl}
                  onChange={(event) => setCameraUrl(event.target.value)}
                  placeholder="rtsp://user:pass@192.168.4.54/stream1 or garage_cam"
                  disabled={savingConfig}
                />
              </label>
              <small className="modal-help">
                Raw RTSP feeds are relayed through go2rtc/WebRTC automatically when the shared go2rtc URL is configured in UI Settings.
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

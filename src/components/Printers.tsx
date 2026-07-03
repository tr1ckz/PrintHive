import { useState, useEffect, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { CameraMode, CameraStreamType } from '../types';
import { API_ENDPOINTS } from '../config/api';
import fetchWithRetry from '../utils/fetchWithRetry';
import { useModal } from './ModalProvider';
import { usePrinterStore } from '../stores/usePrinterStore';
import LoadingScreen from './LoadingScreen';
import ReactivePrinterCard from './ReactivePrinterCard';

function Printers() {
  const { openModal } = useModal();
  const [cameraMode, setCameraMode] = useState<CameraMode>('frigate');
  const [cameraStreamType, setCameraStreamType] = useState<CameraStreamType>('frigate-hls');
  const [frigateStreamUrl, setFrigateStreamUrl] = useState('');
  const [rtspUrl, setRtspUrl] = useState('');
  const loadPrinters = usePrinterStore((state) => state.loadInitialPrinters);
  const { printerIds, loading, error, accountErrors, onlineCount, activeJobs, totalPrinters, socketStatus, hasAssignedRtsp } = usePrinterStore(
    useShallow((state) => {
      const printers = state.printerOrder.map((id) => state.printersById[id]).filter(Boolean);
      return {
        printerIds: state.printerOrder,
        loading: state.loading,
        error: state.error,
        accountErrors: state.accountErrors,
        onlineCount: printers.filter((printer) => printer.online).length,
        activeJobs: printers.filter((printer) => {
          const status = String(printer.current_task?.gcode_state || printer.print_status || '').toUpperCase();
          return status === 'RUNNING' || status === 'PRINTING';
        }).length,
        totalPrinters: printers.length,
        socketStatus: state.socketStatus,
        hasAssignedRtsp: printers.some((printer) => Boolean(String(printer.camera_rtsp_url || '').trim())),
      };
    })
  );

  const loadUiStreamSettings = useCallback(async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.UI, { credentials: 'include' });
      const data = await response.json();
      if (data.success) {
        setCameraMode(data.cameraMode === 'native-rtsp' ? 'native-rtsp' : 'frigate');
        setCameraStreamType(data.cameraStreamType === 'frigate-webrtc' ? 'frigate-webrtc' : 'frigate-hls');
        setFrigateStreamUrl(data.frigateStreamUrl || (data.cameraMode === 'frigate' ? data.cameraStreamUrl || '' : ''));
        setRtspUrl(data.rtspUrl || (data.cameraMode === 'native-rtsp' ? data.cameraStreamUrl || '' : ''));
      }
    } catch (err) {
      console.error('Failed to load camera stream settings:', err);
    }
  }, []);

  useEffect(() => {
    if (printerIds.length === 0) {
      void loadPrinters();
    }
  }, [loadPrinters, printerIds.length]);

  useEffect(() => {
    void loadUiStreamSettings();
  }, [loadUiStreamSettings]);

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
    ];

    openModal({
      title: `${printer.name} hardware info`,
      description: 'Static identifiers are tucked into a modal so the live dashboard stays focused on what is changing right now.',
      content: (
        <div className="space-y-1">
          {details.map((detail) => (
            <div key={detail.label} className="flex items-center justify-between gap-4 rounded-md bg-white/[0.03] px-3 py-2 text-sm [&>span]:text-muted [&>strong]:text-fg-soft [&>strong]:font-medium [&>strong]:truncate">
              <span>{detail.label}</span>
              <strong>{detail.value}</strong>
            </div>
          ))}
        </div>
      ),
      actions: [{ label: 'Close', variant: 'secondary' }],
      size: 'md'
    });
  }, [openModal]);

  if (loading) {
    return <LoadingScreen message="Building your printer overview..." variant="panel" />;
  }

  if (error) {
    return <div className="error-container">{error}</div>;
  }

  const activeCameraUrl = cameraMode === 'native-rtsp' ? rtspUrl : frigateStreamUrl;
  const cameraConfigured = Boolean(activeCameraUrl.trim()) || hasAssignedRtsp;
  const cameraLabel = hasAssignedRtsp
    ? 'Per-printer RTSP ready'
    : cameraMode === 'native-rtsp'
    ? 'Native RTSP ready'
    : `${cameraStreamType === 'frigate-webrtc' ? 'WebRTC' : 'HLS'} stream ready`;

  const reconnectAccounts = accountErrors.filter((a) => a.needsReconnect);

  return (
    <div className="space-y-5">
      {reconnectAccounts.length > 0 && (
        <div className="rounded-md bg-warning/10 px-4 py-3 text-sm text-warning">
          <strong>Bambu Cloud sign-in expired.</strong>{' '}
          {reconnectAccounts.map((a) => a.email).join(', ')} could not load printers because the cloud token is no longer valid.{' '}
          Reconnect the account in <strong>Settings → Printer Connection</strong> to restore cloud printers. Local (LAN) printers are unaffected.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>{onlineCount} online</span>
          <span>{activeJobs} active jobs</span>
          <span>{cameraConfigured ? cameraLabel : 'No camera stream set'}</span>
          <span>Live sync: {socketStatus === 'connected' ? 'Connected' : socketStatus === 'reconnecting' ? 'Reconnecting' : socketStatus === 'connecting' ? 'Connecting' : 'Offline'}</span>
        </div>
        <button className="inline-flex min-h-11 md:min-h-9 items-center gap-2 rounded-md bg-white/5 px-3 text-xs font-semibold text-fg-soft transition-colors hover:bg-white/10 hover:text-fg" onClick={() => void loadPrinters()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg bg-card p-4 shadow-sm">
          <span className="text-xs text-muted">Online printers</span>
          <strong className="mt-1 block text-2xl font-semibold tabular-nums text-fg">{onlineCount}/{totalPrinters || 0}</strong>
          <p className="mt-1 text-xs text-muted">Live devices ready for monitoring.</p>
        </div>
        <div className="rounded-lg bg-card p-4 shadow-sm">
          <span className="text-xs text-muted">Active jobs</span>
          <strong className="mt-1 block text-2xl font-semibold tabular-nums text-fg">{activeJobs}</strong>
          <p className="mt-1 text-xs text-muted">Current prints surfaced with ETA and progress.</p>
        </div>
        <div className="rounded-lg bg-card p-4 shadow-sm">
          <span className="text-xs text-muted">Camera integration</span>
          <strong className="mt-1 block text-2xl font-semibold text-fg">{cameraConfigured ? 'Configured' : 'Not set'}</strong>
          <p className="mt-1 text-xs text-muted">Switch between direct Frigate playback and the Native RTSP relay from one global setting.</p>
        </div>
      </div>

      {printerIds.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <h3 className="text-base font-semibold text-fg">No printers found</h3>
          <p className="text-sm text-muted">Connect your printer to populate the new monitoring dashboard.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {printerIds.map((printerId) => (
            <ReactivePrinterCard
              key={printerId}
              printerId={printerId}
              cameraMode={cameraMode}
              cameraStreamType={cameraStreamType}
              frigateStreamUrl={frigateStreamUrl}
              rtspUrl={rtspUrl}
              onOpenHardware={openHardwareModal}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default Printers;

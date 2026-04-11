import { useEffect, useMemo, useState } from 'react';
import { API_ENDPOINTS } from '../config/api';
import './FrigateCamera.css';

type DisplayMode = 'stream' | 'snapshot' | 'offline';
const SNAPSHOT_REFRESH_MS = 5000;

interface RTSPCameraProps {
  rtspUrl?: string;
  printerId?: string;
  printerName?: string;
  className?: string;
}

function RTSPCamera({
  rtspUrl,
  printerId,
  printerName = 'Printer',
  className = '',
}: RTSPCameraProps) {
  const [displayMode, setDisplayMode] = useState<DisplayMode>('stream');
  const [hasSnapshotError, setHasSnapshotError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [snapshotToken, setSnapshotToken] = useState(0);

  const streamSrc = useMemo(() => {
    if (!rtspUrl?.trim()) {
      return '';
    }

    const separator = API_ENDPOINTS.PRINTERS.CAMERA_STREAM.includes('?') ? '&' : '?';
    const printerQuery = printerId ? `&printerId=${encodeURIComponent(printerId)}` : '';
    return `${API_ENDPOINTS.PRINTERS.CAMERA_STREAM}${separator}t=${reloadToken}${printerQuery}`;
  }, [printerId, reloadToken, rtspUrl]);

  const snapshotSrc = useMemo(() => {
    if (!rtspUrl?.trim()) {
      return '';
    }

    const separator = API_ENDPOINTS.PRINTERS.CAMERA_SNAPSHOT.includes('?') ? '&' : '?';
    const printerQuery = printerId ? `&printerId=${encodeURIComponent(printerId)}` : `&url=${encodeURIComponent(rtspUrl)}`;
    return `${API_ENDPOINTS.PRINTERS.CAMERA_SNAPSHOT}${separator}t=${reloadToken}-${snapshotToken}${printerQuery}`;
  }, [printerId, reloadToken, rtspUrl, snapshotToken]);

  useEffect(() => {
    setDisplayMode('stream');
    setHasSnapshotError(false);
    setSnapshotToken(0);
  }, [streamSrc, rtspUrl]);

  useEffect(() => {
    if (displayMode !== 'snapshot' || !rtspUrl?.trim()) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setSnapshotToken((value) => value + 1);
    }, SNAPSHOT_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [displayMode, rtspUrl]);

  useEffect(() => {
    return () => {
      if (navigator.sendBeacon) {
        try {
          navigator.sendBeacon(
            API_ENDPOINTS.PRINTERS.CAMERA_STOP,
            new Blob([JSON.stringify({ printerId })], { type: 'application/json' })
          );
          return;
        } catch {
          // Fall back to fetch keepalive below.
        }
      }

      void fetch(API_ENDPOINTS.PRINTERS.CAMERA_STOP, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printerId }),
      }).catch(() => undefined);
    };
  }, [printerId]);

  if (!rtspUrl?.trim()) {
    return (
      <div className={`frigate-camera ${className}`.trim()}>
        <div className="frigate-camera-overlay offline">
          <div className="frigate-camera-state">
            <strong>RTSP not configured</strong>
            <span>Add an RTSP URL in Settings → Camera Stream Integration, or assign one directly to this printer in Local Printer / FTP.</span>
            <small>{printerName} · Native RTSP</small>
          </div>
        </div>
      </div>
    );
  }

  const usingSnapshotFallback = displayMode === 'snapshot' && !hasSnapshotError;

  return (
    <div className={`frigate-camera ${className}`.trim()}>
      {displayMode === 'stream' && streamSrc ? (
        <img
          src={streamSrc}
          alt={`${printerName} live RTSP stream`}
          className="frigate-camera-video is-live"
          loading="eager"
          onLoad={() => setHasSnapshotError(false)}
          onError={() => {
            setDisplayMode('snapshot');
            setSnapshotToken(0);
          }}
        />
      ) : null}

      {usingSnapshotFallback && snapshotSrc ? (
        <img
          src={snapshotSrc}
          alt={`${printerName} live RTSP snapshot`}
          className="frigate-camera-video is-live"
          loading="eager"
          title="Snapshot fallback active"
          onLoad={() => setHasSnapshotError(false)}
          onError={() => {
            setHasSnapshotError(true);
            setDisplayMode('offline');
          }}
        />
      ) : null}

      {displayMode === 'offline' ? (
        <div className="frigate-camera-overlay offline">
          <div className="frigate-camera-state">
            <strong>RTSP stream offline</strong>
            <span>PrintHive could not open the live MJPEG relay, and the snapshot fallback also failed for this RTSP source.</span>
            <small>{printerName} · Native RTSP</small>
            <button
              type="button"
              className="frigate-retry-btn"
              onClick={() => setReloadToken((value) => value + 1)}
            >
              Retry now
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default RTSPCamera;

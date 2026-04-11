import { useEffect, useMemo, useState } from 'react';
import { API_ENDPOINTS } from '../config/api';
import './FrigateCamera.css';

interface RTSPCameraProps {
  rtspUrl?: string;
  printerName?: string;
  className?: string;
}

function RTSPCamera({
  rtspUrl,
  printerName = 'Printer',
  className = '',
}: RTSPCameraProps) {
  const [hasError, setHasError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const streamSrc = useMemo(() => {
    if (!rtspUrl?.trim()) {
      return '';
    }

    const separator = API_ENDPOINTS.PRINTERS.CAMERA_STREAM.includes('?') ? '&' : '?';
    return `${API_ENDPOINTS.PRINTERS.CAMERA_STREAM}${separator}t=${reloadToken}`;
  }, [reloadToken, rtspUrl]);

  useEffect(() => {
    setHasError(false);
  }, [streamSrc]);

  useEffect(() => {
    return () => {
      if (navigator.sendBeacon) {
        try {
          navigator.sendBeacon(API_ENDPOINTS.PRINTERS.CAMERA_STOP, new Blob([], { type: 'application/json' }));
          return;
        } catch {
          // Fall back to fetch keepalive below.
        }
      }

      void fetch(API_ENDPOINTS.PRINTERS.CAMERA_STOP, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
      }).catch(() => undefined);
    };
  }, []);

  if (!rtspUrl?.trim()) {
    return (
      <div className={`frigate-camera ${className}`.trim()}>
        <div className="frigate-camera-overlay offline">
          <div className="frigate-camera-state">
            <strong>RTSP not configured</strong>
            <span>Add an RTSP URL in Settings → Camera Stream Integration.</span>
            <small>{printerName} · Native RTSP</small>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`frigate-camera ${className}`.trim()}>
      {!hasError && streamSrc ? (
        <img
          src={streamSrc}
          alt={`${printerName} live RTSP stream`}
          className="frigate-camera-video is-live"
          loading="eager"
          onLoad={() => setHasError(false)}
          onError={() => setHasError(true)}
        />
      ) : null}

      {hasError ? (
        <div className="frigate-camera-overlay offline">
          <div className="frigate-camera-state">
            <strong>RTSP stream offline</strong>
            <span>PrintHive could not relay the FFmpeg MJPEG stream from the configured RTSP source.</span>
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

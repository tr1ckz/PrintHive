import { useEffect, useMemo, useState } from 'react';
import { API_ENDPOINTS } from '../config/api';

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
      <div className={`relative h-full min-h-[250px] w-full overflow-hidden bg-black ${className}`.trim()}>
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 p-5">
          <div className="grid max-w-[280px] justify-items-center gap-1.5 text-center">
            <strong className="text-base text-white">RTSP not configured</strong>
            <span className="text-sm leading-relaxed text-white/70">Add an RTSP URL in Settings → Camera Stream Integration, or assign one directly to this printer in Local Printer / FTP.</span>
            <small className="text-xs uppercase tracking-wider text-white/50">{printerName} · Native RTSP</small>
          </div>
        </div>
      </div>
    );
  }

  const usingSnapshotFallback = displayMode === 'snapshot' && !hasSnapshotError;

  return (
    <div className={`relative h-full min-h-[250px] w-full overflow-hidden bg-black ${className}`.trim()}>
      {displayMode === 'stream' && streamSrc ? (
        <img
          src={streamSrc}
          alt={`${printerName} live RTSP stream`}
          className="block h-full w-full bg-black object-cover"
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
          className="block h-full w-full bg-black object-cover"
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
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 p-5">
          <div className="grid max-w-[280px] justify-items-center gap-1.5 text-center">
            <strong className="text-base text-white">RTSP stream offline</strong>
            <span className="text-sm leading-relaxed text-white/70">PrintHive could not open the live MJPEG relay, and the snapshot fallback also failed for this RTSP source.</span>
            <small className="text-xs uppercase tracking-wider text-white/50">{printerName} · Native RTSP</small>
            <button
              type="button"
              className="mt-1.5 inline-flex min-h-9 items-center rounded-lg bg-accent/15 px-3 text-sm font-semibold text-white ring-1 ring-accent/30 transition-colors hover:bg-accent/25"
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

import React, { useEffect, useRef, useState } from 'react';
import { API_ENDPOINTS } from '../../config/api';

interface ChamberCameraProps {
  printerId: string;
  printerName: string;
}

/**
 * Bambu built-in chamber camera. The backend bridges the printer's proprietary
 * port-6000 stream to MJPEG, which the browser renders natively in an <img>.
 * No go2rtc/ffmpeg involved.
 */
const ChamberCamera: React.FC<ChamberCameraProps> = ({ printerId, printerName }) => {
  const [errored, setErrored] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [nonce, setNonce] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Force a fresh MJPEG connection when the printer changes or on manual retry.
  const src = `${API_ENDPOINTS.PRINTERS.CHAMBER_MJPEG(printerId)}?t=${nonce}`;

  useEffect(() => {
    setErrored(false);
    setLoaded(false);
    // Stop the stream when unmounted so the backend can drop the printer socket.
    const img = imgRef.current;
    return () => { if (img) img.src = ''; };
  }, [printerId, nonce]);

  if (errored) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-2 bg-white/[0.03] p-6 text-center">
        <strong className="text-sm font-medium text-fg-soft">Chamber camera unavailable</strong>
        <span className="text-xs text-muted">
          The printer didn't return a stream. Make sure it's reachable on your LAN and the access code is current.
        </span>
        <button
          onClick={() => setNonce((n) => n + 1)}
          className="mt-1 rounded-md bg-white/5 px-3 py-1.5 text-xs font-semibold text-fg-soft hover:bg-white/10"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {!loaded && (
        <div className="absolute inset-0 flex aspect-video items-center justify-center text-xs text-muted">
          Connecting to chamber camera…
        </div>
      )}
      <img
        ref={imgRef}
        src={src}
        alt={`${printerName} chamber camera`}
        className="w-full"
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
      />
    </div>
  );
};

export default ChamberCamera;

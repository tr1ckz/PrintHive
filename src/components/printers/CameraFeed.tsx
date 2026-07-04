import React from 'react';
import type { CameraMode, CameraStreamType } from '../../types';
import FrigateCamera from '../FrigateCamera';
import RTSPCamera from '../RTSPCamera';
import ChamberCamera from './ChamberCamera';

const formatBitrate = (bps?: number) => {
  if (!bps || Number.isNaN(bps)) return null;

  const mbps = bps / (1024 * 1024);
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;

  const kbps = bps / 1024;
  return `${Math.round(kbps)} Kbps`;
};

interface CameraFeedProps {
  printerId: string;
  printerName: string;
  cameraMode?: CameraMode;
  cameraStreamType?: CameraStreamType;
  frigateStreamUrl?: string;
  rtspUrl?: string;
  /** Per-printer assigned RTSP URL from the store (wins over globals) */
  assignedRtspUrl?: string;
  ipcamBitrate?: number;
}

interface Feed {
  key: string;
  label: string;
  node: React.ReactNode;
}

/**
 * Camera chrome around the existing stream players (players untouched).
 * Renders every configured feed for a printer — an assigned RTSP camera AND the
 * built-in chamber camera show together when both are available.
 */
const CameraFeed: React.FC<CameraFeedProps> = ({
  printerId,
  printerName,
  cameraMode = 'frigate',
  cameraStreamType,
  frigateStreamUrl,
  rtspUrl,
  assignedRtspUrl,
  ipcamBitrate,
}) => {
  const assigned = assignedRtspUrl?.trim();
  const feeds: Feed[] = [];

  // A printer-assigned RTSP camera is always shown when present.
  if (assigned) {
    feeds.push({
      key: 'assigned-rtsp',
      label: 'Assigned RTSP',
      node: <RTSPCamera rtspUrl={assigned} printerId={printerId} printerName={printerName} />,
    });
  }

  // The built-in chamber camera streams over the LAN with no URL to configure;
  // it's shown alongside an assigned RTSP when the mode is enabled.
  if (cameraMode === 'builtin') {
    feeds.push({
      key: 'builtin-chamber',
      label: 'Built-in chamber',
      node: <ChamberCamera printerId={printerId} printerName={printerName} />,
    });
  }

  // Fall back to the global source only when the printer has no feed of its own.
  if (feeds.length === 0) {
    if (cameraMode === 'native-rtsp' && rtspUrl?.trim()) {
      feeds.push({
        key: 'native-rtsp',
        label: 'Native RTSP',
        node: <RTSPCamera rtspUrl={rtspUrl} printerId={printerId} printerName={printerName} />,
      });
    } else if (frigateStreamUrl?.trim()) {
      feeds.push({
        key: 'frigate',
        label: cameraStreamType === 'frigate-webrtc' ? 'Frigate WebRTC' : 'Frigate HLS',
        node: <FrigateCamera streamType={cameraStreamType} streamUrl={frigateStreamUrl} printerName={printerName} />,
      });
    }
  }

  if (feeds.length === 0) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-1 rounded-md bg-white/[0.03] p-6 text-center">
        <strong className="text-sm font-medium text-fg-soft">No camera stream configured</strong>
        <span className="text-xs text-muted">
          Add a global camera in Settings → Camera Stream Integration, assign an RTSP camera to this printer in Local Printer / FTP, or switch Camera Mode to the built-in printer camera.
        </span>
      </div>
    );
  }

  const bitrate = typeof ipcamBitrate === 'number' && ipcamBitrate > 0 ? formatBitrate(ipcamBitrate) : null;

  return (
    <div className="space-y-3">
      {feeds.map((feed, index) => (
        <div key={feed.key}>
          <div className="overflow-hidden rounded-md bg-black/40 [&_video]:w-full [&_img]:w-full">
            {feed.node}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-muted">
            <span>{feed.label}</span>
            {index === 0 && bitrate ? <span className="tabular-nums">{bitrate}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
};

export default CameraFeed;

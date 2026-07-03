import React from 'react';
import type { CameraMode, CameraStreamType } from '../../types';
import FrigateCamera from '../FrigateCamera';
import RTSPCamera from '../RTSPCamera';

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

/**
 * Camera chrome around the existing stream players (players untouched).
 * Rounded media well; source + bitrate as quiet metadata underneath.
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
  const effectiveRtspUrl = assignedRtspUrl?.trim() || rtspUrl;
  const hasAssignedRtsp = Boolean(assignedRtspUrl?.trim());
  const useRtspStream = hasAssignedRtsp || cameraMode === 'native-rtsp';
  const streamConfigured = useRtspStream
    ? Boolean(effectiveRtspUrl?.trim())
    : Boolean(frigateStreamUrl?.trim());

  if (!streamConfigured) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-1 rounded-md bg-white/[0.03] p-6 text-center">
        <strong className="text-sm font-medium text-fg-soft">No camera stream configured</strong>
        <span className="text-xs text-muted">
          Add a global camera in Settings → Camera Stream Integration, or assign an RTSP camera directly to this printer in Local Printer / FTP.
        </span>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-md bg-black/40 [&_video]:w-full [&_img]:w-full">
        {useRtspStream ? (
          <RTSPCamera rtspUrl={effectiveRtspUrl} printerId={printerId} printerName={printerName} />
        ) : (
          <FrigateCamera streamType={cameraStreamType} streamUrl={frigateStreamUrl} printerName={printerName} />
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-muted">
        <span>
          {useRtspStream
            ? (hasAssignedRtsp ? 'Assigned RTSP' : 'Native RTSP')
            : cameraStreamType === 'frigate-webrtc'
              ? 'Frigate WebRTC'
              : 'Frigate HLS'}
        </span>
        {typeof ipcamBitrate === 'number' && ipcamBitrate > 0 ? (
          <span className="tabular-nums">{formatBitrate(ipcamBitrate)}</span>
        ) : null}
      </div>
    </div>
  );
};

export default CameraFeed;

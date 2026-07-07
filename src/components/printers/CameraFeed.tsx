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
  /** Show the built-in chamber camera in addition to any other feed */
  showBuiltin?: boolean;
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
  showBuiltin,
  frigateStreamUrl,
  rtspUrl,
  assignedRtspUrl,
  ipcamBitrate,
}) => {
  const [expandedKey, setExpandedKey] = React.useState<string | null>(null);
  const assigned = assignedRtspUrl?.trim();
  const feeds: Feed[] = [];

  // Base feed: a printer-assigned RTSP wins; otherwise the global source for the
  // selected mode. (When the mode itself is "builtin" there's no separate base —
  // the chamber below is the feed.)
  if (assigned) {
    feeds.push({
      key: 'assigned-rtsp',
      label: 'Assigned RTSP',
      node: <RTSPCamera rtspUrl={assigned} printerId={printerId} printerName={printerName} />,
    });
  } else if (cameraMode === 'native-rtsp' && rtspUrl?.trim()) {
    feeds.push({
      key: 'native-rtsp',
      label: 'Native RTSP',
      node: <RTSPCamera rtspUrl={rtspUrl} printerId={printerId} printerName={printerName} />,
    });
  } else if (cameraMode === 'frigate' && frigateStreamUrl?.trim()) {
    feeds.push({
      key: 'frigate',
      label: cameraStreamType === 'frigate-webrtc' ? 'Frigate WebRTC' : 'Frigate HLS',
      node: <FrigateCamera streamType={cameraStreamType} streamUrl={frigateStreamUrl} printerName={printerName} />,
    });
  }

  // Built-in chamber: added on top when it's the selected mode OR the independent
  // "also show built-in" toggle is on — so it runs alongside any base feed.
  if (cameraMode === 'builtin' || showBuiltin) {
    feeds.push({
      key: 'builtin-chamber',
      label: 'Built-in chamber',
      node: <ChamberCamera printerId={printerId} printerName={printerName} />,
    });
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
  const multiple = feeds.length > 1;
  const expandedFeed = expandedKey ? feeds.find((f) => f.key === expandedKey) : undefined;

  return (
    <>
      {/* Compact by default: multiple feeds sit side by side on desktop (each ~half
          size), a lone feed is capped; everything stacks full-width on mobile.
          Tap the expand button to view a feed large in a modal. */}
      <div className={multiple ? 'grid grid-cols-1 gap-3 lg:grid-cols-2' : 'space-y-3'}>
        {feeds.map((feed, index) => (
          <div key={feed.key} className={multiple ? undefined : 'lg:max-w-lg'}>
            <div className="group relative overflow-hidden rounded-md bg-black/40 [&_video]:w-full [&_img]:w-full">
              {feed.node}
              <button
                type="button"
                onClick={() => setExpandedKey(feed.key)}
                title="Enlarge"
                aria-label="Enlarge camera"
                className="absolute right-2 top-2 inline-flex size-8 items-center justify-center rounded-md bg-black/50 text-white/80 opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/70 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M15 3h6m0 0v6m0-6l-7 7M9 21H3m0 0v-6m0 6l7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs text-muted">
              <span>{feed.label}</span>
              {index === 0 && bitrate ? <span className="tabular-nums">{bitrate}</span> : null}
            </div>
          </div>
        ))}
      </div>

      {expandedFeed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setExpandedKey(null)}
        >
          <div className="w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <div className="overflow-hidden rounded-lg bg-black shadow-xl [&_video]:w-full [&_img]:w-full">
              {expandedFeed.node}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-sm font-medium text-white/85">{expandedFeed.label}</span>
              <button
                type="button"
                onClick={() => setExpandedKey(null)}
                className="inline-flex min-h-9 items-center rounded-md bg-white/10 px-3 text-sm font-semibold text-white transition-colors hover:bg-white/20"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CameraFeed;

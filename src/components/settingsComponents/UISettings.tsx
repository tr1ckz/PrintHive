import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../../config/api';
import fetchWithRetry from '../../utils/fetchWithRetry';
import { applyThemeScheme } from '../../utils/theme';
import { useSettingsContext } from './SettingsContext';
import { CollapsibleSection } from './CollapsibleSection';
import type { CameraMode, CameraStreamType } from './types';

export function UISettings() {
  const { setToast } = useSettingsContext();
  const [hideBmc, setHideBmc] = useState(false);
  const [colorScheme, setColorScheme] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.dataset.themeAccent || 'orange';
    }
    return 'orange';
  });
  const [cameraMode, setCameraMode] = useState<CameraMode>('frigate');
  const [cameraStreamType, setCameraStreamType] = useState<CameraStreamType>('frigate-hls');
  const [frigateStreamUrl, setFrigateStreamUrl] = useState('');
  const [rtspUrl, setRtspUrl] = useState('');
  const [uiLoading, setUiLoading] = useState(false);

  useEffect(() => {
    loadUiSettings();
  }, []);

  useEffect(() => {
    applyThemeScheme(colorScheme);
  }, [colorScheme]);

  const loadUiSettings = async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.UI, { credentials: 'include' });
      const data = await response.json();
      if (data.success) {
        setHideBmc(data.hideBmc || false);
        setColorScheme(data.colorScheme || document.documentElement.dataset.themeAccent || 'orange');
        setCameraMode(['native-rtsp', 'builtin'].includes(data.cameraMode) ? data.cameraMode : 'frigate');
        setCameraStreamType(data.cameraStreamType === 'frigate-webrtc' ? 'frigate-webrtc' : 'frigate-hls');
        setFrigateStreamUrl(data.frigateStreamUrl || (data.cameraMode === 'frigate' ? data.cameraStreamUrl || '' : ''));
        setRtspUrl(data.rtspUrl || (data.cameraMode === 'native-rtsp' ? data.cameraStreamUrl || '' : ''));
      }
    } catch (error) {
      console.error('Failed to load UI settings:', error);
    }
  };

  const handleSaveUiSettings = async () => {
    setUiLoading(true);
    try {
      const trimmedFrigateUrl = frigateStreamUrl.trim();
      const trimmedRtspUrl = rtspUrl.trim();

      if (cameraMode === 'frigate' && trimmedFrigateUrl && !/^(https?:\/\/|wss?:\/\/)/i.test(trimmedFrigateUrl)) {
        setToast({ message: 'Frigate Stream URL must be an absolute http(s) or ws(s) URL.', type: 'error' });
        return;
      }

      if (cameraMode === 'native-rtsp' && trimmedRtspUrl && !/^rtsps?:\/\//i.test(trimmedRtspUrl)) {
        setToast({ message: 'RTSP URL must start with rtsp:// or rtsps://.', type: 'error' });
        return;
      }

      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.UI, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hideBmc,
          colorScheme,
          cameraMode,
          cameraStreamType,
          frigateStreamUrl: trimmedFrigateUrl,
          rtspUrl: trimmedRtspUrl,
        }),
        credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: 'UI and camera settings saved!', type: 'success' });
      } else {
        setToast({ message: 'Failed to save UI settings', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to save UI settings', type: 'error' });
    } finally {
      setUiLoading(false);
    }
  };

  const frigatePlaceholder = cameraStreamType === 'frigate-webrtc'
    ? 'wss://frigate.example.com/live/webrtc?src=printer_cam'
    : 'https://frigate.example.com/api/printer_cam/hls.m3u8';

  return (
    <>
      <CollapsibleSection title="UI Settings" icon="🖥️">
        <p className="mb-4 text-sm text-fg-soft">
          Customize the interface appearance
        </p>

        <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
          <label>Color Scheme</label>
          <select
            value={colorScheme}
            onChange={(e) => setColorScheme(e.target.value)}
            disabled={uiLoading}
            className="w-full"
          >
            <option value="cyan">Cyan</option>
            <option value="purple">Purple</option>
            <option value="green">Green</option>
            <option value="orange">Orange</option>
            <option value="pink">Pink</option>
            <option value="blue">Blue</option>
          </select>
          <small className="mt-1.5 block text-xs text-muted">
            Choose your accent color throughout the app
          </small>
        </div>

        <div className="mb-4 space-y-1">
          <label className="flex cursor-pointer items-center gap-2.5 py-1 text-sm text-fg-soft [&>input]:size-4 [&>input]:shrink-0 [&>input]:accent-accent">
            <input
              type="checkbox"
              checked={hideBmc}
              onChange={(e) => setHideBmc(e.target.checked)}
              disabled={uiLoading}
            />
            <span className="select-none">Hide "Buy Me a Coffee" button</span>
          </label>
        </div>

        <button
          type="button"
          className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong"
          onClick={handleSaveUiSettings}
          disabled={uiLoading}
        >
          {uiLoading ? 'Saving...' : 'Save UI Settings'}
        </button>
      </CollapsibleSection>

      <CollapsibleSection title="Camera Stream Integration" icon="🎥">
        <p className="mb-4 text-sm text-fg-soft">
          Choose between a direct Frigate connection or a native RTSP relay powered by the PrintHive Node.js backend.
        </p>

        <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
          <label>Camera Mode</label>
          <select
            value={cameraMode}
            onChange={(e) => setCameraMode(e.target.value as CameraMode)}
            disabled={uiLoading}
            className="w-full"
          >
            <option value="frigate">Frigate (WebRTC/HLS)</option>
            <option value="native-rtsp">Native RTSP</option>
            <option value="builtin">Built-in printer camera (Bambu chamber)</option>
          </select>
        </div>

        {cameraMode === 'builtin' && (
          <p className="mb-4 rounded-md bg-accent/10 p-3 text-xs text-fg-soft">
            Streams each printer's built-in chamber camera directly over your LAN using its IP and
            access code — no Frigate or RTSP URL needed. Requires the printer to be reachable locally
            (P1/A1/X1). If a printer also has an assigned RTSP camera, that takes priority.
          </p>
        )}

        {cameraMode === 'frigate' ? (
          <>
            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
              <label>Frigate Stream Type</label>
              <select
                value={cameraStreamType}
                onChange={(e) => setCameraStreamType(e.target.value as CameraStreamType)}
                disabled={uiLoading}
                className="w-full"
              >
                <option value="frigate-hls">Frigate HLS (.m3u8)</option>
                <option value="frigate-webrtc">Frigate WebRTC</option>
              </select>
            </div>

            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
              <label>Frigate Stream URL</label>
              <input
                type="text"
                value={frigateStreamUrl}
                onChange={(e) => setFrigateStreamUrl(e.target.value)}
                disabled={uiLoading}
                className="w-full"
                placeholder={frigatePlaceholder}
              />
              <small className="mt-1.5 block text-xs text-muted">
                {cameraStreamType === 'frigate-webrtc'
                  ? 'Paste the full absolute Frigate WebRTC URL. PrintHive will use exactly this host and won’t fall back to window.location.'
                  : 'Paste the full absolute Frigate HLS .m3u8 URL so the browser can load the playlist directly.'}
              </small>
            </div>
          </>
        ) : (
          <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
            <label>RTSP URL</label>
            <input
              type="text"
              value={rtspUrl}
              onChange={(e) => setRtspUrl(e.target.value)}
              disabled={uiLoading}
              className="w-full"
              placeholder="rtsp://pdhacam:pdhacams@192.168.4.54/stream1"
            />
            <small className="mt-1.5 block text-xs text-muted">
              PrintHive will relay this raw RTSP feed through FFmpeg as an MJPEG stream at `/api/camera/stream`. The host already needs FFmpeg installed. For multiple cameras, assign an RTSP override per printer in `Local Printer / FTP`.
            </small>
          </div>
        )}

        <button
          type="button"
          className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong"
          onClick={handleSaveUiSettings}
          disabled={uiLoading}
        >
          {uiLoading ? 'Saving...' : 'Save Camera Integration'}
        </button>
      </CollapsibleSection>
    </>
  );
}

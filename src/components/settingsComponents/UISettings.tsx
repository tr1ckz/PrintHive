import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../../config/api';
import fetchWithRetry from '../../utils/fetchWithRetry';
import { applyThemeScheme } from '../../utils/theme';
import { useSettingsContext } from './SettingsContext';
import { CollapsibleSection } from './CollapsibleSection';
import type { CameraStreamType } from './types';

export function UISettings() {
  const { setToast } = useSettingsContext();
  const [hideBmc, setHideBmc] = useState(false);
  const [colorScheme, setColorScheme] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.dataset.themeAccent || 'orange';
    }
    return 'orange';
  });
  const [cameraStreamType, setCameraStreamType] = useState<CameraStreamType>('frigate-hls');
  const [cameraStreamUrl, setCameraStreamUrl] = useState('');
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
        setCameraStreamType(data.cameraStreamType === 'frigate-webrtc' ? 'frigate-webrtc' : 'frigate-hls');
        setCameraStreamUrl(data.cameraStreamUrl || '');
      }
    } catch (error) {
      console.error('Failed to load UI settings:', error);
    }
  };

  const handleSaveUiSettings = async () => {
    setUiLoading(true);
    try {
      const trimmedStreamUrl = cameraStreamUrl.trim();
      if (trimmedStreamUrl && !/^(https?:\/\/|wss?:\/\/|rtsps?:\/\/)/i.test(trimmedStreamUrl)) {
        setToast({ message: 'Stream URL must be an absolute http(s), ws(s), or rtsp(s) camera URL.', type: 'error' });
        return;
      }

      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.UI, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hideBmc,
          colorScheme,
          cameraStreamType,
          cameraStreamUrl: trimmedStreamUrl
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

  const streamPlaceholder = cameraStreamType === 'frigate-webrtc'
    ? 'rtsp://user:pass@192.168.4.54/stream1 or http://frigate-ip:1984/api/ws?src=camera_name'
    : 'rtsp://user:pass@192.168.4.54/stream1 or http://frigate-ip:5000/api/camera_name/hls.m3u8';

  return (
    <>
      <CollapsibleSection title="UI Settings" icon="🖥️">
        <p className="form-description">
          Customize the interface appearance
        </p>

        <div className="form-group">
          <label>Color Scheme</label>
          <select
            value={colorScheme}
            onChange={(e) => setColorScheme(e.target.value)}
            disabled={uiLoading}
            className="form-control"
          >
            <option value="cyan">Cyan</option>
            <option value="purple">Purple</option>
            <option value="green">Green</option>
            <option value="orange">Orange</option>
            <option value="pink">Pink</option>
            <option value="blue">Blue</option>
          </select>
          <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>
            Choose your accent color throughout the app
          </small>
        </div>

        <div className="toggle-group">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={hideBmc}
              onChange={(e) => setHideBmc(e.target.checked)}
              disabled={uiLoading}
            />
            <span className="toggle-text">Hide "Buy Me a Coffee" button</span>
          </label>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSaveUiSettings}
          disabled={uiLoading}
        >
          {uiLoading ? 'Saving...' : 'Save UI Settings'}
        </button>
      </CollapsibleSection>

      <CollapsibleSection title="Camera Stream Integration" icon="🎥">
        <p className="form-description">
          Use one camera URL across PrintHive. You can paste a Frigate endpoint or a raw RTSP feed and PrintHive will relay it through go2rtc automatically.
        </p>

        <div className="form-group">
          <label>Stream Type</label>
          <select
            value={cameraStreamType}
            onChange={(e) => setCameraStreamType(e.target.value as CameraStreamType)}
            disabled={uiLoading}
            className="form-control"
          >
            <option value="frigate-hls">Frigate HLS (.m3u8)</option>
            <option value="frigate-webrtc">Frigate WebRTC</option>
          </select>
        </div>

        <div className="form-group">
          <label>Stream URL</label>
          <input
            type="text"
            value={cameraStreamUrl}
            onChange={(e) => setCameraStreamUrl(e.target.value)}
            disabled={uiLoading}
            className="form-control"
            placeholder={streamPlaceholder}
          />
          <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>
            {cameraStreamType === 'frigate-webrtc'
              ? 'Paste a Frigate/go2rtc WebRTC URL, or paste your raw RTSP camera URL and PrintHive will relay it over WebRTC automatically.'
              : 'Paste a Frigate HLS .m3u8 URL, or paste your raw RTSP camera URL and PrintHive will expose it as an HLS feed automatically.'}
          </small>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSaveUiSettings}
          disabled={uiLoading}
        >
          {uiLoading ? 'Saving...' : 'Save Camera Integration'}
        </button>
      </CollapsibleSection>
    </>
  );
}

import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../../config/api';
import fetchWithRetry from '../../utils/fetchWithRetry';
import { applyThemeScheme } from '../../utils/theme';
import { useSettingsContext } from './SettingsContext';
import { CollapsibleSection } from './CollapsibleSection';

export function UISettings() {
  const { setToast } = useSettingsContext();
  const [hideBmc, setHideBmc] = useState(false);
  const [colorScheme, setColorScheme] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.dataset.themeAccent || 'orange';
    }
    return 'orange';
  });
  const [go2rtcUrl, setGo2rtcUrl] = useState('');
  const [go2rtcDefaultStream, setGo2rtcDefaultStream] = useState('');
  const [tapoCameraHost, setTapoCameraHost] = useState('');
  const [tapoCameraUsername, setTapoCameraUsername] = useState('');
  const [tapoCameraPassword, setTapoCameraPassword] = useState('');
  const [tapoCameraPath, setTapoCameraPath] = useState('stream1');
  const [frigateUrl, setFrigateUrl] = useState('');
  const [frigateCameraName, setFrigateCameraName] = useState('');
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
        setGo2rtcUrl(data.go2rtcUrl || '');
        setGo2rtcDefaultStream(data.go2rtcDefaultStream || data.frigateCameraName || '');
        setTapoCameraHost(data.tapoCameraHost || '');
        setTapoCameraUsername(data.tapoCameraUsername || '');
        setTapoCameraPassword(data.tapoCameraPassword || '');
        setTapoCameraPath(data.tapoCameraPath || 'stream1');
        setFrigateUrl(data.frigateUrl || '');
        setFrigateCameraName(data.frigateCameraName || '');
      }
    } catch (error) {
      console.error('Failed to load UI settings:', error);
    }
  };

  const handleSaveUiSettings = async () => {
    setUiLoading(true);
    try {
      const trimmedGo2rtcUrl = go2rtcUrl.trim();
      if (trimmedGo2rtcUrl && !/^https?:\/\//i.test(trimmedGo2rtcUrl)) {
        setToast({ message: 'go2rtc Base URL must start with http:// or https://. Put rtsp:// camera feeds in the printer Camera Source field instead.', type: 'error' });
        setUiLoading(false);
        return;
      }

      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.UI, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hideBmc,
          colorScheme,
          go2rtcUrl: trimmedGo2rtcUrl,
          go2rtcDefaultStream,
          tapoCameraHost,
          tapoCameraUsername,
          tapoCameraPassword,
          tapoCameraPath,
          frigateUrl,
          frigateCameraName
        }),
        credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        const streamMessage = data.streamCount
          ? ` go2rtc config updated with ${data.streamCount} stream${data.streamCount === 1 ? '' : 's'}.`
          : '';
        setToast({ message: `UI settings saved!${streamMessage}`, type: 'success' });
      } else {
        setToast({ message: 'Failed to save UI settings', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to save UI settings', type: 'error' });
    } finally {
      setUiLoading(false);
    }
  };

  const maskedRtspPreview = tapoCameraHost
    ? `rtsp://${tapoCameraUsername || 'user'}:${tapoCameraPassword ? '••••••' : 'password'}@${tapoCameraHost}/${(tapoCameraPath || 'stream1').replace(/^\/+/, '')}`
    : '';

  return (
    <CollapsibleSection title="UI Settings" icon="🖥️">
      <p className="form-description">
        Customize the interface appearance and low-latency camera playback
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
        <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>Choose your accent color throughout the app</small>
      </div>

      <div className="form-group">
        <label>go2rtc Base URL (HTTP)</label>
        <input
          type="url"
          value={go2rtcUrl}
          onChange={(e) => setGo2rtcUrl(e.target.value)}
          disabled={uiLoading}
          className="form-control"
          placeholder="http://localhost:1984"
        />
        <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>
          This must be the go2rtc service URL itself, usually <code>http://localhost:1984</code>. Do <strong>not</strong> paste a raw <code>rtsp://</code> camera feed here.
        </small>
      </div>

      <div className="form-group">
        <label>Default go2rtc Stream Name</label>
        <input
          type="text"
          value={go2rtcDefaultStream}
          onChange={(e) => setGo2rtcDefaultStream(e.target.value)}
          disabled={uiLoading}
          className="form-control"
          placeholder="garage_cam"
        />
        <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>
          Used when a printer card does not override the stream source. This should match a stream name in <code>data/go2rtc/go2rtc.yaml</code>.
        </small>
      </div>

      <div className="form-group">
        <label>Tapo Camera IP / Host (Optional)</label>
        <input
          type="text"
          value={tapoCameraHost}
          onChange={(e) => setTapoCameraHost(e.target.value)}
          disabled={uiLoading}
          className="form-control"
          placeholder="192.168.4.54"
        />
      </div>

      <div className="form-group">
        <label>Tapo Username (Optional)</label>
        <input
          type="text"
          value={tapoCameraUsername}
          onChange={(e) => setTapoCameraUsername(e.target.value)}
          disabled={uiLoading}
          className="form-control"
          placeholder="pdhacam"
        />
      </div>

      <div className="form-group">
        <label>Tapo Password (Optional)</label>
        <input
          type="password"
          value={tapoCameraPassword}
          onChange={(e) => setTapoCameraPassword(e.target.value)}
          disabled={uiLoading}
          className="form-control"
          placeholder="camera password"
        />
      </div>

      <div className="form-group">
        <label>Tapo RTSP Path</label>
        <input
          type="text"
          value={tapoCameraPath}
          onChange={(e) => setTapoCameraPath(e.target.value)}
          disabled={uiLoading}
          className="form-control"
          placeholder="stream1"
        />
        <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>
          When the optional Tapo fields are filled in, PrintHive writes <code>data/go2rtc/go2rtc.yaml</code> for you using this RTSP path.
        </small>
      </div>

      {maskedRtspPreview ? (
        <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '1rem' }}>
          Generated RTSP preview: <code>{maskedRtspPreview}</code>
        </small>
      ) : null}

      <div className="form-group">
        <label>Frigate Base URL (Optional legacy fallback)</label>
        <input
          type="url"
          value={frigateUrl}
          onChange={(e) => setFrigateUrl(e.target.value)}
          disabled={uiLoading}
          className="form-control"
          placeholder="http://frigate.local:5000"
        />
        <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>
          Keep this only if you still want the older Frigate HLS fallback path. go2rtc/WebRTC is now the preferred low-latency option.
        </small>
      </div>

      <div className="form-group">
        <label>Default Frigate Camera Name (Optional)</label>
        <input
          type="text"
          value={frigateCameraName}
          onChange={(e) => setFrigateCameraName(e.target.value)}
          disabled={uiLoading}
          className="form-control"
          placeholder="p1s_camera"
        />
      </div>

      {/^https?:\/\//i.test(go2rtcUrl.trim()) && go2rtcDefaultStream ? (
        <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '1rem' }}>
          WebRTC preview: <code>{`${go2rtcUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}/api/ws?src=${encodeURIComponent(go2rtcDefaultStream)}`}</code>
        </small>
      ) : null}

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
  );
}

import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../../config/api';
import fetchWithRetry from '../../utils/fetchWithRetry';
import { useSettingsContext } from './SettingsContext';
import { CollapsibleSection } from './CollapsibleSection';

export function WatchdogSettings() {
  const { setToast } = useSettingsContext();
  const [watchdogEnabled, setWatchdogEnabled] = useState(false);
  const [watchdogInterval, setWatchdogInterval] = useState(30);
  const [watchdogEndpoint, setWatchdogEndpoint] = useState('');
  const [watchdogLoading, setWatchdogLoading] = useState(false);

  useEffect(() => {
    loadWatchdogSettings();
  }, []);

  const loadWatchdogSettings = async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.WATCHDOG, { credentials: 'include' });
      const data = await response.json();
      if (response.ok) {
        setWatchdogEnabled(data.enabled || false);
        setWatchdogInterval(data.interval || 30);
        setWatchdogEndpoint(data.endpoint || '');
      }
    } catch (error) {
      console.error('Failed to load watchdog settings:', error);
    }
  };

  const handleSaveWatchdogSettings = async () => {
    setWatchdogLoading(true);
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.WATCHDOG, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: watchdogEnabled,
          interval: watchdogInterval,
          endpoint: watchdogEndpoint
        }),
        credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: 'Watchdog settings saved!', type: 'success' });
      } else {
        setToast({ message: 'Failed to save watchdog settings', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to save watchdog settings', type: 'error' });
    } finally {
      setWatchdogLoading(false);
    }
  };

  return (
    <CollapsibleSection title="Watchdog / Health Check" icon="🐕">
      <p className="form-description">
        Keep the application alive and monitor health status
      </p>
      
      <div className="toggle-group">
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={watchdogEnabled}
            onChange={(e) => setWatchdogEnabled(e.target.checked)}
            disabled={watchdogLoading}
          />
          <span className="toggle-text">Enable Watchdog</span>
        </label>
        <p className="toggle-hint">Periodically check application health and ping external services</p>
      </div>
      
      {watchdogEnabled && (
        <>
          <div className="form-group">
            <label>Check Interval (seconds)</label>
            <input
              type="number"
              value={watchdogInterval}
              onChange={(e) => setWatchdogInterval(parseInt(e.target.value) || 30)}
              placeholder="30"
              min="10"
              max="3600"
              disabled={watchdogLoading}
            />
          </div>
          
          <div className="form-group">
            <label>External Ping URL (optional)</label>
            <input
              type="url"
              value={watchdogEndpoint}
              onChange={(e) => setWatchdogEndpoint(e.target.value)}
              placeholder="https://healthchecks.io/ping/your-uuid"
              disabled={watchdogLoading}
            />
            <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>
              Optional: URL to ping for external monitoring (Uptime Robot, Healthchecks.io, etc.)
            </small>
          </div>
        </>
      )}
      
      <button 
        type="button" 
        className="btn btn-primary" 
        onClick={handleSaveWatchdogSettings}
        disabled={watchdogLoading}
      >
        {watchdogLoading ? 'Saving...' : 'Save Watchdog Settings'}
      </button>
    </CollapsibleSection>
  );
}

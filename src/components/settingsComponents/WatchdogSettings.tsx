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
      <p className="mb-4 text-sm text-fg-soft">
        Keep the application alive and monitor health status
      </p>
      
      <div className="mb-4 space-y-1">
        <label className="flex cursor-pointer items-center gap-2.5 py-1 text-sm text-fg-soft [&>input]:size-4 [&>input]:shrink-0 [&>input]:accent-accent">
          <input
            type="checkbox"
            checked={watchdogEnabled}
            onChange={(e) => setWatchdogEnabled(e.target.checked)}
            disabled={watchdogLoading}
          />
          <span className="select-none">Enable Watchdog</span>
        </label>
        <p className="text-xs text-muted">Periodically check application health and ping external services</p>
      </div>
      
      {watchdogEnabled && (
        <>
          <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
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
          
          <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
            <label>External Ping URL (optional)</label>
            <input
              type="url"
              value={watchdogEndpoint}
              onChange={(e) => setWatchdogEndpoint(e.target.value)}
              placeholder="https://healthchecks.io/ping/your-uuid"
              disabled={watchdogLoading}
            />
            <small className="mt-1.5 block text-xs text-muted">
              Optional: URL to ping for external monitoring (Uptime Robot, Healthchecks.io, etc.)
            </small>
          </div>
        </>
      )}
      
      <button 
        type="button" 
        className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong" 
        onClick={handleSaveWatchdogSettings}
        disabled={watchdogLoading}
      >
        {watchdogLoading ? 'Saving...' : 'Save Watchdog Settings'}
      </button>
    </CollapsibleSection>
  );
}

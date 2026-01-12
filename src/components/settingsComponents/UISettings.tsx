import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../../config/api';
import fetchWithRetry from '../../utils/fetchWithRetry';
import { useSettingsContext } from './SettingsContext';
import { CollapsibleSection } from './CollapsibleSection';

export function UISettings() {
  const { setToast } = useSettingsContext();
  const [hideBmc, setHideBmc] = useState(false);
  const [colorScheme, setColorScheme] = useState('cyan');
  const [uiLoading, setUiLoading] = useState(false);

  useEffect(() => {
    loadUiSettings();
  }, []);

  const loadUiSettings = async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.UI, { credentials: 'include' });
      const data = await response.json();
      if (data.success) {
        setHideBmc(data.hideBmc || false);
        setColorScheme(data.colorScheme || 'cyan');
      }
    } catch (error) {
      console.error('Failed to load UI settings:', error);
    }
  };

  const handleSaveUiSettings = async () => {
    setUiLoading(true);
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.UI, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hideBmc, colorScheme }),
        credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: 'UI settings saved!', type: 'success' });
      } else {
        setToast({ message: 'Failed to save UI settings', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to save UI settings', type: 'error' });
    } finally {
      setUiLoading(false);
    }
  };

  return (
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
          <option value="cyan">Cyan (Default)</option>
          <option value="purple">Purple</option>
          <option value="green">Green</option>
          <option value="orange">Orange</option>
          <option value="pink">Pink</option>
          <option value="blue">Blue</option>
        </select>
        <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>Choose your accent color throughout the app</small>
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
  );
}

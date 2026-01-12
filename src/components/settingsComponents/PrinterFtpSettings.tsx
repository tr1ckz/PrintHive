import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../../config/api';
import fetchWithRetry from '../../utils/fetchWithRetry';
import { useSettingsContext } from './SettingsContext';
import { CollapsibleSection } from './CollapsibleSection';

export function PrinterFtpSettings() {
  const { setToast } = useSettingsContext();
  const [printerIp, setPrinterIp] = useState('');
  const [printerAccessCode, setPrinterAccessCode] = useState('');
  const [cameraRtspUrl, setCameraRtspUrl] = useState('');
  const [ftpLoading, setFtpLoading] = useState(false);
  const [ftpTesting, setFtpTesting] = useState(false);

  useEffect(() => {
    loadPrinterSettings();
  }, []);

  const loadPrinterSettings = async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.PRINTER_FTP, { credentials: 'include' });
      const data = await response.json();
      if (data.success) {
        setPrinterIp(data.printerIp || '');
        setPrinterAccessCode(data.printerAccessCode || '');
        setCameraRtspUrl(data.cameraRtspUrl || '');
      }
    } catch (error) {
      console.error('Failed to load printer settings:', error);
    }
  };

  const handleSavePrinterSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setFtpLoading(true);
    
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.SAVE_PRINTER_FTP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printerIp, printerAccessCode, cameraRtspUrl }),
        credentials: 'include'
      });
      
      const data = await response.json();
      
      if (data.success) {
        setToast({ message: 'Printer settings saved successfully!', type: 'success' });
      } else {
        setToast({ message: data.error, type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to save printer settings', type: 'error' });
    } finally {
      setFtpLoading(false);
    }
  };

  const handleTestPrinterConnection = async () => {
    setFtpTesting(true);
    
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.TEST_PRINTER_FTP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printerIp, printerAccessCode }),
        credentials: 'include'
      });
      
      const data = await response.json();
      
      if (data.success) {
        setToast({ message: 'Printer connection successful!', type: 'success' });
      } else {
        setToast({ message: data.error || 'Connection test failed', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to test printer connection', type: 'error' });
    } finally {
      setFtpTesting(false);
    }
  };

  return (
    <CollapsibleSection title="Printer FTP Settings" icon="📡">
      <form onSubmit={handleSavePrinterSettings} className="printer-ftp-form">
        <p className="form-description">
          Configure your printer's local FTP connection to automatically download timelapse videos
        </p>
        
        <div className="form-group">
          <label>Printer IP Address</label>
          <input
            type="text"
            value={printerIp}
            onChange={(e) => setPrinterIp(e.target.value)}
            placeholder="192.168.x.x"
            disabled={ftpLoading || ftpTesting}
          />
        </div>
        
        <div className="form-group">
          <label>Access Code</label>
          <input
            type="text"
            value={printerAccessCode}
            onChange={(e) => setPrinterAccessCode(e.target.value)}
            placeholder="12345678"
            disabled={ftpLoading || ftpTesting}
          />
        </div>
        
        <div className="form-group">
          <label>Camera RTSP URL (Optional)</label>
          <input
            type="text"
            value={cameraRtspUrl}
            onChange={(e) => setCameraRtspUrl(e.target.value)}
            placeholder="rtsp://192.168.x.x:554/stream"
            disabled={ftpLoading || ftpTesting}
          />
          <small style={{ color: '#888', marginTop: '5px', display: 'block' }}>
            Enter the RTSP URL for your printer's camera feed. The camera will be displayed on the Printers page.<br/>
            Example: <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '4px' }}>rtsp://admin:password@192.168.1.100:554/stream1</code>
          </small>
        </div>
        
        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            type="submit" 
            className="btn btn-primary" 
            disabled={ftpLoading || ftpTesting}
          >
            {ftpLoading ? 'Saving...' : 'Save Settings'}
          </button>
          
          <button 
            type="button" 
            className="btn btn-secondary" 
            onClick={handleTestPrinterConnection}
            disabled={ftpLoading || ftpTesting}
          >
            {ftpTesting ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </form>
    </CollapsibleSection>
  );
}

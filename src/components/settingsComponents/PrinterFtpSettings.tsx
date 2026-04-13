import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../../config/api';
import fetchWithRetry from '../../utils/fetchWithRetry';
import { useSettingsContext } from './SettingsContext';
import { CollapsibleSection } from './CollapsibleSection';
import { useModal } from '../ModalProvider';

interface Printer {
  dev_id: string;
  name: string;
  ip_address: string;
  access_code: string;
  serial_number: string;
  camera_rtsp_url?: string;
}

interface PrinterFormData {
  dev_id: string;
  name: string;
  ip_address: string;
  access_code: string;
  serial_number: string;
  camera_rtsp_url: string;
}

const emptyPrinter: PrinterFormData = {
  dev_id: '',
  name: '',
  ip_address: '',
  access_code: '',
  serial_number: '',
  camera_rtsp_url: ''
};

export function PrinterFtpSettings() {
  const { setToast } = useSettingsContext();
  const { confirm } = useModal();
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [editingPrinter, setEditingPrinter] = useState<PrinterFormData | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [discoveringId, setDiscoveringId] = useState<string | null>(null);
  const [discoveryCidrs, setDiscoveryCidrs] = useState('');
  const [showAdvancedDiscovery, setShowAdvancedDiscovery] = useState(false);

  useEffect(() => {
    loadPrinters();
  }, []);

  const loadPrinters = async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.PRINTERS.CONFIG, { credentials: 'include' });
      const data = await response.json();
      if (data.success) {
        setPrinters(data.printers || []);
      }
    } catch (error) {
      console.error('Failed to load printers:', error);
    }
  };

  const handleSavePrinter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPrinter) return;
    
    setLoading(true);
    
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.PRINTERS.CONFIG, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dev_id: editingPrinter.dev_id || `manual_${Date.now()}`,
          name: editingPrinter.name,
          ip_address: editingPrinter.ip_address,
          access_code: editingPrinter.access_code,
          serial_number: editingPrinter.serial_number,
          camera_rtsp_url: editingPrinter.camera_rtsp_url.trim()
        }),
        credentials: 'include'
      });
      
      const data = await response.json();
      
      if (data.success) {
        setToast({ message: 'Printer saved successfully!', type: 'success' });
        setEditingPrinter(null);
        setIsAdding(false);
        loadPrinters();
      } else {
        setToast({ message: data.error, type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to save printer', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePrinter = (devId: string) => {
    confirm({
      title: 'Delete printer configuration?',
      message: 'This removes the saved local/FTP connection and any dedicated camera assignment for the selected printer.',
      confirmText: 'Delete',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          const response = await fetchWithRetry(API_ENDPOINTS.PRINTERS.CONFIG_DELETE(devId), {
            method: 'DELETE',
            credentials: 'include'
          });

          const data = await response.json();

          if (data.success) {
            setToast({ message: 'Printer deleted successfully!', type: 'success' });
            loadPrinters();
          } else {
            setToast({ message: data.error, type: 'error' });
          }
        } catch (error) {
          setToast({ message: 'Failed to delete printer', type: 'error' });
        }
      }
    });
  };

  const handleTestConnection = async (printer: Printer) => {
    setTestingId(printer.dev_id);
    
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.TEST_PRINTER_FTP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          printerIp: printer.ip_address, 
          printerAccessCode: printer.access_code 
        }),
        credentials: 'include'
      });
      
      const data = await response.json();
      
      if (data.success) {
        setToast({ message: `Connection to ${printer.name || printer.ip_address} successful!`, type: 'success' });
      } else {
        setToast({ message: data.error || 'Connection test failed', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to test printer connection', type: 'error' });
    } finally {
      setTestingId(null);
    }
  };

  const handleDiscoverIp = async (printer: Printer) => {
    setDiscoveringId(printer.dev_id);

    try {
      const response = await fetchWithRetry(API_ENDPOINTS.PRINTERS.DISCOVER_IP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dev_id: printer.dev_id,
          scanCidrs: discoveryCidrs
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        }),
        credentials: 'include'
      });

      const data = await response.json();

      if (data.success) {
        const ipMessage = data.discoveredIp ? ` ${data.discoveredIp}` : '';
        setToast({ message: `Discovered printer IP:${ipMessage}`.trim(), type: 'success' });
        await loadPrinters();
      } else {
        setToast({ message: data.error || 'Could not auto-discover printer IP', type: 'error' });
      }
    } catch (_error) {
      setToast({ message: 'Failed to run IP discovery', type: 'error' });
    } finally {
      setDiscoveringId(null);
    }
  };

  const startEditing = (printer: Printer) => {
    setEditingPrinter({
      dev_id: printer.dev_id,
      name: printer.name || '',
      ip_address: printer.ip_address || '',
      access_code: printer.access_code || '',
      serial_number: printer.serial_number || '',
      camera_rtsp_url: printer.camera_rtsp_url || ''
    });
    setIsAdding(false);
  };

  const startAdding = () => {
    setEditingPrinter({ ...emptyPrinter });
    setIsAdding(true);
  };

  const cancelEdit = () => {
    setEditingPrinter(null);
    setIsAdding(false);
  };

  return (
    <CollapsibleSection title="Local Printer / FTP" icon="📡" defaultExpanded={true}>
      <p className="form-description">
        Configure your printers' local FTP connections and optionally assign a dedicated RTSP camera to each printer.
      </p>

      {!editingPrinter && (
        <div style={{ marginBottom: '12px' }}>
          <small style={{ display: 'block', color: 'var(--text-secondary)' }}>
            Discover IP now auto-scans local interfaces, route-table networks, ARP neighbors, and remembered subnets.
          </small>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => setShowAdvancedDiscovery((prev) => !prev)}
            style={{ marginTop: '8px' }}
          >
            {showAdvancedDiscovery ? 'Hide Advanced Discovery' : 'Advanced Discovery'}
          </button>

          {showAdvancedDiscovery && (
            <div className="form-group" style={{ marginTop: '10px' }}>
              <label>Optional Extra CIDRs</label>
              <input
                type="text"
                value={discoveryCidrs}
                onChange={(event) => setDiscoveryCidrs(event.target.value)}
                placeholder="192.168.1.0/24, 10.20.30.0/24"
              />
              <small style={{ display: 'block', marginTop: '5px', color: 'var(--text-secondary)' }}>
                Only needed for unusual network layouts where automatic route and ARP discovery cannot reach the printer subnet.
              </small>
            </div>
          )}
        </div>
      )}

      {/* Printer Cards List */}
      {printers.length > 0 && !editingPrinter && (
        <div className="printer-cards-list">
          {printers.map((printer) => (
            <div key={printer.dev_id} className="printer-ftp-card">
              <div className="printer-ftp-card-header">
                <div className="printer-ftp-card-info">
                  <span className="printer-name">{printer.name || 'Unnamed Printer'}</span>
                  <span className="printer-ip">{printer.ip_address || 'No IP set'}</span>
                </div>
                <div className="printer-ftp-card-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleTestConnection(printer)}
                    disabled={testingId === printer.dev_id || !printer.ip_address}
                  >
                    {testingId === printer.dev_id ? 'Testing...' : 'Test'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleDiscoverIp(printer)}
                    disabled={discoveringId === printer.dev_id || !printer.access_code}
                    title={printer.access_code ? 'Auto-detect IP via MQTT probing' : 'Add access code to enable discovery'}
                  >
                    {discoveringId === printer.dev_id ? 'Discovering...' : 'Discover IP'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => startEditing(printer)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDeletePrinter(printer.dev_id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="printer-ftp-card-details">
                {printer.serial_number && (
                  <span className="printer-detail">
                    <strong>Serial:</strong> {printer.serial_number}
                  </span>
                )}
                <span className="printer-detail">
                  <strong>Camera:</strong> {printer.camera_rtsp_url ? 'Assigned RTSP camera' : 'Uses global camera fallback'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Printer Button */}
      {!editingPrinter && (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={startAdding}
          style={{ marginTop: printers.length > 0 ? '15px' : '0' }}
        >
          + Add Printer
        </button>
      )}

      {/* Edit/Add Form */}
      {editingPrinter && (
        <form onSubmit={handleSavePrinter} className="printer-ftp-form">
          <h4 style={{ marginBottom: '15px', color: 'var(--text-primary)' }}>
            {isAdding ? 'Add New Printer' : 'Edit Printer'}
          </h4>
          
          <div className="printer-ftp-form-grid">
            <div className="form-group">
              <label>Printer Name</label>
              <input
                type="text"
                value={editingPrinter.name}
                onChange={(e) => setEditingPrinter({ ...editingPrinter, name: e.target.value })}
                placeholder="My Bambu X1C"
                disabled={loading}
              />
            </div>
            
            <div className="form-group">
              <label>IP Address</label>
              <input
                type="text"
                value={editingPrinter.ip_address}
                onChange={(e) => setEditingPrinter({ ...editingPrinter, ip_address: e.target.value })}
                placeholder="192.168.x.x"
                disabled={loading}
              />
            </div>
            
            <div className="form-group">
              <label>Access Code</label>
              <input
                type="text"
                value={editingPrinter.access_code}
                onChange={(e) => setEditingPrinter({ ...editingPrinter, access_code: e.target.value })}
                placeholder="12345678"
                disabled={loading}
              />
            </div>
            
            <div className="form-group">
              <label>Serial Number</label>
              <input
                type="text"
                value={editingPrinter.serial_number}
                onChange={(e) => setEditingPrinter({ ...editingPrinter, serial_number: e.target.value })}
                placeholder="01S00A123456789"
                disabled={loading}
              />
              <small style={{ display: 'block', marginTop: '5px', color: 'var(--text-secondary)' }}>
                Required for OIDC users without Bambu Cloud account
              </small>
            </div>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Assigned Camera RTSP URL (optional)</label>
              <input
                type="text"
                value={editingPrinter.camera_rtsp_url}
                onChange={(e) => setEditingPrinter({ ...editingPrinter, camera_rtsp_url: e.target.value })}
                placeholder="rtsp://user:pass@camera-ip/stream1"
                disabled={loading}
              />
              <small style={{ display: 'block', marginTop: '5px', color: 'var(--text-secondary)' }}>
                Set a dedicated RTSP camera for this printer. If left blank, this printer falls back to the global camera integration.
              </small>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save Printer'}
            </button>
            
            <button 
              type="button" 
              className="btn btn-secondary" 
              onClick={cancelEdit}
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Empty State */}
      {printers.length === 0 && !editingPrinter && (
        <p style={{ color: 'var(--text-secondary)', marginTop: '10px' }}>
          No printers configured. Click "Add Printer" to add your first printer.
        </p>
      )}
    </CollapsibleSection>
  );
}

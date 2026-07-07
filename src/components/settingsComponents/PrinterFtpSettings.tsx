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
  const [discoveringMissing, setDiscoveringMissing] = useState(false);
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
        if (data.autoDiscovery?.success && data.autoDiscovery?.discoveredIp) {
          setToast({ message: `Printer saved. Auto-discovered IP ${data.autoDiscovery.discoveredIp}.`, type: 'success' });
        } else if (data.dev_id && editingPrinter.dev_id !== data.dev_id) {
          setToast({ message: 'Printer saved and matched to cloud printer identity.', type: 'success' });
        } else {
          setToast({ message: 'Printer saved successfully!', type: 'success' });
        }
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

  const handleDiscoverMissingIps = async () => {
    setDiscoveringMissing(true);

    try {
      const response = await fetchWithRetry(API_ENDPOINTS.PRINTERS.DISCOVER_MISSING_IPS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scanCidrs: discoveryCidrs
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        }),
        credentials: 'include'
      });

      const data = await response.json();
      if (data.success) {
        setToast({ message: `Manual discovery finished: ${data.foundCount}/${data.processedCount} resolved.`, type: 'success' });
        await loadPrinters();
      } else {
        setToast({ message: data.error || 'Manual discovery failed', type: 'error' });
      }
    } catch (_error) {
      setToast({ message: 'Failed to run manual discover', type: 'error' });
    } finally {
      setDiscoveringMissing(false);
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
{!editingPrinter && (
        <div className="mb-3 [&>button]:mr-2 [&>button]:mt-2">
          <small className="block text-xs text-muted">
            Discover IP now auto-scans local interfaces, route-table networks, ARP neighbors, and remembered subnets.
          </small>
          <small className="mt-1 block text-xs text-muted">
            New printers get one automatic discovery attempt on save. Use manual discover to retry later.
          </small>
          <button
            type="button"
            className="inline-flex min-h-9 items-center justify-center gap-1 rounded px-2.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong"
            onClick={handleDiscoverMissingIps}
            disabled={discoveringMissing}
          >
            {discoveringMissing ? 'Discovering Missing IPs...' : 'Manual Discover Missing IPs'}
          </button>
          <button
            type="button"
            className="inline-flex min-h-9 items-center justify-center gap-1 rounded px-2.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg"
            onClick={() => setShowAdvancedDiscovery((prev) => !prev)}
          >
            {showAdvancedDiscovery ? 'Hide Advanced Discovery' : 'Advanced Discovery'}
          </button>

          {showAdvancedDiscovery && (
            <div className="mt-2.5 mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
              <label>Optional Extra CIDRs</label>
              <input
                type="text"
                value={discoveryCidrs}
                onChange={(event) => setDiscoveryCidrs(event.target.value)}
                placeholder="192.168.1.0/24, 10.20.30.0/24"
              />
              <small className="mt-1.5 block text-xs text-muted">
                Only needed for unusual network layouts where automatic route and ARP discovery cannot reach the printer subnet.
              </small>
            </div>
          )}
        </div>
      )}

      {/* Printer Cards List */}
      {printers.length > 0 && !editingPrinter && (
        <div className="space-y-3">
          {printers.map((printer) => (
            <div key={printer.dev_id} className="rounded-lg bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-fg">{printer.name || 'Unnamed Printer'}</span>
                  <span className="text-xs tabular-nums text-muted">{printer.ip_address || 'No IP set'}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="inline-flex min-h-9 items-center justify-center gap-1 rounded px-2.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg"
                    onClick={() => handleTestConnection(printer)}
                    disabled={testingId === printer.dev_id || !printer.ip_address}
                  >
                    {testingId === printer.dev_id ? 'Testing...' : 'Test'}
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-9 items-center justify-center gap-1 rounded px-2.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg"
                    onClick={() => handleDiscoverIp(printer)}
                    disabled={discoveringId === printer.dev_id}
                    title="Auto-detect IP via cloud + local MQTT credentials"
                  >
                    {discoveringId === printer.dev_id ? 'Discovering...' : 'Discover IP'}
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-9 items-center justify-center gap-1 rounded px-2.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong"
                    onClick={() => startEditing(printer)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-9 items-center justify-center gap-1 rounded px-2.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-danger/15 text-danger hover:bg-danger/25"
                    onClick={() => handleDeletePrinter(printer.dev_id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5">
                {printer.serial_number && (
                  <span className="text-xs text-muted [&>strong]:font-medium [&>strong]:text-fg-soft">
                    <strong>Serial:</strong> {printer.serial_number}
                  </span>
                )}
                <span className="text-xs text-muted [&>strong]:font-medium [&>strong]:text-fg-soft">
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
          className="inline-flex min-h-9 items-center justify-center gap-1 rounded px-2.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong"
          onClick={startAdding}
        >
          + Add Printer
        </button>
      )}

      {/* Edit/Add Form */}
      {editingPrinter && (
        <form onSubmit={handleSavePrinter} className="mt-2 rounded-lg bg-white/[0.03] p-4">
          <h4 className="mb-4 text-sm font-semibold text-fg">
            {isAdding ? 'Add New Printer' : 'Edit Printer'}
          </h4>
          
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
              <label>Printer Name</label>
              <input
                type="text"
                value={editingPrinter.name}
                onChange={(e) => setEditingPrinter({ ...editingPrinter, name: e.target.value })}
                placeholder="My Bambu X1C"
                disabled={loading}
              />
            </div>
            
            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
              <label>IP Address</label>
              <input
                type="text"
                value={editingPrinter.ip_address}
                onChange={(e) => setEditingPrinter({ ...editingPrinter, ip_address: e.target.value })}
                placeholder="192.168.x.x"
                disabled={loading}
              />
            </div>
            
            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
              <label>Access Code</label>
              <input
                type="text"
                value={editingPrinter.access_code}
                onChange={(e) => setEditingPrinter({ ...editingPrinter, access_code: e.target.value })}
                placeholder="12345678"
                disabled={loading}
              />
            </div>
            
            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
              <label>Serial Number</label>
              <input
                type="text"
                value={editingPrinter.serial_number}
                onChange={(e) => setEditingPrinter({ ...editingPrinter, serial_number: e.target.value })}
                placeholder="01S00A123456789"
                disabled={loading}
              />
              <small className="mt-1.5 block text-xs text-muted">
                Required for OIDC users without Bambu Cloud account
              </small>
            </div>

            <div className="sm:col-span-2 mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
              <label>Assigned Camera RTSP URL (optional)</label>
              <input
                type="text"
                value={editingPrinter.camera_rtsp_url}
                onChange={(e) => setEditingPrinter({ ...editingPrinter, camera_rtsp_url: e.target.value })}
                placeholder="rtsp://user:pass@camera-ip/stream1"
                disabled={loading}
              />
              <small className="mt-1.5 block text-xs text-muted">
                Set a dedicated RTSP camera for this printer. If left blank, this printer falls back to the global camera integration.
              </small>
            </div>
          </div>
          
          <div className="mt-4 flex flex-wrap gap-2.5">
            <button 
              type="submit" 
              className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong" 
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save Printer'}
            </button>
            
            <button 
              type="button" 
              className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg" 
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
        <p className="mt-2.5 text-sm text-muted">
          No printers configured. Click "Add Printer" to add your first printer.
        </p>
      )}
    </CollapsibleSection>
  );
}

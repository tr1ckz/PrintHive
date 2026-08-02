import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Toast from './Toast';
import LoadingScreen from './LoadingScreen';
import Spinner from './Spinner';
import Modal from './common/Modal';
import { useDebounce } from '../hooks/useDebounce';
import { useEscapeKey } from '../hooks/useKeyboardShortcut';
import { API_ENDPOINTS } from '../config/api';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { formatDuration, formatWeight } from '../utils/formatters';
import { exportToCSV } from '../utils/csvExport';
import { useRealtimeTick } from '../hooks/useRealtimeTick';
interface Print {
  id: number;
  modelId: string;
  title: string;
  designId: string;
  designTitle: string;
  deviceId: string;
  deviceName: string;
  status: string;
  startTime: string;
  endTime: string;
  weight: number;
  length: number;
  costTime: number;
  profileName: string;
  plateType: string;
  coverUrl: string;
  files: string[];
  has3mf: boolean;
  hasVideo: boolean;
  material?: string;
  estimatedCost?: number;
}

const ITEMS_PER_PAGE = 12;

const getPrintStatus = (status: string | number) => {
  const statusNum = typeof status === 'string' ? Number.parseInt(status, 10) : status;
  const statusClassName =
    statusNum === 2 ? 'success' :
    statusNum === 3 ? 'failed' :
    (statusNum === 1 || statusNum === 4) ? 'running' : 'idle';

  const statusDisplay =
    statusClassName === 'success' ? '✓ SUCCESS' :
    statusClassName === 'failed' ? '✕ FAILED' :
    statusClassName === 'running' ? '▶ RUNNING' : '⏸ IDLE';

  return { statusClassName, statusDisplay };
};

const PrintHistory: React.FC = () => {
  const [allPrints, setAllPrints] = useState<Print[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [printerFilter, setPrinterFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const [syncingPrinter, setSyncingPrinter] = useState(false);
  const [syncingSdCard, setSyncingSdCard] = useState(false);
  const [showPrinterSync, setShowPrinterSync] = useState(false);
  const [showSdCardSync, setShowSdCardSync] = useState(false);
  const [printerIp, setPrinterIp] = useState('');
  const [printerAccessCode, setPrinterAccessCode] = useState('');
  const [matching, setMatching] = useState(false);
  const [matchProgress, setMatchProgress] = useState<{
    running: boolean;
    total: number;
    processed: number;
    matched: number;
    unmatched: number;
    currentVideo: string;
    percentComplete: number;
  } | null>(null);
  const [videoModal, setVideoModal] = useState<{ modelId: string; title: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Keyboard shortcuts
  useEscapeKey(!!videoModal, () => setVideoModal(null));
  useEscapeKey(showPrinterSync, () => setShowPrinterSync(false));
  useEscapeKey(showSdCardSync, () => setShowSdCardSync(false));

  const prints = useMemo(() => {
    let filtered = allPrints;

    if (printerFilter !== 'all') {
      filtered = filtered.filter((print) => print.deviceId === printerFilter);
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter((print) => {
        const normalizedStatus = String(print.status).toLowerCase();
        if (statusFilter === 'success') return normalizedStatus === 'success' || String(print.status) === '2';
        if (statusFilter === 'failed') return normalizedStatus === 'failed' || String(print.status) === '3';
        return true;
      });
    }

    if (debouncedSearchTerm.trim()) {
      const search = debouncedSearchTerm.toLowerCase();
      filtered = filtered.filter((print) =>
        print.title?.toLowerCase().includes(search) ||
        print.designTitle?.toLowerCase().includes(search) ||
        print.deviceName?.toLowerCase().includes(search) ||
        print.profileName?.toLowerCase().includes(search)
      );
    }

    return filtered;
  }, [allPrints, printerFilter, statusFilter, debouncedSearchTerm]);

  const printerOptions = useMemo(() => {
    const printerMap = new Map<string, string>();

    allPrints.forEach((print) => {
      if (print.deviceId && !printerMap.has(print.deviceId)) {
        printerMap.set(print.deviceId, print.deviceName || print.deviceId);
      }
    });

    return Array.from(printerMap.entries()).map(([id, label]) => ({ id, label }));
  }, [allPrints]);

  const handleExportCSV = useCallback(() => {
    exportToCSV(
      prints,
      [
        { header: 'Title', accessor: 'title' },
        { header: 'Design', accessor: 'designTitle' },
        { header: 'Printer', accessor: 'deviceName' },
        { header: 'Status', accessor: 'status' },
        { header: 'Start Time', accessor: (row) => new Date(row.startTime).toLocaleString() },
        { header: 'End Time', accessor: (row) => row.endTime ? new Date(row.endTime).toLocaleString() : 'N/A' },
        { header: 'Duration', accessor: (row) => formatDuration(row.costTime) },
        { header: 'Weight (g)', accessor: (row) => row.weight ? formatWeight(row.weight) : 'N/A' },
        { header: 'Material', accessor: (row) => row.material || 'N/A' },
        { header: 'Profile', accessor: 'profileName' },
        { header: 'Plate Type', accessor: 'plateType' },
        { header: 'Has Video', accessor: (row) => row.hasVideo ? 'Yes' : 'No' },
      ],
      'print-history'
    );
    setToast({ message: 'Print history exported to CSV', type: 'success' });
  }, [prints]);

  const fetchPrints = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      
      const params = new URLSearchParams({ source: 'db' });

      const response = await fetchWithRetry(`${API_ENDPOINTS.MODELS.LIST}?${params.toString()}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch prints');
      
      const data = await response.json();
      const fetchedPrints = data.hits || data.models || [];
      setAllPrints(fetchedPrints);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load print history');
    } finally {
      setLoading(false);
    }
  }, []);

  useRealtimeTick(() => {
    void fetchPrints();
  }, { minIntervalMs: 10000 });

  const handleSync = async () => {
    try {
      setSyncing(true);
      const response = await fetchWithRetry(API_ENDPOINTS.SYNC.CLOUD, { method: 'POST', credentials: 'include' });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || data?.message || 'Failed to sync');
      }

      if (data.queued) {
        setToast({ message: 'Cloud sync started in background. Track progress in Background Jobs.', type: 'success' });
        return;
      }

      setToast({ message: `Synced ${data.newPrints || 0} new prints, ${data.updated || 0} updated\nDownloaded ${data.downloadedCovers || 0} covers and ${data.downloadedVideos || 0} timelapses`, type: 'success' });
      void fetchPrints();
    } catch (err) {
      setToast({ message: 'Sync failed: ' + (err instanceof Error ? err.message : 'Unknown error'), type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  const handleMatchVideos = async () => {
    try {
      setMatching(true);
      const response = await fetchWithRetry(API_ENDPOINTS.VIDEO.MATCH, { method: 'POST', credentials: 'include' });
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to match videos');
      }
      
      if (data.success) {
        setToast({ message: 'Video matching started! Processing in background...', type: 'success' });
        
        // Start polling for progress
        const pollProgress = async () => {
          try {
            const statusResponse = await fetchWithRetry(API_ENDPOINTS.VIDEO.MATCH_STATUS, { credentials: 'include' });
            const status = await statusResponse.json();
            
            setMatchProgress(status);
            
            if (status.running) {
              setTimeout(pollProgress, 1000);
            } else {
              setMatching(false);
              setMatchProgress(null);
              
              if (status.matched > 0) {
                setToast({ 
                  message: `✓ Matched ${status.matched} videos to prints${status.unmatched > 0 ? `, ${status.unmatched} unmatched` : ''}`, 
                  type: 'success' 
                });
              } else if (status.total === 0) {
                setToast({ message: 'No video files found in data/videos', type: 'error' });
              } else {
                setToast({ message: `No matches found. ${status.unmatched} videos had no matching prints.`, type: 'error' });
              }
              void fetchPrints();
            }
          } catch (err) {
            console.error('Error polling match status:', err);
            setMatching(false);
            setMatchProgress(null);
          }
        };
        
        pollProgress();
      } else {
        throw new Error(data.message || 'Failed to start video matching');
      }
    } catch (err) {
      setToast({ message: 'Matching failed: ' + (err instanceof Error ? err.message : 'Unknown error'), type: 'error' });
      setMatching(false);
      setMatchProgress(null);
    }
  };

  const handleCancelMatch = async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.VIDEO.MATCH_CANCEL, { method: 'POST', credentials: 'include' });
      const data = await response.json();
      if (data.success) {
        setToast({ message: 'Video matching cancelled', type: 'success' });
      }
    } catch (err) {
      console.error('Error cancelling match:', err);
    }
  };

  const handlePrinterSync = async () => {
    if (!printerIp || !printerAccessCode) {
      setToast({ message: 'Please enter printer IP and access code', type: 'error' });
      return;
    }

    try {
      setSyncingPrinter(true);
      const response = await fetchWithRetry(API_ENDPOINTS.SYNC.PRINTER_TIMELAPSES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printerIp, accessCode: printerAccessCode })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setToast({ message: `Printer sync failed:\n${data.error}\n\n${data.details || ''}\n${data.hint || ''}`, type: 'error' });
        return;
      }

      if (data.queued) {
        setToast({
          message: '✓ Printer timelapse sync started in background. Track progress in Background Jobs.',
          type: 'success'
        });
        setShowPrinterSync(false);
        return;
      }
      
      setToast({ message: `✓ Downloaded ${data.downloaded} timelapses from printer:\n${data.files?.slice(0, 10).join('\n')}${data.files?.length > 10 ? '\n...' : ''}`, type: 'success' });
      setShowPrinterSync(false);
    } catch (err) {
      setToast({ message: 'Printer sync failed: ' + (err instanceof Error ? err.message : 'Unknown error'), type: 'error' });
    } finally {
      setSyncingPrinter(false);
    }
  };

  const handleSdCardSync = async () => {
    if (!printerIp || !printerAccessCode) {
      setToast({ message: 'Please enter printer IP and access code', type: 'error' });
      return;
    }

    try {
      setSyncingSdCard(true);
      const response = await fetchWithRetry('/api/sync-sd-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ printerIp, accessCode: printerAccessCode })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setToast({ message: `SD card sync failed:\n${data.error}\n\n${data.details || ''}\n${data.hint || ''}`, type: 'error' });
        return;
      }

      if (data.queued) {
        setToast({
          message: '✓ SD card sync started in background. Track progress in Background Jobs.',
          type: 'success'
        });
        setShowSdCardSync(false);
        return;
      }
      
      setToast({ 
        message: `✓ Scanned ${data.scanned} files on SD card\n✓ Added ${data.added} new prints to history:\n${data.files?.slice(0, 10).join('\n')}${data.files?.length > 10 ? '\n...' : ''}`, 
        type: 'success' 
      });
      setShowSdCardSync(false);
      void fetchPrints(); // Refresh the print list
    } catch (err) {
      setToast({ message: 'SD card sync failed: ' + (err instanceof Error ? err.message : 'Unknown error'), type: 'error' });
    } finally {
      setSyncingSdCard(false);
    }
  };

  const openSdCardSyncModal = async () => {
    // Pre-fill with printer settings if available
    try {
      const response = await fetchWithRetry('/api/printers', { credentials: 'include' });
      const data = await response.json();
      
      // Find first printer with IP and access code
      const printer = data.devices?.find((p: any) => p.ip_address && p.access_code);
      if (printer) {
        setPrinterIp(printer.ip_address);
        setPrinterAccessCode(printer.access_code);
      } else {
        // Try to get from global config
        const configResponse = await fetchWithRetry('/api/printers/config', { credentials: 'include' });
        const configData = await configResponse.json();
        if (configData.printers?.length > 0) {
          const firstPrinter = configData.printers[0];
          if (firstPrinter.ip_address) setPrinterIp(firstPrinter.ip_address);
          if (firstPrinter.access_code) setPrinterAccessCode(firstPrinter.access_code);
        }
      }
    } catch (err) {
      console.log('Could not pre-fill printer settings:', err);
    }
    setShowSdCardSync(true);
  };

  const handleDownload = async (modelId: string, title: string) => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.PRINTERS.DOWNLOAD(modelId), { credentials: 'include' });
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/[^a-z0-9]/gi, '_')}.3mf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setToast({ message: 'Download failed: ' + (err instanceof Error ? err.message : 'Unknown error'), type: 'error' });
    }
  };

  const handleViewVideo = (modelId: string, title: string) => {
    setVideoModal({ modelId, title });
  };

  const handleCloseVideo = () => {
    setVideoModal(null);
  };

  const handleShareVideo = async () => {
    if (!videoModal) return;
    
    const videoUrl = `${window.location.origin}/api/timelapse/${videoModal.modelId}`;
    
    // Try native share API first (mobile/some browsers)
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Timelapse: ${videoModal.title}`,
          text: `Check out this 3D print timelapse!`,
          url: videoUrl
        });
        return;
      } catch (err) {
        // User cancelled or share failed, fall through to clipboard
      }
    }
    
    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(videoUrl);
      setToast({ message: 'Video link copied to clipboard!', type: 'success' });
    } catch (err) {
      // Final fallback: show the URL
      prompt('Copy this video link:', videoUrl);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchTerm, statusFilter, printerFilter]);

  useEffect(() => {
    const nextTotalPages = Math.ceil(prints.length / ITEMS_PER_PAGE);
    if (nextTotalPages === 0) {
      setCurrentPage(1);
      return;
    }

    setCurrentPage((prevPage) => Math.min(prevPage, nextTotalPages));
  }, [prints.length]);

  const totalPages = Math.ceil(prints.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedPrints = useMemo(
    () => prints.slice(startIndex, startIndex + ITEMS_PER_PAGE),
    [prints, startIndex]
  );

  useEffect(() => {
    void fetchPrints();
  }, [fetchPrints]);

  if (loading) {
    return <LoadingScreen message="Loading print history..." />;
  }

  if (error) {
    return <div className="rounded-md bg-danger/10 p-4 text-sm text-danger">{error}</div>;
  }

  return (
    <div className="space-y-5">
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
      
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>{prints.length} prints in database</span>
          {printerOptions.length > 0 ? <span>{printerOptions.length} printer{printerOptions.length === 1 ? '' : 's'}</span> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleExportCSV} className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg" disabled={prints.length === 0}>
            <span>📊</span> Export CSV
          </button>
          {!matchProgress ? (
            <button onClick={handleMatchVideos} className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg" disabled={matching}>
              <span>{matching ? '⏳' : '🔗'}</span> {matching ? 'Starting...' : 'Match Videos'}
            </button>
          ) : (
            <button onClick={handleCancelMatch} className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-danger/15 text-danger hover:bg-danger/25">
              <span>✕</span> Cancel
            </button>
          )}
          <button onClick={openSdCardSyncModal} className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg" title="Sync SD card files to print history">
            <span>💾</span> Sync SD Card
          </button>
          <button onClick={handleSync} className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg" disabled={syncing}>
            {syncing ? (
              <>
                <Spinner size="small" color="currentColor" /> Syncing...
              </>
            ) : (
              <>
                <span>🔄</span> Sync Cloud
              </>
            )}
          </button>
        </div>
      </div>

      {matchProgress && (
        <div className="rounded-lg bg-card p-4 shadow-sm space-y-2">
          <div className="flex items-baseline justify-between gap-3 text-sm [&>span:first-child]:font-medium [&>span:first-child]:text-fg [&>span:last-child]:text-xs [&>span:last-child]:tabular-nums [&>span:last-child]:text-muted">
            <span>🔗 Matching videos to prints...</span>
            <span>{matchProgress.processed}/{matchProgress.total} ({matchProgress.percentComplete}%)</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/8">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${matchProgress.percentComplete}%` }} />
          </div>
          {matchProgress.currentVideo && (
            <div className="truncate text-xs text-fg-faint">
              Current: {matchProgress.currentVideo.substring(0, 50)}{matchProgress.currentVideo.length > 50 ? '...' : ''}
            </div>
          )}
          <div className="text-xs tabular-nums text-muted">
            ✓ {matchProgress.matched} matched | ✗ {matchProgress.unmatched} unmatched
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          placeholder="Search by title, design, or printer..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="min-h-11 md:min-h-10 flex-1"
        />
        {printerOptions.length > 1 && (
          <select value={printerFilter} onChange={(e) => setPrinterFilter(e.target.value)} className="min-h-11 md:min-h-10 sm:w-44">
            <option value="all">All Printers</option>
            {printerOptions.map((printer) => (
              <option key={printer.id} value={printer.id}>
                {printer.label}
              </option>
            ))}
          </select>
        )}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="min-h-11 md:min-h-10 sm:w-44">
          <option value="all">All Status</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {prints.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted [&>h3]:text-base [&>h3]:font-semibold [&>h3]:text-fg [&>p]:text-sm [&>p]:text-muted">
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2"/>
            <line x1="9" y1="9" x2="15" y2="15" strokeWidth="2"/>
            <line x1="15" y1="9" x2="9" y2="15" strokeWidth="2"/>
          </svg>
          <h3>No prints found</h3>
          <p>Try adjusting your search or sync with the printer</p>
        </div>
      ) : (
        <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {paginatedPrints.map((print) => {
            const { statusClassName, statusDisplay } = getPrintStatus(print.status);

            return (
              <div key={print.id} className="group flex flex-col overflow-hidden rounded-lg bg-card shadow-sm transition-[background-color,box-shadow] duration-200 hover:bg-surface-2 hover:shadow-md">
                <div className="relative aspect-video w-full overflow-hidden bg-white/[0.03] [&>img]:h-full [&>img]:w-full [&>img]:object-cover">
                  {print.coverUrl ? (
                    <img 
                      src={print.coverUrl} 
                      alt={print.title} 
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted">No Image</div>
                  )}
                  {/* No backdrop-blur here: this pill renders once per history
                      card, and each blurred element is its own render surface
                      that re-samples the cover art behind it on every scroll.
                      A denser tint reads the same over a photo for free. */}
                  <div className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${statusClassName === 'success' ? 'bg-success/30 text-success' : statusClassName === 'failed' ? 'bg-danger/30 text-danger' : 'bg-white/25 text-fg'}`}>
                    {statusDisplay}
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4 [&>h3]:truncate [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg">
                  <h3>{print.designTitle || 'Untitled'}</h3>
                  <p className="truncate text-xs text-muted">{print.title}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <div className="min-w-0">
                      <span className="block text-[10px] uppercase tracking-wider text-muted">Printer</span>
                      <span className="block truncate text-xs font-medium tabular-nums text-fg-soft">{print.deviceName}</span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[10px] uppercase tracking-wider text-muted">Duration</span>
                      <span className="block truncate text-xs font-medium tabular-nums text-fg-soft">{formatDuration(print.costTime || 0)}</span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[10px] uppercase tracking-wider text-muted">Weight</span>
                      <span className="block truncate text-xs font-medium tabular-nums text-fg-soft">{(print.weight || 0).toFixed(1)}g</span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[10px] uppercase tracking-wider text-muted">Cost</span>
                      <span className="block truncate text-xs font-medium tabular-nums text-fg-soft">
                        {print.estimatedCost !== undefined && print.estimatedCost > 0
                          ? `$${print.estimatedCost.toFixed(2)}`
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[10px] uppercase tracking-wider text-muted">Started</span>
                      <span className="block truncate text-xs font-medium tabular-nums text-fg-soft">{print.startTime ? new Date(print.startTime).toLocaleString() : 'N/A'}</span>
                    </div>
                  </div>
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    {print.has3mf && (
                      <button onClick={() => handleDownload(print.modelId, print.title)} className="inline-flex min-h-9 flex-1 items-center justify-center gap-1 rounded bg-white/5 px-2 text-xs font-medium text-fg-soft transition-colors hover:bg-white/10 hover:text-fg">
                        <span>⬇</span> Download 3MF
                      </button>
                    )}
                    {print.hasVideo && (
                      <button onClick={() => handleViewVideo(print.modelId, print.title)} className="inline-flex min-h-9 flex-1 items-center justify-center gap-1 rounded bg-accent/10 px-2 text-xs font-medium text-accent transition-colors hover:bg-accent/20">
                        <span>▶️</span> View Video
                      </button>
                    )}
                    {!print.has3mf && !print.hasVideo && (
                      <span className="text-xs text-muted">No files available</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button 
              className="inline-flex min-h-11 md:min-h-9 min-w-11 md:min-w-9 items-center justify-center rounded-md bg-white/5 text-sm text-fg-soft transition-colors hover:bg-white/10 disabled:opacity-40" 
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
            >
              «
            </button>
            <button 
              className="inline-flex min-h-11 md:min-h-9 min-w-11 md:min-w-9 items-center justify-center rounded-md bg-white/5 text-sm text-fg-soft transition-colors hover:bg-white/10 disabled:opacity-40" 
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              ‹
            </button>
            
            <div className="flex items-baseline gap-1.5 text-xs tabular-nums text-muted">
              Page {currentPage} of {totalPages}
              <span className="text-fg-faint">({prints.length} prints)</span>
            </div>
            
            <button 
              className="inline-flex min-h-11 md:min-h-9 min-w-11 md:min-w-9 items-center justify-center rounded-md bg-white/5 text-sm text-fg-soft transition-colors hover:bg-white/10 disabled:opacity-40" 
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              ›
            </button>
            <button 
              className="inline-flex min-h-11 md:min-h-9 min-w-11 md:min-w-9 items-center justify-center rounded-md bg-white/5 text-sm text-fg-soft transition-colors hover:bg-white/10 disabled:opacity-40" 
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              »
            </button>
          </div>
        )}
        </>
      )}

      {/* SD Card Sync Modal */}
      {showSdCardSync && (
        <Modal title="Sync SD Card Files" onClose={() => setShowSdCardSync(false)}>
              <p className="text-sm text-fg-soft">
                This will scan your printer's SD card for gcode/3mf files and add any prints not already in your history.
              </p>
              <div className="mt-4 space-y-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted">
                <label>Printer IP Address</label>
                <input
                  type="text"
                  placeholder="192.168.1.100"
                  value={printerIp}
                  onChange={(e) => setPrinterIp(e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="mt-4 space-y-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted">
                <label>Access Code</label>
                <input
                  type="password"
                  placeholder="12345678"
                  value={printerAccessCode}
                  onChange={(e) => setPrinterAccessCode(e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => setShowSdCardSync(false)} className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg">
                  Cancel
                </button>
                <button
                  onClick={handleSdCardSync}
                  disabled={syncingSdCard || !printerIp || !printerAccessCode}
                  className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong"
                >
                  {syncingSdCard ? 'Syncing...' : 'Sync SD Card'}
                </button>
              </div>
        </Modal>
      )}

      {/* Video Modal */}
      {videoModal && (
        <Modal title={videoModal.title} onClose={handleCloseVideo} contentClassName="sm:max-w-3xl">
              <div className="mb-3 flex justify-end">
                <button
                  onClick={handleShareVideo}
                  className="inline-flex min-h-11 md:min-h-9 items-center gap-1.5 rounded-md bg-white/5 px-3 text-sm font-semibold text-fg-soft transition-colors hover:bg-white/10 hover:text-fg"
                  title="Share video"
                >
                  <span>🔗</span> Share
                </button>
              </div>
              <video
                controls
                autoPlay
                src={`/api/timelapse/${videoModal.modelId}`}
                className="aspect-video w-full rounded-md bg-black"
              >
                Your browser does not support the video tag.
              </video>
      </Modal>
      )}
    </div>
  );
};

export default PrintHistory;

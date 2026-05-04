import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './PrintHistory.css';
import Toast from './Toast';
import LoadingScreen from './LoadingScreen';
import Spinner from './Spinner';
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
    return <div className="error-container">{error}</div>;
  }

  return (
    <div className="print-history-container">
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
      
      <div className="page-header">
        <div className="history-inline-summary">
          <span>{prints.length} prints in database</span>
          {printerOptions.length > 0 ? <span>{printerOptions.length} printer{printerOptions.length === 1 ? '' : 's'}</span> : null}
        </div>
        <div className="header-actions">
          <button onClick={handleExportCSV} className="btn-export" disabled={prints.length === 0}>
            <span>📊</span> Export CSV
          </button>
          {!matchProgress ? (
            <button onClick={handleMatchVideos} className="btn-match" disabled={matching}>
              <span>{matching ? '⏳' : '🔗'}</span> {matching ? 'Starting...' : 'Match Videos'}
            </button>
          ) : (
            <button onClick={handleCancelMatch} className="btn-match cancel">
              <span>✕</span> Cancel
            </button>
          )}
          <button onClick={openSdCardSyncModal} className="btn-sync" title="Sync SD card files to print history">
            <span>💾</span> Sync SD Card
          </button>
          <button onClick={handleSync} className="btn-sync" disabled={syncing}>
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
        <div className="background-job-progress">
          <div className="progress-header">
            <span>🔗 Matching videos to prints...</span>
            <span>{matchProgress.processed}/{matchProgress.total} ({matchProgress.percentComplete}%)</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${matchProgress.percentComplete}%` }} />
          </div>
          {matchProgress.currentVideo && (
            <div className="progress-current">
              Current: {matchProgress.currentVideo.substring(0, 50)}{matchProgress.currentVideo.length > 50 ? '...' : ''}
            </div>
          )}
          <div className="progress-stats">
            ✓ {matchProgress.matched} matched | ✗ {matchProgress.unmatched} unmatched
          </div>
        </div>
      )}
      <div className="controls">
        <input
          type="text"
          placeholder="Search by title, design, or printer..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        {printerOptions.length > 1 && (
          <select value={printerFilter} onChange={(e) => setPrinterFilter(e.target.value)} className="status-filter">
            <option value="all">All Printers</option>
            {printerOptions.map((printer) => (
              <option key={printer.id} value={printer.id}>
                {printer.label}
              </option>
            ))}
          </select>
        )}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="status-filter">
          <option value="all">All Status</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {prints.length === 0 ? (
        <div className="empty-state">
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
        <div className="prints-grid">
          {paginatedPrints.map((print) => {
            const { statusClassName, statusDisplay } = getPrintStatus(print.status);

            return (
              <div key={print.id} className="print-card">
                <div className="print-image">
                  {print.coverUrl ? (
                    <img 
                      src={print.coverUrl} 
                      alt={print.title} 
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="no-image">No Image</div>
                  )}
                  <div className={`status-overlay status-${statusClassName}`}>
                    {statusDisplay}
                  </div>
                </div>
                <div className="print-info">
                  <h3>{print.designTitle || 'Untitled'}</h3>
                  <p className="design-title">{print.title}</p>
                  <div className="print-meta">
                    <div className="meta-item">
                      <span className="meta-label">Printer</span>
                      <span className="meta-value">{print.deviceName}</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">Duration</span>
                      <span className="meta-value">{formatDuration(print.costTime || 0)}</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">Weight</span>
                      <span className="meta-value">{(print.weight || 0).toFixed(1)}g</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">Cost</span>
                      <span className="meta-value">
                        {print.estimatedCost !== undefined && print.estimatedCost > 0
                          ? `$${print.estimatedCost.toFixed(2)}`
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">Started</span>
                      <span className="meta-value">{print.startTime ? new Date(print.startTime).toLocaleString() : 'N/A'}</span>
                    </div>
                  </div>
                  <div className="print-actions">
                    {print.has3mf && (
                      <button onClick={() => handleDownload(print.modelId, print.title)} className="btn-download">
                        <span>⬇</span> Download 3MF
                      </button>
                    )}
                    {print.hasVideo && (
                      <button onClick={() => handleViewVideo(print.modelId, print.title)} className="btn-view-video">
                        <span>▶️</span> View Video
                      </button>
                    )}
                    {!print.has3mf && !print.hasVideo && (
                      <span className="no-files-text">No files available</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="pagination">
            <button 
              className="pagination-btn" 
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
            >
              «
            </button>
            <button 
              className="pagination-btn" 
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              ‹
            </button>
            
            <div className="pagination-info">
              Page {currentPage} of {totalPages}
              <span className="pagination-total">({prints.length} prints)</span>
            </div>
            
            <button 
              className="pagination-btn" 
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              ›
            </button>
            <button 
              className="pagination-btn" 
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
        <div className="video-modal-overlay" onClick={() => setShowSdCardSync(false)}>
          <div className="video-modal-content sd-card-modal" onClick={(e) => e.stopPropagation()}>
            <div className="video-modal-header">
              <h2>Sync SD Card Files</h2>
              <button onClick={() => setShowSdCardSync(false)} className="btn-modal-close" title="Close">
                <span>✕</span>
              </button>
            </div>
            <div className="video-modal-body sd-card-modal-body">
              <p className="sd-card-description">
                This will scan your printer's SD card for gcode/3mf files and add any prints not already in your history.
              </p>
              <div className="sd-card-field">
                <label>Printer IP Address</label>
                <input
                  type="text"
                  placeholder="192.168.1.100"
                  value={printerIp}
                  onChange={(e) => setPrinterIp(e.target.value)}
                  className="sd-card-input"
                />
              </div>
              <div className="sd-card-field">
                <label>Access Code</label>
                <input
                  type="password"
                  placeholder="12345678"
                  value={printerAccessCode}
                  onChange={(e) => setPrinterAccessCode(e.target.value)}
                  className="sd-card-input"
                />
              </div>
              <div className="sd-card-actions">
                <button onClick={() => setShowSdCardSync(false)} className="btn-cancel">
                  Cancel
                </button>
                <button
                  onClick={handleSdCardSync}
                  disabled={syncingSdCard || !printerIp || !printerAccessCode}
                  className="btn-primary"
                >
                  {syncingSdCard ? 'Syncing...' : 'Sync SD Card'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Video Modal */}
      {videoModal && (
        <div className="video-modal-overlay" onClick={handleCloseVideo}>
          <div className="video-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="video-modal-header">
              <h2>{videoModal.title}</h2>
              <div className="video-modal-actions">
                <button onClick={handleShareVideo} className="btn-modal-share" title="Share video">
                  <span>🔗</span> Share
                </button>
                <button onClick={handleCloseVideo} className="btn-modal-close" title="Close">
                  <span>✕</span>
                </button>
              </div>
            </div>
            <div className="video-modal-body">
              <video 
                controls 
                autoPlay 
                src={`/api/timelapse/${videoModal.modelId}`}
                style={{ width: '100%', height: '100%', backgroundColor: '#000' }}
              >
                Your browser does not support the video tag.
              </video>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PrintHistory;

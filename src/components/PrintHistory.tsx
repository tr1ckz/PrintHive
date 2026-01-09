import React, { useState, useEffect } from 'react';
import './PrintHistory.css';
import Toast from './Toast';
import LoadingScreen from './LoadingScreen';
import { useDebounce } from '../hooks/useDebounce';
import { useEscapeKey } from '../hooks/useKeyboardShortcut';
import { API_ENDPOINTS } from '../config/api';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { formatDuration, formatWeight } from '../utils/formatters';
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

const PrintHistory: React.FC = () => {
  const [allPrints, setAllPrints] = useState<Print[]>([]);
  const [prints, setPrints] = useState<Print[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [printerFilter, setPrinterFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const [syncingPrinter, setSyncingPrinter] = useState(false);
  const [showPrinterSync, setShowPrinterSync] = useState(false);
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

  const fetchPrints = async () => {
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
      setPrints(fetchedPrints);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load print history');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      const response = await fetchWithRetry(API_ENDPOINTS.SYNC.CLOUD, { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('Failed to sync');
      
      const data = await response.json();
      setToast({ message: `Synced ${data.newPrints} new prints, ${data.updated} updated\nDownloaded ${data.downloadedCovers} covers and ${data.downloadedVideos} timelapses`, type: 'success' });
      fetchPrints();
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
              fetchPrints();
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
      
      setToast({ message: `✓ Downloaded ${data.downloaded} timelapses from printer:\n${data.files?.slice(0, 10).join('\n')}${data.files?.length > 10 ? '\n...' : ''}`, type: 'success' });
      setShowPrinterSync(false);
    } catch (err) {
      setToast({ message: 'Printer sync failed: ' + (err instanceof Error ? err.message : 'Unknown error'), type: 'error' });
    } finally {
      setSyncingPrinter(false);
    }
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

  const handleExportCSV = () => {
    const csv = [
      ['Model ID', 'Title', 'Design', 'Printer', 'Status', 'Start Time', 'End Time', 'Duration (min)', 'Weight (g)', 'Length (mm)'],
      ...prints.map(p => [
        p.modelId,
        p.title,
        p.designTitle,
        p.deviceName,
        p.status,
        new Date(p.startTime).toLocaleString(),
        p.endTime ? new Date(p.endTime).toLocaleString() : '',
        Math.round(p.costTime / 60),
        p.weight.toFixed(2),
        p.length.toFixed(2)
      ])
    ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `print_history_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  // Filter prints in real-time based on search and status
  useEffect(() => {
    let filtered = [...allPrints];

    // Apply printer filter
    if (printerFilter !== 'all') {
      filtered = filtered.filter(p => p.deviceId === printerFilter);
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(p => {
        const status = p.status.toLowerCase();
        if (statusFilter === 'success') return status === 'success' || p.status === '2';
        if (statusFilter === 'failed') return status === 'failed' || p.status === '3';
        return true;
      });
    }

    // Apply search filter
    if (debouncedSearchTerm.trim()) {
      const search = debouncedSearchTerm.toLowerCase();
      filtered = filtered.filter(p => 
        p.title?.toLowerCase().includes(search) ||
        p.designTitle?.toLowerCase().includes(search) ||
        p.deviceName?.toLowerCase().includes(search) ||
        p.profileName?.toLowerCase().includes(search)
      );
    }

    setPrints(filtered);
    setCurrentPage(1); // Reset to page 1 when filters change
  }, [debouncedSearchTerm, statusFilter, printerFilter, allPrints]);

  // Pagination calculations
  const totalPages = Math.ceil(prints.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedPrints = prints.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  useEffect(() => {
    fetchPrints();
  }, []);

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
        <div>
          <h1>Print History</h1>
          <p>{prints.length} prints in database</p>
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
        {(() => {
          // Get unique printers from all prints
          const uniquePrinters = Array.from(new Set(allPrints.map(p => p.deviceId).filter(Boolean)));
          
          // Only show printer filter if multiple printers exist
          if (uniquePrinters.length > 1) {
            return (
              <select value={printerFilter} onChange={(e) => setPrinterFilter(e.target.value)} className="status-filter">
                <option value="all">All Printers</option>
                {uniquePrinters.map(deviceId => {
                  const print = allPrints.find(p => p.deviceId === deviceId);
                  return (
                    <option key={deviceId} value={deviceId}>
                      {print?.deviceName || deviceId}
                    </option>
                  );
                })}
              </select>
            );
          }
          return null;
        })()}
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
            // Map numeric status codes: 2=success, 3=failed, 1=running, others=idle
            const statusNum = typeof print.status === 'string' ? parseInt(print.status) : print.status;
            const statusStr = statusNum === 2 ? 'success' : 
                             statusNum === 3 ? 'failed' : 
                             statusNum === 1 ? 'running' : 'idle';
            const statusDisplay = statusStr === 'success' ? '✓ SUCCESS' : 
                                 statusStr === 'failed' ? '✕ FAILED' : 
                                 statusStr === 'running' ? '▶ RUNNING' : 
                                 statusStr === 'idle' ? '⏸ IDLE' : '⏸ IDLE';
            
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
                  <div className={`status-overlay status-${statusStr}`}>
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

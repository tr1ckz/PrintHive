import { useState, useEffect } from 'react';
import './Duplicates.css';
import Toast from './Toast';
import ConfirmModal from './ConfirmModal';
import LoadingScreen from './LoadingScreen';
import { API_ENDPOINTS } from '../config/api';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { useDebounce } from '../hooks/useDebounce';

interface LibraryFile {
  id: number;
  fileName: string;
  originalName: string;
  fileType: string;
  fileSize: number;
  filePath: string;
  thumbnailPath?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  fileHash?: string;
}

interface DuplicateGroup {
  name: string;
  files: LibraryFile[];
  totalSize: number;
  reason?: string;
}

function Duplicates() {
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());
  const [groupBy, setGroupBy] = useState<'hash' | 'name' | 'size'>('hash');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteProgress, setDeleteProgress] = useState<{
    running: boolean;
    total: number;
    processed: number;
    deleted: number;
    failed: number;
  } | null>(null);
  const debouncedSearch = useDebounce(searchTerm, 300);

  // Restore progress from localStorage on mount
  useEffect(() => {
    const savedProgress = localStorage.getItem('duplicateDeleteProgress');
    if (savedProgress) {
      try {
        const progress = JSON.parse(savedProgress);
        if (progress.running) {
          setDeleteProgress(progress);
        }
      } catch (error) {
        console.error('Failed to restore progress:', error);
      }
    }
  }, []);

  // Persist progress to localStorage
  useEffect(() => {
    if (deleteProgress) {
      localStorage.setItem('duplicateDeleteProgress', JSON.stringify(deleteProgress));
    }
  }, [deleteProgress]);

  useEffect(() => {
    loadDuplicates();
  }, [groupBy]);

  // Poll for delete job progress
  useEffect(() => {
    if (!deleteProgress?.running) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetchWithRetry(API_ENDPOINTS.LIBRARY.BULK_DELETE_STATUS, {
          credentials: 'include',
        });
        const data = await response.json();
        const newProgress = {
          running: data.running,
          total: data.total,
          processed: data.processed,
          deleted: data.deleted,
          failed: data.failed
        };
        setDeleteProgress(newProgress);

        if (!data.running && deleteProgress.running) {
          setToast({
            message: `Deletion complete: ${data.deleted} deleted, ${data.failed} failed`,
            type: data.failed > 0 ? 'error' : 'success'
          });
          localStorage.removeItem('duplicateDeleteProgress');
          setSelectedFiles(new Set());
          loadDuplicates();
        }
      } catch (error) {
        console.error('Failed to check delete progress:', error);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [deleteProgress?.running]);

  const loadDuplicates = async () => {
    setLoading(true);
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.LIBRARY.DUPLICATES(groupBy), {
        credentials: 'include',
      });
      const data = await response.json();
      setDuplicates(data.duplicates || []);
    } catch (error) {
      console.error('Failed to load duplicates:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleFileSelection = (fileId: number) => {
    const newSelection = new Set(selectedFiles);
    if (newSelection.has(fileId)) {
      newSelection.delete(fileId);
    } else {
      newSelection.add(fileId);
    }
    setSelectedFiles(newSelection);
  };

  const selectAllInGroup = (group: DuplicateGroup) => {
    const newSelection = new Set(selectedFiles);
    group.files.forEach(file => newSelection.add(file.id));
    setSelectedFiles(newSelection);
  };

  const selectSuggestedInGroup = (group: DuplicateGroup) => {
    // Keep the oldest file (lowest ID), select others for deletion
    const sorted = [...group.files].sort((a, b) => a.id - b.id);
    const newSelection = new Set(selectedFiles);
    sorted.slice(1).forEach(file => newSelection.add(file.id));
    setSelectedFiles(newSelection);
  };

  const selectAllDuplicates = () => {
    // Select all duplicates from all groups (keeping oldest in each group)
    const newSelection = new Set<number>();
    duplicates.forEach(group => {
      const sorted = [...group.files].sort((a, b) => a.id - b.id);
      sorted.slice(1).forEach(file => newSelection.add(file.id));
    });
    setSelectedFiles(newSelection);
  };

  const handleDeleteClick = () => {
    if (selectedFiles.size === 0) {
      setToast({ message: 'No files selected for deletion', type: 'error' });
      return;
    }
    setConfirmDelete(true);
  };

  const deleteSelectedFiles = async () => {
    setConfirmDelete(false);

    try {
      const response = await fetchWithRetry(API_ENDPOINTS.LIBRARY.BULK_DELETE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ fileIds: Array.from(selectedFiles) })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setDeleteProgress({
          running: true,
          total: data.status.total,
          processed: 0,
          deleted: 0,
          failed: 0
        });
        setToast({ message: `Started deleting ${selectedFiles.size} file(s)...`, type: 'success' });
      } else {
        setToast({ message: data.message || 'Failed to start deletion', type: 'error' });
      }
    } catch (error) {
      console.error('Failed to delete files:', error);
      setToast({ message: 'Failed to start deletion. Please try again.', type: 'error' });
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const filteredDuplicates = duplicates.filter(group => {
    if (!debouncedSearch.trim()) return true;
    const term = debouncedSearch.toLowerCase();
    return group.name.toLowerCase().includes(term) ||
      group.files.some(file =>
        file.originalName?.toLowerCase().includes(term) ||
        file.fileName?.toLowerCase().includes(term) ||
        file.description?.toLowerCase().includes(term)
      );
  });

  const totalSelectedSize = filteredDuplicates
    .flatMap(group => group.files)
    .filter(file => selectedFiles.has(file.id))
    .reduce((sum, file) => {
      const size = (file as any).filesize ?? (file as any).fileSize ?? (file as any).file_size ?? 0;
      return sum + size;
    }, 0);

  if (loading) {
    return <LoadingScreen message="Scanning for duplicates..." />;
  }

  return (
    <div className="duplicates-container">
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
      
      <div className="duplicates-header">
        <div>
          <h1>Duplicate Files</h1>
          <p className="duplicates-description">
            Find and remove duplicate files to free up space
          </p>
        </div>
        <div className="duplicates-search">
          <input
            type="text"
            placeholder="Search duplicates..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {duplicates.length > 0 && (
        <div className="caution-banner">
          <div className="caution-icon">⚠️</div>
          <div className="caution-content">
            <strong>Caution:</strong> The "Select All Duplicates" feature keeps the oldest copy of each file and marks the rest for deletion. 
            Review your selections carefully before deleting to avoid removing files you want to keep.
          </div>
          <button 
            className="btn btn-warning"
            onClick={selectAllDuplicates}
          >
            Select All Duplicates
          </button>
        </div>
      )}

      <div className="duplicates-toolbar">
        <div className="toolbar-left">
          <label>
            Group by:
            <select 
              value={groupBy} 
              onChange={(e) => setGroupBy(e.target.value as 'hash' | 'name' | 'size')}
              className="group-select"
            >
              <option value="hash">Content (Exact Duplicates)</option>
              <option value="name">Filename (Similar Names)</option>
              <option value="size">File Size</option>
            </select>
          </label>
          
          <div className="stats">
            <span className="stat">
              {filteredDuplicates.length} group(s)
            </span>
            <span className="stat">
              {filteredDuplicates.reduce((sum, g) => sum + g.files.length, 0)} files
            </span>
          </div>
        </div>

        {selectedFiles.size > 0 && (
          <div className="toolbar-right">
            <span className="selection-info">
              {selectedFiles.size} selected ({formatFileSize(totalSelectedSize)})
            </span>
            <button 
              className="btn btn-danger" 
              onClick={handleDeleteClick}
            >
              Delete Selected
            </button>
            <button 
              className="btn btn-secondary" 
              onClick={() => setSelectedFiles(new Set())}
            >
              Clear Selection
            </button>
          </div>
        )}
      </div>

      {deleteProgress?.running && (
        <div className="progress-panel">
          <div className="progress-header">
            <h3>🗑️ Deleting Files...</h3>
            <button 
              className="btn-cancel"
              onClick={() => fetchWithRetry(API_ENDPOINTS.LIBRARY.BULK_DELETE_CANCEL, { method: 'POST', credentials: 'include' })}
            >
              Cancel
            </button>
          </div>
          <div className="progress-info">
            <span>{deleteProgress.processed} / {deleteProgress.total} files</span>
            <span>{deleteProgress.deleted} deleted, {deleteProgress.failed} failed</span>
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${Math.round((deleteProgress.processed / deleteProgress.total) * 100)}%` }}
            ></div>
          </div>
          <div className="progress-percent">
            {Math.round((deleteProgress.processed / deleteProgress.total) * 100)}%
          </div>
        </div>
      )}

      {filteredDuplicates.length === 0 ? (
        <div className="no-duplicates">
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <h2>No Duplicates Found</h2>
          <p>Your library is clean! No duplicate files detected.</p>
        </div>
      ) : (
        <div className="duplicates-list">
          {filteredDuplicates.map((group, idx) => (
            <div key={idx} className="duplicate-group">
              <div className="group-header">
                <div className="group-info">
                  <h3>{group.name}</h3>
                  <span className="group-stats">
                    {group.files.length} copies • {formatFileSize(group.totalSize)} total
                    {group.reason && <span className="duplicate-reason"> • {group.reason}</span>}
                  </span>
                </div>
                <div className="group-actions">
                  <button
                    className="btn btn-small btn-secondary"
                    onClick={() => selectSuggestedInGroup(group)}
                    title="Select duplicates (keeps oldest)"
                  >
                    Select Duplicates
                  </button>
                  <button
                    className="btn btn-small btn-secondary"
                    onClick={() => selectAllInGroup(group)}
                  >
                    Select All
                  </button>
                </div>
              </div>

              <div className="group-files">
                {group.files.map((file, fileIdx) => (
                  <div
                    key={file.id}
                    className={`duplicate-file ${selectedFiles.has(file.id) ? 'selected' : ''}`}
                  >
                    <div className="file-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedFiles.has(file.id)}
                        onChange={() => toggleFileSelection(file.id)}
                      />
                    </div>

                    <div className="file-thumbnail-wrapper">
                      <img
                        src={`/api/library/thumbnail/${file.id}`}
                        alt={file.originalName || file.fileName}
                        className="file-thumbnail"
                      />
                    </div>

                    <div className="file-details">
                      <div className="file-name">{file.originalName || file.fileName}</div>
                      <div className="file-meta">
                        <span>{file.fileType?.toUpperCase()}</span>
                        <span>{formatFileSize(file.fileSize)}</span>
                        <span>ID: {file.id}</span>
                        <span>{formatDate(file.createdAt)}</span>
                      </div>
                      {file.description && (
                        <div className="file-description">{file.description}</div>
                      )}
                    </div>

                    {fileIdx === 0 && (
                      <div className="file-badge original">Original</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        isOpen={confirmDelete}
        title="Confirm Deletion"
        message={`Are you sure you want to delete ${selectedFiles.size} file(s)?\n\nThis action cannot be undone.`}
        confirmText="Delete"
        confirmButtonClass="btn-delete"
        onConfirm={deleteSelectedFiles}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export default Duplicates;

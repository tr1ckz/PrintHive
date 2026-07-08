import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
// Lazy so three.js (~600KB) only downloads when a model is actually opened.
const ModelViewer = lazy(() => import('./ModelViewer'));
import TagsInput from './TagsInput';
import Toast from './Toast';
import LoadingScreen from './LoadingScreen';
import Spinner from './Spinner';
import ConfirmModal from './ConfirmModal';
import Modal from './common/Modal';
import ProgressDisplay from './common/ProgressDisplay';
import { API_ENDPOINTS } from '../config/api';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { useDebounce } from '../hooks/useDebounce';
import { formatFileSize } from '../utils/formatters';
import { useEscapeKey } from '../hooks/useKeyboardShortcut';
import { useRealtimeTick } from '../hooks/useRealtimeTick';

interface LibraryFile {
  id: number;
  fileName: string;
  originalName: string;
  fileType: string;
  fileSize: number;
  filePath: string;
  description: string;
  tags: string;
  createdAt: string;
}

interface LibraryProps {
  userRole?: string;
}

const LIBRARY_CACHE_KEY = 'bambu_library_cache';

const Library: React.FC<LibraryProps> = ({ userRole }) => {
  const [files, setFiles] = useState<LibraryFile[]>(() => {
    try {
      const cached = sessionStorage.getItem(LIBRARY_CACHE_KEY);
      return cached ? (JSON.parse(cached) as LibraryFile[]) : [];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(() => {
    try {
      return !sessionStorage.getItem(LIBRARY_CACHE_KEY);
    } catch {
      return true;
    }
  });
  const [uploading, setUploading] = useState(false);
  const [folderPath, setFolderPath] = useState('');
  const [scanning, setScanning] = useState(false);
  const [viewingModel, setViewingModel] = useState<LibraryFile | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(24);
  const [isDragging, setIsDragging] = useState(false);
  const [editingFile, setEditingFile] = useState<LibraryFile | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editTags, setEditTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [autoTagging, setAutoTagging] = useState(false);
  const [autoTaggingAll, setAutoTaggingAll] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());
  const [bulkTagsModal, setBulkTagsModal] = useState(false);
  const [bulkTags, setBulkTags] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkTagging, setBulkTagging] = useState(false);
  const [autoTagProgress, setAutoTagProgress] = useState<{
    running: boolean;
    total: number;
    processed: number;
    updated: number;
    errors: number;
    currentFile: string;
    percentComplete: number;
  } | null>(null);
  const [scanProgress, setScanProgress] = useState<{
    running: boolean;
    total: number;
    processed: number;
    added: number;
    skipped: number;
    currentFile: string;
    percentComplete: number;
  } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterSizeMin, setFilterSizeMin] = useState<number | ''>('');
  const [filterSizeMax, setFilterSizeMax] = useState<number | ''>('');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [descriptionModal, setDescriptionModal] = useState<{
    description: string;
    fileName: string;
  } | null>(null);
  
  const isAdmin = userRole === 'admin';

  const fetchFiles = useCallback(async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.LIBRARY.LIST, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch library');
      const data = await response.json();
      setFiles(data);
      try { sessionStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(data)); } catch { /* noop */ }
    } catch (err) {
      console.error('Failed to load library:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  useRealtimeTick(() => {
    void fetchFiles();
  }, { minIntervalMs: 10000 });

  // Debounce search query for better performance
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Keyboard shortcuts
  useEscapeKey(!!editingFile, () => setEditingFile(null));
  useEscapeKey(!!viewingModel, () => setViewingModel(null));
  useEscapeKey(bulkTagsModal, () => setBulkTagsModal(false));

  // Filter files based on search query and filters (memoized for performance)
  const filteredFiles = useMemo(() => {
    return files
      .filter(file => {
        const query = debouncedSearchQuery.toLowerCase();
        const matchesQuery = !query || 
          file.originalName.toLowerCase().includes(query) ||
          file.description.toLowerCase().includes(query) ||
          file.tags.toLowerCase().includes(query);
        
        const matchesType = filterType === 'all' || file.fileType === filterType;
        
        const matchesSizeMin = !filterSizeMin || file.fileSize >= filterSizeMin * 1024 * 1024;
        const matchesSizeMax = !filterSizeMax || file.fileSize <= filterSizeMax * 1024 * 1024;
        
        return matchesQuery && matchesType && matchesSizeMin && matchesSizeMax;
      })
      .sort((a, b) => {
        let comparison = 0;
        switch (sortBy) {
          case 'name':
            comparison = a.originalName.localeCompare(b.originalName);
            break;
          case 'size':
            comparison = a.fileSize - b.fileSize;
            break;
          case 'date':
          default:
            comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }
        return sortOrder === 'asc' ? comparison : -comparison;
      });
  }, [files, debouncedSearchQuery, filterType, filterSizeMin, filterSizeMax, sortBy, sortOrder]);

  // Pagination (memoized)
  const { totalPages, paginatedFiles } = useMemo(() => {
    const totalPages = Math.ceil(filteredFiles.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedFiles = filteredFiles.slice(startIndex, endIndex);
    return { totalPages, paginatedFiles };
  }, [filteredFiles, currentPage, itemsPerPage]);

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);

    try {
      setUploading(true);
      const response = await fetchWithRetry(API_ENDPOINTS.LIBRARY.UPLOAD, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Upload failed');
      
      setToast({ message: 'File uploaded successfully!', type: 'success' });
      form.reset();
      fetchFiles();
    } catch (err) {
      setToast({ message: 'Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'), type: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const uploadFiles = async (fileList: FileList) => {
    try {
      setUploading(true);
      
      // Upload each file
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < fileList.length; i++) {
        const formData = new FormData();
        formData.append('file', fileList[i]);

        try {
          const response = await fetchWithRetry(API_ENDPOINTS.LIBRARY.UPLOAD, {
            method: 'POST',
            body: formData,
            credentials: 'include',
          });

          if (response.ok) {
            successCount++;
          } else {
            failCount++;
          }
        } catch {
          failCount++;
        }
      }

      if (successCount > 0) {
        setToast({ message: `Successfully uploaded ${successCount} file(s)${failCount > 0 ? `, ${failCount} failed` : ''}`, type: 'success' });
        fetchFiles();
      } else {
        setToast({ message: 'All uploads failed', type: 'error' });
      }
    } catch (err) {
      setToast({ message: 'Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'), type: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      // Filter for supported file types
      const validFiles = Array.from(files).filter(file => {
        const ext = file.name.toLowerCase();
        return ext.endsWith('.3mf') || ext.endsWith('.stl') || ext.endsWith('.gcode');
      });

      if (validFiles.length === 0) {
        setToast({ message: 'No valid files found. Only .3mf, .stl, and .gcode files are supported.', type: 'error' });
        return;
      }

      uploadFiles(files);
    }
  };


  const handleDownload = async (id: number, originalName: string) => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.LIBRARY.DOWNLOAD(id), {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = originalName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setToast({ message: 'Download failed: ' + (err instanceof Error ? err.message : 'Unknown error'), type: 'error' });
    }
  };

  const handleDeleteClick = (id: number) => {
    setDeleteConfirm(id);
  };

  const handleDeleteConfirm = async () => {
    if (deleteConfirm === null) return;

    try {
      const response = await fetchWithRetry(API_ENDPOINTS.LIBRARY.FILE(deleteConfirm), { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error('Delete failed');
      
      setToast({ message: 'File deleted successfully', type: 'success' });
      fetchFiles();
    } catch (err) {
      setToast({ message: 'Delete failed: ' + (err instanceof Error ? err.message : 'Unknown error'), type: 'error' });
    } finally {
      setDeleteConfirm(null);
    }
  };

  // Bulk operations
  const toggleSelectFile = (id: number) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedFiles(newSelected);
  };

  const selectAllVisible = () => {
    if (selectedFiles.size === paginatedFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(paginatedFiles.map(f => f.id)));
    }
  };

  const handleBulkDelete = async () => {
    setConfirmModal({
      title: 'Delete Selected Files',
      message: `Are you sure you want to delete ${selectedFiles.size} selected file${selectedFiles.size !== 1 ? 's' : ''}? This action cannot be undone.`,
      onConfirm: async () => {
        try {
          setBulkDeleting(true);
          let success = 0;
          let failed = 0;
          
          for (const id of selectedFiles) {
            try {
              const response = await fetchWithRetry(API_ENDPOINTS.LIBRARY.FILE(id), { method: 'DELETE', credentials: 'include' });
              if (response.ok) success++;
              else failed++;
            } catch {
              failed++;
            }
          }
          
          setToast({ 
            message: `Deleted ${success} file${success !== 1 ? 's' : ''}${failed > 0 ? `, ${failed} failed` : ''}`, 
            type: failed > 0 ? 'error' : 'success' 
          });
          setSelectedFiles(new Set());
          fetchFiles();
        } finally {
          setBulkDeleting(false);
        }
      }
    });
  };

  const handleBulkAddTags = async () => {
    const tagsArray = bulkTags.split(',').map(t => t.trim()).filter(t => t.length > 0);
    if (tagsArray.length === 0) {
      setToast({ message: 'Please enter at least one tag', type: 'error' });
      return;
    }
    
    try {
      setBulkTagging(true);
      let success = 0;
      
      for (const fileId of selectedFiles) {
        try {
          // Get existing tags for this file
          const file = files.find(f => f.id === fileId);
          const existingTags = file?.tags ? file.tags.split(',').map(t => t.trim()) : [];
          const allTags = [...new Set([...existingTags, ...tagsArray])];
          
          const response = await fetchWithRetry(API_ENDPOINTS.LIBRARY.UPDATE_TAGS(fileId), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: allTags })
          });
          if (response.ok) success++;
        } catch {
          // Continue on error
        }
      }
      
      setToast({ message: `Added tags to ${success} files`, type: 'success' });
      setBulkTagsModal(false);
      setBulkTags('');
      setSelectedFiles(new Set());
      fetchFiles();
    } finally {
      setBulkTagging(false);
    }
  };

  const handleScanFolder = async () => {
    try {
      setScanning(true);
      const response = await fetchWithRetry(API_ENDPOINTS.LIBRARY.SCAN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      const result = await response.json();
      
      if (result.success) {
        setToast({ message: 'Library scan started! Processing in background...', type: 'success' });
        
        // Start polling for progress
        const pollProgress = async () => {
          try {
            const statusResponse = await fetchWithRetry(API_ENDPOINTS.LIBRARY.SCAN_STATUS, { credentials: 'include' });
            const status = await statusResponse.json();
            
            setScanProgress(status);
            
            if (status.running) {
              setTimeout(pollProgress, 1000);
            } else {
              setScanning(false);
              setScanProgress(null);
              setToast({ 
                message: `Scan complete! Added ${status.added} new file(s), ${status.skipped} already existed.`, 
                type: 'success' 
              });
              fetchFiles();
            }
          } catch (err) {
            console.error('Error polling scan status:', err);
            setScanning(false);
            setScanProgress(null);
          }
        };
        
        pollProgress();
      } else {
        throw new Error(result.message || 'Scan failed');
      }
    } catch (err) {
      setToast({ message: 'Scan failed: ' + (err instanceof Error ? err.message : 'Unknown error'), type: 'error' });
      setScanning(false);
      setScanProgress(null);
    }
  };

  const handleCancelScan = async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.LIBRARY.SCAN_CANCEL, { method: 'POST', credentials: 'include' });
      const data = await response.json();
      if (data.success) {
        setToast({ message: 'Library scan cancelled', type: 'success' });
      }
    } catch (err) {
      console.error('Error cancelling scan:', err);
    }
  };

  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case '3mf': return '📦';
      case 'stl': return '🔷';
      case 'gcode': return '📄';
      default: return '📁';
    }
  };

  const handleView3D = (file: LibraryFile) => {
    if (file.fileType === 'stl' || file.fileType === '3mf') {
      setViewingModel(file);
    } else {
      setToast({ message: '3D viewing only available for STL and 3MF files', type: 'error' });
    }
  };

  const handleShare = async (file: LibraryFile) => {
    try {
      const response = await fetchWithRetry(`${API_ENDPOINTS.LIBRARY.BASE}/share/${file.id}`, {
        method: 'POST',
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Failed to generate share link');
      
      const { hash } = await response.json();
      const shareUrl = `${window.location.origin}/library/share?hash=${hash}`;
      
      // Copy to clipboard
      await navigator.clipboard.writeText(shareUrl);
      setToast({ message: 'Share link copied to clipboard!', type: 'success' });
    } catch (err) {
      console.error('Failed to generate share link:', err);
      setToast({ message: 'Failed to generate share link', type: 'error' });
    }
  };

  const handleEditFile = (file: LibraryFile) => {
    setEditingFile(file);
    setEditDescription(file.description || '');
    setEditTags(file.tags || '');
  };

  const handleAutoTag = async () => {
    if (!editingFile) return;
    
    try {
      setAutoTagging(true);
      const response = await fetchWithRetry(API_ENDPOINTS.LIBRARY.AUTO_TAG(editingFile.id), {
        method: 'POST'
      });
      
      if (!response.ok) throw new Error('Auto-tag failed');
      
      const data = await response.json();
      
      // Update the form fields with auto-generated content
      setEditDescription(data.description);
      setEditTags(data.tags.join(', '));
      
      setToast({ message: 'Auto-generated description and tags!', type: 'success' });
    } catch (err) {
      setToast({ message: 'Auto-tag failed: ' + (err instanceof Error ? err.message : 'Unknown error'), type: 'error' });
    } finally {
      setAutoTagging(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingFile) return;
    
    try {
      setSaving(true);
      
      // Save description
      const descResponse = await fetchWithRetry(API_ENDPOINTS.LIBRARY.FILE(editingFile.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: editDescription })
      });
      
      if (!descResponse.ok) throw new Error('Failed to update description');
      
      // Save tags
      const tagsArray = editTags.split(',').map(t => t.trim()).filter(t => t.length > 0);
      const tagsResponse = await fetchWithRetry(API_ENDPOINTS.LIBRARY.UPDATE_TAGS(editingFile.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: tagsArray })
      });
      
      if (!tagsResponse.ok) throw new Error('Failed to update tags');
      
      setToast({ message: 'File updated successfully!', type: 'success' });
      setEditingFile(null);
      fetchFiles();
    } catch (err) {
      setToast({ message: 'Failed to update file: ' + (err instanceof Error ? err.message : 'Unknown error'), type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleAutoTagAll = async () => {
    if (!confirm('This will auto-generate descriptions and tags for ALL files in your library. The process runs in the background - you can continue using the site. Continue?')) {
      return;
    }
    
    try {
      setAutoTaggingAll(true);
      
      const response = await fetchWithRetry(API_ENDPOINTS.LIBRARY.AUTO_TAG_ALL, {
        method: 'POST'
      });
      
      const data = await response.json();
      
      if (data.success) {
        setToast({ message: 'Auto-tag started! Processing in background...', type: 'success' });
        
        // Start polling for progress
        const pollProgress = async () => {
          try {
            const statusResponse = await fetchWithRetry(API_ENDPOINTS.LIBRARY.AUTO_TAG_STATUS, { credentials: 'include' });
            const status = await statusResponse.json();
            
            setAutoTagProgress(status);
            
            if (status.running) {
              // Continue polling every 1 second
              setTimeout(pollProgress, 1000);
            } else {
              // Job finished
              setAutoTaggingAll(false);
              setAutoTagProgress(null);
              setToast({ 
                message: `Auto-tag complete: ${status.updated} files updated, ${status.errors} errors`, 
                type: status.errors > 0 ? 'error' : 'success' 
              });
              fetchFiles();
            }
          } catch (err) {
            console.error('Error polling auto-tag status:', err);
            setAutoTaggingAll(false);
            setAutoTagProgress(null);
          }
        };
        
        // Start polling
        pollProgress();
      } else {
        throw new Error(data.error || data.message || 'Failed to start auto-tag');
      }
    } catch (err) {
      setToast({ message: 'Auto-tag failed: ' + (err instanceof Error ? err.message : 'Unknown error'), type: 'error' });
      setAutoTaggingAll(false);
      setAutoTagProgress(null);
    }
  };
  
  const handleCancelAutoTag = async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.LIBRARY.AUTO_TAG_CANCEL, {
        method: 'POST'
      });
      const data = await response.json();
      
      if (data.success) {
        setToast({ message: 'Auto-tag cancelled', type: 'success' });
      }
    } catch (err) {
      console.error('Error cancelling auto-tag:', err);
    }
  };

  if (loading) {
    return <LoadingScreen message="Loading library..." />;
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
      
      {viewingModel && (
        <Suspense fallback={<Spinner size="large" message="Loading 3D viewer…" />}>
          <ModelViewer
            fileId={viewingModel.id}
            fileName={viewingModel.originalName}
            fileType={viewingModel.fileType}
            onClose={() => setViewingModel(null)}
          />
        </Suspense>
      )}

      {editingFile && (
        <Modal title="✏️ Edit File" onClose={() => setEditingFile(null)}>
              <div className="mb-4 space-y-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&_input]:w-full [&_textarea]:w-full [&_select]:w-full">
                <label>Filename</label>
                <input 
                  type="text" 
                  value={editingFile.originalName} 
                  disabled 
                  className="opacity-60"
                />
              </div>
              
              <div className="mb-4 space-y-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&_input]:w-full [&_textarea]:w-full [&_select]:w-full">
                <label>Description</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Add a description..."
                  rows={3}
                  disabled={saving || autoTagging}
                />
              </div>
              
              <div className="mb-4 space-y-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&_input]:w-full [&_textarea]:w-full [&_select]:w-full">
                <label>Tags</label>
                <TagsInput
                  value={editTags}
                  onChange={setEditTags}
                  disabled={saving || autoTagging}
                  placeholder="Add tags..."
                />
                <small className="text-xs text-muted">
                  Type and press Enter or comma to add. Click × to remove.
                </small>
              </div>
              
              <button 
                onClick={handleAutoTag} 
                className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent/10 text-accent hover:bg-accent/20"
                disabled={saving || autoTagging}
                style={{ width: '100%', marginBottom: '1rem' }}
              >
                {autoTagging ? '🔄 Analyzing...' : '✨ Auto-Generate Description & Tags'}
              </button>
              
              <div className="mt-5 flex justify-end gap-2">
                <button 
                  onClick={() => setEditingFile(null)} 
                  className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong"
                  disabled={saving}
                >
                  {saving ? '💾 Saving...' : '💾 Save Changes'}
                </button>
              </div>
        </Modal>
      )}

      <section>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <article className="rounded-lg bg-card p-4 shadow-sm [&>strong]:mt-1 [&>strong]:block [&>strong]:text-2xl [&>strong]:font-semibold [&>strong]:tabular-nums [&>strong]:text-fg">
            <span className="text-xs text-muted">Total files</span>
            <strong>{files.length}</strong>
          </article>
          <article className="rounded-lg bg-card p-4 shadow-sm [&>strong]:mt-1 [&>strong]:block [&>strong]:text-2xl [&>strong]:font-semibold [&>strong]:tabular-nums [&>strong]:text-fg">
            <span className="text-xs text-muted">Selected</span>
            <strong>{selectedFiles.size}</strong>
          </article>
          <article className="rounded-lg bg-card p-4 shadow-sm [&>strong]:mt-1 [&>strong]:block [&>strong]:text-2xl [&>strong]:font-semibold [&>strong]:tabular-nums [&>strong]:text-fg">
            <span className="text-xs text-muted">Page</span>
            <strong>{Math.max(totalPages, 1) === 0 ? 1 : currentPage}/{Math.max(totalPages, 1)}</strong>
          </article>
        </div>
      </section>

      {/* Bulk Action Bar */}
      {selectedFiles.size > 0 && (
        <div className="sticky top-16 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-elevated px-4 py-2.5 shadow-md">
          <span className="text-sm font-medium text-accent">{selectedFiles.size} selected</span>
          <div className="flex flex-wrap gap-2">
            <button 
              onClick={() => setBulkTagsModal(true)} 
              className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg"
              disabled={bulkDeleting}
            >
              🏷️ Add Tags
            </button>
            <button 
              onClick={handleBulkDelete} 
              className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-danger/15 text-danger hover:bg-danger/25"
              disabled={bulkDeleting}
            >
              {bulkDeleting ? '🗑️ Deleting...' : '🗑️ Delete'}
            </button>
            <button 
              onClick={() => setSelectedFiles(new Set())} 
              className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg"
            >
              ✕ Clear Selection
            </button>
          </div>
        </div>
      )}

      {/* Bulk Tags Modal */}
      {bulkTagsModal && (
        <Modal title={<>🏷️ Add Tags to {selectedFiles.size} Files</>} onClose={() => setBulkTagsModal(false)}>
              <div className="mb-4 space-y-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&_input]:w-full [&_textarea]:w-full [&_select]:w-full">
                <label>Tags to add</label>
                <TagsInput
                  value={bulkTags}
                  onChange={setBulkTags}
                  disabled={bulkTagging}
                  placeholder="Add tags to apply..."
                />
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => setBulkTagsModal(false)} className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg">Cancel</button>
                <button onClick={handleBulkAddTags} className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong" disabled={bulkTagging}>
                  {bulkTagging ? 'Adding...' : 'Add Tags'}
                </button>
              </div>
        </Modal>
      )}

      <div className="flex items-center gap-2">
        <button 
          onClick={selectAllVisible} 
          className="inline-flex size-11 md:size-9 shrink-0 items-center justify-center rounded-md bg-white/5 text-fg-soft transition-colors hover:bg-white/10"
          title={selectedFiles.size === paginatedFiles.length ? 'Deselect All' : 'Select All'}
        >
          {selectedFiles.size === paginatedFiles.length && paginatedFiles.length > 0 ? '☑' : '☐'}
        </button>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="🔍 Search by filename, description, or tags..."
          className="min-h-11 md:min-h-10 flex-1"
        />
        <button 
          onClick={() => setShowFilters(!showFilters)} 
          className={`inline-flex min-h-11 md:min-h-9 shrink-0 items-center rounded-md px-3 text-sm font-medium transition-colors ${showFilters ? 'bg-accent/15 text-accent' : 'bg-white/5 text-fg-soft hover:bg-white/10'}`}
          title="Toggle Filters"
        >
          🔧 Filters
        </button>
        {searchQuery && (
          <button 
            onClick={() => setSearchQuery('')} 
            className="inline-flex size-11 md:size-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/5 hover:text-fg"
          >
            ✕
          </button>
        )}
      </div>

      {/* Advanced Filters */}
      {showFilters && (
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-card p-4 shadow-sm sm:grid-cols-4 lg:grid-cols-5">
          <div className="space-y-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&_input]:w-full [&_textarea]:w-full [&_select]:w-full">
            <label>File Type</label>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">All Types</option>
              <option value="3mf">3MF</option>
              <option value="stl">STL</option>
              <option value="gcode">G-code</option>
            </select>
          </div>
          
          <div className="space-y-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&_input]:w-full [&_textarea]:w-full [&_select]:w-full">
            <label>Size (MB)</label>
            <div className="flex items-center gap-2 [&>span]:text-xs [&>span]:text-muted">
              <input
                type="number"
                placeholder="Min"
                value={filterSizeMin}
                onChange={(e) => setFilterSizeMin(e.target.value ? Number(e.target.value) : '')}
                min="0"
              />
              <span>to</span>
              <input
                type="number"
                placeholder="Max"
                value={filterSizeMax}
                onChange={(e) => setFilterSizeMax(e.target.value ? Number(e.target.value) : '')}
                min="0"
              />
            </div>
          </div>
          
          <div className="space-y-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&_input]:w-full [&_textarea]:w-full [&_select]:w-full">
            <label>Sort By</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'date' | 'name' | 'size')}>
              <option value="date">Date Added</option>
              <option value="name">Name</option>
              <option value="size">File Size</option>
            </select>
          </div>
          
          <div className="space-y-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&_input]:w-full [&_textarea]:w-full [&_select]:w-full">
            <label>Order</label>
            <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}>
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
          
          <button 
            className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg self-end"
            onClick={() => {
              setFilterType('all');
              setFilterSizeMin('');
              setFilterSizeMax('');
              setSortBy('date');
              setSortOrder('desc');
            }}
          >
            Clear Filters
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div 
          className={`rounded-lg p-6 text-center transition-colors ${isDragging ? 'bg-accent/10 ring-1 ring-accent/40' : 'bg-card shadow-sm'}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="flex flex-col items-center gap-1.5 [&>h3]:text-base [&>h3]:font-semibold [&>h3]:text-fg [&>p]:text-sm [&>p]:text-muted">
            <div className="text-3xl">📦</div>
            <h3>Drag & Drop Files Here</h3>
            <p>or click to browse</p>
            <p className="!text-xs !text-muted">Supports .3mf, .stl, and .gcode files</p>
            <input 
              type="file" 
              id="file-input"
              accept=".3mf,.stl,.gcode" 
              multiple
              onChange={(e) => e.target.files && uploadFiles(e.target.files)}
              style={{ display: 'none' }}
            />
            <label htmlFor="file-input" className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong mt-2 cursor-pointer">
              {uploading ? (
                <>
                  <Spinner size="small" color="currentColor" /> Uploading...
                </>
              ) : (
                '📁 Browse Files'
              )}
            </label>
          </div>
        </div>

        <div className="rounded-lg bg-card p-6 shadow-sm [&>h3]:text-base [&>h3]:font-semibold [&>h3]:text-fg">
          <h3>Auto-Import from Library Folder</h3>
          <div className="mt-2 space-y-3 [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&>p]:text-sm [&>p]:text-muted">
            <p>📂 Files in <code>/app/library</code> are automatically scanned</p>
            <div className="flex flex-wrap gap-2">
              {!scanProgress ? (
                <button onClick={handleScanFolder} disabled={scanning} className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg">
                  {scanning ? '⏳ Starting...' : '🔄 Refresh Library'}
                </button>
              ) : (
                <button onClick={handleCancelScan} className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-danger/15 text-danger hover:bg-danger/25">
                  ✕ Cancel Scan
                </button>
              )}
              {!autoTagProgress ? (
                <button 
                  onClick={handleAutoTagAll} 
                  disabled={autoTaggingAll || files.length === 0} 
                  className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent/10 text-accent hover:bg-accent/20"
                >
                  {autoTaggingAll ? '⏳ Starting...' : '✨ Auto-Tag All Files'}
                </button>
              ) : (
                <button 
                  onClick={handleCancelAutoTag} 
                  className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-danger/15 text-danger hover:bg-danger/25"
                >
                  ✕ Cancel
                </button>
              )}
            </div>
            {scanProgress && (
              <ProgressDisplay
                label="🔄 Scanning library..."
                stats={<>{scanProgress.added} added / {scanProgress.skipped} skipped</>}
                percentComplete={scanProgress.percentComplete}
                processed={scanProgress.processed}
                total={scanProgress.total}
                currentFile={scanProgress.currentFile}
              />
            )}
            {autoTagProgress && (
              <ProgressDisplay
                label="✨ Auto-tagging files..."
                stats={<>{autoTagProgress.updated} updated / {autoTagProgress.errors} errors</>}
                percentComplete={autoTagProgress.percentComplete}
                processed={autoTagProgress.processed}
                total={autoTagProgress.total}
                currentFile={autoTagProgress.currentFile}
              />
            )}
          </div>
          <p className="mt-3 text-xs text-muted">Mount your local folder to <code>/app/library</code> in Docker</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {files.length === 0 ? (
          <div className="col-span-full flex flex-col items-center gap-2 py-16 text-center [&>h3]:text-base [&>h3]:font-semibold [&>h3]:text-fg [&>p]:text-sm [&>p]:text-muted">
            <div className="text-4xl">📚</div>
            <h3>No files in library</h3>
            <p>Upload files or scan a folder to get started</p>
          </div>
        ) : (
          paginatedFiles.map(file => (
            <div key={file.id} className={`group relative flex flex-col overflow-hidden rounded-lg bg-card shadow-sm transition hover:bg-surface-2 hover:shadow-md ${selectedFiles.has(file.id) ? 'ring-1 ring-accent/50' : ''}`}>
              {/* Selection checkbox */}
              <label className="absolute left-1.5 top-1.5 z-10 flex size-11 md:size-9 cursor-pointer items-center justify-center [&>input]:size-5" onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedFiles.has(file.id)}
                  onChange={() => toggleSelectFile(file.id)}
                />
                
              </label>
              
              <div
                className="relative aspect-square w-full overflow-hidden bg-[#eae6de]"
                onClick={() => handleView3D(file)}
                style={{ cursor: (file.fileType === 'stl' || file.fileType === '3mf') ? 'pointer' : 'default' }}
              >
                {/* Most model thumbnails are baked with a stark pure-white studio
                    background (from Bambu Studio's embedded plate render) — a
                    harsh blown-out slab next to the rest of the dark UI. Tone
                    it down to a soft ivory mat rather than clinical #fff. */}
                <img
                  src={`/api/library/thumbnail/${file.id}`}
                  alt={file.originalName}
                  className="h-full w-full object-cover brightness-[0.91] sepia-[0.1] saturate-[0.94]"
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                {(file.fileType === 'stl' || file.fileType === '3mf') && (
                  <div className="absolute inset-0 flex items-center justify-center bg-overlay opacity-0 transition-opacity group-hover:opacity-100 [&_span]:text-xs [&_span]:font-medium [&_span]:text-fg">
                    <span>🔍 View in 3D</span>
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3 [&>h4]:truncate [&>h4]:text-sm [&>h4]:font-medium [&>h4]:text-fg">
                <h4>{file.originalName}</h4>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">{file.fileType.toUpperCase()}</p>
                <p className="text-xs tabular-nums text-muted">{formatFileSize(file.fileSize)}</p>
                {file.description && (
                  <p className="line-clamp-2 cursor-pointer text-xs text-fg-faint" onClick={() => setDescriptionModal({ description: file.description, fileName: file.originalName })}>
                    {file.description}
                    {file.description.length > 150 && <span className="text-accent"> ...Read more</span>}
                  </p>
                )}
                {file.tags && (
                  <div className="flex flex-wrap gap-1">
                    {file.tags.split(',').map((tag, i) => (
                      <span key={i} className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-muted">{tag.trim()}</span>
                    ))}
                  </div>
                )}
                <p className="mt-auto text-[10px] text-muted">{new Date(file.createdAt).toLocaleDateString()}</p>
              </div>
              <div className="flex flex-wrap gap-1 p-2 pt-0">
                {(file.fileType === 'stl' || file.fileType === '3mf') && (
                  <button 
                    onClick={() => handleShare(file)}
                    className="min-h-9 flex-1 rounded bg-white/5 px-1.5 text-[11px] font-medium text-fg-soft transition-colors hover:bg-white/10 hover:text-fg"
                  >
                    🔗 Share
                  </button>
                )}
                <button 
                  onClick={() => handleEditFile(file)}
                  className="min-h-9 flex-1 rounded bg-white/5 px-1.5 text-[11px] font-medium text-fg-soft transition-colors hover:bg-white/10 hover:text-fg"
                >
                  ✏️ Edit
                </button>
                <button 
                  onClick={() => handleDownload(file.id, file.originalName)}
                  className="min-h-9 flex-1 rounded bg-white/5 px-1.5 text-[11px] font-medium text-fg-soft transition-colors hover:bg-white/10 hover:text-fg"
                >
                  ⬇ Download
                </button>
                {isAdmin && (
                  <button 
                    onClick={() => handleDeleteClick(file.id)}
                    className="min-h-9 flex-1 rounded bg-danger/10 px-1.5 text-[11px] font-medium text-danger transition-colors hover:bg-danger/20"
                  >
                    🗑 Delete
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button 
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="inline-flex min-h-11 md:min-h-9 items-center justify-center rounded-md bg-white/5 px-3 text-sm text-fg-soft transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            ← Previous
          </button>
          
          <div className="text-xs tabular-nums text-muted">
            Page {currentPage} of {totalPages} ({filteredFiles.length} files)
          </div>
          
          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(page => {
                // Show first page, last page, current page, and 2 pages around current
                return page === 1 || 
                       page === totalPages || 
                       Math.abs(page - currentPage) <= 2;
              })
              .map((page, index, array) => {
                // Add ellipsis if there's a gap
                const showEllipsis = index > 0 && page - array[index - 1] > 1;
                return (
                  <React.Fragment key={page}>
                    {showEllipsis && <span className="px-1 text-muted">...</span>}
                    <button
                      onClick={() => setCurrentPage(page)}
                      className={`inline-flex min-h-11 md:min-h-9 min-w-9 items-center justify-center rounded-md px-3 text-sm tabular-nums transition-colors ${currentPage === page ? 'bg-accent/15 text-accent' : 'bg-white/5 text-fg-soft hover:bg-white/10'}`}
                    >
                      {page}
                    </button>
                  </React.Fragment>
                );
              })}
          </div>
          
          <button 
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="inline-flex min-h-11 md:min-h-9 items-center justify-center rounded-md bg-white/5 px-3 text-sm text-fg-soft transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={deleteConfirm !== null}
        title="Confirm Delete"
        message="Are you sure you want to delete this file? This action cannot be undone."
        confirmText="Delete"
        confirmButtonClass="btn-delete"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteConfirm(null)}
      />

      {descriptionModal && (
        <Modal title="📖 Full Description" onClose={() => setDescriptionModal(null)}>
              <p className="text-sm font-medium text-fg">{descriptionModal.fileName}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-fg-soft">{descriptionModal.description}</p>
        </Modal>
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
      
      {confirmModal && (
        <ConfirmModal
          isOpen
          title={confirmModal.title}
          message={confirmModal.message}
          onConfirm={() => {
            confirmModal.onConfirm();
            setConfirmModal(null);
          }}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
};

export default Library;

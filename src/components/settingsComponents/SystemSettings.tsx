import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../../config/api';
import fetchWithRetry from '../../utils/fetchWithRetry';
import { useSettingsContext } from './SettingsContext';
import { CollapsibleSection } from './CollapsibleSection';
import { BackupInfo, BackupStats, DbResultModal } from './types';
import LoadingSplash from '../LoadingSplash';
import ConfirmModal from '../ConfirmModal';
import Modal from '../common/Modal';
import { useModal } from '../ModalProvider';

export function SystemSettings() {
  const { setToast } = useSettingsContext();
  const { confirm } = useModal();
  
  // System state
  const [restarting, setRestarting] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [showRestartSplash, setShowRestartSplash] = useState(false);
  const [restartMessage, setRestartMessage] = useState('Restarting server...');
  
  // Log level
  const [logLevel, setLogLevel] = useState('INFO');
  const logLevels = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];
  
  // Database maintenance state
  const [dbVacuuming, setDbVacuuming] = useState(false);
  const [dbAnalyzing, setDbAnalyzing] = useState(false);
  const [dbRebuildingIndexes, setDbRebuildingIndexes] = useState(false);
  const [dbMaintenanceLoading, setDbMaintenanceLoading] = useState(false);
  const [lastBackupDate, setLastBackupDate] = useState<string | null>(null);
  const [dbResultModal, setDbResultModal] = useState<DbResultModal | null>(null);
  
  // Backup schedule
  const [backupScheduleEnabled, setBackupScheduleEnabled] = useState(false);
  const [backupInterval, setBackupInterval] = useState(7);
  const [backupRetention, setBackupRetention] = useState(30);
  
  // Backup options
  const [backupIncludeVideos, setBackupIncludeVideos] = useState(true);
  const [backupIncludeLibrary, setBackupIncludeLibrary] = useState(true);
  const [backupIncludeCovers, setBackupIncludeCovers] = useState(true);
  
  // Remote backup
  const [remoteBackupEnabled, setRemoteBackupEnabled] = useState(false);
  const [remoteBackupType, setRemoteBackupType] = useState<'sftp' | 'ftp'>('sftp');
  const [remoteBackupHost, setRemoteBackupHost] = useState('');
  const [remoteBackupPort, setRemoteBackupPort] = useState(22);
  const [remoteBackupUsername, setRemoteBackupUsername] = useState('');
  const [remoteBackupPassword, setRemoteBackupPassword] = useState('');
  const [remoteBackupPath, setRemoteBackupPath] = useState('/backups');
  const [remoteBackupTesting, setRemoteBackupTesting] = useState(false);
  
  // Backup webhook
  const [backupWebhookUrl, setBackupWebhookUrl] = useState('');
  
  // Restore state
  const [availableBackups, setAvailableBackups] = useState<BackupInfo[]>([]);
  const [backupStats, setBackupStats] = useState<BackupStats>({ count: 0, totalSize: 0, totalSizeFormatted: '0 B' });
  const [selectedBackup, setSelectedBackup] = useState('');
  const [restoreInProgress, setRestoreInProgress] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restoreMessage, setRestoreMessage] = useState('');
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  
  // Backup progress state
  const [backupInProgress, setBackupInProgress] = useState(false);
  const [backupProgress, setBackupProgress] = useState(0);
  const [backupMessage, setBackupMessage] = useState('');

  useEffect(() => {
    loadDatabaseSettings();
    loadAvailableBackups();
    loadLogLevel();
  }, []);

  const loadLogLevel = async () => {
    try {
      const resp = await fetchWithRetry(API_ENDPOINTS.SYSTEM.LOG_LEVEL, { credentials: 'include' });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.level) setLogLevel(String(data.level).toUpperCase());
      }
    } catch {}
  };

  const handleSaveLogLevel = async () => {
    try {
      const resp = await fetchWithRetry(API_ENDPOINTS.SYSTEM.LOG_LEVEL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: logLevel }),
        credentials: 'include'
      });
      if (resp.ok) {
        setToast({ message: `Log level set to ${logLevel}`, type: 'success' });
      } else {
        setToast({ message: 'Failed to set log level', type: 'error' });
      }
    } catch {
      setToast({ message: 'Failed to set log level', type: 'error' });
    }
  };

  const handleRestartApp = async () => {
    setConfirmRestart(false);
    setRestarting(true);
    
    try {
      await fetchWithRetry(API_ENDPOINTS.SYSTEM.RESTART, { method: 'POST', credentials: 'include' });
      setRestartMessage('Restarting server...');
      setShowRestartSplash(true);
    } catch (error) {
      setRestartMessage('Server restarting...');
      setShowRestartSplash(true);
    }
  };

  const loadDatabaseSettings = async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DATABASE, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) return;
      setBackupScheduleEnabled(data.backupScheduleEnabled ?? false);
      setBackupInterval(data.backupInterval ?? 7);
      setBackupRetention(data.backupRetention ?? 30);
      setLastBackupDate(data.lastBackupDate ?? null);
      setRemoteBackupEnabled(data.remoteBackupEnabled ?? false);
      setRemoteBackupType(data.remoteBackupType ?? 'sftp');
      setRemoteBackupHost(data.remoteBackupHost ?? '');
      setRemoteBackupPort(data.remoteBackupPort ?? 22);
      setRemoteBackupUsername(data.remoteBackupUsername ?? '');
      setRemoteBackupPassword(data.remoteBackupPassword ?? '');
      setRemoteBackupPath(data.remoteBackupPath ?? '/backups');
      setBackupWebhookUrl(data.backupWebhookUrl ?? '');
      setBackupIncludeVideos(data.backupIncludeVideos !== false);
      setBackupIncludeLibrary(data.backupIncludeLibrary !== false);
      setBackupIncludeCovers(data.backupIncludeCovers !== false);
    } catch (error) {
      console.error('Failed to load database settings:', error);
    }
  };

  const loadAvailableBackups = async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DATABASE_BACKUPS, { credentials: 'include' });
      const data = await response.json();
      if (data.success) {
        setAvailableBackups(data.backups || []);
        setBackupStats(data.stats || { count: 0, totalSize: 0, totalSizeFormatted: '0 B' });
      }
    } catch (error) {
      console.error('Failed to load available backups:', error);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(Math.abs(bytes) || 1) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const handleVacuumDatabase = async () => {
    setDbVacuuming(true);
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DATABASE_VACUUM, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await response.json();
      if (!response.ok) {
        setToast({ message: data.error || data.message || 'Failed to vacuum database', type: 'error' });
        return;
      }
      if (data.queued) {
        setToast({ message: 'Database vacuum started in background. Check Background Jobs for progress.', type: 'success' });
        return;
      }
      if (data.success && data.details) {
        setDbResultModal({
          title: 'Vacuum Complete',
          icon: '⚡',
          details: {
            'Size Before': formatBytes(data.details.sizeBefore),
            'Size After': formatBytes(data.details.sizeAfter),
            'Space Saved': formatBytes(data.details.spaceSaved),
            'Duration': `${data.details.duration}ms`
          }
        });
      } else if (data.success) {
        setToast({ message: 'Database vacuumed successfully!', type: 'success' });
      } else {
        setToast({ message: data.error || 'Failed to vacuum database', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to vacuum database', type: 'error' });
    } finally {
      setDbVacuuming(false);
    }
  };

  const handleAnalyzeDatabase = async () => {
    setDbAnalyzing(true);
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DATABASE_ANALYZE, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await response.json();
      if (!response.ok) {
        setToast({ message: data.error || data.message || 'Failed to analyze database', type: 'error' });
        return;
      }
      if (data.queued) {
        setToast({ message: 'Database analyze started in background. Check Background Jobs for progress.', type: 'success' });
        return;
      }
      if (data.success && data.details) {
        setDbResultModal({
          title: 'Analyze Complete',
          icon: '📊',
          details: {
            'Tables Analyzed': data.details.tablesAnalyzed.toString(),
            'Duration': `${data.details.duration}ms`
          }
        });
      } else if (data.success) {
        setToast({ message: 'Database analyzed successfully!', type: 'success' });
      } else {
        setToast({ message: data.error || 'Failed to analyze database', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to analyze database', type: 'error' });
    } finally {
      setDbAnalyzing(false);
    }
  };

  const handleRebuildIndexes = async () => {
    setDbRebuildingIndexes(true);
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DATABASE_REINDEX, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await response.json();
      if (!response.ok) {
        setToast({ message: data.error || data.message || 'Failed to rebuild indexes', type: 'error' });
        return;
      }
      if (data.queued) {
        setToast({ message: 'Database reindex started in background. Check Background Jobs for progress.', type: 'success' });
        return;
      }
      if (data.success && data.details) {
        setDbResultModal({
          title: 'Reindex Complete',
          icon: '🔨',
          details: {
            'Indexes Rebuilt': data.details.indexesRebuilt.toString(),
            'Duration': `${data.details.duration}ms`
          }
        });
      } else if (data.success) {
        setToast({ message: 'Database indexes rebuilt successfully!', type: 'success' });
      } else {
        setToast({ message: data.error || 'Failed to rebuild indexes', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to rebuild indexes', type: 'error' });
    } finally {
      setDbRebuildingIndexes(false);
    }
  };

  const handleBackupNow = async () => {
    setDbMaintenanceLoading(true);
    setBackupInProgress(true);
    setBackupProgress(0);
    setBackupMessage('Starting backup...');
    
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DATABASE_BACKUP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          includeVideos: backupIncludeVideos,
          includeLibrary: backupIncludeLibrary,
          includeCovers: backupIncludeCovers,
          async: true
        }),
        credentials: 'include'
      });
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error(`Server error (${response.status}): Backup may have timed out.`);
      }
      
      const data = await response.json();
      
      if (data.async && data.jobId) {
        const pollStatus = async () => {
          try {
            const statusResponse = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DATABASE_BACKUP_STATUS(data.jobId), {
              credentials: 'include'
            });
            const statusData = await statusResponse.json();
            
            setBackupProgress(statusData.progress || 0);
            setBackupMessage(statusData.message || 'Creating backup...');
            
            if (statusData.status === 'completed') {
              setBackupInProgress(false);
              setDbMaintenanceLoading(false);
              setDbResultModal({
                title: 'Backup Complete',
                icon: '💾',
                details: statusData.result?.details || {
                  'Status': 'Backup created successfully',
                  'Time': new Date().toLocaleString()
                }
              });
              setLastBackupDate(new Date().toISOString());
              loadAvailableBackups();
            } else if (statusData.status === 'failed') {
              setBackupInProgress(false);
              setDbMaintenanceLoading(false);
              setToast({ message: statusData.error || 'Backup failed', type: 'error' });
            } else {
              setTimeout(pollStatus, 3000);
            }
          } catch (pollError) {
            console.error('Failed to poll backup status:', pollError);
            setTimeout(pollStatus, 5000);
          }
        };
        
        setTimeout(pollStatus, 2000);
      } else if (data.success) {
        setBackupInProgress(false);
        setDbResultModal({
          title: 'Backup Complete',
          icon: '💾',
          details: data.details || { 'Status': 'Backup created successfully' }
        });
        setLastBackupDate(new Date().toISOString());
        loadAvailableBackups();
        setDbMaintenanceLoading(false);
      } else {
        setBackupInProgress(false);
        setToast({ message: data.error || 'Failed to create backup', type: 'error' });
        setDbMaintenanceLoading(false);
      }
    } catch (error: any) {
      setBackupInProgress(false);
      setToast({ message: error?.message || 'Failed to create backup', type: 'error' });
      setDbMaintenanceLoading(false);
    }
  };

  const handleSaveDatabaseSettings = async () => {
    setDbMaintenanceLoading(true);
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DATABASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backupScheduleEnabled,
          backupInterval,
          backupRetention,
          remoteBackupEnabled,
          remoteBackupType,
          remoteBackupHost,
          remoteBackupPort,
          remoteBackupUsername,
          remoteBackupPassword,
          remoteBackupPath,
          backupIncludeVideos,
          backupIncludeLibrary,
          backupIncludeCovers,
          backupWebhookUrl
        }),
        credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: 'Database settings saved!', type: 'success' });
      } else {
        setToast({ message: data.error || 'Failed to save database settings', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to save database settings', type: 'error' });
    } finally {
      setDbMaintenanceLoading(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (!selectedBackup) {
      setToast({ message: 'Please select a backup to restore', type: 'error' });
      return;
    }
    
    setRestoreInProgress(true);
    setRestoreProgress(0);
    setRestoreMessage('Starting restore...');
    
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DATABASE_RESTORE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupFile: selectedBackup, async: true }),
        credentials: 'include'
      });
      
      const data = await response.json();
      
      if (data.async && data.jobId) {
        const pollStatus = async () => {
          try {
            const statusResponse = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DATABASE_RESTORE_STATUS(data.jobId), {
              credentials: 'include'
            });
            const statusData = await statusResponse.json();
            
            setRestoreProgress(statusData.progress || 0);
            setRestoreMessage(statusData.message || '');
            
            if (statusData.status === 'completed') {
              setRestoreInProgress(false);
              setRestoreProgress(100);
              setRestoreMessage('Restore complete! Server restarting...');
              setShowRestoreModal(false);
              setRestartMessage('Server restarting after restore...');
              setShowRestartSplash(true);
            } else if (statusData.status === 'failed') {
              setRestoreInProgress(false);
              setToast({ message: statusData.error || 'Restore failed', type: 'error' });
            } else {
              setTimeout(pollStatus, 1000);
            }
          } catch (pollError) {
            setTimeout(pollStatus, 2000);
          }
        };
        
        setTimeout(pollStatus, 1000);
      } else if (data.success) {
        setRestoreInProgress(false);
        setToast({ message: 'Restore complete! Reloading page...', type: 'success' });
        setShowRestoreModal(false);
        setTimeout(() => window.location.reload(), 2000);
      } else {
        setToast({ message: data.error || 'Failed to restore backup', type: 'error' });
        setRestoreInProgress(false);
      }
    } catch (error: any) {
      setToast({ message: error?.message || 'Failed to restore backup', type: 'error' });
      setRestoreInProgress(false);
    }
  };

  const handleTestRemoteBackup = async () => {
    setRemoteBackupTesting(true);
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DATABASE_TEST_REMOTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: remoteBackupType,
          host: remoteBackupHost,
          port: remoteBackupPort,
          username: remoteBackupUsername,
          password: remoteBackupPassword,
          path: remoteBackupPath
        }),
        credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: 'Connection successful!', type: 'success' });
      } else {
        setToast({ message: data.error || 'Connection failed', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Connection test failed', type: 'error' });
    } finally {
      setRemoteBackupTesting(false);
    }
  };

  const handleDeleteBackup = (filename: string) => {
    confirm({
      title: 'Delete backup file?',
      message: `Are you sure you want to delete backup: ${filename}?`,
      confirmText: 'Delete backup',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DATABASE_BACKUP_FILE(filename), {
            method: 'DELETE',
            credentials: 'include'
          });
          const data = await response.json();

          if (data.success) {
            setToast({ message: 'Backup deleted', type: 'success' });
            if (selectedBackup === filename) {
              setSelectedBackup('');
            }
            loadAvailableBackups();
          } else {
            setToast({ message: data.error || 'Failed to delete backup', type: 'error' });
          }
        } catch (error) {
          setToast({ message: 'Failed to delete backup', type: 'error' });
        }
      }
    });
  };

  return (
    <>
      <CollapsibleSection title="System" icon="🖥️">

        <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
          <label>Log Level</label>
          <div className="flex items-center gap-2.5 [&>select]:min-w-0 [&>select]:flex-1">
            <select value={logLevel} onChange={(e) => setLogLevel(e.target.value)}>
              {logLevels.map(l => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            <button type="button" className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg" onClick={handleSaveLogLevel}>Apply</button>
          </div>
          <small className="mt-1.5 block text-xs text-muted">Controls verbosity of server logs without restart</small>
        </div>
        
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white/[0.03] p-4">
            <div className="min-w-0 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>p]:mt-0.5 [&>p]:text-xs [&>p]:text-muted">
              <h3>Restart Application</h3>
              <p>Restart the server to apply configuration changes</p>
            </div>
            <button 
              type="button" 
              className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-warning/15 text-warning hover:bg-warning/25" 
              onClick={() => setConfirmRestart(true)}
              disabled={restarting}
            >
              {restarting ? 'Restarting...' : 'Restart App'}
            </button>
          </div>
        </div>

        <div className="mt-8 border-t border-line pt-8">
          <h3 className="mb-4 text-base font-semibold text-fg">🗄️ Database Maintenance</h3>
          <p className="mb-6 text-sm text-fg-soft">
            Optimize database performance with maintenance tasks
          </p>

          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button 
              type="button" 
              className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg" 
              onClick={handleVacuumDatabase}
              disabled={dbVacuuming || dbMaintenanceLoading}
              title="Removes unused space from the database"
            >
              {dbVacuuming ? 'Vacuuming...' : '⚡ Vacuum DB'}
            </button>
            
            <button 
              type="button" 
              className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg" 
              onClick={handleAnalyzeDatabase}
              disabled={dbAnalyzing || dbMaintenanceLoading}
              title="Analyzes query statistics to optimize performance"
            >
              {dbAnalyzing ? 'Analyzing...' : '📊 Analyze DB'}
            </button>

            <button 
              type="button" 
              className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg" 
              onClick={handleRebuildIndexes}
              disabled={dbRebuildingIndexes || dbMaintenanceLoading}
              title="Rebuilds all database indexes for optimal query performance"
            >
              {dbRebuildingIndexes ? 'Rebuilding...' : '🔨 Rebuild Indexes'}
            </button>

            <button 
              type="button" 
              className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg" 
              onClick={handleBackupNow}
              disabled={dbMaintenanceLoading}
              title="Create a backup of the database now"
            >
              {dbMaintenanceLoading ? 'Backing Up...' : '💾 Backup Now'}
            </button>
          </div>

          {lastBackupDate && (
            <div className="mb-6 rounded-lg bg-accent/10 p-3 text-sm text-fg-soft">
              Last backup: {new Date(lastBackupDate).toLocaleString()}
            </div>
          )}

          {/* Backup Schedule */}
          <div className="mt-6 border-t border-line pt-6">
            <h4 className="mb-4 text-sm font-semibold text-fg">Backup Schedule</h4>
            
            <div className="mb-4 space-y-1">
              <label className="flex cursor-pointer items-center gap-2.5 py-1 text-sm text-fg-soft [&>input]:size-4 [&>input]:shrink-0 [&>input]:accent-accent">
                <input
                  type="checkbox"
                  checked={backupScheduleEnabled}
                  onChange={(e) => setBackupScheduleEnabled(e.target.checked)}
                  disabled={dbMaintenanceLoading}
                />
                <span className="select-none">Enable automatic backups</span>
              </label>
            </div>

            {backupScheduleEnabled && (
              <div className="my-4 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
                  <label>Backup Interval (days)</label>
                  <input
                    type="number"
                    value={backupInterval}
                    onChange={(e) => setBackupInterval(parseInt(e.target.value) || 7)}
                    placeholder="7"
                    min="1"
                    max="365"
                    disabled={dbMaintenanceLoading}
                  />
                </div>

                <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
                  <label>Retention Period (days)</label>
                  <input
                    type="number"
                    value={backupRetention}
                    onChange={(e) => setBackupRetention(parseInt(e.target.value) || 30)}
                    placeholder="30"
                    min="1"
                    max="365"
                    disabled={dbMaintenanceLoading}
                  />
                  <small className="mt-1.5 block text-xs text-muted">
                    Older backups will be automatically deleted
                  </small>
                </div>
              </div>
            )}
          </div>

          {/* Backup Options */}
          <div className="mt-6 border-t border-line pt-6">
            <h4 className="mb-4 text-sm font-semibold text-fg">📦 Backup Options</h4>
            <p className="mb-4 text-sm text-fg-soft">
              Select what to include in backups
            </p>
            
            <div className="flex flex-col gap-1">
              <label className="flex cursor-pointer items-center gap-2.5 py-1 text-sm text-fg-soft [&>input]:size-4 [&>input]:shrink-0 [&>input]:accent-accent">
                <input
                  type="checkbox"
                  checked={backupIncludeVideos}
                  onChange={(e) => setBackupIncludeVideos(e.target.checked)}
                  disabled={dbMaintenanceLoading}
                />
                <span className="select-none">Include timelapse videos</span>
              </label>
              
              <label className="flex cursor-pointer items-center gap-2.5 py-1 text-sm text-fg-soft [&>input]:size-4 [&>input]:shrink-0 [&>input]:accent-accent">
                <input
                  type="checkbox"
                  checked={backupIncludeLibrary}
                  onChange={(e) => setBackupIncludeLibrary(e.target.checked)}
                  disabled={dbMaintenanceLoading}
                />
                <span className="select-none">Include library files (.3mf, .stl, .gcode)</span>
              </label>
              
              <label className="flex cursor-pointer items-center gap-2.5 py-1 text-sm text-fg-soft [&>input]:size-4 [&>input]:shrink-0 [&>input]:accent-accent">
                <input
                  type="checkbox"
                  checked={backupIncludeCovers}
                  onChange={(e) => setBackupIncludeCovers(e.target.checked)}
                  disabled={dbMaintenanceLoading}
                />
                <span className="select-none">Include cover images</span>
              </label>
            </div>
            <small className="mt-4 block text-xs text-muted">
              Database is always included. Uncheck options to create smaller, faster backups.
            </small>
          </div>

          {/* Remote Backup */}
          <div className="mt-6 border-t border-line pt-6">
            <h4 className="mb-4 text-sm font-semibold text-fg">📤 Remote Backup Location</h4>
            
            <div className="mb-4 space-y-1">
              <label className="flex cursor-pointer items-center gap-2.5 py-1 text-sm text-fg-soft [&>input]:size-4 [&>input]:shrink-0 [&>input]:accent-accent">
                <input
                  type="checkbox"
                  checked={remoteBackupEnabled}
                  onChange={(e) => setRemoteBackupEnabled(e.target.checked)}
                  disabled={dbMaintenanceLoading}
                />
                <span className="select-none">Enable remote backup (SFTP/FTP)</span>
              </label>
              <p className="text-xs text-muted">Upload backups to a remote server</p>
            </div>

            {remoteBackupEnabled && (
              <div className="mt-4">
                <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
                  <label>Protocol</label>
                  <select
                    value={remoteBackupType}
                    onChange={(e) => {
                      setRemoteBackupType(e.target.value as 'sftp' | 'ftp');
                      setRemoteBackupPort(e.target.value === 'sftp' ? 22 : 21);
                    }}
                    disabled={dbMaintenanceLoading}
                  >
                    <option value="sftp">SFTP (Secure)</option>
                    <option value="ftp">FTP</option>
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-[2fr_1fr]">
                  <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
                    <label>Host</label>
                    <input
                      type="text"
                      value={remoteBackupHost}
                      onChange={(e) => setRemoteBackupHost(e.target.value)}
                      placeholder="backup.example.com"
                      disabled={dbMaintenanceLoading}
                    />
                  </div>
                  <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
                    <label>Port</label>
                    <input
                      type="number"
                      value={remoteBackupPort}
                      onChange={(e) => setRemoteBackupPort(parseInt(e.target.value) || 22)}
                      disabled={dbMaintenanceLoading}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                  <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
                    <label>Username</label>
                    <input
                      type="text"
                      value={remoteBackupUsername}
                      onChange={(e) => setRemoteBackupUsername(e.target.value)}
                      placeholder="backup_user"
                      disabled={dbMaintenanceLoading}
                    />
                  </div>
                  <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
                    <label>Password</label>
                    <input
                      type="password"
                      value={remoteBackupPassword}
                      onChange={(e) => setRemoteBackupPassword(e.target.value)}
                      placeholder="••••••••"
                      disabled={dbMaintenanceLoading}
                    />
                  </div>
                </div>

                <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
                  <label>Remote Path</label>
                  <input
                    type="text"
                    value={remoteBackupPath}
                    onChange={(e) => setRemoteBackupPath(e.target.value)}
                    placeholder="/backups/printhive"
                    disabled={dbMaintenanceLoading}
                  />
                </div>

                <button 
                  type="button" 
                  className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg" 
                  onClick={handleTestRemoteBackup}
                  disabled={dbMaintenanceLoading || remoteBackupTesting || !remoteBackupHost}
                >
                  {remoteBackupTesting ? 'Testing...' : '🔌 Test Connection'}
                </button>
              </div>
            )}
          </div>

          {/* Webhook */}
          <div className="mt-6 border-t border-line pt-6">
            <h4 className="mb-4 text-sm font-semibold text-fg">🔔 Backup Webhook</h4>
            
            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
              <label>Webhook URL (optional)</label>
              <input
                type="url"
                value={backupWebhookUrl}
                onChange={(e) => setBackupWebhookUrl(e.target.value)}
                placeholder="https://your-server.com/webhook/backup"
                disabled={dbMaintenanceLoading}
              />
            </div>

            <button 
              type="button" 
              className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong" 
              onClick={handleSaveDatabaseSettings}
              disabled={dbMaintenanceLoading}
            >
              {dbMaintenanceLoading ? 'Saving...' : 'Save Backup Settings'}
            </button>
          </div>

          {/* Restore */}
          <div className="mt-6 border-t border-line pt-6">
            <h4 className="mb-4 text-sm font-semibold text-fg">♻️ Restore from Backup</h4>

            {backupStats.count > 0 && (
              <div className="mb-4 flex justify-around rounded-lg bg-accent/10 p-4">
                <div className="text-center">
                  <div className="text-2xl font-bold tabular-nums text-accent">{backupStats.count}</div>
                  <div className="text-xs text-fg-soft">Backups</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold tabular-nums text-accent">{backupStats.totalSizeFormatted}</div>
                  <div className="text-xs text-fg-soft">Total Size</div>
                </div>
              </div>
            )}
            
            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
              <label>Available Backups</label>
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto rounded-lg bg-black/20 p-2">
                {availableBackups.length === 0 ? (
                  <div className="rounded-lg bg-white/5 p-4 text-center text-sm text-muted">
                    No backups found
                  </div>
                ) : (
                  availableBackups.map((backup) => (
                    <div key={backup.name} className={`flex items-center gap-2 rounded-lg p-3 ${selectedBackup === backup.name ? 'bg-accent/10 ring-1 ring-accent/30' : 'bg-white/5'}`}>
                      <input 
                        type="radio" 
                        name="selectedBackup" 
                        value={backup.name}
                        checked={selectedBackup === backup.name}
                        onChange={(e) => setSelectedBackup(e.target.value)}
                        disabled={restoreInProgress}
                        className="shrink-0 accent-accent"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-fg">{backup.date}</div>
                        <div className="text-xs tabular-nums text-muted">{backup.size}</div>
                      </div>
                      <button
                        type="button"
                        className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-danger/15 text-danger hover:bg-danger/25"
                        onClick={(e) => {
                          e.preventDefault();
                          handleDeleteBackup(backup.name);
                        }}
                        disabled={restoreInProgress}
                        aria-label={`Delete backup ${backup.name}`}
                      >
                        🗑️
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button 
                type="button" 
                className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg" 
                onClick={loadAvailableBackups}
                disabled={restoreInProgress}
              >
                🔄 Refresh
              </button>
              
              <button 
                type="button" 
                className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-warning/15 text-warning hover:bg-warning/25" 
                onClick={() => setShowRestoreModal(true)}
                disabled={!selectedBackup || restoreInProgress}
              >
                {restoreInProgress ? 'Restoring...' : '♻️ Restore'}
              </button>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      <ConfirmModal
        isOpen={confirmRestart}
        title="Restart Application"
        message="Are you sure you want to restart the application? This will briefly disconnect all users."
        confirmText="Restart"
        confirmButtonClass="btn-warning"
        onConfirm={handleRestartApp}
        onCancel={() => setConfirmRestart(false)}
      />

      {/* DB Result Modal */}
      {dbResultModal && (
        <Modal
          title={<><span aria-hidden="true">{dbResultModal.icon}</span> {dbResultModal.title}</>}
          onClose={() => setDbResultModal(null)}
          contentClassName="sm:max-w-md"
        >
          <div className="divide-y divide-line">
            {Object.entries(dbResultModal.details).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-muted">{key}</span>
                <span className="font-medium tabular-nums text-fg">{value}</span>
              </div>
            ))}
          </div>
          <button
            className="mt-6 inline-flex min-h-11 md:min-h-9 w-full items-center justify-center rounded-md bg-accent px-3 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-strong"
            onClick={() => setDbResultModal(null)}
          >
            Done
          </button>
        </Modal>
      )}

      {/* Restore Modal */}
      {showRestoreModal && (
        <Modal
          title={restoreInProgress ? 'Restoring Backup' : 'Confirm Restore'}
          onClose={() => { if (!restoreInProgress) setShowRestoreModal(false); }}
          contentClassName="sm:max-w-md"
        >
          {restoreInProgress ? (
            <>
              <p className="mb-4 text-center text-sm text-fg-soft">
                {restoreMessage}
              </p>
              <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500"
                  style={{ width: `${restoreProgress}%` }}
                />
              </div>
              <p className="text-center text-xs font-semibold tabular-nums text-fg-soft">{restoreProgress}%</p>
            </>
          ) : (
            <>
              <p className="mb-4 text-sm text-fg-soft">
                Are you sure you want to restore from this backup?
              </p>
              <p className="mb-4 text-sm font-bold text-danger">
                This will replace the current database!
              </p>
              <p className="mb-6 text-xs text-muted">
                Backup: {selectedBackup}
              </p>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg"
                  onClick={() => setShowRestoreModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-warning/15 text-warning hover:bg-warning/25"
                  onClick={handleRestoreBackup}
                >
                  Restore Now
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {showRestartSplash && (
        <LoadingSplash 
          message={restartMessage}
          checkServerHealth={true}
          onComplete={() => window.location.reload()}
        />
      )}

      {backupInProgress && (
        <LoadingSplash 
          message={backupMessage}
          progress={backupProgress}
        />
      )}
    </>
  );
}

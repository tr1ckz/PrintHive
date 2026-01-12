import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../../config/api';
import fetchWithRetry from '../../utils/fetchWithRetry';
import { useSettingsContext } from './SettingsContext';
import { CollapsibleSection } from './CollapsibleSection';
import { BackupInfo, BackupStats, DbResultModal } from './types';
import LoadingSplash from '../LoadingSplash';
import ConfirmModal from '../ConfirmModal';

export function SystemSettings() {
  const { setToast } = useSettingsContext();
  
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

  const handleDeleteBackup = async (filename: string) => {
    if (!confirm(`Are you sure you want to delete backup: ${filename}?`)) {
      return;
    }
    
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
  };

  return (
    <>
      <CollapsibleSection title="System" icon="🖥️">
        <p className="form-description">
          Application management and maintenance
        </p>
        
        <div className="form-group">
          <label>Log Level</label>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <select value={logLevel} onChange={(e) => setLogLevel(e.target.value)}>
              {logLevels.map(l => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            <button type="button" className="btn btn-secondary" onClick={handleSaveLogLevel}>Apply</button>
          </div>
          <small className="form-hint">Controls verbosity of server logs without restart</small>
        </div>
        
        <div className="system-actions">
          <div className="system-action">
            <div className="action-info">
              <h3>Restart Application</h3>
              <p>Restart the server to apply configuration changes</p>
            </div>
            <button 
              type="button" 
              className="btn btn-warning" 
              onClick={() => setConfirmRestart(true)}
              disabled={restarting}
            >
              {restarting ? 'Restarting...' : 'Restart App'}
            </button>
          </div>
        </div>

        <div style={{ marginTop: '2rem', borderTop: '1px solid rgba(0, 212, 255, 0.2)', paddingTop: '2rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#fff', marginBottom: '1rem' }}>🗄️ Database Maintenance</h3>
          <p className="form-description" style={{ marginBottom: '1.5rem' }}>
            Optimize database performance with maintenance tasks
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            <button 
              type="button" 
              className="btn btn-secondary" 
              onClick={handleVacuumDatabase}
              disabled={dbVacuuming || dbMaintenanceLoading}
              title="Removes unused space from the database"
            >
              {dbVacuuming ? 'Vacuuming...' : '⚡ Vacuum DB'}
            </button>
            
            <button 
              type="button" 
              className="btn btn-secondary" 
              onClick={handleAnalyzeDatabase}
              disabled={dbAnalyzing || dbMaintenanceLoading}
              title="Analyzes query statistics to optimize performance"
            >
              {dbAnalyzing ? 'Analyzing...' : '📊 Analyze DB'}
            </button>

            <button 
              type="button" 
              className="btn btn-secondary" 
              onClick={handleRebuildIndexes}
              disabled={dbRebuildingIndexes || dbMaintenanceLoading}
              title="Rebuilds all database indexes for optimal query performance"
            >
              {dbRebuildingIndexes ? 'Rebuilding...' : '🔨 Rebuild Indexes'}
            </button>

            <button 
              type="button" 
              className="btn btn-secondary" 
              onClick={handleBackupNow}
              disabled={dbMaintenanceLoading}
              title="Create a backup of the database now"
            >
              {dbMaintenanceLoading ? 'Backing Up...' : '💾 Backup Now'}
            </button>
          </div>

          {lastBackupDate && (
            <div style={{ padding: '0.75rem', background: 'rgba(0, 212, 255, 0.1)', borderRadius: '8px', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
              Last backup: {new Date(lastBackupDate).toLocaleString()}
            </div>
          )}

          {/* Backup Schedule */}
          <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(0, 212, 255, 0.2)' }}>
            <h4 style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '1rem' }}>Backup Schedule</h4>
            
            <div className="toggle-group">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={backupScheduleEnabled}
                  onChange={(e) => setBackupScheduleEnabled(e.target.checked)}
                  disabled={dbMaintenanceLoading}
                />
                <span className="toggle-text">Enable automatic backups</span>
              </label>
            </div>

            {backupScheduleEnabled && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem', marginBottom: '1rem' }}>
                <div className="form-group">
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

                <div className="form-group">
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
                  <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>
                    Older backups will be automatically deleted
                  </small>
                </div>
              </div>
            )}
          </div>

          {/* Backup Options */}
          <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(0, 212, 255, 0.2)' }}>
            <h4 style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '1rem' }}>📦 Backup Options</h4>
            <p className="form-description" style={{ marginBottom: '1rem' }}>
              Select what to include in backups
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <label className="toggle-label" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <input
                  type="checkbox"
                  checked={backupIncludeVideos}
                  onChange={(e) => setBackupIncludeVideos(e.target.checked)}
                  disabled={dbMaintenanceLoading}
                />
                <span className="toggle-text">Include timelapse videos</span>
              </label>
              
              <label className="toggle-label" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <input
                  type="checkbox"
                  checked={backupIncludeLibrary}
                  onChange={(e) => setBackupIncludeLibrary(e.target.checked)}
                  disabled={dbMaintenanceLoading}
                />
                <span className="toggle-text">Include library files (.3mf, .stl, .gcode)</span>
              </label>
              
              <label className="toggle-label" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <input
                  type="checkbox"
                  checked={backupIncludeCovers}
                  onChange={(e) => setBackupIncludeCovers(e.target.checked)}
                  disabled={dbMaintenanceLoading}
                />
                <span className="toggle-text">Include cover images</span>
              </label>
            </div>
            <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '1rem' }}>
              Database is always included. Uncheck options to create smaller, faster backups.
            </small>
          </div>

          {/* Remote Backup */}
          <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(0, 212, 255, 0.2)' }}>
            <h4 style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '1rem' }}>📤 Remote Backup Location</h4>
            
            <div className="toggle-group">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={remoteBackupEnabled}
                  onChange={(e) => setRemoteBackupEnabled(e.target.checked)}
                  disabled={dbMaintenanceLoading}
                />
                <span className="toggle-text">Enable remote backup (SFTP/FTP)</span>
              </label>
              <p className="toggle-hint">Upload backups to a remote server</p>
            </div>

            {remoteBackupEnabled && (
              <div style={{ marginTop: '1rem' }}>
                <div className="form-group" style={{ marginBottom: '1rem' }}>
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

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div className="form-group">
                    <label>Host</label>
                    <input
                      type="text"
                      value={remoteBackupHost}
                      onChange={(e) => setRemoteBackupHost(e.target.value)}
                      placeholder="backup.example.com"
                      disabled={dbMaintenanceLoading}
                    />
                  </div>
                  <div className="form-group">
                    <label>Port</label>
                    <input
                      type="number"
                      value={remoteBackupPort}
                      onChange={(e) => setRemoteBackupPort(parseInt(e.target.value) || 22)}
                      disabled={dbMaintenanceLoading}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div className="form-group">
                    <label>Username</label>
                    <input
                      type="text"
                      value={remoteBackupUsername}
                      onChange={(e) => setRemoteBackupUsername(e.target.value)}
                      placeholder="backup_user"
                      disabled={dbMaintenanceLoading}
                    />
                  </div>
                  <div className="form-group">
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

                <div className="form-group" style={{ marginBottom: '1rem' }}>
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
                  className="btn btn-secondary" 
                  onClick={handleTestRemoteBackup}
                  disabled={dbMaintenanceLoading || remoteBackupTesting || !remoteBackupHost}
                  style={{ marginBottom: '1rem' }}
                >
                  {remoteBackupTesting ? 'Testing...' : '🔌 Test Connection'}
                </button>
              </div>
            )}
          </div>

          {/* Webhook */}
          <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(0, 212, 255, 0.2)' }}>
            <h4 style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '1rem' }}>🔔 Backup Webhook</h4>
            
            <div className="form-group">
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
              className="btn btn-primary" 
              onClick={handleSaveDatabaseSettings}
              disabled={dbMaintenanceLoading}
              style={{ marginTop: '1rem' }}
            >
              {dbMaintenanceLoading ? 'Saving...' : 'Save Backup Settings'}
            </button>
          </div>

          {/* Restore */}
          <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(0, 212, 255, 0.2)' }}>
            <h4 style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '1rem' }}>♻️ Restore from Backup</h4>
            
            {backupStats.count > 0 && (
              <div style={{ padding: '1rem', background: 'rgba(0, 212, 255, 0.1)', borderRadius: '8px', marginBottom: '1rem', display: 'flex', justifyContent: 'space-around', fontSize: '0.9rem' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#00d4ff' }}>{backupStats.count}</div>
                  <div style={{ color: 'rgba(255,255,255,0.7)' }}>Backups</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#00d4ff' }}>{backupStats.totalSizeFormatted}</div>
                  <div style={{ color: 'rgba(255,255,255,0.7)' }}>Total Size</div>
                </div>
              </div>
            )}
            
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label>Available Backups</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '400px', overflowY: 'auto', padding: '0.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                {availableBackups.length === 0 ? (
                  <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>
                    No backups found
                  </div>
                ) : (
                  availableBackups.map((backup) => (
                    <div key={backup.name} style={{ 
                      display: 'flex', 
                      gap: '0.5rem', 
                      alignItems: 'center',
                      padding: '0.75rem',
                      background: selectedBackup === backup.name ? 'rgba(0, 212, 255, 0.1)' : 'rgba(255,255,255,0.05)',
                      borderRadius: '8px',
                      border: selectedBackup === backup.name ? '1px solid rgba(0, 212, 255, 0.3)' : '1px solid transparent'
                    }}>
                      <input 
                        type="radio" 
                        name="selectedBackup" 
                        value={backup.name}
                        checked={selectedBackup === backup.name}
                        onChange={(e) => setSelectedBackup(e.target.value)}
                        disabled={restoreInProgress}
                        style={{ flexShrink: 0 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500 }}>{backup.date}</div>
                        <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)' }}>{backup.size}</div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={(e) => {
                          e.preventDefault();
                          handleDeleteBackup(backup.name);
                        }}
                        disabled={restoreInProgress}
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                      >
                        🗑️
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={loadAvailableBackups}
                disabled={restoreInProgress}
              >
                🔄 Refresh
              </button>
              
              <button 
                type="button" 
                className="btn btn-warning" 
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
        <div className="modal-overlay" onClick={() => setDbResultModal(null)}>
          <div className="db-result-modal" onClick={e => e.stopPropagation()}>
            <div className="db-result-header">
              <span className="db-result-icon">{dbResultModal.icon}</span>
              <h3>{dbResultModal.title}</h3>
            </div>
            <div className="db-result-details">
              {Object.entries(dbResultModal.details).map(([key, value]) => (
                <div key={key} className="db-result-row">
                  <span className="db-result-label">{key}</span>
                  <span className="db-result-value">{value}</span>
                </div>
              ))}
            </div>
            <button 
              className="btn btn-primary" 
              onClick={() => setDbResultModal(null)}
              style={{ marginTop: '1.5rem', width: '100%' }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Restore Modal */}
      {showRestoreModal && (
        <div className="modal-overlay" onClick={() => !restoreInProgress && setShowRestoreModal(false)}>
          <div className="db-result-modal" onClick={(e) => e.stopPropagation()}>
            <div className="db-result-header">
              <span className="db-result-icon">{restoreInProgress ? '♻️' : '⚠️'}</span>
              <h3>{restoreInProgress ? 'Restoring Backup' : 'Confirm Restore'}</h3>
            </div>
            <div className="db-result-details">
              {restoreInProgress ? (
                <>
                  <p style={{ marginBottom: '1rem', color: 'rgba(255,255,255,0.8)', textAlign: 'center' }}>
                    {restoreMessage}
                  </p>
                  <div style={{ width: '100%', height: '30px', background: 'rgba(255,255,255,0.1)', borderRadius: '15px', overflow: 'hidden', marginBottom: '1rem' }}>
                    <div 
                      style={{ 
                        width: `${restoreProgress}%`, 
                        height: '100%', 
                        background: 'linear-gradient(90deg, #00d4ff, #0099cc)', 
                        transition: 'width 0.5s ease',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        color: '#fff'
                      }}
                    >
                      {restoreProgress}%
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ marginBottom: '1rem', color: 'rgba(255,255,255,0.8)' }}>
                    Are you sure you want to restore from this backup?
                  </p>
                  <p style={{ marginBottom: '1rem', fontWeight: 'bold', color: '#ff6b6b' }}>
                    This will replace the current database!
                  </p>
                  <p style={{ marginBottom: '1.5rem', fontSize: '0.9rem', color: 'rgba(255,255,255,0.6)' }}>
                    Backup: {selectedBackup}
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                    <button 
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setShowRestoreModal(false)}
                    >
                      Cancel
                    </button>
                    <button 
                      type="button"
                      className="btn btn-warning"
                      onClick={handleRestoreBackup}
                    >
                      Restore Now
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
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

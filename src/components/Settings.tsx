import { useState, useEffect } from 'react';
import './Settings.css';
import Toast from './Toast';
import ConfirmModal from './ConfirmModal';
import UserManagement from './UserManagement';

interface BambuStatus {
  connected: boolean;
  email: string | null;
  region: string;
  lastUpdated: string | null;
}

interface SettingsProps {
  userRole?: string;
}

// Collapsible Section Component
interface CollapsibleSectionProps {
  title: string;
  icon?: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}

function CollapsibleSection({ title, icon, children, defaultExpanded = false }: CollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  
  return (
    <div className={`settings-section collapsible ${isExpanded ? 'expanded' : ''}`}>
      <div className="section-header" onClick={() => setIsExpanded(!isExpanded)}>
        <h2>
          {icon && <span className="section-icon">{icon}</span>}
          {title}
        </h2>
        <span className="expand-icon">{isExpanded ? '−' : '+'}</span>
      </div>
      <div className="section-content">
        {children}
      </div>
    </div>
  );
}

function Settings({ userRole }: SettingsProps) {
  const isAdmin = userRole === 'admin' || userRole === 'superadmin';
  const [bambuStatus, setBambuStatus] = useState<BambuStatus | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [region, setRegion] = useState('global');
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  
  // Track which category sections are expanded
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    printer: true,
    account: false,
    preferences: false,
    integrations: false,
    advanced: false,
    administration: false
  });
  
  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };
  
  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  
  // Printer FTP settings state
  const [printerIp, setPrinterIp] = useState('');
  const [printerAccessCode, setPrinterAccessCode] = useState('');
  const [cameraRtspUrl, setCameraRtspUrl] = useState('');
  const [ftpLoading, setFtpLoading] = useState(false);
  const [ftpTesting, setFtpTesting] = useState(false);
  
  // OAuth settings state
  const [oauthProvider, setOauthProvider] = useState('none');
  const [publicHostname, setPublicHostname] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [oidcIssuer, setOidcIssuer] = useState('');
  const [oidcClientId, setOidcClientId] = useState('');
  const [oidcClientSecret, setOidcClientSecret] = useState('');
  const [oidcEndSessionUrl, setOidcEndSessionUrl] = useState('');
  const [oauthLoading, setOauthLoading] = useState(false);
  
  // UI settings state
  const [hideBmc, setHideBmc] = useState(false);
  const [uiLoading, setUiLoading] = useState(false);
  
  // Watchdog settings state
  const [watchdogEnabled, setWatchdogEnabled] = useState(false);
  const [watchdogInterval, setWatchdogInterval] = useState(30);
  const [watchdogEndpoint, setWatchdogEndpoint] = useState('');
  const [watchdogLoading, setWatchdogLoading] = useState(false);
  
  // Discord webhook settings state
  const [discordPrinterWebhook, setDiscordPrinterWebhook] = useState('');
  const [discordPrinterEnabled, setDiscordPrinterEnabled] = useState(false);
  const [discordMaintenanceWebhook, setDiscordMaintenanceWebhook] = useState('');
  const [discordMaintenanceEnabled, setDiscordMaintenanceEnabled] = useState(false);
  const [discordPingUserId, setDiscordPingUserId] = useState('');
  const [discordLoading, setDiscordLoading] = useState(false);
  const [discordTesting, setDiscordTesting] = useState<string | null>(null);
  
  // User profile state
  const [userProfile, setUserProfile] = useState({ username: '', email: '', displayName: '', oauthProvider: 'none' });
  const [profileLoading, setProfileLoading] = useState(false);
  
  // Cost calculator state
  const [filamentCostPerKg, setFilamentCostPerKg] = useState(25);
  const [electricityCostPerKwh, setElectricityCostPerKwh] = useState(0.12);
  const [printerWattage, setPrinterWattage] = useState(150);
  const [costCurrency, setCostCurrency] = useState('USD');
  const [costLoading, setCostLoading] = useState(false);
  
  // System state
  const [restarting, setRestarting] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  
  // Database maintenance state
  const [dbVacuuming, setDbVacuuming] = useState(false);
  const [dbAnalyzing, setDbAnalyzing] = useState(false);
  const [dbRebuildingIndexes, setDbRebuildingIndexes] = useState(false);
  const [backupScheduleEnabled, setBackupScheduleEnabled] = useState(false);
  const [backupInterval, setBackupInterval] = useState(7); // days
  const [backupRetention, setBackupRetention] = useState(30); // days
  const [dbMaintenanceLoading, setDbMaintenanceLoading] = useState(false);
  const [lastBackupDate, setLastBackupDate] = useState<string | null>(null);
  const [dbResultModal, setDbResultModal] = useState<{
    title: string;
    icon: string;
    details: Record<string, string | number>;
  } | null>(null);
  
  // Remote backup settings
  const [remoteBackupEnabled, setRemoteBackupEnabled] = useState(false);
  const [remoteBackupType, setRemoteBackupType] = useState<'sftp' | 'ftp'>('sftp');
  const [remoteBackupHost, setRemoteBackupHost] = useState('');
  const [remoteBackupPort, setRemoteBackupPort] = useState(22);
  const [remoteBackupUsername, setRemoteBackupUsername] = useState('');
  const [remoteBackupPassword, setRemoteBackupPassword] = useState('');
  const [remoteBackupPath, setRemoteBackupPath] = useState('/backups');
  const [remoteBackupTesting, setRemoteBackupTesting] = useState(false);
  
  // Backup options
  const [backupIncludeVideos, setBackupIncludeVideos] = useState(true);
  const [backupIncludeLibrary, setBackupIncludeLibrary] = useState(true);
  const [backupIncludeCovers, setBackupIncludeCovers] = useState(true);
  
  // Backup webhook
  const [backupWebhookUrl, setBackupWebhookUrl] = useState('');
  
  // Restore state
  const [availableBackups, setAvailableBackups] = useState<any[]>([]);
  const [selectedBackup, setSelectedBackup] = useState('');
  const [restoreInProgress, setRestoreInProgress] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  
  // Toast state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    loadBambuStatus();
    loadPrinterSettings();
    loadOAuthSettings();
    loadUiSettings();
    loadWatchdogSettings();
    loadDiscordSettings();
    loadDatabaseSettings();
    loadAvailableBackups();
    loadUserProfile();
    loadCostSettings();
  }, []);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const loadBambuStatus = async () => {
    try {
      const response = await fetch('/api/settings/bambu-status');
      const data = await response.json();
      setBambuStatus(data);
    } catch (error) {
      console.error('Failed to load Bambu status:', error);
    }
  };

  const loadPrinterSettings = async () => {
    try {
      const response = await fetch('/api/settings/printer-ftp');
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

  const loadOAuthSettings = async () => {
    try {
      const response = await fetch('/api/settings/oauth');
      const data = await response.json();
      setOauthProvider(data.provider || 'none');
      setPublicHostname(data.publicHostname || '');
      setGoogleClientId(data.googleClientId || '');
      setGoogleClientSecret(data.googleClientSecret || '');
      setOidcIssuer(data.oidcIssuer || '');
      setOidcClientId(data.oidcClientId || '');
      setOidcClientSecret(data.oidcClientSecret || '');
      setOidcEndSessionUrl(data.oidcEndSessionUrl || '');
    } catch (error) {
      console.error('Failed to load OAuth settings:', error);
    }
  };

  const loadUiSettings = async () => {
    try {
      const response = await fetch('/api/settings/ui');
      const data = await response.json();
      if (data.success) {
        setHideBmc(data.hideBmc || false);
      }
    } catch (error) {
      console.error('Failed to load UI settings:', error);
    }
  };

  const handleSaveUiSettings = async () => {
    setUiLoading(true);
    try {
      const response = await fetch('/api/settings/ui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hideBmc })
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: 'UI settings saved!', type: 'success' });
      } else {
        setToast({ message: 'Failed to save UI settings', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to save UI settings', type: 'error' });
    } finally {
      setUiLoading(false);
    }
  };

  const handleRestartApp = async () => {
    setConfirmRestart(false);
    setRestarting(true);
    setToast({ message: 'Restarting application...', type: 'success' });
    
    try {
      await fetch('/api/settings/restart', { method: 'POST' });
      // The server will restart, so we'll lose connection
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    } catch (error) {
      // Expected - server is restarting
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    }
  };

  const loadAvailableBackups = async () => {
    try {
      const response = await fetch('/api/settings/database/backups');
      const data = await response.json();
      if (data.success) {
        setAvailableBackups(data.backups || []);
      }
    } catch (error) {
      console.error('Failed to load available backups:', error);
    }
  };

  const loadDatabaseSettings = async () => {
    try {
      const response = await fetch('/api/settings/database');
      const data = await response.json();
      if (!response.ok) return;
      setBackupScheduleEnabled(data.backupScheduleEnabled ?? false);
      setBackupInterval(data.backupInterval ?? 7);
      setBackupRetention(data.backupRetention ?? 30);
      setLastBackupDate(data.lastBackupDate ?? null);
      // Remote backup settings
      setRemoteBackupEnabled(data.remoteBackupEnabled ?? false);
      setRemoteBackupType(data.remoteBackupType ?? 'sftp');
      setRemoteBackupHost(data.remoteBackupHost ?? '');
      setRemoteBackupPort(data.remoteBackupPort ?? 22);
      setRemoteBackupUsername(data.remoteBackupUsername ?? '');
      setRemoteBackupPassword(data.remoteBackupPassword ?? '');
      setRemoteBackupPath(data.remoteBackupPath ?? '/backups');
      // Backup webhook
      setBackupWebhookUrl(data.backupWebhookUrl ?? '');
      // Backup options
      setBackupIncludeVideos(data.backupIncludeVideos !== false);
      setBackupIncludeLibrary(data.backupIncludeLibrary !== false);
      setBackupIncludeCovers(data.backupIncludeCovers !== false);
    } catch (error) {
      console.error('Failed to load database settings:', error);
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
      const response = await fetch('/api/settings/database/vacuum', {
        method: 'POST'
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
      const response = await fetch('/api/settings/database/analyze', {
        method: 'POST'
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
      const response = await fetch('/api/settings/database/reindex', {
        method: 'POST'
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
    setToast({ message: 'Creating backup... This may take several minutes for large backups.', type: 'success' });
    try {
      // Use AbortController for long timeout (30 minutes for large backups)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30 * 60 * 1000);
      
      const response = await fetch('/api/settings/database/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          includeVideos: backupIncludeVideos,
          includeLibrary: backupIncludeLibrary,
          includeCovers: backupIncludeCovers
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      // Check if we got an HTML error page instead of JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Backup returned non-JSON response:', text.substring(0, 200));
        throw new Error(`Server error (${response.status}): Backup may have timed out. Try excluding videos for faster backup.`);
      }
      
      const data = await response.json();
      if (data.success) {
        setDbResultModal({
          title: 'Backup Complete',
          icon: '💾',
          details: data.details || {
            'Status': 'Backup created successfully',
            'Archive Size': 'N/A',
            'Videos': backupIncludeVideos ? 'Included' : 'Excluded',
            'Library Files': backupIncludeLibrary ? 'Included' : 'Excluded',
            'Cover Images': backupIncludeCovers ? 'Included' : 'Excluded',
            'Time': new Date().toLocaleString()
          }
        });
        setLastBackupDate(new Date().toISOString());
        loadAvailableBackups();
      } else {
        setToast({ message: data.error || 'Failed to create backup', type: 'error' });
        console.error('Backup failed:', data.error);
      }
    } catch (error: any) {
      let errorMsg = 'Failed to create backup';
      if (error?.name === 'AbortError') {
        errorMsg = 'Backup timed out after 30 minutes. Try excluding videos for faster backup.';
      } else if (error?.message) {
        errorMsg = error.message;
      }
      setToast({ message: errorMsg, type: 'error' });
      console.error('Backup error:', error);
    } finally {
      setDbMaintenanceLoading(false);
    }
  };

  const handleSaveDatabaseSettings = async () => {
    setDbMaintenanceLoading(true);
    try {
      const response = await fetch('/api/settings/database', {
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
        })
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
    try {
      const response = await fetch('/api/settings/database/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupFile: selectedBackup })
      });
      const data = await response.json();
      if (data.success) {
        setDbResultModal({
          title: 'Restore Complete',
          icon: '♻️',
          details: {
            'Status': 'Database restored successfully',
            'Backup File': selectedBackup,
            'Time': new Date().toLocaleString(),
            'Note': 'Please refresh the page'
          }
        });
        setShowRestoreModal(false);
      } else {
        setToast({ message: data.error || 'Failed to restore backup', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to restore backup', type: 'error' });
    } finally {
      setRestoreInProgress(false);
    }
  };

  const handleTestRemoteBackup = async () => {
    setRemoteBackupTesting(true);
    try {
      const response = await fetch('/api/settings/database/test-remote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: remoteBackupType,
          host: remoteBackupHost,
          port: remoteBackupPort,
          username: remoteBackupUsername,
          password: remoteBackupPassword,
          path: remoteBackupPath
        })
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

  const loadWatchdogSettings = async () => {
    try {
      const response = await fetch('/api/settings/watchdog');
      const data = await response.json();
      if (!response.ok) return;
      setWatchdogEnabled(data.enabled || false);
      setWatchdogInterval(data.interval || 30);
      setWatchdogEndpoint(data.endpoint || '');
    } catch (error) {
      console.error('Failed to load watchdog settings:', error);
    }
  };

  const handleSaveWatchdogSettings = async () => {
    setWatchdogLoading(true);
    try {
      const response = await fetch('/api/settings/watchdog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: watchdogEnabled,
          interval: watchdogInterval,
          endpoint: watchdogEndpoint
        })
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: 'Watchdog settings saved!', type: 'success' });
      } else {
        setToast({ message: 'Failed to save watchdog settings', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to save watchdog settings', type: 'error' });
    } finally {
      setWatchdogLoading(false);
    }
  };

  // Discord webhook functions
  const loadDiscordSettings = async () => {
    try {
      const response = await fetch('/api/settings/discord');
      const data = await response.json();
      if (!response.ok) return;
      setDiscordPrinterWebhook(data.printerWebhook || '');
      setDiscordPrinterEnabled(data.printerEnabled || false);
      setDiscordMaintenanceWebhook(data.maintenanceWebhook || '');
      setDiscordMaintenanceEnabled(data.maintenanceEnabled || false);
      setDiscordPingUserId(data.pingUserId || '');
    } catch (error) {
      console.error('Failed to load Discord settings:', error);
    }
  };

  const handleSaveDiscordSettings = async () => {
    setDiscordLoading(true);
    try {
      const response = await fetch('/api/settings/discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          printerWebhook: discordPrinterWebhook,
          printerEnabled: discordPrinterEnabled,
          maintenanceWebhook: discordMaintenanceWebhook,
          maintenanceEnabled: discordMaintenanceEnabled,
          pingUserId: discordPingUserId
        })
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: 'Discord webhook settings saved!', type: 'success' });
      } else {
        setToast({ message: 'Failed to save Discord settings', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to save Discord settings', type: 'error' });
    } finally {
      setDiscordLoading(false);
    }
  };

  const handleTestDiscordWebhook = async (type: 'printer' | 'maintenance') => {
    const webhook = type === 'printer' ? discordPrinterWebhook : discordMaintenanceWebhook;
    if (!webhook) {
      setToast({ message: 'Please enter a webhook URL first', type: 'error' });
      return;
    }
    setDiscordTesting(type);
    try {
      const response = await fetch('/api/discord/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, webhook })
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: `Test ${type} notification sent!`, type: 'success' });
      } else {
        setToast({ message: data.error || 'Failed to send test notification', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to send test notification', type: 'error' });
    } finally {
      setDiscordTesting(null);
    }
  };

  const loadUserProfile = async () => {
    try {
      const response = await fetch('/api/settings/profile');
      const data = await response.json();
      if (!response.ok) return;
      setUserProfile(data);
    } catch (error) {
      console.error('Failed to load user profile:', error);
    }
  };

  const handleSaveProfile = async () => {
    setProfileLoading(true);
    try {
      const response = await fetch('/api/settings/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: userProfile.displayName,
          email: userProfile.email
        })
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: 'Profile updated!', type: 'success' });
      } else {
        setToast({ message: 'Failed to update profile', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to update profile', type: 'error' });
    } finally {
      setProfileLoading(false);
    }
  };

  const loadCostSettings = async () => {
    try {
      const response = await fetch('/api/settings/costs');
      const data = await response.json();
      if (!response.ok) return;
      setFilamentCostPerKg(data.filamentCostPerKg ?? 25);
      setElectricityCostPerKwh(data.electricityCostPerKwh ?? 0.12);
      setPrinterWattage(data.printerWattage ?? 150);
      setCostCurrency(data.currency ?? 'USD');
    } catch (error) {
      console.error('Failed to load cost settings:', error);
    }
  };

  const handleSaveCostSettings = async () => {
    setCostLoading(true);
    try {
      const response = await fetch('/api/settings/costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filamentCostPerKg,
          electricityCostPerKwh,
          printerWattage,
          currency: costCurrency
        })
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: 'Cost settings saved!', type: 'success' });
      } else {
        setToast({ message: 'Failed to save cost settings', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to save cost settings', type: 'error' });
    } finally {
      setCostLoading(false);
    }
  };

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/settings/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, region })
      });

      const data = await response.json();

      if (data.success) {
        setCodeSent(true);
        setCountdown(300); // 5 minutes = 300 seconds
        setToast({ message: 'Verification code sent to your email!', type: 'success' });
      } else {
        setToast({ message: data.error, type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to send verification code', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/settings/connect-bambu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, region })
      });

      const data = await response.json();

      if (data.success) {
        setToast({ message: 'Successfully connected to Bambu Lab!', type: 'success' });
        setCode('');
        setCodeSent(false);
        await loadBambuStatus();
      } else {
        setToast({ message: data.error, type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to connect to Bambu Lab', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnectClick = () => {
    setConfirmDisconnect(true);
  };

  const handleDisconnect = async () => {
    setConfirmDisconnect(false);
    setLoading(true);

    try {
      const response = await fetch('/api/settings/disconnect-bambu', {
        method: 'POST'
      });

      const data = await response.json();

      if (data.success) {
        setToast({ message: 'Disconnected from Bambu Lab', type: 'success' });
        await loadBambuStatus();
      } else {
        setToast({ message: 'Failed to disconnect', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to disconnect', type: 'error' });
    } finally {
      setLoading(false);
    }
  };
  
  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordLoading(true);
    
    if (newPassword !== confirmPassword) {
      setToast({ message: 'New passwords do not match', type: 'error' });
      setPasswordLoading(false);
      return;
    }
    
    if (newPassword.length < 4) {
      setToast({ message: 'Password must be at least 4 characters', type: 'error' });
      setPasswordLoading(false);
      return;
    }
    
    try {
      const response = await fetch('/api/settings/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setToast({ message: 'Password changed successfully!', type: 'success' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setToast({ message: data.error, type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to change password', type: 'error' });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSavePrinterSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setFtpLoading(true);
    
    try {
      const response = await fetch('/api/settings/save-printer-ftp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printerIp, printerAccessCode, cameraRtspUrl })
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
      const response = await fetch('/api/settings/test-printer-ftp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printerIp, printerAccessCode })
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

  const handleSaveOAuthSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setOauthLoading(true);
    
    try {
      const response = await fetch('/api/settings/save-oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: oauthProvider,
          publicHostname,
          googleClientId,
          googleClientSecret,
          oidcIssuer,
          oidcClientId,
          oidcClientSecret,
          oidcEndSessionUrl
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setToast({ message: 'OAuth settings saved successfully! Restart required.', type: 'success' });
      } else {
        setToast({ message: data.error, type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to save OAuth settings', type: 'error' });
    } finally {
      setOauthLoading(false);
    }
  };

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h1>⚙️ Settings</h1>
        <p className="settings-description">
          Configure your printers, account, and preferences
        </p>
      </div>

      {/* PRINTER CONNECTION */}
      <div className="settings-category">
        <div 
          className={`category-header category-collapsible ${expandedCategories.printer ? 'expanded' : ''}`}
          onClick={() => toggleCategory('printer')}
        >
          <span className="category-icon">🖨️</span>
          <h2>Printer Connection</h2>
          <span className="category-toggle-icon">{expandedCategories.printer ? '−' : '+'}</span>
        </div>

        {expandedCategories.printer && (
          <>
        <CollapsibleSection title="Bambu Lab Account" icon="🔗" defaultExpanded={!bambuStatus?.connected}>
        
        {bambuStatus?.connected ? (
          <div className="bambu-connected">
            <div className="status-badge connected">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Connected
            </div>

            <div className="bambu-info">
              <div className="info-row">
                <span className="info-label">Email:</span>
                <span className="info-value">{bambuStatus.email}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Region:</span>
                <span className="info-value">{bambuStatus.region === 'china' ? 'China' : 'Global'}</span>
              </div>
              {bambuStatus.lastUpdated && (
                <div className="info-row">
                  <span className="info-label">Last updated:</span>
                  <span className="info-value">{new Date(bambuStatus.lastUpdated).toLocaleString()}</span>
                </div>
              )}
            </div>

            <button 
              className="btn btn-danger" 
              onClick={handleDisconnectClick}
              disabled={loading}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <form onSubmit={codeSent ? handleConnect : handleRequestCode} className="bambu-connect-form">
            <p className="form-description">
              Connect your Bambu Lab account to access your printers and print history
            </p>

            <div className="form-group">
              <label>Bambu Lab Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                disabled={loading || codeSent}
              />
            </div>

            <div className="form-group">
              <label>Region</label>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                disabled={loading || codeSent}
              >
                <option value="global">Global</option>
                <option value="china">China</option>
              </select>
            </div>

            {codeSent && (
              <div className="form-group">
                <label>Verification Code</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Enter 6-digit code from email"
                  required
                  disabled={loading}
                  maxLength={6}
                />
              </div>
            )}

            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={loading}
            >
              {loading ? (codeSent ? 'Connecting...' : 'Sending Code...') : (codeSent ? 'Connect' : 'Send Verification Code')}
            </button>

            {codeSent && (
              <>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={handleRequestCode}
                  disabled={loading || countdown > 0}
                  style={{ marginLeft: '10px' }}
                >
                  {countdown > 0 ? `Resend Code (${Math.floor(countdown / 60)}:${(countdown % 60).toString().padStart(2, '0')})` : 'Resend Code'}
                </button>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => { setCodeSent(false); setCode(''); setCountdown(0); }}
                  disabled={loading}
                  style={{ marginLeft: '10px' }}
                >
                  Change Email
                </button>
              </>
            )}
          </form>
        )}
        </CollapsibleSection>
      
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
          </>
        )}
      </div>

      {/* ACCOUNT */}
      <div className="settings-category">
        <div 
          className={`category-header category-collapsible ${expandedCategories.account ? 'expanded' : ''}`}
          onClick={() => toggleCategory('account')}
        >
          <span className="category-icon">👤</span>
          <h2>Account</h2>
          <span className="category-toggle-icon">{expandedCategories.account ? '−' : '+'}</span>
        </div>

        {expandedCategories.account && (
          <>

      {/* User Profile Section - moved here */}
      <CollapsibleSection title="User Profile" icon="📝">
        <p className="form-description">
          Manage your account information and display preferences
        </p>
        
        <div className="form-group">
          <label>Username</label>
          <input
            type="text"
            value={userProfile.username}
            disabled
            style={{ opacity: 0.6, cursor: 'not-allowed' }}
          />
          <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>
            Username cannot be changed
          </small>
        </div>
        
        <div className="form-group">
          <label>Email</label>
          <input
            type="email"
            value={userProfile.email}
            onChange={(e) => setUserProfile(prev => ({ ...prev, email: e.target.value }))}
            placeholder="your@email.com"
            disabled={profileLoading || userProfile.oauthProvider !== 'none'}
          />
          {userProfile.oauthProvider !== 'none' && (
            <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>
              Email is managed by {userProfile.oauthProvider === 'oidc' ? 'SSO provider' : userProfile.oauthProvider}
            </small>
          )}
        </div>
        
        <div className="form-group">
          <label>Display Name</label>
          <input
            type="text"
            value={userProfile.displayName}
            onChange={(e) => setUserProfile(prev => ({ ...prev, displayName: e.target.value }))}
            placeholder="Your full name"
            disabled={profileLoading}
          />
        </div>
        
        <button 
          type="button" 
          className="btn btn-primary" 
          onClick={handleSaveProfile}
          disabled={profileLoading}
        >
          {profileLoading ? 'Saving...' : 'Save Profile'}
        </button>
        </CollapsibleSection>

      <CollapsibleSection title="Account Security" icon="🔒">
        
        <form onSubmit={handlePasswordChange} className="password-change-form">
          <p className="form-description">
            Change your account password
          </p>
          
          <div className="form-group">
            <label>Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
              required
              disabled={passwordLoading}
            />
          </div>
          
          <div className="form-group">
            <label>New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              required
              disabled={passwordLoading}
            />
          </div>
          
          <div className="form-group">
            <label>Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              required
              disabled={passwordLoading}
            />
          </div>
          
          <button 
            type="submit" 
            className="btn btn-primary" 
            disabled={passwordLoading}
          >
            {passwordLoading ? 'Changing Password...' : 'Change Password'}
          </button>
        </form>
        </CollapsibleSection>
          </>
        )}
      </div>

      {/* PREFERENCES */}
      <div className="settings-category">
        <div 
          className={`category-header category-collapsible ${expandedCategories.preferences ? 'expanded' : ''}`}
          onClick={() => toggleCategory('preferences')}
        >
          <span className="category-icon">🎨</span>
          <h2>Preferences</h2>
          <span className="category-toggle-icon">{expandedCategories.preferences ? '−' : '+'}</span>
        </div>

        {expandedCategories.preferences && (
          <>

      {/* Cost Calculator */}
      <CollapsibleSection title="Cost Calculator" icon="💰">
        <p className="form-description">
          Configure costs to track printing expenses
        </p>
        
        <div className="form-group">
          <label>Currency</label>
          <select
            value={costCurrency}
            onChange={(e) => setCostCurrency(e.target.value)}
            disabled={costLoading}
          >
            <option value="USD">USD ($)</option>
            <option value="EUR">EUR (€)</option>
            <option value="GBP">GBP (£)</option>
            <option value="CAD">CAD ($)</option>
            <option value="AUD">AUD ($)</option>
            <option value="JPY">JPY (¥)</option>
            <option value="CNY">CNY (¥)</option>
          </select>
        </div>
        
        <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label>Filament $/kg</label>
            <input
              type="number"
              value={filamentCostPerKg}
              onChange={(e) => setFilamentCostPerKg(parseFloat(e.target.value) || 0)}
              placeholder="25"
              min="0"
              step="0.01"
              disabled={costLoading}
            />
          </div>
          
          <div className="form-group">
            <label>Electricity $/kWh</label>
            <input
              type="number"
              value={electricityCostPerKwh}
              onChange={(e) => setElectricityCostPerKwh(parseFloat(e.target.value) || 0)}
              placeholder="0.12"
              min="0"
              step="0.001"
              disabled={costLoading}
            />
          </div>
        </div>
        
        <div className="form-group">
          <label>Printer Wattage</label>
          <input
            type="number"
            value={printerWattage}
            onChange={(e) => setPrinterWattage(parseInt(e.target.value) || 0)}
            placeholder="150"
            min="0"
            step="1"
            disabled={costLoading}
          />
          <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>
            Average power consumption (typically 100-200W)
          </small>
        </div>
        
        <button 
          type="button" 
          className="btn btn-primary" 
          onClick={handleSaveCostSettings}
          disabled={costLoading}
        >
          {costLoading ? 'Saving...' : 'Save Cost Settings'}
        </button>
        </CollapsibleSection>

      {/* UI Settings */}
      <CollapsibleSection title="UI Settings" icon="🖥️">
        <p className="form-description">
          Customize the interface appearance
        </p>
        
        <div className="toggle-group">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={hideBmc}
              onChange={(e) => setHideBmc(e.target.checked)}
              disabled={uiLoading}
            />
            <span className="toggle-text">Hide "Buy Me a Coffee" button</span>
          </label>
        </div>
        
        <button 
          type="button" 
          className="btn btn-primary" 
          onClick={handleSaveUiSettings}
          disabled={uiLoading}
        >
          {uiLoading ? 'Saving...' : 'Save UI Settings'}
        </button>
        </CollapsibleSection>
          </>
        )}
      </div>

      {/* INTEGRATIONS */}
      <div className="settings-category">
        <div 
          className={`category-header category-collapsible ${expandedCategories.integrations ? 'expanded' : ''}`}
          onClick={() => toggleCategory('integrations')}
        >
          <span className="category-icon">🔌</span>
          <h2>Integrations</h2>
          <span className="category-toggle-icon">{expandedCategories.integrations ? '−' : '+'}</span>
        </div>

        {expandedCategories.integrations && (
          <>

      {/* Discord Webhooks Section */}
      <CollapsibleSection title="Discord Webhooks" icon="💬">
        <p className="form-description">
          Get instant Discord notifications for print failures and maintenance alerts
        </p>

        {/* Printer Alerts Webhook */}
        <div className="form-group" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
            <label className="toggle-switch" style={{ marginRight: '1rem' }}>
              <input
                type="checkbox"
                checked={discordPrinterEnabled}
                onChange={(e) => setDiscordPrinterEnabled(e.target.checked)}
                disabled={discordLoading}
              />
              <span className="toggle-slider"></span>
            </label>
            <span style={{ fontWeight: 500, color: '#fff' }}>Printer Alerts</span>
          </div>
          <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '0.75rem' }}>
            Get notified when prints fail, encounter errors, or complete
          </small>
          {discordPrinterEnabled && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="url"
                value={discordPrinterWebhook}
                onChange={(e) => setDiscordPrinterWebhook(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                disabled={discordLoading}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => handleTestDiscordWebhook('printer')}
                disabled={discordTesting === 'printer' || !discordPrinterWebhook}
                style={{ whiteSpace: 'nowrap' }}
              >
                {discordTesting === 'printer' ? 'Sending...' : 'Test'}
              </button>
            </div>
          )}
        </div>

        {/* Maintenance Alerts Webhook */}
        <div className="form-group" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
            <label className="toggle-switch" style={{ marginRight: '1rem' }}>
              <input
                type="checkbox"
                checked={discordMaintenanceEnabled}
                onChange={(e) => setDiscordMaintenanceEnabled(e.target.checked)}
                disabled={discordLoading}
              />
              <span className="toggle-slider"></span>
            </label>
            <span style={{ fontWeight: 500, color: '#fff' }}>Maintenance Alerts</span>
          </div>
          <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '0.75rem' }}>
            Get notified when scheduled maintenance is due or overdue
          </small>
          {discordMaintenanceEnabled && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="url"
                value={discordMaintenanceWebhook}
                onChange={(e) => setDiscordMaintenanceWebhook(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                disabled={discordLoading}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => handleTestDiscordWebhook('maintenance')}
                disabled={discordTesting === 'maintenance' || !discordMaintenanceWebhook}
                style={{ whiteSpace: 'nowrap' }}
              >
                {discordTesting === 'maintenance' ? 'Sending...' : 'Test'}
              </button>
            </div>
          )}
        </div>

        {/* Ping User ID */}
        <div className="form-group" style={{ marginBottom: '1.5rem' }}>
          <label style={{ fontWeight: 500, color: '#fff', marginBottom: '0.5rem', display: 'block' }}>
            Discord User ID to Ping (optional)
          </label>
          <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '0.75rem' }}>
            Enter your Discord user ID to get pinged in notifications. Right-click your profile → Copy User ID
          </small>
          <input
            type="text"
            value={discordPingUserId}
            onChange={(e) => setDiscordPingUserId(e.target.value)}
            placeholder="e.g. 874822659161092166"
            disabled={discordLoading}
            style={{ maxWidth: '300px' }}
          />
        </div>
        
        <button 
          type="button" 
          className="btn btn-primary" 
          onClick={handleSaveDiscordSettings}
          disabled={discordLoading}
        >
          {discordLoading ? 'Saving...' : 'Save Discord Settings'}
        </button>
        </CollapsibleSection>
          </>
        )}
      </div>

      {/* ADVANCED */}
      <div className="settings-category">
        <div 
          className={`category-header category-collapsible ${expandedCategories.advanced ? 'expanded' : ''}`}
          onClick={() => toggleCategory('advanced')}
        >
          <span className="category-icon">⚡</span>
          <h2>Advanced</h2>
          <span className="category-toggle-icon">{expandedCategories.advanced ? '−' : '+'}</span>
        </div>

        {expandedCategories.advanced && (
          <>

      <CollapsibleSection title="OAuth / SSO Authentication" icon="🔑">
        <form onSubmit={handleSaveOAuthSettings} className="oauth-form">
          <p className="form-description">
            Configure Single Sign-On (SSO) authentication for user logins
          </p>
          
          <div className="form-group">
            <label>Authentication Provider</label>
            <select
              value={oauthProvider}
              onChange={(e) => setOauthProvider(e.target.value)}
              disabled={oauthLoading}
            >
              <option value="none">None (Local Authentication Only)</option>
              <option value="google">Google OAuth</option>
              <option value="oidc">Generic OIDC (Authentik, Keycloak, etc.)</option>
            </select>
          </div>

          {oauthProvider !== 'none' && (
            <div className="form-group">
              <label>Public Hostname</label>
              <input
                type="text"
                value={publicHostname}
                onChange={(e) => setPublicHostname(e.target.value)}
                placeholder="https://3d.example.com"
                disabled={oauthLoading}
                required
              />
              <small style={{ color: '#888', display: 'block', marginTop: '0.5rem' }}>
                The public URL where this application is accessible (used for OAuth callbacks)
              </small>
            </div>
          )}

          {oauthProvider === 'google' && (
            <>
              <div className="form-group">
                <label>Google Client ID</label>
                <input
                  type="text"
                  value={googleClientId}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                  placeholder="your-app.apps.googleusercontent.com"
                  disabled={oauthLoading}
                  required
                />
              </div>
              
              <div className="form-group">
                <label>Google Client Secret</label>
                <input
                  type="password"
                  value={googleClientSecret}
                  onChange={(e) => setGoogleClientSecret(e.target.value)}
                  placeholder="Enter your Google OAuth client secret"
                  disabled={oauthLoading}
                  required
                />
              </div>
              
              <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(0,212,255,0.1)', borderRadius: '8px', fontSize: '0.9rem' }}>
                <strong>Setup Instructions:</strong>
                <ol style={{ marginTop: '0.5rem', paddingLeft: '1.5rem' }}>
                  <li>Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" style={{ color: '#00d4ff' }}>Google Cloud Console</a></li>
                  <li>Create OAuth 2.0 credentials</li>
                  <li>Add authorized redirect URI: <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '4px' }}>{publicHostname || window.location.origin}/auth/google/callback</code></li>
                </ol>
              </div>
            </>
          )}

          {oauthProvider === 'oidc' && (
            <>
              <div className="form-group">
                <label>OIDC Issuer URL</label>
                <input
                  type="url"
                  value={oidcIssuer}
                  onChange={(e) => setOidcIssuer(e.target.value)}
                  placeholder="https://auth.example.com/application/o/your-app/"
                  disabled={oauthLoading}
                  required
                />
                <small style={{ color: '#888', marginTop: '5px', display: 'block' }}>
                  Discovery URL - endpoints will be auto-discovered from /.well-known/openid-configuration
                </small>
              </div>
              
              <div className="form-group">
                <label>OIDC Client ID</label>
                <input
                  type="text"
                  value={oidcClientId}
                  onChange={(e) => setOidcClientId(e.target.value)}
                  placeholder="your-client-id"
                  disabled={oauthLoading}
                  required
                />
              </div>
              
              <div className="form-group">
                <label>OIDC Client Secret</label>
                <input
                  type="password"
                  value={oidcClientSecret}
                  onChange={(e) => setOidcClientSecret(e.target.value)}
                  placeholder="Enter your OIDC client secret"
                  disabled={oauthLoading}
                  required
                />
              </div>
              
              <div className="form-group">
                <label>OIDC End-Session URL (Logout) <span style={{ fontWeight: 'normal', color: '#888' }}>- Optional</span></label>
                <input
                  type="url"
                  value={oidcEndSessionUrl}
                  onChange={(e) => setOidcEndSessionUrl(e.target.value)}
                  placeholder="https://auth.example.com/application/o/your-app/end-session/"
                  disabled={oauthLoading}
                />
                <small style={{ color: '#888', display: 'block', marginTop: '0.25rem' }}>
                  Custom logout URL. Leave empty to auto-discover from OIDC provider.
                </small>
              </div>
              
              <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(0,212,255,0.1)', borderRadius: '8px', fontSize: '0.9rem' }}>
                <strong>Setup Instructions (Authentik):</strong>
                <ol style={{ marginTop: '0.5rem', paddingLeft: '1.5rem' }}>
                  <li>Create a new OAuth2/OpenID Provider</li>
                  <li>Create an Application linked to the provider</li>
                  <li>Add redirect URI: <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '4px' }}>{publicHostname || window.location.origin}/auth/oidc/callback</code></li>
                  <li>Copy the Client ID, Client Secret, and endpoint URLs from the provider</li>
                  <li>Use the URLs shown in the Authentik provider configuration</li>
                </ol>
              </div>
            </>
          )}
          
          <button 
            type="submit" 
            className="btn btn-primary" 
            disabled={oauthLoading || oauthProvider === 'none'}
          >
            {oauthLoading ? 'Saving...' : 'Save OAuth Settings'}
          </button>
          
          {oauthProvider !== 'none' && (
            <p style={{ marginTop: '1rem', color: '#f59e0b', fontSize: '0.9rem' }}>
              ⚠️ After saving OAuth settings, you must restart the application for changes to take effect.
            </p>
          )}
        </form>
        </CollapsibleSection>

      {/* Watchdog Section */}
      <CollapsibleSection title="Watchdog / Health Check" icon="🐕">
        <p className="form-description">
          Keep the application alive and monitor health status
        </p>
        
        <div className="toggle-group">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={watchdogEnabled}
              onChange={(e) => setWatchdogEnabled(e.target.checked)}
              disabled={watchdogLoading}
            />
            <span className="toggle-text">Enable Watchdog</span>
          </label>
          <p className="toggle-hint">Periodically check application health and ping external services</p>
        </div>
        
        {watchdogEnabled && (
          <>
            <div className="form-group">
              <label>Check Interval (seconds)</label>
              <input
                type="number"
                value={watchdogInterval}
                onChange={(e) => setWatchdogInterval(parseInt(e.target.value) || 30)}
                placeholder="30"
                min="10"
                max="3600"
                disabled={watchdogLoading}
              />
            </div>
            
            <div className="form-group">
              <label>External Ping URL (optional)</label>
              <input
                type="url"
                value={watchdogEndpoint}
                onChange={(e) => setWatchdogEndpoint(e.target.value)}
                placeholder="https://healthchecks.io/ping/your-uuid"
                disabled={watchdogLoading}
              />
              <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>
                Optional: URL to ping for external monitoring (Uptime Robot, Healthchecks.io, etc.)
              </small>
            </div>
          </>
        )}
        
        <button 
          type="button" 
          className="btn btn-primary" 
          onClick={handleSaveWatchdogSettings}
          disabled={watchdogLoading}
        >
          {watchdogLoading ? 'Saving...' : 'Save Watchdog Settings'}
        </button>
        </CollapsibleSection>

      {/* System Section */}
      <CollapsibleSection title="System" icon="🖥️">
        <p className="form-description">
          Application management and maintenance
        </p>
        
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

          {/* Remote Backup Settings */}
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
                      placeholder={remoteBackupType === 'sftp' ? '22' : '21'}
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
                  <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>
                    Directory on the remote server where backups will be stored
                  </small>
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

          {/* Webhook Notification */}
          <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(0, 212, 255, 0.2)' }}>
            <h4 style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '1rem' }}>🔔 Backup Webhook</h4>
            <p className="form-description" style={{ marginBottom: '1rem' }}>
              Send a POST notification when backups complete
            </p>
            
            <div className="form-group">
              <label>Webhook URL (optional)</label>
              <input
                type="url"
                value={backupWebhookUrl}
                onChange={(e) => setBackupWebhookUrl(e.target.value)}
                placeholder="https://your-server.com/webhook/backup"
                disabled={dbMaintenanceLoading}
              />
              <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>
                Receives JSON: {'{event, timestamp, backup:{filename, size, videos, library, covers}, remote_uploaded}'}
              </small>
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

          {/* Restore from Backup */}
          <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(0, 212, 255, 0.2)' }}>
            <h4 style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '1rem' }}>♻️ Restore from Backup</h4>
            <p className="form-description" style={{ marginBottom: '1rem' }}>
              Restore the database from a previous backup
            </p>
            
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label>Available Backups</label>
              <select
                value={selectedBackup}
                onChange={(e) => setSelectedBackup(e.target.value)}
                disabled={restoreInProgress}
              >
                <option value="">-- Select a backup --</option>
                {availableBackups.map((backup) => (
                  <option key={backup.name} value={backup.name}>
                    {backup.date} - {backup.size}
                  </option>
                ))}
              </select>
              <small style={{ color: 'rgba(255,255,255,0.5)', display: 'block', marginTop: '0.5rem' }}>
                Found {availableBackups.length} backup(s) in data/backups directory
              </small>
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={loadAvailableBackups}
                disabled={restoreInProgress}
              >
                🔄 Refresh List
              </button>
              
              <button 
                type="button" 
                className="btn btn-warning" 
                onClick={() => setShowRestoreModal(true)}
                disabled={!selectedBackup || restoreInProgress}
              >
                {restoreInProgress ? 'Restoring...' : '♻️ Restore Backup'}
              </button>
            </div>

            {showRestoreModal && (
              <div className="modal-overlay" onClick={() => !restoreInProgress && setShowRestoreModal(false)}>
                <div className="db-result-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="db-result-header">
                    <span className="db-result-icon">⚠️</span>
                    <h3>Confirm Restore</h3>
                  </div>
                  <div className="db-result-details">
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
                        disabled={restoreInProgress}
                      >
                        Cancel
                      </button>
                      <button 
                        type="button"
                        className="btn btn-warning"
                        onClick={handleRestoreBackup}
                        disabled={restoreInProgress}
                      >
                        {restoreInProgress ? 'Restoring...' : 'Restore Now'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        </CollapsibleSection>
          </>
        )}
      </div>

      {/* ADMIN */}
      {isAdmin && (
        <div className="settings-category">
          <div 
            className={`category-header category-collapsible ${expandedCategories.administration ? 'expanded' : ''}`}
            onClick={() => toggleCategory('administration')}
          >
            <span className="category-icon">🔐</span>
            <h2>Administration</h2>
            <span className="category-toggle-icon">{expandedCategories.administration ? '−' : '+'}</span>
          </div>

          {expandedCategories.administration && (
            <>
          <CollapsibleSection title="User Management" icon="👥" defaultExpanded={true}>
            <p className="form-description">
              Manage user accounts and permissions
            </p>
            <UserManagement />
            </CollapsibleSection>
            </>
          )}
        </div>
      )}
      
      <ConfirmModal
        isOpen={confirmDisconnect}
        title="Disconnect Bambu Lab"
        message="Are you sure you want to disconnect your Bambu Lab account?"
        confirmText="Disconnect"
        confirmButtonClass="btn-delete"
        onConfirm={handleDisconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />

      <ConfirmModal
        isOpen={confirmRestart}
        title="Restart Application"
        message="Are you sure you want to restart the application? This will briefly disconnect all users."
        confirmText="Restart"
        confirmButtonClass="btn-warning"
        onConfirm={handleRestartApp}
        onCancel={() => setConfirmRestart(false)}
      />

      {/* Database Result Modal */}
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

      {toast && (
        <Toast 
          message={toast.message} 
          type={toast.type} 
          onClose={() => setToast(null)} 
        />
      )}
    </div>
  );
}

export default Settings;
/* cache bust */

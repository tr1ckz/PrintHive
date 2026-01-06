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

function Settings({ userRole }: SettingsProps) {
  const isAdmin = userRole === 'admin' || userRole === 'superadmin';
  const [bambuStatus, setBambuStatus] = useState<BambuStatus | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [region, setRegion] = useState('global');
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  
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
  
  // Toast state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    loadBambuStatus();
    loadPrinterSettings();
    loadOAuthSettings();
    loadUiSettings();
    loadWatchdogSettings();
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
      <div className="settings-group-header">
        <span className="group-icon">🖨️</span>
        <h2>Printer Connection</h2>
      </div>

      <div className="settings-section">
        <h2>Bambu Lab Account</h2>
        
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
      </div>
      
      <div className="settings-section">
        <h2>Printer FTP Settings</h2>
        
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
      </div>

      {/* ACCOUNT */}
      <div className="settings-group-header">
        <span className="group-icon">👤</span>
        <h2>Account</h2>
      </div>

      {/* User Profile Section - moved here */}
      <div className="settings-section">
        <h2>User Profile</h2>
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
      </div>

      <div className="settings-section">
        <h2>Account Security</h2>
        
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
      </div>

      {/* PREFERENCES */}
      <div className="settings-group-header">
        <span className="group-icon">🎨</span>
        <h2>Preferences</h2>
      </div>

      {/* Cost Calculator */}
      <div className="settings-section">
        <h2>Cost Calculator</h2>
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
      </div>

      {/* UI Settings */}
      <div className="settings-section">
        <h2>UI Settings</h2>
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
      </div>

      {/* ADVANCED */}
      <div className="settings-group-header">
        <span className="group-icon">⚡</span>
        <h2>Advanced</h2>
      </div>

      <div className="settings-section">
        <h2>OAuth / SSO Authentication</h2>
        
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
      </div>

      {/* Watchdog Section */}
      <div className="settings-section">
        <h2>Watchdog / Health Check</h2>
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
      </div>

      {/* System Section */}
      <div className="settings-section">
        <h2>System</h2>
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
      </div>

      {/* ADMIN */}
      {isAdmin && (
        <>
          <div className="settings-group-header">
            <span className="group-icon">🔐</span>
            <h2>Administration</h2>
          </div>

          <div className="settings-section">
            <h2>User Management</h2>
            <p className="form-description">
              Manage user accounts and permissions
            </p>
            <UserManagement />
          </div>
        </>
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

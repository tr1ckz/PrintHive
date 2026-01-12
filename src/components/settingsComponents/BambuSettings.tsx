import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../../config/api';
import fetchWithRetry from '../../utils/fetchWithRetry';
import { useSettingsContext } from './SettingsContext';
import { CollapsibleSection } from './CollapsibleSection';
import { BambuStatus } from './types';

export function BambuSettings() {
  const { setToast } = useSettingsContext();
  const [bambuStatus, setBambuStatus] = useState<BambuStatus | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [region, setRegion] = useState('global');
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    loadBambuStatus();
  }, []);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const loadBambuStatus = async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.BAMBU_STATUS, { credentials: 'include' });
      const data = await response.json();
      setBambuStatus(data);
    } catch (error) {
      console.error('Failed to load Bambu status:', error);
    }
  };

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.REQUEST_CODE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, region }),
        credentials: 'include'
      });

      const data = await response.json();

      if (data.success) {
        setCodeSent(true);
        setCountdown(300);
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
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.CONNECT_BAMBU, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, region }),
        credentials: 'include'
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

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect your Bambu Lab account?')) return;
    setLoading(true);

    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.DISCONNECT_BAMBU, {
        method: 'POST',
        credentials: 'include'
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

  return (
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
            onClick={handleDisconnect}
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
  );
}

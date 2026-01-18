import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../../config/api';
import fetchWithRetry from '../../utils/fetchWithRetry';
import { useSettingsContext } from './SettingsContext';
import { CollapsibleSection } from './CollapsibleSection';

interface BambuAccount {
  id: number;
  email: string;
  region: string;
  is_primary: boolean;
  updated_at: string;
}

export function BambuSettings() {
  const { setToast } = useSettingsContext();
  const [accounts, setAccounts] = useState<BambuAccount[]>([]);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [region, setRegion] = useState('global');
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const loadAccounts = async () => {
    try {
      const response = await fetchWithRetry('/api/bambu/accounts', { credentials: 'include' });
      const data = await response.json();
      if (data.success) {
        setAccounts(data.accounts || []);
        setShowAddForm(data.accounts.length === 0);
      }
    } catch (error) {
      console.error('Failed to load Bambu accounts:', error);
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
      const response = await fetchWithRetry('/api/bambu/accounts/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, region }),
        credentials: 'include'
      });

      const data = await response.json();

      if (data.success) {
        setToast({ message: 'Successfully connected Bambu Lab account!', type: 'success' });
        setCode('');
        setEmail('');
        setCodeSent(false);
        setShowAddForm(false);
        await loadAccounts();
      } else {
        setToast({ message: data.error, type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to connect to Bambu Lab', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async (accountId: number) => {
    if (!confirm('Are you sure you want to disconnect this Bambu Lab account?')) return;
    setLoading(true);

    try {
      const response = await fetchWithRetry(`/api/bambu/accounts/${accountId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      const data = await response.json();

      if (data.success) {
        setToast({ message: 'Disconnected Bambu Lab account', type: 'success' });
        await loadAccounts();
      } else {
        setToast({ message: 'Failed to disconnect', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to disconnect', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleSetPrimary = async (accountId: number) => {
    setLoading(true);
    try {
      const response = await fetchWithRetry(`/api/bambu/accounts/${accountId}/primary`, {
        method: 'POST',
        credentials: 'include'
      });

      const data = await response.json();

      if (data.success) {
        setToast({ message: 'Primary account updated', type: 'success' });
        await loadAccounts();
      } else {
        setToast({ message: 'Failed to update primary account', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to update primary account', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <CollapsibleSection title="Bambu Lab Accounts" icon="🔗" defaultExpanded={accounts.length === 0}>
      <p className="form-description">
        Connect multiple Bambu Lab accounts to manage all your printers in one place
      </p>

      {/* Connected Accounts List */}
      {accounts.length > 0 && (
        <div className="bambu-accounts-list">
          {accounts.map((account) => (
            <div key={account.id} className="bambu-account-card">
              <div className="account-card-content">
                <div className="account-info">
                  <div className="account-email-row">
                    <span className="account-email">{account.email}</span>
                    {account.is_primary && (
                      <span className="primary-badge">Primary</span>
                    )}
                  </div>
                  <span className="account-meta">
                    Region: {account.region === 'china' ? 'China' : 'Global'} • 
                    Updated: {new Date(account.updated_at).toLocaleString()}
                  </span>
                </div>
                <div className="account-actions">
                  {!account.is_primary && (
                    <button 
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleSetPrimary(account.id)}
                      disabled={loading}
                    >
                      Set Primary
                    </button>
                  )}
                  <button 
                    className="btn btn-danger btn-sm"
                    onClick={() => handleDisconnect(account.id)}
                    disabled={loading}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Account Button or Form */}
      {!showAddForm ? (
        <button 
          className="btn btn-primary" 
          onClick={() => setShowAddForm(true)}
          disabled={loading}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: '8px' }}>
            <path d="M12 4v16m8-8H4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Add Another Account
        </button>
      ) : (
        <form onSubmit={codeSent ? handleConnect : handleRequestCode} className="bambu-connect-form">
          <p className="form-description">
            Connect a Bambu Lab account to access printers
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
              {accounts.length > 0 && (
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => { setShowAddForm(false); setCodeSent(false); setCode(''); setEmail(''); setCountdown(0); }}
                  disabled={loading}
                  style={{ marginLeft: '10px' }}
                >
                  Cancel
                </button>
              )}
            </>
          )}
        </form>
      )}
    </CollapsibleSection>
  );
}

import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../../config/api';
import fetchWithRetry from '../../utils/fetchWithRetry';
import { useSettingsContext } from './SettingsContext';
import { CollapsibleSection } from './CollapsibleSection';
import { useModal } from '../ModalProvider';

interface BambuAccount {
  id: number;
  email: string;
  region: string;
  is_primary: boolean;
  updated_at: string;
}

export function BambuSettings() {
  const { setToast } = useSettingsContext();
  const { confirm } = useModal();
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

  const handleDisconnect = (accountId: number) => {
    confirm({
      title: 'Disconnect Bambu account?',
      message: 'This removes the selected Bambu Lab account from PrintHive but does not delete the account itself.',
      confirmText: 'Disconnect',
      confirmVariant: 'danger',
      onConfirm: async () => {
        const previousAccounts = accounts;
        setLoading(true);
        setAccounts((prev) => prev.filter((account) => account.id !== accountId));

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
            setAccounts(previousAccounts);
            setToast({ message: 'Failed to disconnect', type: 'error' });
          }
        } catch (error) {
          setAccounts(previousAccounts);
          setToast({ message: 'Failed to disconnect', type: 'error' });
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleSetPrimary = async (accountId: number) => {
    const previousAccounts = accounts;
    setLoading(true);
    setAccounts(prev => prev.map(account => ({ ...account, is_primary: account.id === accountId })));

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
        setAccounts(previousAccounts);
        setToast({ message: 'Failed to update primary account', type: 'error' });
      }
    } catch (error) {
      setAccounts(previousAccounts);
      setToast({ message: 'Failed to update primary account', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <CollapsibleSection title="Bambu Lab Accounts" icon="🔗" defaultExpanded={true}>
      <p className="mb-4 text-sm text-fg-soft">
        Connect multiple Bambu Lab accounts to manage all your printers in one place.
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted">
          {accounts.length > 0 ? `${accounts.length} connected account${accounts.length > 1 ? 's' : ''}` : 'No accounts connected yet'}
        </span>
        {!showAddForm && (
          <button
            className="inline-flex min-h-9 items-center justify-center gap-1 rounded px-2.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong"
            onClick={() => setShowAddForm(true)}
            disabled={loading}
          >
            + Add Account
          </button>
        )}
      </div>

      {/* Connected Accounts List */}
      {accounts.length > 0 && (
        <div className="space-y-3">
          {accounts.map((account) => (
            <div key={account.id} className={`rounded-lg bg-white/[0.03] p-4 ${account.is_primary ? 'ring-1 ring-accent/30' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {account.is_primary && <span className="text-accent">★</span>}
                    <span className="truncate text-sm font-medium text-fg">{account.email}</span>
                    {account.is_primary && (
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">Primary</span>
                    )}
                  </div>
                  <span className="text-xs text-muted">
                    {account.region === 'china' ? 'China' : 'Global'} • Updated {new Date(account.updated_at).toLocaleString()}
                  </span>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {!account.is_primary && (
                    <button
                      className="inline-flex min-h-9 items-center justify-center gap-1 rounded px-2.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg"
                      onClick={() => handleSetPrimary(account.id)}
                      disabled={loading}
                    >
                      Set Primary
                    </button>
                  )}
                  <button
                    className="inline-flex min-h-9 items-center justify-center gap-1 rounded px-2.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-danger/15 text-danger hover:bg-danger/25"
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

      {/* Add Account Form */}
      {showAddForm && (
        <form onSubmit={codeSent ? handleConnect : handleRequestCode} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-white/[0.03] p-4 [&>div]:w-full [&>p]:w-full">
          <p className="mb-4 text-sm text-fg-soft">
            Connect a Bambu Lab account to access printers
          </p>

          <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
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

          <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
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
            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
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
            className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong" 
            disabled={loading}
          >
            {loading ? (codeSent ? 'Connecting...' : 'Sending Code...') : (codeSent ? 'Connect' : 'Send Verification Code')}
          </button>

          {codeSent && (
            <>
              <button 
                type="button" 
                className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg" 
                onClick={handleRequestCode}
                disabled={loading || countdown > 0}
              >
                {countdown > 0 ? `Resend Code (${Math.floor(countdown / 60)}:${(countdown % 60).toString().padStart(2, '0')})` : 'Resend Code'}
              </button>
              <button 
                type="button" 
                className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg" 
                onClick={() => { setCodeSent(false); setCode(''); setCountdown(0); }}
                disabled={loading}
              >
                Change Email
              </button>
              {accounts.length > 0 && (
                <button 
                  type="button" 
                  className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-white/5 text-fg-soft hover:bg-white/10 hover:text-fg" 
                  onClick={() => { setShowAddForm(false); setCodeSent(false); setCode(''); setEmail(''); setCountdown(0); }}
                  disabled={loading}
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

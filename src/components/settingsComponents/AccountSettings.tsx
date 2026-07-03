import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../../config/api';
import fetchWithRetry from '../../utils/fetchWithRetry';
import { useSettingsContext } from './SettingsContext';
import { CollapsibleSection } from './CollapsibleSection';
import { UserProfile } from './types';

export function AccountSettings() {
  const { setToast } = useSettingsContext();
  
  // User profile state
  const [userProfile, setUserProfile] = useState<UserProfile>({ username: '', email: '', displayName: '', oauthProvider: 'none' });
  const [profileLoading, setProfileLoading] = useState(false);
  
  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  useEffect(() => {
    loadUserProfile();
  }, []);

  const loadUserProfile = async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.PROFILE, { credentials: 'include' });
      const data = await response.json();
      if (response.ok) {
        setUserProfile(data);
      }
    } catch (error) {
      console.error('Failed to load user profile:', error);
    }
  };

  const handleSaveProfile = async () => {
    setProfileLoading(true);
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.PROFILE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: userProfile.displayName,
          email: userProfile.email
        }),
        credentials: 'include'
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
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.CHANGE_PASSWORD, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
        credentials: 'include'
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

  return (
    <>
      <CollapsibleSection title="User Profile" icon="📝">
        <p className="mb-4 text-sm text-fg-soft">
          Manage your account information and display preferences
        </p>
        
        <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
          <label>Username</label>
          <input
            type="text"
            value={userProfile.username}
            disabled
            className="opacity-60"
          />
          <small className="mt-1.5 block text-xs text-muted">
            Username cannot be changed
          </small>
        </div>
        
        <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
          <label>Email</label>
          <input
            type="email"
            value={userProfile.email}
            onChange={(e) => setUserProfile(prev => ({ ...prev, email: e.target.value }))}
            placeholder="your@email.com"
            disabled={profileLoading || userProfile.oauthProvider !== 'none'}
          />
          {userProfile.oauthProvider !== 'none' && (
            <small className="mt-1.5 block text-xs text-muted">
              Email is managed by {userProfile.oauthProvider === 'oidc' ? 'SSO provider' : userProfile.oauthProvider}
            </small>
          )}
        </div>
        
        <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
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
          className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong" 
          onClick={handleSaveProfile}
          disabled={profileLoading}
        >
          {profileLoading ? 'Saving...' : 'Save Profile'}
        </button>
      </CollapsibleSection>

      {/* Only show password change for local accounts, not OIDC users */}
      {userProfile.oauthProvider === 'none' && (
        <CollapsibleSection title="Account Security" icon="🔒">
          <form onSubmit={handlePasswordChange} className="block">
            <p className="mb-4 text-sm text-fg-soft">
              Change your account password
            </p>
          
          <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
            <label>Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Enter current password"
              required
              disabled={passwordLoading}
            />
          </div>
          
          <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
            <label>New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Enter new password"
              required
              disabled={passwordLoading}
            />
          </div>
          
          <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
            <label>Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Confirm new password"
              required
              disabled={passwordLoading}
            />
          </div>
          
          <button 
            type="submit" 
            className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong" 
            disabled={passwordLoading}
          >
            {passwordLoading ? 'Changing Password...' : 'Change Password'}
          </button>
        </form>
      </CollapsibleSection>
      )}
    </>
  );
}

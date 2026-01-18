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

      {/* Only show password change for local accounts, not OIDC users */}
      {userProfile.oauthProvider === 'none' && (
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
              autoComplete="current-password"
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
              autoComplete="new-password"
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
              autoComplete="new-password"
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
      )}
    </>
  );
}

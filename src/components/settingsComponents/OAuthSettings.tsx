import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../../config/api';
import fetchWithRetry from '../../utils/fetchWithRetry';
import { useSettingsContext } from './SettingsContext';
import { CollapsibleSection } from './CollapsibleSection';

export function OAuthSettings() {
  const { setToast } = useSettingsContext();
  const [oauthProvider, setOauthProvider] = useState('none');
  const [publicHostname, setPublicHostname] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [oidcIssuer, setOidcIssuer] = useState('');
  const [oidcClientId, setOidcClientId] = useState('');
  const [oidcClientSecret, setOidcClientSecret] = useState('');
  const [oidcEndSessionUrl, setOidcEndSessionUrl] = useState('');
  const [oauthLoading, setOauthLoading] = useState(false);

  useEffect(() => {
    loadOAuthSettings();
  }, []);

  const loadOAuthSettings = async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.OAUTH, { credentials: 'include' });
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

  const handleSaveOAuthSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setOauthLoading(true);
    
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.SAVE_OAUTH, {
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
        }),
        credentials: 'include'
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
  );
}

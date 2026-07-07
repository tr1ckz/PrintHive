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
  const [groupsClaim, setGroupsClaim] = useState('');
  const [adminGroups, setAdminGroups] = useState('');
  const [userGroups, setUserGroups] = useState('');
  const [defaultRole, setDefaultRole] = useState('user');
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
      setGroupsClaim(data.groupsClaim || '');
      setAdminGroups(data.adminGroups || '');
      setUserGroups(data.userGroups || '');
      setDefaultRole(data.defaultRole || 'user');
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
          oidcEndSessionUrl,
          groupsClaim,
          adminGroups,
          userGroups,
          defaultRole
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
      <form onSubmit={handleSaveOAuthSettings}>

        <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
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
          <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
            <label>Public Hostname</label>
            <input
              type="text"
              value={publicHostname}
              onChange={(e) => setPublicHostname(e.target.value)}
              placeholder="https://3d.example.com"
              disabled={oauthLoading}
              required
            />
            <small className="mt-1.5 block text-xs text-muted">
              The public URL where this application is accessible (used for OAuth callbacks)
            </small>
          </div>
        )}

        {oauthProvider === 'google' && (
          <>
            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
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
            
            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
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
            
            <div className="mt-4 rounded-lg bg-accent/10 p-4 text-sm text-fg-soft">
              <strong>Setup Instructions:</strong>
              <ol className="mt-2 list-decimal space-y-1 pl-6">
                <li>Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" className="text-accent underline-offset-2 hover:underline">Google Cloud Console</a></li>
                <li>Create OAuth 2.0 credentials</li>
                <li>Add authorized redirect URI: <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">{publicHostname || window.location.origin}/auth/google/callback</code></li>
              </ol>
            </div>
          </>
        )}

        {oauthProvider === 'oidc' && (
          <>
            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
              <label>OIDC Issuer URL</label>
              <input
                type="url"
                value={oidcIssuer}
                onChange={(e) => setOidcIssuer(e.target.value)}
                placeholder="https://auth.example.com/application/o/your-app/"
                disabled={oauthLoading}
                required
              />
              <small className="mt-1.5 block text-xs text-muted">
                Discovery URL - endpoints will be auto-discovered from /.well-known/openid-configuration
              </small>
            </div>
            
            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
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
            
            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
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
            
            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
              <label>OIDC End-Session URL (Logout) <span className="font-normal text-muted">- Optional</span></label>
              <input
                type="url"
                value={oidcEndSessionUrl}
                onChange={(e) => setOidcEndSessionUrl(e.target.value)}
                placeholder="https://auth.example.com/application/o/your-app/end-session/"
                disabled={oauthLoading}
              />
              <small className="mt-1 block text-xs text-muted">
                Custom logout URL. Leave empty to auto-discover from OIDC provider.
              </small>
            </div>

            <div className="mb-2 mt-6 border-t border-border pt-4">
              <h4 className="text-sm font-semibold text-fg">Group → Role Mapping</h4>
              <p className="mt-1 text-xs text-muted">
                Map your identity provider's groups to PrintHive roles. SSO only ever grants
                <strong> Admin</strong> or <strong>User</strong> — the protected <strong>Super Admin</strong> tier
                is managed locally and is never assigned or revoked via SSO.
              </p>
            </div>

            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
              <label>Groups Claim <span className="font-normal text-muted">- Optional</span></label>
              <input
                type="text"
                value={groupsClaim}
                onChange={(e) => setGroupsClaim(e.target.value)}
                placeholder="groups"
                disabled={oauthLoading}
              />
              <small className="mt-1.5 block text-xs text-muted">
                Name of the token claim that holds the user's groups. Defaults to <code className="rounded bg-black/30 px-1 py-0.5">groups</code>.
              </small>
            </div>

            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
              <label>Admin Groups</label>
              <input
                type="text"
                value={adminGroups}
                onChange={(e) => setAdminGroups(e.target.value)}
                placeholder="PrintHive Admins, Infra"
                disabled={oauthLoading}
              />
              <small className="mt-1.5 block text-xs text-muted">
                Comma-separated group names whose members get the <strong>Admin</strong> role (case-insensitive).
              </small>
            </div>

            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
              <label>User Groups <span className="font-normal text-muted">- Optional</span></label>
              <input
                type="text"
                value={userGroups}
                onChange={(e) => setUserGroups(e.target.value)}
                placeholder="PrintHive Users"
                disabled={oauthLoading}
              />
              <small className="mt-1.5 block text-xs text-muted">
                Comma-separated group names that get the <strong>User</strong> role. Leave empty to grant the default role below to anyone not in an admin group.
              </small>
            </div>

            <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
              <label>Default Role (no matching group)</label>
              <select
                value={defaultRole}
                onChange={(e) => setDefaultRole(e.target.value)}
                disabled={oauthLoading}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <small className="mt-1.5 block text-xs text-muted">
                Role assigned when a user is in none of the groups above. <strong>User</strong> is recommended.
              </small>
            </div>

            <div className="mt-4 rounded-lg bg-accent/10 p-4 text-sm text-fg-soft">
              <strong>Setup Instructions (Authentik):</strong>
              <ol className="mt-2 list-decimal space-y-1 pl-6">
                <li>Create a new OAuth2/OpenID Provider</li>
                <li>Create an Application linked to the provider</li>
                <li>Add redirect URI: <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">{publicHostname || window.location.origin}/auth/oidc/callback</code></li>
                <li>Copy the Client ID, Client Secret, and endpoint URLs from the provider</li>
                <li>Use the URLs shown in the Authentik provider configuration</li>
              </ol>
            </div>
          </>
        )}
        
        <button 
          type="submit" 
          className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong" 
          disabled={oauthLoading || oauthProvider === 'none'}
        >
          {oauthLoading ? 'Saving...' : 'Save OAuth Settings'}
        </button>
        
        {oauthProvider !== 'none' && (
          <p className="mt-4 text-sm text-warning">
            ⚠️ After saving OAuth settings, you must restart the application for changes to take effect.
          </p>
        )}
      </form>
    </CollapsibleSection>
  );
}

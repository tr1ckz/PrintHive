import { useState, useEffect } from 'react';
import './Login.css';
import { API_ENDPOINTS } from '../config/api';
import { fetchWithRetry } from '../utils/fetchWithRetry';

interface LoginProps {
  onLoginSuccess: () => void;
}

function Login({ onLoginSuccess }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthProvider, setOauthProvider] = useState<string | null>(null);
  const [isAdminRoute, setIsAdminRoute] = useState(false);

  useEffect(() => {
    // Check if we're on /admin route
    const path = window.location.pathname;
    const adminRoute = path === '/admin' || path.startsWith('/admin/');
    setIsAdminRoute(adminRoute);

    // Fetch OAuth configuration
    fetchOAuthConfig();
  }, []);

  const fetchOAuthConfig = async () => {
    try {
      console.log('[Login] fetchOAuthConfig called');
      console.log('[Login] Current URL:', window.location.href);
      console.log('[Login] Pathname:', window.location.pathname);
      console.log('[Login] Search:', window.location.search);
      
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.OAUTH_PUBLIC, { credentials: 'include' });
      const data = await response.json();
      console.log('[Login] OAuth provider:', data.provider);
      setOauthProvider(data.provider || 'none');

      // Check if we're coming back from a logout (query param ?logout=1)
      const urlParams = new URLSearchParams(window.location.search);
      const isLogout = urlParams.get('logout') === '1';
      console.log('[Login] isLogout check:', isLogout);
      console.log('[Login] URL params:', Object.fromEntries(urlParams));

      const onAdminRoute = window.location.pathname.startsWith('/admin');
      console.log('[Login] On admin route:', onAdminRoute);
      
      const shouldRedirect = data.provider && data.provider !== 'none' && 
                            !onAdminRoute && 
                            !isLogout;
      console.log('[Login] Should redirect to OAuth:', shouldRedirect);

      // Auto-redirect to OAuth if configured, NOT on admin route, and NOT after logout
      if (shouldRedirect) {
        console.log('[Login] Redirecting to:', `/auth/${data.provider}`);
        window.location.href = `/auth/${data.provider}`;
      }
    } catch (error) {
      console.error('Failed to fetch OAuth config:', error);
      setOauthProvider('none');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetchWithRetry(API_ENDPOINTS.AUTH.LOGIN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username, 
          password
        }),
        credentials: 'include'
      });

      const data = await response.json();

      if (data.success) {
        onLoginSuccess();
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (err) {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-header">
          <div className="logo">
            <img src="/images/logo.png" alt="PrintHive" style={{ width: '80px', height: '80px', objectFit: 'contain' }} />
          </div>
          <h1>PrintHive</h1>
          <p>Sign in to your account</p>
        </div>

        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              required
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={loading}
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          {!isAdminRoute && oauthProvider && oauthProvider !== 'none' && (
            <>
              <div style={{ margin: '1.5rem 0', textAlign: 'center', color: '#888' }}>
                <span style={{ display: 'inline-block', position: 'relative' }}>
                  <span style={{ background: '#1a1a1a', padding: '0 10px', position: 'relative', zIndex: 1 }}>or</span>
                  <span style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '1px', background: '#333', zIndex: 0 }}></span>
                </span>
              </div>
              
              {oauthProvider === 'google' && (
                <a href="/auth/google" className="btn-oauth btn-google">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: '8px' }}>
                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
                    <path d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707 0-.593.102-1.17.282-1.709V4.958H.957C.347 6.173 0 7.548 0 9c0 1.452.348 2.827.957 4.042l3.007-2.335z" fill="#FBBC05"/>
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                  </svg>
                  Sign in with Google
                </a>
              )}
              
              {oauthProvider === 'oidc' && (
                <a href="/auth/oidc" className="btn-oauth btn-oidc">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: '8px' }}>
                    <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V9h7V2.99c3.72 1.15 6.47 4.82 7 8.94h-7v1.06z" fill="currentColor"/>
                  </svg>
                  Sign in with SSO
                </a>
              )}
            </>
          )}

          <div className="login-footer">
            {isAdminRoute ? (
              <p>Admin login - Default: admin / admin</p>
            ) : (
              <p>For admin access, visit <a href="/admin" style={{ color: '#00d4ff' }}>/admin</a></p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

export default Login;


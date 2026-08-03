import { useState, useEffect, lazy, Suspense } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import LoadingScreen from './components/LoadingScreen';
import ErrorBoundary from './components/ErrorBoundary';
import { ModalProvider } from './components/ModalProvider';

// Lazy so the public docs route shares the same split chunk as the in-app Docs
// page instead of being pulled into the initial bundle.
const Docs = lazy(() => import('./components/Docs'));
import { API_ENDPOINTS } from './config/api';
import { fetchWithRetry } from './utils/fetchWithRetry';
import { usePrinterStore } from './stores/usePrinterStore';
import { applyThemeScheme } from './utils/theme';
import { clearSsoRedirectState, suppressSsoRedirect } from './utils/ssoRedirect';
import packageInfo from '../package.json';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [footerVersion, setFooterVersion] = useState<string>(packageInfo.version);
  const connectPrinterRealtime = usePrinterStore((state) => state.connect);
  const disconnectPrinterRealtime = usePrinterStore((state) => state.disconnect);
  const loadInitialPrinters = usePrinterStore((state) => state.loadInitialPrinters);
  const isDocsRoute = window.location.pathname.toLowerCase().startsWith('/docs');

  useEffect(() => {
    checkAuth();
    loadColorScheme();
    void loadFooterVersion();
  }, []);

  useEffect(() => {
    if (isAuthenticated !== null) {
      return;
    }

    // Fail-safe: never leave users stuck on the splash screen indefinitely.
    const timeoutId = window.setTimeout(() => {
      setIsAuthenticated(false);
    }, 8000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isAuthenticated]);

  const loadFooterVersion = async () => {
    try {
      const response = await fetchWithRetry(
        API_ENDPOINTS.SYSTEM.VERSION,
        { credentials: 'include' },
        { maxRetries: 0, timeoutMs: 6000 }
      );
      if (!response.ok) {
        return;
      }
      const versionData = await response.json();
      if (versionData?.version && typeof versionData.version === 'string') {
        setFooterVersion(versionData.version);
      }
    } catch {
      // Keep package.json version as fallback.
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      void loadInitialPrinters();
      connectPrinterRealtime();
      return () => disconnectPrinterRealtime();
    }

    disconnectPrinterRealtime();
    return undefined;
  }, [connectPrinterRealtime, disconnectPrinterRealtime, isAuthenticated, loadInitialPrinters]);

  const loadColorScheme = async () => {
    try {
      const response = await fetchWithRetry(
        API_ENDPOINTS.SETTINGS.UI,
        { credentials: 'include' },
        { maxRetries: 0, timeoutMs: 6000 }
      );
      const data = await response.json();
      applyThemeScheme(data.success ? data.colorScheme : 'orange');
    } catch (error) {
      console.error('Failed to load color scheme:', error);
      applyThemeScheme('orange');
    }
  };

  const checkAuth = async () => {
    try {
      const response = await fetchWithRetry(
        API_ENDPOINTS.AUTH.CHECK,
        { credentials: 'include' },
        { maxRetries: 0, timeoutMs: 6000 }
      );
      const data = await response.json();
      if (data.authenticated) {
        // The SSO round-trip worked; forget the loop breaker.
        clearSsoRedirectState();
      }
      setIsAuthenticated(data.authenticated);
    } catch (error) {
      setIsAuthenticated(false);
    }
  };

  const handleLoginSuccess = () => {
    clearSsoRedirectState();
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
    // Logging out means staying on the login page. Without this the login
    // screen would bounce straight back into the IdP, which still holds a
    // session, and the user could never actually sign out.
    suppressSsoRedirect();

    try {
      const response = await fetchWithRetry(API_ENDPOINTS.AUTH.LOGOUT, {
        method: 'POST',
        credentials: 'include'
      });

      const data = await response.json();

      if (data.oidcLogout && data.endSessionUrl) {
        window.location.href = data.endSessionUrl;
        return;
      }

      setIsAuthenticated(false);
    } catch (error) {
      setIsAuthenticated(false);
    }
  };

  if (isAuthenticated === null && !isDocsRoute) {
    return <LoadingScreen message="Initializing your workspace..." title="PrintHive" />;
  }

  return (
    <ErrorBoundary>
      <ModalProvider>
        <div className="min-h-dvh flex flex-col">
          <div className="flex-1 min-h-0">
            {isDocsRoute && !isAuthenticated ? (
              <Suspense fallback={<LoadingScreen message="Loading docs..." title="PrintHive" />}>
                <Docs standalone />
              </Suspense>
            ) : isAuthenticated ? (
              <Dashboard onLogout={handleLogout} />
            ) : (
              <Login onLoginSuccess={handleLoginSuccess} />
            )}
          </div>

          {/* Desktop-only footer: mobile gives the space to content + tab bar */}
          <footer className="hidden md:block shrink-0 border-t border-line bg-base/90 px-6 py-3">
            <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-fg-soft">PrintHive v{footerVersion}</span>
              <div className="flex items-center gap-2 text-muted">
                <span>3D print ops workspace</span>
                <span aria-hidden className="opacity-50">•</span>
                <a
                  className="font-semibold text-accent hover:text-accent-strong transition-colors"
                  href="https://github.com/tr1ckz"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  by tr1ck
                </a>
              </div>
            </div>
          </footer>
        </div>
      </ModalProvider>
    </ErrorBoundary>
  );
}

export default App;

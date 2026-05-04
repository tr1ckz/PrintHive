import { useState, useEffect } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import LoadingScreen from './components/LoadingScreen';
import ErrorBoundary from './components/ErrorBoundary';
import Docs from './components/Docs';
import { ModalProvider } from './components/ModalProvider';
import { API_ENDPOINTS } from './config/api';
import { fetchWithRetry } from './utils/fetchWithRetry';
import { usePrinterStore } from './stores/usePrinterStore';
import { applyThemeScheme } from './utils/theme';
import packageInfo from '../package.json';
import './App.css';

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

  const loadFooterVersion = async () => {
    try {
      const response = await fetch('/version.json', { cache: 'no-store' });
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
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.UI, {
        credentials: 'include',
      });
      const data = await response.json();
      applyThemeScheme(data.success ? data.colorScheme : 'orange');
    } catch (error) {
      console.error('Failed to load color scheme:', error);
      applyThemeScheme('orange');
    }
  };

  const checkAuth = async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.AUTH.CHECK, {
        credentials: 'include'
      });
      const data = await response.json();
      setIsAuthenticated(data.authenticated);
    } catch (error) {
      setIsAuthenticated(false);
    }
  };

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
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
        <div className="app">
          <div className="app-content">
            {isDocsRoute && !isAuthenticated ? (
              <Docs standalone />
            ) : isAuthenticated ? (
              <Dashboard onLogout={handleLogout} />
            ) : (
              <Login onLoginSuccess={handleLoginSuccess} />
            )}
          </div>

          <footer className="app-footer">
            <div className="app-footer-inner">
              <span className="app-footer-version">PrintHive v{footerVersion}</span>
              <div className="app-footer-meta">
                <span className="app-footer-caption">3D print ops workspace</span>
                <span className="app-footer-separator">•</span>
                <a
                  className="app-footer-link"
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

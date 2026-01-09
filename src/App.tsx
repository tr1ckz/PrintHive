import { useState, useEffect } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import LoadingScreen from './components/LoadingScreen';
import ErrorBoundary from './components/ErrorBoundary';
import { API_ENDPOINTS } from './config/api';
import { fetchWithRetry } from './utils/fetchWithRetry';
import './App.css';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    checkAuth();
    loadColorScheme();
  }, []);

  const loadColorScheme = async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.UI, {
        credentials: 'include',
      });
      const data = await response.json();
      if (data.success && data.colorScheme) {
        applyColorScheme(data.colorScheme);
      }
    } catch (error) {
      console.error('Failed to load color scheme:', error);
    }
  };

  const applyColorScheme = (scheme: string) => {
    const colorSchemes: Record<string, { primary: string; secondary: string; gradient1: string; gradient2: string }> = {
      cyan: { primary: '#00d4ff', secondary: '#0099ff', gradient1: '#00d4ff', gradient2: '#0099ff' },
      purple: { primary: '#a855f7', secondary: '#7c3aed', gradient1: '#a855f7', gradient2: '#7c3aed' },
      green: { primary: '#10b981', secondary: '#059669', gradient1: '#10b981', gradient2: '#059669' },
      orange: { primary: '#f97316', secondary: '#ea580c', gradient1: '#f97316', gradient2: '#ea580c' },
      pink: { primary: '#ec4899', secondary: '#db2777', gradient1: '#ec4899', gradient2: '#db2777' },
      blue: { primary: '#3b82f6', secondary: '#2563eb', gradient1: '#3b82f6', gradient2: '#2563eb' }
    };

    const colors = colorSchemes[scheme] || colorSchemes.cyan;
    document.documentElement.style.setProperty('--color-primary', colors.primary);
    document.documentElement.style.setProperty('--color-secondary', colors.secondary);
    document.documentElement.style.setProperty('--color-gradient-1', colors.gradient1);
    document.documentElement.style.setProperty('--color-gradient-2', colors.gradient2);
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
      
      // If OIDC logout, redirect to provider's end-session endpoint FIRST
      // Don't set authenticated to false yet - let the redirect happen
      if (data.oidcLogout && data.endSessionUrl) {
        window.location.href = data.endSessionUrl;
        return; // Don't continue after redirect
      }
      
      // Only set unauthenticated for non-OIDC logouts
      setIsAuthenticated(false);
    } catch (error) {
      setIsAuthenticated(false);
    }
  };

  if (isAuthenticated === null) {
    return <LoadingScreen message="Initializing..." />;
  }

  return (
    <ErrorBoundary>
      <div className="app">
        {isAuthenticated ? (
          <Dashboard onLogout={handleLogout} />
        ) : (
          <Login onLoginSuccess={handleLoginSuccess} />
        )}
      </div>
    </ErrorBoundary>
  );
}

export default App;

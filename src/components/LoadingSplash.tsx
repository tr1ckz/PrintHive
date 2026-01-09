import { useEffect, useState } from 'react';
import './LoadingSplash.css';
import { API_ENDPOINTS } from '../config/api';
import { fetchWithRetry } from '../utils/fetchWithRetry';

interface LoadingSplashProps {
  message?: string;
  progress?: number;
  onComplete?: () => void;
  checkServerHealth?: boolean;
}

function LoadingSplash({ 
  message, 
  progress, 
  onComplete,
  checkServerHealth = false
}: LoadingSplashProps) {
  const [serverReady, setServerReady] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [showRefreshButton, setShowRefreshButton] = useState(false);

  // 10-second countdown fallback
  useEffect(() => {
    if (!checkServerHealth || serverReady) return;

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          setShowRefreshButton(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [checkServerHealth, serverReady]);

  // Auto-refresh when server comes back up
  useEffect(() => {
    if (!checkServerHealth) return;

    const checkServer = async () => {
      try {
        const response = await fetchWithRetry(API_ENDPOINTS.AUTH.HEALTH, { 
          method: 'GET',
          cache: 'no-cache',
        });
        if (response.ok) {
          setServerReady(true);
          // Auto-refresh after brief delay
          setTimeout(() => {
            window.location.reload();
          }, 500);
        }
      } catch (error) {
        // Server not ready yet, keep checking
        setTimeout(checkServer, 1000);
      }
    };

    // Start checking immediately
    checkServer();
  }, [checkServerHealth]);

  return (
    <div className="loading-splash" style={{ backgroundImage: `url(/images/splash.png)` }}>
      <div className="loading-content">
        {checkServerHealth && !serverReady && (
          <>
            <div className="loading-countdown">
              {countdown}s
            </div>
            {showRefreshButton && (
              <div className="loading-refresh-container">
                <button 
                  className="btn btn-primary" 
                  onClick={() => window.location.reload()}
                >
                  Refresh
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {progress !== undefined && (
        <div className="loading-progress-container">
          <div className="loading-progress-bar">
            <div 
              className="loading-progress-fill"
              style={{ width: `${progress}%` }}
            >
              <span className="loading-progress-text">{progress}%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LoadingSplash;

import { useEffect, useState } from 'react';
import './LoadingSplash.css';

interface LoadingSplashProps {
  message?: string;
  progress?: number;
  onComplete?: () => void;
  checkServerHealth?: boolean;
}

function LoadingSplash({ 
  message = 'Loading...', 
  progress, 
  onComplete,
  checkServerHealth = false 
}: LoadingSplashProps) {
  const [dots, setDots] = useState('');
  const [serverReady, setServerReady] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => (prev.length >= 3 ? '' : prev + '.'));
    }, 500);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!checkServerHealth) return;

    const checkServer = async () => {
      try {
        const response = await fetch('/api/health', { 
          method: 'GET',
          cache: 'no-cache',
        });
        if (response.ok) {
          setServerReady(true);
          setTimeout(() => {
            if (onComplete) onComplete();
          }, 500);
        }
      } catch (error) {
        // Server not ready yet, keep checking
        setTimeout(checkServer, 1000);
      }
    };

    // Start checking after a brief delay
    setTimeout(checkServer, 2000);
  }, [checkServerHealth, onComplete]);

  return (
    <div className="loading-splash">
      <div className="loading-content">
        <div className="loading-logo">
          <div className="loading-spinner"></div>
          <h1>PrintHive</h1>
        </div>
        
        <div className="loading-message">
          {message}{dots}
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

        {serverReady && (
          <div className="loading-success">
            ✓ Server ready! Redirecting...
          </div>
        )}
      </div>
    </div>
  );
}

export default LoadingSplash;

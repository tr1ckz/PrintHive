import { useEffect, useState } from 'react';
import './LoadingScreen.css';

interface LoadingScreenProps {
  message?: string;
  title?: string;
  variant?: 'fullscreen' | 'panel';
}

function LoadingScreen({
  message = 'Loading...',
  title = 'PrintHive',
  variant = 'fullscreen'
}: LoadingScreenProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      timeoutId = setTimeout(() => {
        if (!active) return;
        setProgress((prev) => {
          if (prev >= 95) return prev;
          const increment = Math.random() * 12 + 3;
          return Math.min(prev + increment, 95);
        });
        if (active) tick();
      }, 220);
    };

    tick();

    return () => {
      active = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  return (
    <div className={`loading-screen ${variant === 'panel' ? 'is-panel' : ''}`}>
      <div className="loading-content">
        <span className="loading-kicker">Unified workspace</span>
        <div className="logo-container">
          <img src="/images/logo.png" alt="Logo" className="loading-logo" />
          <div className="logo-glow"></div>
        </div>

        <h2 className="loading-title">{title}</h2>
        <p className="loading-message">{message}</p>

        <div className="loading-bar-container">
          <div className="loading-bar-track">
            <div
              className="loading-bar-fill"
              style={{ width: `${progress}%` }}
            ></div>
            <div className="loading-bar-shine"></div>
          </div>
          <span className="loading-percentage">{Math.round(progress)}%</span>
        </div>

        <div className="loading-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>
  );
}

export default LoadingScreen;

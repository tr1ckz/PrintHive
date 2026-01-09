import React, { useState, useEffect } from 'react';
import './ThemeToggle.css';

type Theme = 'dark' | 'light';

const ThemeToggle: React.FC = () => {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    // Load saved theme from localStorage
    const savedTheme = localStorage.getItem('theme') as Theme;
    if (savedTheme) {
      setTheme(savedTheme);
      applyTheme(savedTheme);
    }
  }, []);

  const applyTheme = (newTheme: Theme) => {
    const root = document.documentElement;
    
    if (newTheme === 'light') {
      root.style.setProperty('--bg-dark', '#f8fafc');
      root.style.setProperty('--bg-darker', '#e2e8f0');
      root.style.setProperty('--bg-overlay', 'rgba(255, 255, 255, 0.95)');
      root.style.setProperty('--bg-card', '#ffffff');
      root.style.setProperty('--text-primary', '#0f172a');
      root.style.setProperty('--text-secondary', '#475569');
      root.style.setProperty('--text-muted', '#64748b');
      root.style.setProperty('--border-primary', 'rgba(0, 0, 0, 0.1)');
      root.style.setProperty('--border-dark', 'rgba(0, 0, 0, 0.15)');
      root.style.setProperty('--shadow-sm', '0 1px 2px rgba(0, 0, 0, 0.05)');
      root.style.setProperty('--shadow-md', '0 4px 6px rgba(0, 0, 0, 0.07)');
      root.style.setProperty('--shadow-lg', '0 10px 15px rgba(0, 0, 0, 0.1)');
      
      // Update body background
      document.body.style.background = 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)';
    } else {
      // Dark theme (default values)
      root.style.setProperty('--bg-dark', 'rgba(15, 23, 42, 0.95)');
      root.style.setProperty('--bg-darker', 'rgba(10, 15, 30, 0.98)');
      root.style.setProperty('--bg-overlay', 'rgba(30, 30, 30, 0.95)');
      root.style.setProperty('--bg-card', 'rgba(15, 23, 42, 0.6)');
      root.style.setProperty('--text-primary', '#ffffff');
      root.style.setProperty('--text-secondary', 'rgba(255, 255, 255, 0.8)');
      root.style.setProperty('--text-muted', 'rgba(255, 255, 255, 0.6)');
      root.style.setProperty('--border-primary', 'rgba(0, 212, 255, 0.3)');
      root.style.setProperty('--border-dark', 'rgba(255, 255, 255, 0.1)');
      root.style.setProperty('--shadow-sm', '0 1px 2px rgba(0, 0, 0, 0.3)');
      root.style.setProperty('--shadow-md', '0 4px 12px rgba(0, 0, 0, 0.1)');
      root.style.setProperty('--shadow-lg', '0 10px 40px rgba(0, 0, 0, 0.1)');
      
      // Update body background
      document.body.style.background = 'linear-gradient(135deg, rgba(15, 23, 42, 1) 0%, rgba(0, 0, 0, 1) 100%)';
    }
  };

  const toggleTheme = () => {
    const newTheme: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  return (
    <button 
      className="theme-toggle" 
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? (
        <span className="theme-icon">☀️</span>
      ) : (
        <span className="theme-icon">🌙</span>
      )}
    </button>
  );
};

export default ThemeToggle;

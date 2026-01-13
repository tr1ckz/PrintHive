import { useState, useEffect } from 'react';
import PrintHistory from './PrintHistory';
import Library from './Library';
import Duplicates from './Duplicates';
import Settings from './Settings';
import BuyMeACoffee from './BuyMeACoffee';
import DashboardHome from './DashboardHome';
import Maintenance from './Maintenance';
import Printers from './Printers';
import Statistics from './Statistics';
import ThemeToggle from './ThemeToggle';
import CommandPalette from './CommandPalette';
import { API_ENDPOINTS } from '../config/api';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import './Dashboard.css';

interface DashboardProps {
  onLogout: () => void;
}

type Tab = 'home' | 'history' | 'library' | 'duplicates' | 'maintenance' | 'settings' | 'printers' | 'statistics';

const tabPaths: Record<Tab, string> = {
  home: '/',
  history: '/history',
  library: '/library',
  duplicates: '/duplicates',
  maintenance: '/maintenance',
  settings: '/settings',
  printers: '/printers',
  statistics: '/statistics'
};

const getHashSection = () => {
  return window.location.hash ? window.location.hash.slice(1) : null;
};

const getTabFromLocation = (): Tab | null => {
  const path = window.location.pathname.toLowerCase();

  if (path.startsWith('/history')) return 'history';
  if (path.startsWith('/library')) return 'library';
  if (path.startsWith('/duplicates')) return 'duplicates';
  if (path.startsWith('/maintenance')) return 'maintenance';
  if (path.startsWith('/settings')) return 'settings';
  if (path.startsWith('/printers')) return 'printers';
  if (path.startsWith('/statistics')) return 'statistics';
  if (path === '/' || path === '') return 'home';
  return null;
};

interface UserInfo {
  username: string;
  role: string;
  email: string | null;
  display_name?: string;
}

function Dashboard({ onLogout }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const urlTab = getTabFromLocation();
    if (urlTab) return urlTab;
    const savedTab = localStorage.getItem('activeTab');
    return (savedTab as Tab) || 'home';
  });
  const [settingsSection, setSettingsSection] = useState<string | null>(() => getHashSection());
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hideBmc, setHideBmc] = useState(true); // Default hidden until loaded

  useEffect(() => {
    fetchWithRetry(API_ENDPOINTS.AUTH.USER_ME, { credentials: 'include' })
      .then(res => res.json())
      .then(data => setUserInfo(data))
      .catch(err => console.error('Failed to fetch user info:', err));
    
    // Fetch UI settings
    fetchWithRetry(API_ENDPOINTS.SETTINGS.UI, { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setHideBmc(data.hideBmc || false);
        } else {
          setHideBmc(false); // Show by default if fetch fails
        }
      })
      .catch(() => setHideBmc(false)); // Show by default if fetch fails
  }, []);

  useEffect(() => {
    localStorage.setItem('activeTab', activeTab);
  }, [activeTab]);

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (mobileMenuOpen && !target.closest('.navbar') && !target.closest('.mobile-menu')) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [mobileMenuOpen]);

  // Sync tab with browser history (supports back/forward navigation)
  useEffect(() => {
    const handleNavigation = () => {
      const tabFromPath = getTabFromLocation();
      if (tabFromPath) {
        setActiveTab(tabFromPath);
        setSettingsSection(getHashSection());
      }
    };

    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('hashchange', handleNavigation);
    return () => {
      window.removeEventListener('popstate', handleNavigation);
      window.removeEventListener('hashchange', handleNavigation);
    };
  }, []);

  // Close mobile menu on tab change + push URL
  const handleTabChange = (tab: Tab, hashSection?: string) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);

    const path = tabPaths[tab] || '/';
    const nextUrl = hashSection ? `${path}#${hashSection}` : path;
    window.history.pushState({ tab }, '', nextUrl);
    setSettingsSection(hashSection || getHashSection());
  };

  const isAdmin = userInfo?.role === 'admin' || userInfo?.role === 'superadmin';

  const navItems = [
    { id: 'home' as Tab, label: 'Home', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )},
    { id: 'history' as Tab, label: 'History', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )},
    { id: 'library' as Tab, label: 'Library', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )},
    { id: 'duplicates' as Tab, label: 'Duplicates', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )},
    { id: 'maintenance' as Tab, label: 'Maintenance', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )},
    { id: 'settings' as Tab, label: 'Settings', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )},
  ];

  const adminItems: { id: Tab; label: string; icon: JSX.Element }[] = [];

  return (
    <div className="dashboard">
      {/* Fixed Top Navbar */}
      <nav className="navbar">
        <div className="navbar-container">
          {/* Logo */}
          <div className="navbar-brand" onClick={() => handleTabChange('home')} style={{ cursor: 'pointer' }}>
            <img src="/images/logo.png" alt="PrintHive" className="navbar-logo" />
            <span className="navbar-title">PrintHive</span>
          </div>

          {/* Desktop Navigation */}
          <div className="navbar-nav">
            {navItems.map(item => (
              <button
                key={item.id}
                className={`navbar-item ${activeTab === item.id ? 'active' : ''}`}
                onClick={() => handleTabChange(item.id)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
            {isAdmin && adminItems.map(item => (
              <button
                key={item.id}
                className={`navbar-item ${activeTab === item.id ? 'active' : ''}`}
                onClick={() => handleTabChange(item.id)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>

          {/* Right Section: User + Logout */}
          <div className="navbar-right">
            {!hideBmc && <BuyMeACoffee username="tr1ck" />}
            <div className="navbar-user">
              <div className="user-avatar">{(userInfo?.display_name || userInfo?.username)?.[0]?.toUpperCase() || 'U'}</div>
              <span className="user-name">{userInfo?.display_name || userInfo?.username || 'User'}</span>
            </div>
            <button className="logout-btn" onClick={onLogout} title="Logout">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {/* Mobile Menu Button */}
            <button 
              className="mobile-menu-btn"
              onClick={(e) => { e.stopPropagation(); setMobileMenuOpen(!mobileMenuOpen); }}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Menu */}
        <div className={`mobile-menu ${mobileMenuOpen ? 'open' : ''}`}>
          {navItems.map(item => (
            <button
              key={item.id}
              className={`mobile-menu-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => handleTabChange(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
          {isAdmin && (
            <>
              <div className="mobile-menu-divider"></div>
              {adminItems.map(item => (
                <button
                  key={item.id}
                  className={`mobile-menu-item ${activeTab === item.id ? 'active' : ''}`}
                  onClick={() => handleTabChange(item.id)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </nav>

      {/* Main Content - Components are conditionally rendered to save memory */}
      <main className="dashboard-content">
        <div className="content-wrapper">
          {activeTab === 'home' ? <DashboardHome onNavigate={(tab) => handleTabChange(tab as Tab)} /> : null}
          {activeTab === 'history' ? <PrintHistory /> : null}
          {activeTab === 'library' ? <Library userRole={userInfo?.role} /> : null}
          {activeTab === 'duplicates' ? <Duplicates /> : null}
          {activeTab === 'maintenance' ? <Maintenance /> : null}
          {activeTab === 'settings' ? <Settings userRole={userInfo?.role} initialSection={settingsSection || undefined} /> : null}
          {activeTab === 'printers' ? <Printers /> : null}
          {activeTab === 'statistics' ? <Statistics /> : null}
        </div>
      </main>

      {/* Buy Me A Coffee */}
      {!hideBmc && <BuyMeACoffee />}
      
      {/* Theme Toggle */}
      <ThemeToggle />
      
      {/* Command Palette */}
      <CommandPalette onNavigate={(tab) => handleTabChange(tab as Tab)} />
    </div>
  );
}

export default Dashboard;

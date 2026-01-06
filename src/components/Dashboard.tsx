import { useState, useEffect } from 'react';
import Printers from './Printers';
import PrintHistory from './PrintHistory';
import Statistics from './Statistics';
import Library from './Library';
import Duplicates from './Duplicates';
import Settings from './Settings';
import UserManagement from './UserManagement';
import BuyMeACoffee from './BuyMeACoffee';
import './Dashboard.css';

interface DashboardProps {
  onLogout: () => void;
}

type Tab = 'printers' | 'history' | 'statistics' | 'library' | 'duplicates' | 'settings' | 'users';

interface UserInfo {
  username: string;
  role: string;
  email: string | null;
  display_name?: string;
}

function Dashboard({ onLogout }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const savedTab = localStorage.getItem('activeTab');
    return (savedTab as Tab) || 'printers';
  });
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hideBmc, setHideBmc] = useState(true); // Default hidden until loaded

  useEffect(() => {
    fetch('/api/user/me')
      .then(res => res.json())
      .then(data => setUserInfo(data))
      .catch(err => console.error('Failed to fetch user info:', err));
    
    // Fetch UI settings
    fetch('/api/settings/ui')
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

  // Close mobile menu on tab change
  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  const isAdmin = userInfo?.role === 'admin' || userInfo?.role === 'superadmin';

  const navItems = [
    { id: 'printers' as Tab, label: 'Printers', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
        <path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )},
    { id: 'history' as Tab, label: 'History', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )},
    { id: 'statistics' as Tab, label: 'Stats', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M9 11v6m6-8v8m-9-6v4m12-8v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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
  ];

  const adminItems = [
    { id: 'users' as Tab, label: 'Users', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )},
    { id: 'settings' as Tab, label: 'Settings', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )},
  ];

  return (
    <div className="dashboard">
      {/* Fixed Top Navbar */}
      <nav className="navbar">
        <div className="navbar-container">
          {/* Logo */}
          <div className="navbar-brand">
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

      {/* Main Content */}
      <main className="dashboard-content">
        <div className="content-wrapper">
          {activeTab === 'printers' && <Printers />}
          {activeTab === 'history' && <PrintHistory />}
          {activeTab === 'statistics' && <Statistics />}
          {activeTab === 'library' && <Library userRole={userInfo?.role} />}
          {activeTab === 'duplicates' && <Duplicates />}
          {isAdmin && activeTab === 'users' && <UserManagement />}
          {isAdmin && activeTab === 'settings' && <Settings />}
        </div>
      </main>
    </div>
  );
}

export default Dashboard;

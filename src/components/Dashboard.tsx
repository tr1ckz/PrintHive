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
}

function Dashboard({ onLogout }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const savedTab = localStorage.getItem('activeTab');
    return (savedTab as Tab) || 'printers';
  });
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);

  useEffect(() => {
    // Fetch current user info
    fetch('/api/user/me')
      .then(res => res.json())
      .then(data => setUserInfo(data))
      .catch(err => console.error('Failed to fetch user info:', err));
  }, []);

  useEffect(() => {
    localStorage.setItem('activeTab', activeTab);
  }, [activeTab]);

  const isAdmin = userInfo?.role === 'admin' || userInfo?.role === 'superadmin';

  return (
    <div className="dashboard">
      <div className="dashboard-sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <img src="/images/logo.png" alt="PrintHive" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />
          </div>
          <h2>PrintHive</h2>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeTab === 'printers' ? 'active' : ''}`}
            onClick={() => setActiveTab('printers')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="4" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
              <path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>Printers</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Print History</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'statistics' ? 'active' : ''}`}
            onClick={() => setActiveTab('statistics')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 11v6m6-8v8m-9-6v4m12-8v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Statistics</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'library' ? 'active' : ''}`}
            onClick={() => setActiveTab('library')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Library</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'duplicates' ? 'active' : ''}`}
            onClick={() => setActiveTab('duplicates')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Duplicates</span>
          </button>

          {isAdmin && (
            <button
              className={`nav-item ${activeTab === 'users' ? 'active' : ''}`}
              onClick={() => setActiveTab('users')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Users</span>
            </button>
          )}

          {isAdmin && (
            <button
              className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Settings</span>
            </button>
          )}
        </nav>

        <div className="sidebar-footer">
          <BuyMeACoffee username="tr1ck" />
          
          <div className="user-logout-row">
            <div className="user-info">
              <div className="user-avatar">{userInfo?.username?.[0]?.toUpperCase() || 'U'}</div>
              <div className="user-details">
                <div className="user-name">{userInfo?.username || 'User'}</div>
                <div className="user-role">{userInfo?.role === 'admin' ? 'Admin' : 'User'}</div>
              </div>
            </div>
            <button className="logout-btn" onClick={onLogout} title="Logout">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="dashboard-content">
        <div className="content-wrapper">
          {activeTab === 'printers' && <Printers />}
          {activeTab === 'history' && <PrintHistory />}
          {activeTab === 'statistics' && <Statistics />}
          {activeTab === 'library' && <Library userRole={userInfo?.role} />}
          {activeTab === 'duplicates' && <Duplicates />}
          {isAdmin && activeTab === 'users' && <UserManagement />}
          {isAdmin && activeTab === 'settings' && <Settings />}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;

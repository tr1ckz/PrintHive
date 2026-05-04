import { useState, useEffect } from 'react';
import PrintHistory from './PrintHistory';
import Library from './Library';
import Duplicates from './Duplicates';
import Settings from './Settings';
import DashboardHome from './DashboardHome';
import Maintenance from './Maintenance';
import Printers from './Printers';
import CommandPalette from './CommandPalette';
import Statistics from './Statistics';
import Docs from './Docs';
import BackgroundJobTracker from './BackgroundJobTracker';
import BuyMeACoffee from './BuyMeACoffee';
import GlobalLayout from './GlobalLayout';
import { API_ENDPOINTS } from '../config/api';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import './Dashboard.css';

interface DashboardProps {
  onLogout: () => void;
}

type Tab = 'home' | 'history' | 'library' | 'duplicates' | 'maintenance' | 'settings' | 'printers' | 'statistics' | 'docs';

const tabPaths: Record<Tab, string> = {
  home: '/',
  history: '/history',
  library: '/library',
  duplicates: '/duplicates',
  maintenance: '/maintenance',
  settings: '/settings',
  printers: '/printers',
  statistics: '/statistics',
  docs: '/docs'
};

const pageMeta: Record<Tab, { eyebrow: string; title: string; description: string; breadcrumbs: string[] }> = {
  home: {
    eyebrow: 'Command center',
    title: 'Overview',
    description: 'Your workshop at a glance with jobs, insights, and the next actions that matter.',
    breadcrumbs: ['Workspace', 'Overview']
  },
  history: {
    eyebrow: 'Operations',
    title: 'Print History',
    description: 'Audit completed jobs, timelapses, and outcomes without leaving the shared shell.',
    breadcrumbs: ['Workspace', 'History']
  },
  library: {
    eyebrow: 'Design library',
    title: 'Model Library',
    description: 'Browse, organize, and enrich your printable assets in one clean catalog.',
    breadcrumbs: ['Workspace', 'Library']
  },
  duplicates: {
    eyebrow: 'Library hygiene',
    title: 'Duplicates',
    description: 'Spot redundant files quickly and keep the collection lean.',
    breadcrumbs: ['Workspace', 'Duplicates']
  },
  maintenance: {
    eyebrow: 'Workshop care',
    title: 'Maintenance',
    description: 'Track recurring upkeep and keep every machine in top condition.',
    breadcrumbs: ['Workspace', 'Maintenance']
  },
  settings: {
    eyebrow: 'System preferences',
    title: 'Settings',
    description: 'Navigate every configuration area with scoped categories and focused panels.',
    breadcrumbs: ['Workspace', 'Settings']
  },
  printers: {
    eyebrow: 'Live monitoring',
    title: 'Printers',
    description: 'A unified bento dashboard for cameras, telemetry, AMS state, and print progress.',
    breadcrumbs: ['Workspace', 'Printers']
  },
  statistics: {
    eyebrow: 'Reporting',
    title: 'Statistics',
    description: 'See output, reliability, and material usage trends without digging around.',
    breadcrumbs: ['Workspace', 'Statistics']
  },
  docs: {
    eyebrow: 'Reference',
    title: 'Documentation',
    description: 'Read guides and integration notes from the same consistent workspace shell.',
    breadcrumbs: ['Workspace', 'Docs']
  }
};

const getSettingsSectionFromLocation = () => {
  const searchSection = new URLSearchParams(window.location.search).get('section');
  if (searchSection) {
    return searchSection;
  }
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
  if (path.startsWith('/docs')) return 'docs';
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
  const [settingsSection, setSettingsSection] = useState<string | null>(() => getSettingsSectionFromLocation());
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hideBmc, setHideBmc] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true');

  useEffect(() => {
    fetchWithRetry(API_ENDPOINTS.AUTH.USER_ME, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setUserInfo(data))
      .catch((err) => console.error('Failed to fetch user info:', err));

    fetchWithRetry(API_ENDPOINTS.SETTINGS.UI, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setHideBmc(data.hideBmc || false);
        }
      })
      .catch((err) => console.error('Failed to fetch UI settings:', err));
  }, []);

  useEffect(() => {
    localStorage.setItem('activeTab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    const handleNavigation = () => {
      const tabFromPath = getTabFromLocation();
      if (tabFromPath) {
        setActiveTab(tabFromPath);
        setSettingsSection(getSettingsSectionFromLocation());
      }
    };

    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('hashchange', handleNavigation);
    return () => {
      window.removeEventListener('popstate', handleNavigation);
      window.removeEventListener('hashchange', handleNavigation);
    };
  }, []);

  const handleTabChange = (tab: Tab, hashSection?: string) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);

    const path = tabPaths[tab] || '/';
    const nextUrl = hashSection ? `${path}?section=${encodeURIComponent(hashSection)}` : path;
    window.history.pushState({ tab }, '', nextUrl);
    setSettingsSection(hashSection || null);
  };

  const isAdmin = userInfo?.role === 'admin' || userInfo?.role === 'superadmin';
  const currentMeta = pageMeta[activeTab];

  const navItems = [
    { id: 'home' as Tab, label: 'Home', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )},
    { id: 'printers' as Tab, label: 'Printers', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 17h10m-9-6h8m2 8H6a2 2 0 01-2-2V9a3 3 0 013-3h10a3 3 0 013 3v8a2 2 0 01-2 2zM8 5h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )},
    { id: 'history' as Tab, label: 'History', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )},
    { id: 'statistics' as Tab, label: 'Stats', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 21V9m5 12V3m5 18v-8m5 8V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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
    { id: 'docs' as Tab, label: 'Docs', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 4.5A2.5 2.5 0 019.5 2H20v16H9.5A2.5 2.5 0 007 20.5m0-16v16m0-16H5a2 2 0 00-2 2v12a2 2 0 002 2h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )},
  ];

  const rightSlot = (
    <div className="dashboard-status-pills">
      <span className="dashboard-status-pill">{isAdmin ? 'Admin access' : 'Workspace member'}</span>
      <span className="dashboard-status-pill subtle">⌘K Command palette</span>
    </div>
  );

  const renderActiveView = () => {
    switch (activeTab) {
      case 'home':
        return <DashboardHome onNavigate={(tab) => handleTabChange(tab as Tab)} />;
      case 'history':
        return <PrintHistory />;
      case 'statistics':
        return <Statistics />;
      case 'library':
        return <Library userRole={userInfo?.role} />;
      case 'duplicates':
        return <Duplicates />;
      case 'maintenance':
        return <Maintenance />;
      case 'settings':
        return <Settings userRole={userInfo?.role} initialSection={settingsSection || undefined} />;
      case 'printers':
        return <Printers />;
      case 'docs':
        return <Docs />;
      default:
        return <DashboardHome onNavigate={(tab) => handleTabChange(tab as Tab)} />;
    }
  };

  return (
    <div className="dashboard">
      <GlobalLayout
        navItems={navItems}
        activeId={activeTab}
        onSelect={(tab) => handleTabChange(tab as Tab)}
        pageTitle={currentMeta.title}
        pageDescription={currentMeta.description}
        pageEyebrow={currentMeta.eyebrow}
        breadcrumbs={currentMeta.breadcrumbs}
        userName={userInfo?.display_name || userInfo?.username || 'User'}
        userRole={userInfo?.role}
        userAvatarText={(userInfo?.display_name || userInfo?.username)?.[0]?.toUpperCase() || 'U'}
        onLogout={onLogout}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((prev) => !prev)}
        mobileMenuOpen={mobileMenuOpen}
        onToggleMobileMenu={() => setMobileMenuOpen((prev) => !prev)}
        sidebarFooter={!hideBmc ? <BuyMeACoffee /> : null}
        rightSlot={rightSlot}
      >
        {renderActiveView()}
      </GlobalLayout>

      <BackgroundJobTracker />
      <CommandPalette onNavigate={(tab) => handleTabChange(tab as Tab)} />
    </div>
  );
}

export default Dashboard;

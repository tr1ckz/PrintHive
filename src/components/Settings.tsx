import { useState, useEffect } from 'react';
import './Settings.css';
import Toast from './Toast';
import UserManagement from './UserManagement';
import {
  SettingsContext,
  BambuSettings,
  PrinterFtpSettings,
  AccountSettings,
  CostSettings,
  UISettings,
  NotificationSettings,
  OAuthSettings,
  WatchdogSettings,
  SystemSettings,
  CollapsibleSection,
  ToastState
} from './settingsComponents';

interface SettingsProps {
  userRole?: string;
  initialSection?: string;
}

type SettingsSection = 'hardware' | 'account' | 'preferences' | 'integrations' | 'advanced' | 'administration';

const SETTINGS_SECTIONS: Record<SettingsSection, { label: string; icon: string; description: string; hint: string }> = {
  hardware: {
    label: 'Hardware',
    icon: '🖨️',
    description: 'Manage Bambu cloud accounts, LAN printers, FTP, and timelapse connectivity in one place.',
    hint: 'Printers & connectivity'
  },
  account: {
    label: 'Account',
    icon: '👤',
    description: 'Update your profile, login details, and personal account preferences.',
    hint: 'Profile & security'
  },
  preferences: {
    label: 'Preferences',
    icon: '🎨',
    description: 'Adjust UI appearance, cost settings, and the day-to-day dashboard experience.',
    hint: 'UI & cost defaults'
  },
  integrations: {
    label: 'Integrations',
    icon: '🔌',
    description: 'Configure notifications and external services without digging through nested cards.',
    hint: 'Discord & alerts'
  },
  advanced: {
    label: 'Advanced',
    icon: '⚡',
    description: 'Fine-tune OAuth, watchdog behavior, and system-level options.',
    hint: 'System behavior'
  },
  administration: {
    label: 'Administration',
    icon: '🔐',
    description: 'Manage users and permissions for shared PrintHive installs.',
    hint: 'Admin-only controls'
  }
};

function Settings({ userRole, initialSection }: SettingsProps) {
  const isAdmin = userRole === 'admin' || userRole === 'superadmin';
  const [toast, setToast] = useState<ToastState | null>(null);

  const resolveSection = (section?: string | null): SettingsSection => {
    const normalized = (section || '').toLowerCase();
    const sectionMap: Record<string, SettingsSection> = {
      printer: 'hardware',
      hardware: 'hardware',
      connectivity: 'hardware',
      account: 'account',
      preferences: 'preferences',
      integrations: 'integrations',
      advanced: 'advanced',
      administration: 'administration'
    };

    const nextSection = sectionMap[normalized] || 'hardware';
    return nextSection === 'administration' && !isAdmin ? 'hardware' : nextSection;
  };

  const [activeSection, setActiveSection] = useState<SettingsSection>(() => resolveSection(initialSection));

  useEffect(() => {
    setActiveSection(resolveSection(initialSection));
  }, [initialSection, isAdmin]);

  useEffect(() => {
    const nextUrl = `/settings#${activeSection}`;
    if (window.location.pathname === '/settings' && window.location.hash !== `#${activeSection}`) {
      window.history.replaceState({ section: activeSection }, '', nextUrl);
    }
  }, [activeSection]);

  const availableSections = (Object.keys(SETTINGS_SECTIONS) as SettingsSection[]).filter((section) => {
    return isAdmin || section !== 'administration';
  });

  const activeSectionMeta = SETTINGS_SECTIONS[activeSection];

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'hardware':
        return (
          <div className="settings-panel-stack">
            <BambuSettings />
            <PrinterFtpSettings />
          </div>
        );
      case 'account':
        return <AccountSettings />;
      case 'preferences':
        return (
          <div className="settings-panel-stack">
            <CostSettings />
            <UISettings />
          </div>
        );
      case 'integrations':
        return <NotificationSettings />;
      case 'advanced':
        return (
          <div className="settings-panel-stack">
            <OAuthSettings />
            <WatchdogSettings />
            <SystemSettings />
          </div>
        );
      case 'administration':
        return isAdmin ? (
          <CollapsibleSection title="User Management" icon="👥" defaultExpanded={true}>
            <p className="form-description">
              Manage user accounts and permissions.
            </p>
            <UserManagement />
          </CollapsibleSection>
        ) : null;
      default:
        return null;
    }
  };

  return (
    <SettingsContext.Provider value={{ toast, setToast, isAdmin }}>
      <div className="settings-container settings-container-redesigned">
        <div className="settings-header">
          <h1>⚙️ Settings</h1>
          <p className="settings-description">
            Configure printers, accounts, integrations, and system behavior without the accordion maze.
          </p>
        </div>

        <div className="settings-layout">
          <aside className="settings-sidebar">
            <div className="settings-sidebar-sticky">
              <div className="settings-nav" aria-label="Settings sections">
                {availableSections.map((section) => {
                  const meta = SETTINGS_SECTIONS[section];
                  return (
                    <button
                      key={section}
                      type="button"
                      className={`settings-nav-item ${activeSection === section ? 'active' : ''}`}
                      onClick={() => setActiveSection(section)}
                    >
                      <span className="settings-nav-icon">{meta.icon}</span>
                      <span className="settings-nav-copy">
                        <span className="settings-nav-label">{meta.label}</span>
                        <span className="settings-nav-hint">{meta.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

          <section className="settings-main">
            <div className="settings-panel-hero">
              <span className="settings-panel-kicker">{activeSectionMeta.icon} {activeSectionMeta.label}</span>
              <h2>{activeSectionMeta.label}</h2>
              <p>{activeSectionMeta.description}</p>
            </div>

            {renderActiveSection()}
          </section>
        </div>

        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </div>
    </SettingsContext.Provider>
  );
}

export default Settings;

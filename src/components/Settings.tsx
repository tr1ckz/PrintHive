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

function Settings({ userRole, initialSection }: SettingsProps) {
  const isAdmin = userRole === 'admin' || userRole === 'superadmin';
  const [toast, setToast] = useState<ToastState | null>(null);
  
  // Track which category sections are expanded
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    printer: true,
    account: false,
    preferences: false,
    integrations: false,
    advanced: false,
    administration: false
  });
  
  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  // When navigated with a hash (e.g., /settings#account), expand and scroll to that section
  useEffect(() => {
    if (!initialSection) return;

    const sectionMap: Record<string, string> = {
      printer: 'settings-printer',
      account: 'settings-account',
      preferences: 'settings-preferences',
      integrations: 'settings-integrations',
      advanced: 'settings-advanced',
      administration: 'settings-administration'
    };

    const targetId = sectionMap[initialSection] || `settings-${initialSection}`;

    setExpandedCategories(prev => ({
      ...prev,
      [initialSection]: true
    }));

    const targetEl = document.getElementById(targetId);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [initialSection]);

  return (
    <SettingsContext.Provider value={{ toast, setToast, isAdmin }}>
      <div className="settings-container">
        <div className="settings-header">
          <h1>⚙️ Settings</h1>
          <p className="settings-description">
            Configure your printers, account, and preferences
          </p>
        </div>

        {/* PRINTER CONNECTION */}
        <div className="settings-category">
          <div 
            id="settings-printer"
            className={`category-header category-collapsible ${expandedCategories.printer ? 'expanded' : ''}`}
            onClick={() => toggleCategory('printer')}
          >
            <span className="category-icon">🖨️</span>
            <h2>Printer Connection</h2>
            <span className="category-toggle-icon">{expandedCategories.printer ? '−' : '+'}</span>
          </div>

          {expandedCategories.printer && (
            <>
              <BambuSettings />
              <PrinterFtpSettings />
            </>
          )}
        </div>

        {/* ACCOUNT */}
        <div className="settings-category">
          <div 
            id="settings-account"
            className={`category-header category-collapsible ${expandedCategories.account ? 'expanded' : ''}`}
            onClick={() => toggleCategory('account')}
          >
            <span className="category-icon">👤</span>
            <h2>Account</h2>
            <span className="category-toggle-icon">{expandedCategories.account ? '−' : '+'}</span>
          </div>

          {expandedCategories.account && <AccountSettings />}
        </div>

        {/* PREFERENCES */}
        <div className="settings-category">
          <div 
            id="settings-preferences"
            className={`category-header category-collapsible ${expandedCategories.preferences ? 'expanded' : ''}`}
            onClick={() => toggleCategory('preferences')}
          >
            <span className="category-icon">🎨</span>
            <h2>Preferences</h2>
            <span className="category-toggle-icon">{expandedCategories.preferences ? '−' : '+'}</span>
          </div>

          {expandedCategories.preferences && (
            <>
              <CostSettings />
              <UISettings />
            </>
          )}
        </div>

        {/* INTEGRATIONS */}
        <div className="settings-category">
          <div 
            id="settings-integrations"
            className={`category-header category-collapsible ${expandedCategories.integrations ? 'expanded' : ''}`}
            onClick={() => toggleCategory('integrations')}
          >
            <span className="category-icon">🔌</span>
            <h2>Integrations</h2>
            <span className="category-toggle-icon">{expandedCategories.integrations ? '−' : '+'}</span>
          </div>

          {expandedCategories.integrations && <NotificationSettings />}
        </div>

        {/* ADVANCED */}
        <div className="settings-category">
          <div 
            id="settings-advanced"
            className={`category-header category-collapsible ${expandedCategories.advanced ? 'expanded' : ''}`}
            onClick={() => toggleCategory('advanced')}
          >
            <span className="category-icon">⚡</span>
            <h2>Advanced</h2>
            <span className="category-toggle-icon">{expandedCategories.advanced ? '−' : '+'}</span>
          </div>

          {expandedCategories.advanced && (
            <>
              <OAuthSettings />
              <WatchdogSettings />
              <SystemSettings />
            </>
          )}
        </div>

        {/* ADMIN */}
        {isAdmin && (
          <div className="settings-category">
            <div 
              id="settings-administration"
              className={`category-header category-collapsible ${expandedCategories.administration ? 'expanded' : ''}`}
              onClick={() => toggleCategory('administration')}
            >
              <span className="category-icon">🔐</span>
              <h2>Administration</h2>
              <span className="category-toggle-icon">{expandedCategories.administration ? '−' : '+'}</span>
            </div>

            {expandedCategories.administration && (
              <CollapsibleSection title="User Management" icon="👥" defaultExpanded={true}>
                <p className="form-description">
                  Manage user accounts and permissions
                </p>
                <UserManagement />
              </CollapsibleSection>
            )}
          </div>
        )}

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

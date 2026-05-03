import { useEffect, useMemo, useState } from 'react';
import './Settings.css';
import Toast from './Toast';
import UserManagement from './UserManagement';
import {
  SettingsContext,
  BambuSettings,
  PrinterFtpSettings,
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

type SettingsCategory = 'workspace' | 'hardware' | 'integrations' | 'system';
type SettingsPanel =
  | 'appearance'
  | 'costs'
  | 'users'
  | 'bambu'
  | 'local'
  | 'notifications'
  | 'oauth'
  | 'watchdog'
  | 'system-panel';

interface PanelConfig {
  id: SettingsPanel;
  label: string;
  adminOnly?: boolean;
  render: () => JSX.Element | null;
}

interface CategoryConfig {
  id: SettingsCategory;
  label: string;
  icon: string;
  panels: PanelConfig[];
}

function CategoryIcon({ id }: { id: SettingsCategory }) {
  const paths: Record<SettingsCategory, JSX.Element> = {
    workspace: <path d="M4 6h16M4 12h16M4 18h16" />,
    hardware: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M12 12h.01" /></>,
    integrations: <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />,
    system: <><path d="M12 15a3 3 0 100-6 3 3 0 000 6z" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" /></>,
  };
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[id]}
    </svg>
  );
}

function Settings({ userRole, initialSection }: SettingsProps) {
  const isAdmin = userRole === 'admin' || userRole === 'superadmin';
  const [toast, setToast] = useState<ToastState | null>(null);

  const navigation = useMemo<CategoryConfig[]>(() => [
    {
      id: 'workspace',
      label: 'Workspace',
      icon: '▤',
      panels: [
        {
          id: 'appearance',
          label: 'Appearance',
          render: () => <UISettings />,
        },
        {
          id: 'costs',
          label: 'Costs',
          render: () => <CostSettings />,
        },
        {
          id: 'users',
          label: 'Users',
          adminOnly: true,
          render: () => (
            <CollapsibleSection title="User Management" icon="👥" defaultExpanded={true}>
              <p className="form-description">Manage user accounts and permissions for shared PrintHive installs.</p>
              <UserManagement />
            </CollapsibleSection>
          ),
        },
      ],
    },
    {
      id: 'hardware',
      label: 'Hardware',
      icon: '◫',
      panels: [
        {
          id: 'bambu',
          label: 'Bambu Link',
          render: () => <BambuSettings />,
        },
        {
          id: 'local',
          label: 'Local Network',
          render: () => <PrinterFtpSettings />,
        },
      ],
    },
    {
      id: 'integrations',
      label: 'Integrations',
      icon: '⌥',
      panels: [
        {
          id: 'notifications',
          label: 'Notifications',
          render: () => <NotificationSettings />,
        },
        {
          id: 'oauth',
          label: 'SSO & Auth',
          render: () => <OAuthSettings />,
        },
      ],
    },
    {
      id: 'system',
      label: 'System',
      icon: '⚙',
      panels: [
        {
          id: 'watchdog',
          label: 'Watchdog',
          render: () => <WatchdogSettings />,
        },
        {
          id: 'system-panel',
          label: 'Maintenance',
          render: () => <SystemSettings />,
        },
      ],
    },
  ], [isAdmin]);

  const resolveSelection = (section?: string | null): { category: SettingsCategory; panel: SettingsPanel } => {
    const normalized = (section || '').toLowerCase().replace('#', '');
    const [candidateCategory, candidatePanel] = normalized.split(/[.:/]/);

    const aliases: Record<string, { category: SettingsCategory; panel: SettingsPanel }> = {
      workspace: { category: 'workspace', panel: 'appearance' },
      general: { category: 'workspace', panel: 'appearance' },
      preferences: { category: 'workspace', panel: 'appearance' },
      ui: { category: 'workspace', panel: 'appearance' },
      appearance: { category: 'workspace', panel: 'appearance' },
      costs: { category: 'workspace', panel: 'costs' },
      users: { category: 'workspace', panel: isAdmin ? 'users' : 'appearance' },
      administration: { category: 'workspace', panel: isAdmin ? 'users' : 'appearance' },
      account: { category: 'workspace', panel: 'appearance' },
      profile: { category: 'workspace', panel: 'appearance' },
      hardware: { category: 'hardware', panel: 'bambu' },
      printers: { category: 'hardware', panel: 'bambu' },
      printer: { category: 'hardware', panel: 'bambu' },
      bambu: { category: 'hardware', panel: 'bambu' },
      local: { category: 'hardware', panel: 'local' },
      connectivity: { category: 'hardware', panel: 'local' },
      integrations: { category: 'integrations', panel: 'notifications' },
      cloud: { category: 'integrations', panel: 'notifications' },
      notifications: { category: 'integrations', panel: 'notifications' },
      oauth: { category: 'integrations', panel: 'oauth' },
      sso: { category: 'integrations', panel: 'oauth' },
      system: { category: 'system', panel: 'watchdog' },
      watchdog: { category: 'system', panel: 'watchdog' },
      advanced: { category: 'system', panel: 'watchdog' },
      maintenance: { category: 'system', panel: 'system-panel' },
    };

    if (candidateCategory && candidatePanel) {
      const foundCategory = navigation.find((entry) => entry.id === candidateCategory);
      const foundPanel = foundCategory?.panels.find((panel) => panel.id === candidatePanel && (!panel.adminOnly || isAdmin));
      if (foundCategory && foundPanel) {
        return { category: foundCategory.id, panel: foundPanel.id };
      }
    }

    return aliases[normalized] || { category: 'workspace', panel: 'appearance' };
  };

  const [selection, setSelection] = useState<{ category: SettingsCategory; panel: SettingsPanel }>(() => resolveSelection(initialSection));

  useEffect(() => {
    setSelection(resolveSelection(initialSection));
  }, [initialSection, isAdmin]);

  const availableCategories = navigation.map((category) => ({
    ...category,
    panels: category.panels.filter((panel) => !panel.adminOnly || isAdmin),
  }));

  const activeCategoryConfig = availableCategories.find((category) => category.id === selection.category) || availableCategories[0];
  const activePanelConfig = activeCategoryConfig.panels.find((panel) => panel.id === selection.panel) || activeCategoryConfig.panels[0];

  useEffect(() => {
    if (!activeCategoryConfig || !activePanelConfig) return;
    const nextHash = `${activeCategoryConfig.id}.${activePanelConfig.id}`;
    const nextUrl = `/settings#${nextHash}`;
    if (window.location.pathname === '/settings' && window.location.hash !== `#${nextHash}`) {
      window.history.replaceState({ section: nextHash }, '', nextUrl);
    }
  }, [activeCategoryConfig, activePanelConfig]);

  const handleCategoryChange = (categoryId: SettingsCategory) => {
    const nextCategory = availableCategories.find((category) => category.id === categoryId);
    if (!nextCategory) return;
    setSelection({ category: categoryId, panel: nextCategory.panels[0].id });
  };

  const handlePanelChange = (panelId: SettingsPanel) => {
    setSelection((current) => ({ ...current, panel: panelId }));
  };

  return (
    <SettingsContext.Provider value={{ toast, setToast, isAdmin }}>
      <div className="st-shell">
        {/* Mobile selects */}
        <div className="st-mobile-controls">
          <select
            value={selection.category}
            onChange={(e) => handleCategoryChange(e.target.value as SettingsCategory)}
            className="st-mobile-select"
          >
            {availableCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.label}</option>
            ))}
          </select>
          <select
            value={activePanelConfig.id}
            onChange={(e) => handlePanelChange(e.target.value as SettingsPanel)}
            className="st-mobile-select"
          >
            {activeCategoryConfig.panels.map((panel) => (
              <option key={panel.id} value={panel.id}>{panel.label}</option>
            ))}
          </select>
        </div>

        <div className="st-layout">
          {/* Sidebar */}
          <aside className="st-sidebar">
            <nav className="st-nav" aria-label="Settings navigation">
              {availableCategories.map((category) => (
                <div key={category.id} className="st-nav-group">
                  <button
                    type="button"
                    className={`st-nav-category ${activeCategoryConfig.id === category.id ? 'is-active' : ''}`}
                    onClick={() => handleCategoryChange(category.id)}
                  >
                    <span className="st-nav-cat-icon">
                      <CategoryIcon id={category.id} />
                    </span>
                    <span className="st-nav-cat-label">{category.label}</span>
                  </button>

                  {activeCategoryConfig.id === category.id && (
                    <div className="st-nav-panels">
                      {category.panels.map((panel) => (
                        <button
                          key={panel.id}
                          type="button"
                          className={`st-nav-panel ${activePanelConfig.id === panel.id ? 'is-active' : ''}`}
                          onClick={() => handlePanelChange(panel.id)}
                        >
                          {panel.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </nav>
          </aside>

          {/* Content */}
          <main className="st-content">
            <div className="st-content-header">
              <span className="st-content-eyebrow">{activeCategoryConfig.label}</span>
              <h2 className="st-content-title">{activePanelConfig.label}</h2>
            </div>
            <div className="st-content-body">
              {activePanelConfig.render()}
            </div>
          </main>
        </div>

        {toast ? (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        ) : null}
      </div>
    </SettingsContext.Provider>
  );
}

export default Settings;

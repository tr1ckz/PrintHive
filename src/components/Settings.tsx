import { useEffect, useMemo, useState } from 'react';
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

type SettingsCategory = 'general' | 'account' | 'printers' | 'cloud' | 'advanced' | 'system';
type SettingsPanel =
  | 'appearance'
  | 'costs'
  | 'profile'
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
  hint: string;
  description: string;
  adminOnly?: boolean;
  render: () => JSX.Element | null;
}

interface CategoryConfig {
  id: SettingsCategory;
  label: string;
  icon: string;
  description: string;
  panels: PanelConfig[];
}

function Settings({ userRole, initialSection }: SettingsProps) {
  const isAdmin = userRole === 'admin' || userRole === 'superadmin';
  const [toast, setToast] = useState<ToastState | null>(null);

  const navigation = useMemo<CategoryConfig[]>(() => [
    {
      id: 'general',
      label: 'General',
      icon: '🎛️',
      description: 'Keep the day-to-day experience tight by splitting UI defaults and cost preferences into focused panels.',
      panels: [
        {
          id: 'appearance',
          label: 'Appearance',
          hint: 'Theme and layout',
          description: 'Adjust the visual feel, density, and dashboard behavior for the unified interface.',
          render: () => <UISettings />,
        },
        {
          id: 'costs',
          label: 'Costs',
          hint: 'Materials and rates',
          description: 'Tune the price and usage defaults that drive your print estimates.',
          render: () => <CostSettings />,
        },
      ],
    },
    {
      id: 'account',
      label: 'Account',
      icon: '👤',
      description: 'Profile controls and user access live here, without being buried beneath unrelated toggles.',
      panels: [
        {
          id: 'profile',
          label: 'Profile',
          hint: 'Identity and credentials',
          description: 'Manage your personal account details and authentication settings.',
          render: () => <AccountSettings />,
        },
        {
          id: 'users',
          label: 'Users',
          hint: 'Shared access',
          description: 'Add, review, and adjust shared workshop permissions.',
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
      id: 'printers',
      label: 'Printers',
      icon: '🖨️',
      description: 'Separate cloud identity from local printer details so each task stays compact and obvious.',
      panels: [
        {
          id: 'bambu',
          label: 'Bambu Cloud',
          hint: 'Accounts and pairing',
          description: 'Connect or swap Bambu Lab accounts without scrolling past unrelated settings.',
          render: () => <BambuSettings />,
        },
        {
          id: 'local',
          label: 'Local / FTP',
          hint: 'LAN and timelapse access',
          description: 'Manage local printer IPs, access codes, and timelapse download connectivity.',
          render: () => <PrinterFtpSettings />,
        },
      ],
    },
    {
      id: 'cloud',
      label: 'Cloud Sync',
      icon: '☁️',
      description: 'Group notifications and auth integrations together so sync-related configuration is always easy to find.',
      panels: [
        {
          id: 'notifications',
          label: 'Notifications',
          hint: 'Alerts and Discord',
          description: 'Manage the messages that leave PrintHive and keep your team in the loop.',
          render: () => <NotificationSettings />,
        },
        {
          id: 'oauth',
          label: 'OAuth',
          hint: 'External sign-in',
          description: 'Configure SSO and provider details in their own contained panel.',
          render: () => <OAuthSettings />,
        },
      ],
    },
    {
      id: 'advanced',
      label: 'Advanced',
      icon: '⚡',
      description: 'Tuck the workshop automation and watchdog behavior into a single focused workspace.',
      panels: [
        {
          id: 'watchdog',
          label: 'Watchdog',
          hint: 'Automation and recovery',
          description: 'Adjust watchdog timing, monitoring, and recovery behavior without unrelated clutter.',
          render: () => <WatchdogSettings />,
        },
      ],
    },
    {
      id: 'system',
      label: 'System',
      icon: '🖥️',
      description: 'Reserve heavy maintenance, backups, and service controls for a dedicated system area.',
      panels: [
        {
          id: 'system-panel',
          label: 'System Controls',
          hint: 'Backups and service actions',
          description: 'Handle database maintenance, backups, and runtime options from a single panel.',
          render: () => <SystemSettings />,
        },
      ],
    },
  ], [isAdmin]);

  const resolveSelection = (section?: string | null): { category: SettingsCategory; panel: SettingsPanel } => {
    const normalized = (section || '').toLowerCase().replace('#', '');
    const [candidateCategory, candidatePanel] = normalized.split(/[.:/]/);

    const aliases: Record<string, { category: SettingsCategory; panel: SettingsPanel }> = {
      general: { category: 'general', panel: 'appearance' },
      preferences: { category: 'general', panel: 'appearance' },
      ui: { category: 'general', panel: 'appearance' },
      costs: { category: 'general', panel: 'costs' },
      account: { category: 'account', panel: 'profile' },
      profile: { category: 'account', panel: 'profile' },
      administration: { category: 'account', panel: isAdmin ? 'users' : 'profile' },
      printers: { category: 'printers', panel: 'bambu' },
      printer: { category: 'printers', panel: 'bambu' },
      hardware: { category: 'printers', panel: 'bambu' },
      connectivity: { category: 'printers', panel: 'local' },
      cloud: { category: 'cloud', panel: 'notifications' },
      integrations: { category: 'cloud', panel: 'notifications' },
      notifications: { category: 'cloud', panel: 'notifications' },
      oauth: { category: 'cloud', panel: 'oauth' },
      advanced: { category: 'advanced', panel: 'watchdog' },
      watchdog: { category: 'advanced', panel: 'watchdog' },
      system: { category: 'system', panel: 'system-panel' },
    };

    if (candidateCategory && candidatePanel) {
      const foundCategory = navigation.find((entry) => entry.id === candidateCategory);
      const foundPanel = foundCategory?.panels.find((panel) => panel.id === candidatePanel && (!panel.adminOnly || isAdmin));
      if (foundCategory && foundPanel) {
        return { category: foundCategory.id, panel: foundPanel.id };
      }
    }

    return aliases[normalized] || { category: 'general', panel: 'appearance' };
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
      <div className="settings-container settings-shell px-0 sm:px-1">
        <div className="settings-header settings-shell-header">
          <div className="settings-header-pills">
            <span className="settings-summary-pill">{availableCategories.length} categories</span>
            <span className="settings-summary-pill muted">{activeCategoryConfig.panels.length} focused panels</span>
          </div>
        </div>

        <div className="settings-mobile-controls xl:hidden">
          <div className="form-group">
            <label htmlFor="settings-category-select">Category</label>
            <select
              id="settings-category-select"
              value={selection.category}
              onChange={(event) => handleCategoryChange(event.target.value as SettingsCategory)}
              className="form-control"
            >
              {availableCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="settings-panel-select">Section</label>
            <select
              id="settings-panel-select"
              value={activePanelConfig.id}
              onChange={(event) => handlePanelChange(event.target.value as SettingsPanel)}
              className="form-control"
            >
              {activeCategoryConfig.panels.map((panel) => (
                <option key={panel.id} value={panel.id}>
                  {panel.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="settings-layout settings-layout-unified grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)] xl:gap-6">
          <aside className="settings-sidebar settings-sidebar-modern hidden xl:block">
            <div className="settings-sidebar-card">
              <span className="settings-sidebar-title">Categories</span>
              <div className="settings-nav" aria-label="Settings sections">
                {availableCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className={`settings-nav-item ${activeCategoryConfig.id === category.id ? 'active' : ''}`}
                    onClick={() => handleCategoryChange(category.id)}
                  >
                    <span className="settings-nav-icon">{category.icon}</span>
                    <span className="settings-nav-copy">
                      <span className="settings-nav-label">{category.label}</span>
                      <span className="settings-nav-hint">{category.panels.length} panel{category.panels.length > 1 ? 's' : ''}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section className="settings-main settings-main-modern min-w-0">
            <div className="settings-panel-hero settings-panel-hero-modern rounded-2xl p-4 md:p-5 lg:p-6">
              <span className="settings-panel-kicker">{activeCategoryConfig.icon} {activeCategoryConfig.label}</span>
              <h2 className="text-xl md:text-2xl">{activeCategoryConfig.label}</h2>
              <p className="text-sm md:text-base">{activeCategoryConfig.description}</p>

              <div className="settings-panel-tabs" role="tablist" aria-label={`${activeCategoryConfig.label} sub-sections`}>
                {activeCategoryConfig.panels.map((panel) => (
                  <button
                    key={panel.id}
                    type="button"
                    className={`settings-panel-tab ${activePanelConfig.id === panel.id ? 'active' : ''}`}
                    onClick={() => handlePanelChange(panel.id)}
                  >
                    <strong>{panel.label}</strong>
                    <span>{panel.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-panel-surface">
              <div className="settings-panel-intro rounded-2xl p-4 md:p-5">
                <h3 className="text-lg md:text-xl">{activePanelConfig.label}</h3>
                <p className="text-sm md:text-base">{activePanelConfig.description}</p>
              </div>

              {activePanelConfig.render()}
            </div>
          </section>
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

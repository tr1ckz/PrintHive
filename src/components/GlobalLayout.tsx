import type { ReactNode } from 'react';
import './GlobalLayout.css';

export interface GlobalLayoutNavItem {
  id: string;
  label: string;
  icon: ReactNode;
}

interface GlobalLayoutProps {
  appName?: string;
  pageTitle: string;
  pageDescription: string;
  pageEyebrow?: string;
  breadcrumbs?: string[];
  navItems: GlobalLayoutNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  userName?: string;
  userRole?: string;
  userAvatarText?: string;
  onLogout: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  mobileMenuOpen: boolean;
  onToggleMobileMenu: () => void;
  sidebarFooter?: ReactNode;
  rightSlot?: ReactNode;
  children: ReactNode;
}

const formatRole = (role?: string) => {
  if (!role) return 'Member';
  return role.charAt(0).toUpperCase() + role.slice(1);
};

function GlobalLayout({
  appName = 'PrintHive',
  pageTitle,
  pageDescription,
  pageEyebrow = 'Unified workspace',
  breadcrumbs = ['Workspace', pageTitle],
  navItems,
  activeId,
  onSelect,
  userName,
  userRole,
  userAvatarText,
  onLogout,
  sidebarCollapsed,
  onToggleSidebar,
  mobileMenuOpen,
  onToggleMobileMenu,
  sidebarFooter,
  rightSlot,
  children,
}: GlobalLayoutProps) {
  const avatarText = userAvatarText || userName?.slice(0, 1)?.toUpperCase() || 'U';

  return (
    <div className={`global-layout ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
      <aside className="global-sidebar">
        <div className="global-sidebar-inner">
          <div className="global-brand" onClick={() => onSelect('home')}>
            <img src="/images/logo.png" alt="PrintHive" className="global-brand-logo" />
            <div className="global-brand-copy">
              <span className="global-brand-kicker">3D Print Ops</span>
              <strong>{appName}</strong>
            </div>
            <button
              type="button"
              className="global-collapse-btn"
              onClick={(event) => {
                event.stopPropagation();
                onToggleSidebar();
              }}
              title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            >
              {sidebarCollapsed ? '→' : '←'}
            </button>
          </div>

          <nav className="global-nav" aria-label="Primary navigation">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`global-nav-item ${activeId === item.id ? 'active' : ''}`}
                onClick={() => onSelect(item.id)}
                title={item.label}
              >
                <span className="global-nav-icon">{item.icon}</span>
                <span className="global-nav-label">{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="global-sidebar-footer">
            {sidebarFooter}
          </div>
        </div>
      </aside>

      <div className="global-main-shell">
        <header className="global-topbar">
          <div className="global-topbar-copy">
            <span className="global-topbar-kicker">{pageEyebrow}</span>
            <div className="global-breadcrumbs" aria-label="Breadcrumb">
              {breadcrumbs.map((crumb, index) => (
                <span key={`${crumb}-${index}`} className="global-breadcrumb-item">
                  {crumb}
                </span>
              ))}
            </div>
            <h1>{pageTitle}</h1>
            <p>{pageDescription}</p>
          </div>

          <div className="global-topbar-actions">
            {rightSlot ? <div className="global-topbar-slot">{rightSlot}</div> : null}

            <div className="global-user-chip">
              <div className="global-user-avatar">{avatarText}</div>
              <div className="global-user-copy">
                <strong>{userName || 'User'}</strong>
                <span>{formatRole(userRole)}</span>
              </div>
            </div>

            <button type="button" className="global-logout-btn" onClick={onLogout} title="Log out">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Logout</span>
            </button>

            <button
              type="button"
              className="global-mobile-menu-btn"
              onClick={onToggleMobileMenu}
              aria-label="Toggle navigation"
            >
              {mobileMenuOpen ? '✕' : '☰'}
            </button>
          </div>
        </header>

        <div className={`global-mobile-nav ${mobileMenuOpen ? 'open' : ''}`}>
          {navItems.map((item) => (
            <button
              key={`mobile-${item.id}`}
              type="button"
              className={`global-mobile-nav-item ${activeId === item.id ? 'active' : ''}`}
              onClick={() => onSelect(item.id)}
            >
              <span className="global-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <main className="global-page-content">{children}</main>
      </div>
    </div>
  );
}

export default GlobalLayout;

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
  const mobilePrimaryItems = navItems.filter((item) => ['home', 'printers', 'statistics', 'settings'].includes(item.id));

  const handleMobileSelect = (id: string) => {
    onSelect(id);
    if (mobileMenuOpen) {
      onToggleMobileMenu();
    }
  };

  return (
    <div className={`global-layout min-h-full ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
      <aside className="global-sidebar hidden lg:block" aria-label="Desktop navigation">
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

      <div className="global-main-shell p-4 md:p-5 lg:p-6">
        <header className="global-topbar rounded-2xl p-4 md:p-5 lg:p-6">
          <div className="global-topbar-copy min-w-0">
            <span className="global-topbar-kicker">{pageEyebrow}</span>
            <div className="global-breadcrumbs" aria-label="Breadcrumb">
              {breadcrumbs.map((crumb, index) => (
                <span key={`${crumb}-${index}`} className="global-breadcrumb-item">
                  {crumb}
                </span>
              ))}
            </div>
            <h1 className="text-2xl md:text-3xl lg:text-4xl">{pageTitle}</h1>
            <p className="text-sm md:text-base">{pageDescription}</p>
          </div>

          <div className="global-topbar-actions">
            {rightSlot ? <div className="global-topbar-slot hidden md:flex">{rightSlot}</div> : null}

            <div className="global-user-chip hidden sm:flex">
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
              className="global-mobile-menu-btn lg:hidden"
              onClick={onToggleMobileMenu}
              aria-label="Toggle navigation"
            >
              {mobileMenuOpen ? '✕' : '☰'}
            </button>
          </div>
        </header>

        <button
          type="button"
          className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 lg:hidden ${mobileMenuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
          onClick={onToggleMobileMenu}
          aria-label="Close mobile navigation"
        />

        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-[min(21rem,88vw)] flex-col border-r border-white/10 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-xl transition-transform duration-200 lg:hidden ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
          aria-hidden={!mobileMenuOpen}
        >
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div className="flex items-center gap-3">
              <img src="/images/logo.png" alt="PrintHive" className="h-9 w-9 object-contain" />
              <div>
                <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orange-300/80">3D Print Ops</span>
                <strong className="text-sm text-white">{appName}</strong>
              </div>
            </div>
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white"
              onClick={onToggleMobileMenu}
              aria-label="Close navigation"
            >
              ✕
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-2 overflow-y-auto" aria-label="Mobile navigation">
            {navItems.map((item) => (
              <button
                key={`mobile-${item.id}`}
                type="button"
                className={`global-mobile-nav-item ${activeId === item.id ? 'active' : ''}`}
                onClick={() => handleMobileSelect(item.id)}
              >
                <span className="global-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="global-page-content pb-24 md:pb-4">{children}</main>

        <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-4 gap-2 rounded-2xl border border-white/10 bg-zinc-950/90 p-2 shadow-2xl backdrop-blur-xl md:hidden" aria-label="Quick mobile navigation">
          {mobilePrimaryItems.map((item) => (
            <button
              key={`bottom-${item.id}`}
              type="button"
              className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[0.68rem] font-semibold transition-colors ${activeId === item.id ? 'bg-orange-500/20 text-white ring-1 ring-orange-400/40' : 'text-zinc-300 hover:bg-white/5'}`}
              onClick={() => handleMobileSelect(item.id)}
            >
              <span className="global-nav-icon">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

export default GlobalLayout;

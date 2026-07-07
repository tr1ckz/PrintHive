import { type ReactNode } from 'react';
import MobileNav from './layout/MobileNav';
import IconButton from './common/IconButton';

export interface GlobalLayoutNavItem {
  id: string;
  label: string;
  icon: ReactNode;
}

interface GlobalLayoutProps {
  appName?: string;
  pageTitle: string;
  navItems: GlobalLayoutNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  userName?: string;
  userRole?: string;
  userAvatarText?: string;
  onLogout: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  /** Legacy props from the removed hamburger drawer — accepted for compat, unused */
  mobileMenuOpen?: boolean;
  onToggleMobileMenu?: () => void;
  sidebarFooter?: ReactNode;
  rightSlot?: ReactNode;
  children: ReactNode;
}

const formatRole = (role?: string) => {
  if (!role) return 'Member';
  return role.charAt(0).toUpperCase() + role.slice(1);
};

/** Ask the CommandPalette singleton to open (mobile search button). */
const openCommandPalette = () => {
  window.dispatchEvent(new CustomEvent('printhive:open-command-palette'));
};

/**
 * App shell. Structure by breakpoint:
 *  - base (<md): slim topbar + MobileNav bottom tab bar; no sidebar
 *  - md: icon rail sidebar
 *  - lg+: full 280px sidebar (collapsible to icon rail via the header chevron)
 * De-boxed: the shell separates zones with background shifts and one
 * hairline under the sticky topbar — no framed panels.
 */
function GlobalLayout({
  appName = 'PrintHive',
  pageTitle,
  navItems,
  activeId,
  onSelect,
  userName,
  userRole,
  userAvatarText,
  onLogout,
  sidebarCollapsed,
  onToggleSidebar,
  sidebarFooter,
  rightSlot,
  children,
}: GlobalLayoutProps) {
  const avatarText = userAvatarText || userName?.slice(0, 1)?.toUpperCase() || 'U';
  // md shows the icon rail; lg expands unless the user collapsed it
  const railOnly = sidebarCollapsed;

  return (
    <div className="min-h-dvh md:flex">
      {/* ---- Sidebar (md: icon rail, lg: full unless collapsed) ---- */}
      <aside
        aria-label="Desktop navigation"
        className={`ph-glass hidden md:flex sticky top-0 h-dvh shrink-0 flex-col transition-[width] duration-250 ease-out ${
          railOnly ? 'md:w-[76px]' : 'md:w-[76px] lg:w-[264px]'
        }`}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-4 h-16 shrink-0">
          <button
            type="button"
            onClick={() => onSelect('home')}
            className="flex items-center gap-3 min-w-0 min-h-11"
            aria-label={`${appName} home`}
          >
            <img src="/images/logo.png" alt="" className="size-9 shrink-0 object-contain" />
            {!railOnly && (
              <span className="hidden lg:block min-w-0 text-left text-sm font-semibold text-fg truncate">{appName}</span>
            )}
          </button>
          {!railOnly && (
            <IconButton
              aria-label="Collapse navigation"
              onClick={onToggleSidebar}
              className="hidden lg:inline-flex ml-auto"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </IconButton>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1" aria-label="Primary navigation">
          {navItems.map((item) => {
            const active = activeId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                title={item.label}
                aria-current={active ? 'page' : undefined}
                className={`flex w-full items-center gap-3 min-h-11 rounded-md px-3 text-sm font-medium transition-all duration-200 ${
                  active
                    ? 'ph-nav-active'
                    : 'text-fg-soft hover:text-fg hover:bg-white/5'
                }`}
              >
                <span className="shrink-0 [&_svg]:size-5">{item.icon}</span>
                <span className={railOnly ? 'sr-only' : 'hidden lg:block truncate'}>{item.label}</span>
              </button>
            );
          })}
          {railOnly && (
            <button
              type="button"
              onClick={onToggleSidebar}
              title="Expand navigation"
              className="hidden lg:flex w-full items-center justify-center min-h-11 rounded-md text-muted hover:text-fg hover:bg-white/5 transition-colors"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ transform: 'rotate(180deg)' }}>
                <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </nav>

        {/* Footer slot (BuyMeACoffee etc.) */}
        {sidebarFooter && !railOnly && (
          <div className="hidden lg:block px-4 py-4 shrink-0">{sidebarFooter}</div>
        )}
      </aside>

      {/* ---- Main column ---- */}
      <div className="flex-1 min-w-0 flex flex-col min-h-dvh">
        {/* Sticky topbar */}
        <header className="sticky top-0 z-20 bg-base/60 backdrop-blur-xl backdrop-saturate-150 border-b border-line">
          <div className="flex items-center gap-3 px-4 sm:px-6 lg:px-8 h-14 md:h-16">
            <div className="min-w-0 flex-1">
              <h1 className="text-lg md:text-xl font-semibold tracking-tight text-fg truncate">{pageTitle}</h1>
            </div>

            {rightSlot && <div className="hidden md:flex items-center shrink-0">{rightSlot}</div>}

            {/* Mobile: search opens the command palette */}
            <IconButton aria-label="Search and commands" onClick={openCommandPalette} className="md:hidden">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </IconButton>

            {/* Desktop: user chip + logout */}
            <div className="hidden md:flex items-center gap-2 shrink-0">
              <div className="hidden lg:flex items-center gap-2.5 pl-2">
                <div className="flex size-9 items-center justify-center rounded-full bg-accent/15 text-accent text-sm font-semibold">
                  {avatarText}
                </div>
                <div className="min-w-0 leading-tight">
                  <div className="text-sm font-medium text-fg truncate">{userName || 'User'}</div>
                  <div className="text-xs text-muted">{formatRole(userRole)}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="flex items-center gap-2 min-h-9 px-3 rounded-md text-sm font-medium text-muted hover:text-fg hover:bg-white/5 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="hidden lg:inline">Logout</span>
              </button>
            </div>
          </div>
        </header>

        {/* Page content — bottom padding clears the mobile tab bar */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-4 md:py-6 pb-24 md:pb-8">{children}</main>
      </div>

      <MobileNav
        navItems={navItems}
        activeId={activeId}
        onSelect={onSelect}
        userName={userName}
        userRole={userRole}
        onLogout={onLogout}
      />
    </div>
  );
}

export default GlobalLayout;

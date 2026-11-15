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
 *  - lg+: full 224px sidebar (collapsible to icon rail via the header chevron)
 * Spacing: 48px bars, 36px nav rows, 16/24px page gutters. Zones are split
 * by a single hairline each (sidebar edge, topbar edge) — no glass, no glow.
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
    <div className="flex-1 md:flex">
      {/* ---- Sidebar (md: icon rail, lg: full unless collapsed) ---- */}
      <aside
        aria-label="Desktop navigation"
        className={`hidden md:flex sticky top-0 max-h-dvh shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 ease-out ${
          railOnly ? 'md:w-14' : 'md:w-14 lg:w-56'
        }`}
      >
        {/* Brand */}
        <div className={`flex h-12 shrink-0 items-center gap-2 px-2 ${railOnly ? 'justify-center' : 'justify-center lg:justify-start lg:pl-3'}`}>
          <button
            type="button"
            onClick={() => onSelect('home')}
            className="flex min-h-9 min-w-9 items-center justify-center gap-2.5 rounded-md"
            aria-label={`${appName} home`}
          >
            <img src="/images/logo.png" alt="" className="size-7 shrink-0 object-contain" />
            {!railOnly && (
              <span className="hidden lg:block min-w-0 text-left text-sm font-semibold text-fg truncate">{appName}</span>
            )}
          </button>
          {!railOnly && (
            <span className="ml-auto hidden lg:block">
              <IconButton aria-label="Collapse navigation" onClick={onToggleSidebar}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </IconButton>
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2" aria-label="Primary navigation">
          {navItems.map((item) => {
            const active = activeId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                title={item.label}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors duration-150 ${
                  railOnly ? 'justify-center' : 'justify-center lg:justify-start'
                } ${
                  active
                    ? 'ph-nav-active'
                    : 'text-muted hover:text-fg hover:bg-white/5'
                }`}
              >
                <span className="shrink-0 [&_svg]:size-[18px]">{item.icon}</span>
                <span className={railOnly ? 'sr-only' : 'hidden lg:block truncate'}>{item.label}</span>
              </button>
            );
          })}
          {railOnly && (
            <button
              type="button"
              onClick={onToggleSidebar}
              title="Expand navigation"
              aria-label="Expand navigation"
              className="hidden lg:flex w-full items-center justify-center min-h-9 rounded-md text-muted hover:text-fg hover:bg-white/5 transition-colors"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ transform: 'rotate(180deg)' }}>
                <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </nav>

        {/* Footer slot (BuyMeACoffee etc.) */}
        {sidebarFooter && !railOnly && (
          <div className="hidden lg:block px-3 py-3 shrink-0">{sidebarFooter}</div>
        )}
      </aside>

      {/* ---- Main column ---- */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Sticky topbar */}
        <header className="sticky top-0 z-20 border-b border-line bg-base/75 backdrop-blur-md">
          <div className="flex h-12 items-center gap-2 px-4 sm:px-6">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-semibold tracking-tight text-fg">{pageTitle}</h1>
            </div>

            {rightSlot && <div className="hidden md:flex items-center shrink-0">{rightSlot}</div>}

            {/* Mobile: search opens the command palette */}
            <IconButton aria-label="Search and commands" onClick={openCommandPalette} className="md:hidden">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </IconButton>

            {/* Desktop: user chip + logout */}
            <div className="hidden md:flex items-center gap-1 shrink-0">
              <div className="flex items-center gap-2 pl-2 pr-1" title={`${userName || 'User'} · ${formatRole(userRole)}`}>
                <div className="flex size-7 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
                  {avatarText}
                </div>
                <div className="hidden min-w-0 lg:block">
                  <span className="block max-w-40 truncate text-[13px] font-medium leading-4 text-fg">{userName || 'User'}</span>
                  <span className="block text-[11px] leading-4 text-muted">{formatRole(userRole)}</span>
                </div>
              </div>
              <IconButton aria-label="Log out" title="Log out" onClick={onLogout}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </IconButton>
            </div>
          </div>
        </header>

        {/* Page content — bottom padding clears the mobile tab bar */}
        <main className="flex-1 px-4 pt-4 pb-24 sm:px-6 md:pt-5 md:pb-8">{children}</main>
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

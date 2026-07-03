import { useEffect, useState, type ReactNode } from 'react';
import type { GlobalLayoutNavItem } from '../GlobalLayout';

const PRIMARY_IDS = ['home', 'printers', 'library', 'history'];

interface MobileNavProps {
  navItems: GlobalLayoutNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  userName?: string;
  userRole?: string;
  onLogout: () => void;
  /** Extra rows for the More sheet (e.g. theme picker) */
  sheetExtras?: ReactNode;
}

const MoreIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 12h.01M12 12h.01M19 12h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

/**
 * Mobile navigation: a fixed 5-slot bottom tab bar (Home, Printers,
 * Library, History, More) + a bottom sheet holding the remaining
 * routes, user identity, and logout. The single mobile nav pattern —
 * the old hamburger drawer is gone.
 */
function MobileNav({ navItems, activeId, onSelect, userName, userRole, onLogout, sheetExtras }: MobileNavProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const primary = PRIMARY_IDS
    .map((id) => navItems.find((item) => item.id === id))
    .filter((item): item is GlobalLayoutNavItem => Boolean(item));
  const secondary = navItems.filter((item) => !PRIMARY_IDS.includes(item.id));
  const moreActive = secondary.some((item) => item.id === activeId);

  // Close the sheet whenever the route changes
  useEffect(() => {
    setSheetOpen(false);
  }, [activeId]);

  const select = (id: string) => {
    setSheetOpen(false);
    onSelect(id);
  };

  return (
    <>
      {/* More sheet */}
      <div
        className={`fixed inset-0 z-40 bg-overlay backdrop-blur-sm transition-opacity duration-200 md:hidden ${sheetOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={() => setSheetOpen(false)}
        aria-hidden={!sheetOpen}
      />
      <div
        role="dialog"
        aria-label="More navigation"
        aria-hidden={!sheetOpen}
        className={`fixed inset-x-0 bottom-0 z-50 rounded-t-xl bg-elevated shadow-xl transition-transform duration-250 ease-out md:hidden ${sheetOpen ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-white/15" />
        <div className="px-4 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <nav className="flex flex-col" aria-label="More pages">
            {secondary.map((item) => (
              <button
                key={`sheet-${item.id}`}
                type="button"
                onClick={() => select(item.id)}
                className={`flex items-center gap-3 min-h-12 px-2 rounded-md text-sm font-medium transition-colors ${
                  activeId === item.id ? 'text-accent bg-accent/10' : 'text-fg-soft hover:bg-white/5'
                }`}
              >
                <span className="shrink-0 [&_svg]:size-5">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>

          {sheetExtras && (
            <div className="mt-2 pt-2 border-t border-line">{sheetExtras}</div>
          )}

          <div className="mt-2 pt-2 border-t border-line flex items-center justify-between gap-3">
            <div className="min-w-0 px-2">
              <div className="text-sm font-medium text-fg truncate">{userName || 'User'}</div>
              <div className="text-xs text-muted capitalize">{userRole || 'member'}</div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-2 min-h-11 px-4 rounded-md text-sm font-medium text-danger hover:bg-danger/10 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Bottom tab bar */}
      <nav
        aria-label="Primary mobile navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex bg-elevated/90 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {primary.map((item) => {
          const active = activeId === item.id;
          return (
            <button
              key={`tab-${item.id}`}
              type="button"
              onClick={() => select(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`flex h-14 flex-1 min-w-0 flex-col items-center justify-center gap-0.5 text-[0.68rem] font-medium transition-colors ${
                active ? 'text-accent' : 'text-muted hover:text-fg-soft'
              }`}
            >
              <span className="[&_svg]:size-5">{item.icon}</span>
              <span className="truncate max-w-full px-1">{item.label}</span>
              <span className={`size-1 rounded-full ${active ? 'bg-accent' : 'bg-transparent'}`} />
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setSheetOpen((open) => !open)}
          aria-expanded={sheetOpen}
          className={`flex h-14 flex-1 min-w-0 flex-col items-center justify-center gap-0.5 text-[0.68rem] font-medium transition-colors ${
            moreActive || sheetOpen ? 'text-accent' : 'text-muted hover:text-fg-soft'
          }`}
        >
          <span className="[&_svg]:size-5">{MoreIcon}</span>
          <span>More</span>
          <span className={`size-1 rounded-full ${moreActive ? 'bg-accent' : 'bg-transparent'}`} />
        </button>
      </nav>
    </>
  );
}

export default MobileNav;

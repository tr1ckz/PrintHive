// Loop protection for the login page's automatic SSO redirect.
//
// When an OAuth provider is configured the login page bounces straight to
// /auth/<provider>. If that round-trip comes back without a session — the IdP
// rejected us, the session cookie never stuck, the callback errored, or the
// user simply logged out — the login page would redirect again, and again.
// That reads as an endlessly refreshing page. These helpers remember that we
// already tried, so the second pass stops and shows the form instead.

const ATTEMPT_KEY = 'printhive:sso-redirect-attempt';
const SUPPRESS_KEY = 'printhive:sso-redirect-suppressed';

// Coming back inside this window means SSO handed us straight back to the
// login page rather than signing us in.
export const SSO_BOUNCE_WINDOW_MS = 20000;

export type SsoRedirectBlockReason =
  | 'no-provider'
  | 'admin-route'
  | 'logged-out'
  | 'sso-error'
  | 'bounced';

export type SsoRedirectDecision =
  | { redirect: true }
  | { redirect: false; reason: SsoRedirectBlockReason };

export interface SsoRedirectInput {
  provider: string | null | undefined;
  pathname: string;
  search: string;
  suppressed: boolean;
  lastAttemptAt: number | null;
  now: number;
}

export function decideSsoRedirect({
  provider,
  pathname,
  search,
  suppressed,
  lastAttemptAt,
  now,
}: SsoRedirectInput): SsoRedirectDecision {
  if (!provider || provider === 'none') {
    return { redirect: false, reason: 'no-provider' };
  }

  // /admin is the local-account escape hatch and never auto-redirects.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return { redirect: false, reason: 'admin-route' };
  }

  const params = new URLSearchParams(search);

  if (params.get('logout') === '1' || suppressed) {
    return { redirect: false, reason: 'logged-out' };
  }

  if (params.has('error')) {
    return { redirect: false, reason: 'sso-error' };
  }

  // Clock changes can push the stored timestamp either side of now, so treat
  // any recent-looking attempt as a bounce.
  if (lastAttemptAt !== null && Math.abs(now - lastAttemptAt) < SSO_BOUNCE_WINDOW_MS) {
    return { redirect: false, reason: 'bounced' };
  }

  return { redirect: true };
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    // Private mode / sandboxed iframes throw on access.
    return null;
  }
}

export function readSsoRedirectAttempt(): number | null {
  const store = sessionStore();
  if (!store) return null;

  try {
    const raw = store.getItem(ATTEMPT_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function markSsoRedirectAttempt(now: number = Date.now()): void {
  try {
    sessionStore()?.setItem(ATTEMPT_KEY, String(now));
  } catch {
    // Without storage we lose loop protection, but never the page itself.
  }
}

export function isSsoRedirectSuppressed(): boolean {
  try {
    return sessionStore()?.getItem(SUPPRESS_KEY) === '1';
  } catch {
    return false;
  }
}

// Sticky for the rest of the tab session: after an explicit logout the user
// wants the login form, not an instant bounce back into the IdP.
export function suppressSsoRedirect(): void {
  try {
    sessionStore()?.setItem(SUPPRESS_KEY, '1');
  } catch {
    // Ignore — the ?logout=1 query param still covers the common path.
  }
}

export function clearSsoRedirectState(): void {
  try {
    const store = sessionStore();
    store?.removeItem(ATTEMPT_KEY);
    store?.removeItem(SUPPRESS_KEY);
  } catch {
    // Nothing to clear.
  }
}

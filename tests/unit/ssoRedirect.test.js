import { describe, it, expect } from 'vitest';
import { decideSsoRedirect, SSO_BOUNCE_WINDOW_MS } from '../../src/utils/ssoRedirect';

const base = {
  provider: 'oidc',
  pathname: '/',
  search: '',
  suppressed: false,
  lastAttemptAt: null,
  now: 1_700_000_000_000,
};

const decide = (overrides) => decideSsoRedirect({ ...base, ...overrides });

describe('decideSsoRedirect', () => {
  it('redirects on a clean first visit with a provider configured', () => {
    expect(decide({})).toEqual({ redirect: true });
  });

  it('does not redirect when no provider is configured', () => {
    expect(decide({ provider: 'none' })).toEqual({ redirect: false, reason: 'no-provider' });
    expect(decide({ provider: null })).toEqual({ redirect: false, reason: 'no-provider' });
  });

  it('never redirects from the admin route', () => {
    expect(decide({ pathname: '/admin' })).toEqual({ redirect: false, reason: 'admin-route' });
    expect(decide({ pathname: '/admin/' })).toEqual({ redirect: false, reason: 'admin-route' });
  });

  it('honours the ?logout=1 marker', () => {
    expect(decide({ search: '?logout=1' })).toEqual({ redirect: false, reason: 'logged-out' });
  });

  it('honours a stored logout suppression even without the query param', () => {
    expect(decide({ suppressed: true })).toEqual({ redirect: false, reason: 'logged-out' });
  });

  it('stops after an SSO error is reported back', () => {
    expect(decide({ search: '?error=oidc_callback_failed' }))
      .toEqual({ redirect: false, reason: 'sso-error' });
  });

  it('stops when SSO just bounced us back without a session', () => {
    expect(decide({ lastAttemptAt: base.now - 1000 }))
      .toEqual({ redirect: false, reason: 'bounced' });
  });

  it('treats a clock skewed attempt timestamp as a bounce', () => {
    expect(decide({ lastAttemptAt: base.now + 1000 }))
      .toEqual({ redirect: false, reason: 'bounced' });
  });

  it('redirects again once the bounce window has passed', () => {
    expect(decide({ lastAttemptAt: base.now - SSO_BOUNCE_WINDOW_MS - 1 }))
      .toEqual({ redirect: true });
  });
});

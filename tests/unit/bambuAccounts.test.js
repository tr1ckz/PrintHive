import { describe, it, expect } from 'vitest';
import {
  isBambuTokenExpired,
  bambuAccountKey,
  dedupeBambuAccounts,
} from '../../server/services/bambuAccounts.js';

// Build a minimal JWT (header.payload.sig) carrying an exp claim, seconds since
// epoch, so we can exercise the expiry logic deterministically.
function jwt(expSecondsFromNow) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('isBambuTokenExpired', () => {
  it('is true for a token past its exp (with skew)', () => {
    expect(isBambuTokenExpired(jwt(-10))).toBe(true);
    expect(isBambuTokenExpired(jwt(30))).toBe(true); // inside 60s skew
  });

  it('is false for a comfortably valid token', () => {
    expect(isBambuTokenExpired(jwt(3600))).toBe(false);
  });

  it('fails open (false) for unparseable / non-JWT tokens', () => {
    expect(isBambuTokenExpired('not-a-jwt')).toBe(false);
    expect(isBambuTokenExpired('')).toBe(false);
    expect(isBambuTokenExpired(null)).toBe(false);
  });
});

describe('bambuAccountKey', () => {
  it('is case-insensitive on email and treats NULL region as global', () => {
    expect(bambuAccountKey({ email: 'A@B.com', region: 'global' }))
      .toBe(bambuAccountKey({ email: 'a@b.com', region: null }));
  });

  it('separates the same email across different regions', () => {
    expect(bambuAccountKey({ email: 'a@b.com', region: 'global' }))
      .not.toBe(bambuAccountKey({ email: 'a@b.com', region: 'china' }));
  });
});

describe('dedupeBambuAccounts', () => {
  it('keeps the valid-token row over a stale duplicate (the false-banner fix)', () => {
    const rows = [
      { id: 1, email: 'me@x.com', region: 'global', token: jwt(-100), is_primary: 1 }, // stale primary
      { id: 2, email: 'me@x.com', region: 'global', token: jwt(3600), is_primary: 0 }, // fresh
    ];
    const out = dedupeBambuAccounts(rows);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(2);
    expect(isBambuTokenExpired(out[0].token)).toBe(false);
  });

  it('collapses a NULL-region and a global-region row for the same email', () => {
    const rows = [
      { id: 1, email: 'me@x.com', region: null, token: jwt(3600), is_primary: 0, updated_at: '2026-01-01' },
      { id: 2, email: 'me@x.com', region: 'global', token: jwt(3600), is_primary: 1, updated_at: '2026-06-01' },
    ];
    const out = dedupeBambuAccounts(rows);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(2); // primary + newer wins when both valid
  });

  it('prefers primary, then newest, when both tokens are valid', () => {
    const rows = [
      { id: 5, email: 'me@x.com', region: 'global', token: jwt(3600), is_primary: 0, updated_at: '2026-06-01' },
      { id: 6, email: 'me@x.com', region: 'global', token: jwt(3600), is_primary: 1, updated_at: '2026-01-01' },
    ];
    expect(dedupeBambuAccounts(rows)[0].id).toBe(6); // primary beats newer
  });

  it('keeps distinct accounts (different email or region) separate', () => {
    const rows = [
      { id: 1, email: 'a@x.com', region: 'global', token: jwt(3600), is_primary: 1 },
      { id: 2, email: 'b@x.com', region: 'global', token: jwt(3600), is_primary: 0 },
      { id: 3, email: 'a@x.com', region: 'china', token: jwt(3600), is_primary: 0 },
    ];
    expect(dedupeBambuAccounts(rows)).toHaveLength(3);
  });

  it('still returns a row when every duplicate is expired', () => {
    const rows = [
      { id: 1, email: 'me@x.com', region: 'global', token: jwt(-100), is_primary: 0, updated_at: '2026-01-01' },
      { id: 2, email: 'me@x.com', region: 'global', token: jwt(-50), is_primary: 0, updated_at: '2026-06-01' },
    ];
    const out = dedupeBambuAccounts(rows);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(2); // newest of the expired set
  });
});

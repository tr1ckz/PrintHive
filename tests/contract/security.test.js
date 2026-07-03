import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { bootServer } from '../helpers/bootServer.js';

/**
 * Pins the Phase 1 security hardening: bcrypt migration, login rate limit,
 * secret masking, cross-site rejection, persisted session secret.
 * Boots its own server so the rate-limit test can't poison other suites.
 */

let server;

beforeAll(async () => {
  server = await bootServer();
}, 90000);

afterAll(async () => {
  if (server) await server.stop();
});

describe('password storage', () => {
  it('stores the default admin as a bcrypt hash, and login still works', async () => {
    const db = new Database(path.join(server.dataDir, 'printhive.db'), { readonly: true });
    const admin = db.prepare('SELECT password FROM users WHERE username = ?').get('admin');
    db.close();
    expect(admin.password).toMatch(/^\$2[aby]\$/);
    const cookie = await server.login('admin', 'admin');
    expect(cookie).toContain('bambu.sid=');
  });

  it('change-password verifies via bcrypt and stores a new hash', async () => {
    const cookie = await server.login('admin', 'admin');
    const res = await fetch(`${server.baseUrl}/api/settings/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ currentPassword: 'admin', newPassword: 'admin' }),
    });
    const body = await res.json();
    expect(body.success).toBe(true);

    const db = new Database(path.join(server.dataDir, 'printhive.db'), { readonly: true });
    const admin = db.prepare('SELECT password FROM users WHERE username = ?').get('admin');
    db.close();
    expect(admin.password).toMatch(/^\$2[aby]\$/);
  });
});

describe('session secret', () => {
  it('persists a generated secret in the data dir', () => {
    const secretFile = path.join(server.dataDir, 'session-secret');
    expect(fs.existsSync(secretFile)).toBe(true);
    expect(fs.readFileSync(secretFile, 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('cross-site request rejection', () => {
  it('rejects a mutating request with a foreign Origin', async () => {
    const res = await fetch(`${server.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });
    expect(res.status).toBe(403);
  });

  it('allows a same-host Origin on another port (Vite dev proxy)', async () => {
    const res = await fetch(`${server.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });
    expect(res.status).toBe(200);
  });
});

describe('OIDC secret masking', () => {
  it('masks the stored client secret on GET and keeps it on masked save', async () => {
    const cookie = await server.login('admin', 'admin');
    const save = (payload) =>
      fetch(`${server.baseUrl}/api/settings/save-oauth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(payload),
      });

    // Store a secret (provider 'none' so configureOIDC is not attempted)
    const first = await save({
      provider: 'none', publicHostname: '', googleClientId: '', googleClientSecret: '',
      oidcIssuer: 'https://auth.example.com', oidcClientId: 'printhive',
      oidcClientSecret: 'super-secret-value', oidcEndSessionUrl: '',
    });
    expect((await first.json()).success).toBe(true);

    const { body: masked } = await server.getJson('/api/settings/oauth', cookie);
    expect(masked.oidcClientSecret).not.toContain('super-secret-value');
    expect(masked.oidcClientSecret.length).toBeGreaterThan(0);

    // Round-trip the masked value — stored secret must survive
    await save({ ...masked, provider: 'none' });
    const db = new Database(path.join(server.dataDir, 'printhive.db'), { readonly: true });
    const stored = db.prepare('SELECT value FROM config WHERE key = ?').get('oauth_oidcClientSecret');
    db.close();
    expect(stored.value).toBe('super-secret-value');
  });
});

describe('login rate limiting', () => {
  it('returns 429 after repeated failed attempts', async () => {
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${server.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: `wrong-${i}` }),
      });
      if (res.status === 429) { limited = true; break; }
    }
    expect(limited).toBe(true);
  });
});

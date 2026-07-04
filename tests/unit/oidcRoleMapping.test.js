import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Pins the OIDC group -> role mapping. SSO must only ever resolve to
 * 'admin' or 'user' (never the locally-managed 'superadmin' tier), honour the
 * configurable admin/user group lists and default role, and support a custom
 * groups claim name.
 *
 * Requires a reachable PostgreSQL (PG_HOST/PG_USER/PG_PASSWORD/PG_DB) like the
 * rest of the suite; runs in its own throwaway schema.
 */

let db;
let resolveOidcRole;
let pool;

beforeAll(async () => {
  // Isolate this file in its own schema before database.js reads the env.
  process.env.PG_SCHEMA = `test_oidcroles_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const dbMod = require('../../database');
  const authMod = require('../../server/routes/auth');
  db = dbMod.db;
  pool = dbMod.pool;
  resolveOidcRole = authMod.resolveOidcRole;
  await dbMod.initDatabase();
}, 90000);

afterAll(async () => {
  try {
    if (pool && process.env.PG_SCHEMA) {
      await pool.query(`DROP SCHEMA IF EXISTS "${process.env.PG_SCHEMA}" CASCADE`);
    }
  } catch { /* best effort */ }
  try { await db.close(); } catch { /* ignore */ }
});

async function withConfig(map) {
  await db.prepare("DELETE FROM config WHERE key LIKE 'oauth_%'").run();
  for (const [k, v] of Object.entries(map)) {
    await db.prepare(
      'INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    ).run('oauth_' + k, v);
  }
}

describe('OIDC group -> role mapping', () => {
  it('grants admin when a group is in the admin list (case-insensitive)', async () => {
    await withConfig({ adminGroups: 'PrintHive Admins, Infra', defaultRole: 'user' });
    expect(await resolveOidcRole({ groups: ['users', 'INFRA'] })).toBe('admin');
  });

  it('grants user for a user-group match even when default is admin', async () => {
    await withConfig({ adminGroups: 'Admins', userGroups: 'Staff', defaultRole: 'admin' });
    expect(await resolveOidcRole({ groups: ['staff'] })).toBe('user');
  });

  it('falls back to the default role when no group matches', async () => {
    await withConfig({ adminGroups: 'Admins', userGroups: 'Staff', defaultRole: 'user' });
    expect(await resolveOidcRole({ groups: ['randoms'] })).toBe('user');

    await withConfig({ adminGroups: 'Admins', defaultRole: 'admin' });
    expect(await resolveOidcRole({ groups: ['randoms'] })).toBe('admin');
  });

  it('defaults to user when the token carries no groups claim', async () => {
    await withConfig({ adminGroups: 'Admins', defaultRole: 'user' });
    expect(await resolveOidcRole({})).toBe('user');
  });

  it('reads a custom groups claim name', async () => {
    await withConfig({ groupsClaim: 'roles', adminGroups: 'Admins', defaultRole: 'user' });
    expect(await resolveOidcRole({ roles: ['Admins'], groups: ['nope'] })).toBe('admin');
  });

  it('accepts a single-string group value', async () => {
    await withConfig({ adminGroups: 'Admins', defaultRole: 'user' });
    expect(await resolveOidcRole({ groups: 'Admins' })).toBe('admin');
  });

  it('never resolves to superadmin, even if a group is literally named that', async () => {
    await withConfig({ adminGroups: 'superadmin, Admins', defaultRole: 'user' });
    const role = await resolveOidcRole({ groups: ['superadmin'] });
    expect(role).toBe('admin');
    expect(role).not.toBe('superadmin');
  });
});

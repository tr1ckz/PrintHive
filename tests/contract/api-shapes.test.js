import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootServer } from '../helpers/bootServer.js';

/**
 * Contract snapshots: pin the exact JSON shape of every endpoint the frontend
 * consumes, against a fresh (empty) database. These are the regression oracle
 * for the server decomposition — any refactor that changes a response shape
 * fails here before it reaches the UI.
 */

let server;
let cookie;

beforeAll(async () => {
  server = await bootServer();
  cookie = await server.login();
}, 90000);

afterAll(async () => {
  if (server) await server.stop();
});

const VOLATILE_KEY = /(^|_)(time|date|at|uptime|timestamp|expires?|version|updated|created|lastRun|nextRun)($|[A-Z_])|(Time|Date|At|Stamp|Version)$/i;

function normalize(value, keyHint = '') {
  if (Array.isArray(value)) return value.map((v) => normalize(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = normalize(value[key], key);
    return out;
  }
  if (VOLATILE_KEY.test(keyHint) && value !== null && value !== undefined && value !== 0 && value !== '') {
    return `<volatile:${typeof value}>`;
  }
  return value;
}

const ENDPOINTS = [
  '/api/health',
  '/api/version',
  '/api/check-auth',
  '/api/user/me',
  '/api/printers',
  '/api/printers/status',
  '/api/printers/config',
  '/api/prints',
  '/api/models',
  '/api/timelapses',
  '/api/library',
  '/api/library/stats',
  '/api/library/duplicates',
  '/api/statistics',
  '/api/statistics/costs',
  '/api/maintenance',
  '/api/maintenance/summary',
  '/api/background-jobs/summary',
  '/api/sync-status',
  '/api/match-videos-status',
  '/api/library/scan-status',
  '/api/library/auto-tag-status',
  '/api/library/bulk-delete-status',
  '/api/download-missing-covers-status',
  '/api/printer-transfer-status',
  '/api/settings/ui',
  '/api/settings/printer-ftp',
  '/api/settings/oauth',
  '/api/settings/oauth-public',
  '/api/settings/bambu-status',
  '/api/settings/watchdog',
  '/api/settings/discord',
  '/api/settings/notifications',
  '/api/settings/database',
  '/api/settings/database/maintenance-status',
  '/api/settings/database/backups',
  '/api/settings/dashboard-widgets',
  '/api/bambu/accounts',
  '/api/admin/users',
  '/api/tags',
];

describe('API contract snapshots (authenticated, empty DB)', () => {
  for (const endpoint of ENDPOINTS) {
    it(`GET ${endpoint}`, async () => {
      const { status, body } = await server.getJson(endpoint, cookie);
      expect({ status, body: normalize(body) }).toMatchSnapshot();
    });
  }
});

describe('auth boundary', () => {
  it('rejects /api/printers without a session', async () => {
    const { status } = await server.getJson('/api/printers');
    expect(status).toBeGreaterThanOrEqual(400);
  });

  it('login with wrong password never grants a session', async () => {
    await expect(server.login('admin', 'wrong')).rejects.toThrow();
  });
});

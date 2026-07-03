import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Boots simple-server.js as a child process against a throwaway data dir.
 * The server auto-creates its schema and a default admin/admin user, so a
 * fresh boot is immediately loginable.
 */
export async function bootServer() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'printhive-test-'));
  const dataDir = path.join(tempRoot, 'data');
  const libraryDir = path.join(tempRoot, 'library');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(libraryDir, { recursive: true });

  const port = 3900 + Math.floor(Math.random() * 900);
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];

  // Each boot gets an isolated PostgreSQL schema so tests don't share state.
  const pgSchema = `test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  const child = spawn(process.execPath, [path.join(ROOT, 'simple-server.js')], {
    cwd: tempRoot, // keeps ./sessions inside the temp dir
    env: {
      ...process.env,
      PORT: String(port),
      PRINTHIVE_DATA_DIR: dataDir,
      PRINTHIVE_LIBRARY_DIR: libraryDir,
      NODE_ENV: 'test',
      PG_SCHEMA: pgSchema,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));

  const exited = new Promise((resolve) => child.on('exit', resolve));

  // Wait for readiness
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) { ready = true; break; }
    } catch { /* not up yet */ }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) {
    child.kill('SIGKILL');
    throw new Error(`Server failed to boot on ${baseUrl}:\n${logs.join('')}`);
  }

  // /api/health responds as soon as the HTTP server is listening, which can be
  // before initDatabase() finishes creating the schema + default admin. Wait
  // until the admin user exists so tests see a fully-initialized database.
  const adminDeadline = Date.now() + 30000;
  while (Date.now() < adminDeadline) {
    try {
      const rows = await query("SELECT 1 FROM users WHERE username = 'admin' LIMIT 1");
      if (rows.length > 0) break;
    } catch { /* schema not ready yet */ }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  async function login(username = 'admin', password = 'admin') {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(`Login failed (${res.status}): ${await res.text()}`);
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) throw new Error('Login returned no session cookie');
    return setCookie.split(';')[0];
  }

  async function getJson(pathname, cookie) {
    const res = await fetch(`${baseUrl}${pathname}`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
    let body = null;
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  }

  // Connect to the same PostgreSQL the server uses (for assertions / cleanup).
  function pgClient() {
    const raw = process.env.PG_HOST || '127.0.0.1:5432';
    let host = raw, portNum = 5432;
    if (raw.includes(':')) { host = raw.slice(0, raw.lastIndexOf(':')); portNum = parseInt(raw.slice(raw.lastIndexOf(':') + 1), 10) || 5432; }
    return new pg.Client({
      host, port: portNum,
      user: process.env.PG_USER, password: process.env.PG_PASSWORD, database: process.env.PG_DB,
      options: `-c search_path=${pgSchema}`,
    });
  }

  // Run a query against this boot's schema; returns rows.
  async function query(text, params = []) {
    const client = pgClient();
    await client.connect();
    try { return (await client.query(text, params)).rows; }
    finally { await client.end(); }
  }

  async function stop() {
    child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
    // Drop the isolated schema.
    try {
      const client = pgClient();
      await client.connect();
      await client.query(`DROP SCHEMA IF EXISTS "${pgSchema}" CASCADE`);
      await client.end();
    } catch { /* best effort */ }
    try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3 }); } catch { /* win file locks */ }
  }

  return { baseUrl, dataDir, libraryDir, pgSchema, login, getJson, query, stop, logs, child };
}

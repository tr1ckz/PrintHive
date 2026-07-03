import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

  const child = spawn(process.execPath, [path.join(ROOT, 'simple-server.js')], {
    cwd: tempRoot, // keeps ./sessions inside the temp dir
    env: {
      ...process.env,
      PORT: String(port),
      PRINTHIVE_DATA_DIR: dataDir,
      PRINTHIVE_LIBRARY_DIR: libraryDir,
      NODE_ENV: 'test',
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

  async function stop() {
    child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
    try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3 }); } catch { /* win file locks */ }
  }

  return { baseUrl, dataDir, libraryDir, login, getJson, stop, logs, child };
}

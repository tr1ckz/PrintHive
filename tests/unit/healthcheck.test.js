import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listProcesses, descendantsOf } from '../helpers/procTree.js';

const require = createRequire(import.meta.url);
const { checkHealth, healthUrl } = require('../../healthcheck');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Mock app: /api/health answers with whatever `healthStatus` is set to,
// /status/<code> answers with that code, /hang never answers.
let server;
let port;
let healthStatus = 200;
const seen = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url });
    if (req.url === '/hang') return; // never respond
    const match = req.url.match(/^\/status\/(\d+)$/);
    const status = match ? Number(match[1]) : healthStatus;
    res.writeHead(status, status === 302 ? { Location: '/status/500' } : {});
    res.end(JSON.stringify({ status }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const at = (pathname) => `http://localhost:${port}${pathname}`;

async function closedPort() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, resolve));
  const free = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return free;
}

describe('healthcheck probe (same contract as `curl -f`)', () => {
  it('targets the same URL the curl HEALTHCHECK did', () => {
    expect(healthUrl({ PORT: '3000' })).toBe('http://localhost:3000/api/health');
    expect(healthUrl({ PORT: '8123' })).toBe('http://localhost:8123/api/health');
  });

  it('is healthy on a 2xx and sends a plain GET', async () => {
    seen.length = 0;
    expect(await checkHealth({ url: at('/status/200') })).toEqual({ ok: true, status: 200 });
    expect(seen).toEqual([{ method: 'GET', url: '/status/200' }]);
  });

  it('is unhealthy on 4xx and 5xx', async () => {
    expect(await checkHealth({ url: at('/status/404') })).toMatchObject({ ok: false, status: 404 });
    expect(await checkHealth({ url: at('/status/500') })).toMatchObject({ ok: false, status: 500 });
    expect(await checkHealth({ url: at('/status/503') })).toMatchObject({ ok: false, status: 503 });
  });

  it('treats a redirect as healthy without following it', async () => {
    seen.length = 0;
    expect(await checkHealth({ url: at('/status/302') })).toEqual({ ok: true, status: 302 });
    expect(seen).toHaveLength(1); // the 500 behind the redirect was never requested
  });

  it('is unhealthy when the app does not answer within the timeout', async () => {
    const started = Date.now();
    const result = await checkHealth({ url: at('/hang'), timeoutMs: 100 });
    expect(result).toEqual({ ok: false, error: 'Timed out after 100ms' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('is unhealthy when nothing is listening', async () => {
    const result = await checkHealth({ url: `http://localhost:${await closedPort()}/api/health` });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });
});

describe.skipIf(process.platform !== 'linux')('healthcheck probe leaves no processes behind', () => {
  it('runs 100 healthy/failing/timeout checks without spawning curl or leaving a zombie', async () => {
    const refused = `http://localhost:${await closedPort()}/api/health`;
    const cases = [
      { url: () => at('/status/200'), ok: true },
      { url: () => at('/status/500'), ok: false },
      { url: () => at('/hang'), ok: false },
      { url: () => refused, ok: false },
    ];

    const childrenBefore = descendantsOf(process.pid).map((proc) => proc.pid).sort();
    const offenders = [];

    for (let i = 0; i < 100; i++) {
      const testCase = cases[i % cases.length];
      const result = await checkHealth({ url: testCase.url(), timeoutMs: 50 });
      expect(result.ok).toBe(testCase.ok);

      for (const proc of descendantsOf(process.pid)) {
        if (proc.comm === 'curl' || proc.state === 'Z') offenders.push({ iteration: i, ...proc });
      }
    }

    expect(offenders).toEqual([]);
    // No child process of any kind was created by the checks.
    expect(descendantsOf(process.pid).map((proc) => proc.pid).sort()).toEqual(childrenBefore);
    expect(listProcesses().filter((proc) => proc.ppid === process.pid && proc.state === 'Z')).toEqual([]);
  });
});

describe('healthcheck.js as run by Docker', () => {
  function runProbe(probePort) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(ROOT, 'healthcheck.js')], {
        env: { ...process.env, PORT: String(probePort) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (code) => resolve({ code, stderr }));
    });
  }

  it('exits 0 when /api/health is healthy', async () => {
    healthStatus = 200;
    expect(await runProbe(port)).toEqual({ code: 0, stderr: '' });
  });

  it('exits 1 and says why when /api/health fails', async () => {
    healthStatus = 500;
    const result = await runProbe(port);
    healthStatus = 200;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`http://localhost:${port}/api/health failed`);
    expect(result.stderr).toContain('500');
  });

  it('exits 1 when the app is down', async () => {
    const result = await runProbe(await closedPort());
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/ECONNREFUSED/);
  });
});

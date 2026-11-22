import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listProcesses, descendantsOf, isAlive, waitFor } from '../helpers/procTree.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE_APP = path.join(ROOT, 'tests', 'fixtures', 'watchdog-app.js');

const running = [];

/** Boots watchdog.js supervising the fixture app (or `appCmd`). */
function startWatchdog({ appCmd, env = {} } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printhive-watchdog-'));
  const appLog = path.join(tempDir, 'app.log');
  const restartFlag = path.join(tempDir, 'restart.flag');
  fs.writeFileSync(appLog, '');

  const proc = spawn(process.execPath, [path.join(ROOT, 'watchdog.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      APP_CMD: appCmd || `${process.execPath} ${FIXTURE_APP}`,
      APP_LOG: appLog,
      RESTART_FLAG: restartFlag,
      RESTART_DELAY_MS: '50',
      RESTART_FLAG_POLL_MS: '250',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const watchdog = {
    proc,
    restartFlag,
    output: '',
    exited: new Promise((resolve) => proc.on('exit', (code, signal) => resolve({ code, signal }))),
    events: () => fs.readFileSync(appLog, 'utf8').split('\n').filter(Boolean),
    appPids: () => watchdog.events().filter((line) => line.startsWith('start ')).map((line) => Number(line.split(' ')[1])),
    waitForStarts: (count) => waitFor(() => watchdog.appPids().length >= count && watchdog.appPids(), { what: `app start #${count}` }),
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
  };
  proc.stdout.on('data', (chunk) => { watchdog.output += chunk; });
  proc.stderr.on('data', (chunk) => { watchdog.output += chunk; });
  running.push(watchdog);
  return watchdog;
}

afterEach(async () => {
  for (const watchdog of running.splice(0)) {
    for (const proc of descendantsOf(watchdog.proc.pid)) {
      try { process.kill(proc.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    if (watchdog.proc.exitCode === null && watchdog.proc.signalCode === null) watchdog.proc.kill('SIGKILL');
    await watchdog.exited;
    watchdog.cleanup();
  }
});

describe.skipIf(process.platform !== 'linux')('watchdog', () => {
  it('restarts the app when it dies, and reaps the dead one', async () => {
    const watchdog = startWatchdog();
    const [firstPid] = await watchdog.waitForStarts(1);

    process.kill(firstPid, 'SIGKILL'); // the app crashes

    const [, secondPid] = await watchdog.waitForStarts(2);
    expect(secondPid).not.toBe(firstPid);
    expect(watchdog.output).toContain('[watchdog] child exited (code=null, signal=SIGKILL), restarting in 50ms');

    // The only child is the live replacement — the dead app was reaped.
    const children = listProcesses().filter((proc) => proc.ppid === watchdog.proc.pid);
    expect(children.map((proc) => proc.pid)).toEqual([secondPid]);
    expect(children.filter((proc) => proc.state === 'Z')).toEqual([]);
  });

  it('restarts the app when the restart flag appears', async () => {
    const watchdog = startWatchdog();
    const [firstPid] = await watchdog.waitForStarts(1);

    fs.writeFileSync(watchdog.restartFlag, '1');

    const [, secondPid] = await watchdog.waitForStarts(2);
    expect(secondPid).not.toBe(firstPid);
    expect(fs.existsSync(watchdog.restartFlag)).toBe(false);
    expect(watchdog.events()).toContain(`sigterm ${firstPid}`);
    expect(watchdog.output).toContain('[watchdog] restart flag detected, restarting app');
    expect(isAlive(firstPid)).toBe(false);
  });

  it('restarts the app on SIGHUP', async () => {
    const watchdog = startWatchdog();
    const [firstPid] = await watchdog.waitForStarts(1);

    watchdog.proc.kill('SIGHUP');

    const [, secondPid] = await watchdog.waitForStarts(2);
    expect(secondPid).not.toBe(firstPid);
    expect(watchdog.output).toContain('[watchdog] received SIGHUP, restarting app');
  });

  it('forwards SIGTERM, waits for the app, and exits with its code', async () => {
    const watchdog = startWatchdog();
    const [appPid] = await watchdog.waitForStarts(1);

    watchdog.proc.kill('SIGTERM');

    expect(await watchdog.exited).toEqual({ code: 0, signal: null });
    expect(watchdog.events()).toContain(`sigterm ${appPid}`);
    expect(watchdog.output).toContain('[watchdog] forwarding SIGTERM to child');
    expect(watchdog.output).toContain('[watchdog] child exited (code=0, signal=null), shutting down');
    expect(watchdog.appPids()).toHaveLength(1); // not restarted while stopping
    expect(isAlive(appPid)).toBe(false);
  });

  it('SIGKILLs an app that ignores SIGTERM, so a hung app cannot block a restart', async () => {
    const watchdog = startWatchdog({ env: { APP_MODE: 'ignore-term', KILL_GRACE_MS: '300' } });
    const [firstPid] = await watchdog.waitForStarts(1);

    fs.writeFileSync(watchdog.restartFlag, '1');

    const [, secondPid] = await watchdog.waitForStarts(2);
    expect(watchdog.events()).toContain(`sigterm ${firstPid}`);
    expect(watchdog.output).toContain('child still running 300ms after SIGTERM, sending SIGKILL');
    expect(isAlive(firstPid)).toBe(false);

    // ...and cannot block shutdown either.
    watchdog.proc.kill('SIGTERM');
    expect(await watchdog.exited).toEqual({ code: 0, signal: null });
    expect(isAlive(secondPid)).toBe(false);
  });

  it('keeps retrying instead of crashing when the app cannot be started', async () => {
    const watchdog = startWatchdog({ appCmd: '/nonexistent/printhive-app' });

    await waitFor(() => (watchdog.output.match(/failed to start app/g) || []).length >= 2, { what: 'two start attempts' });
    expect(watchdog.proc.exitCode).toBeNull();

    watchdog.proc.kill('SIGTERM');
    expect(await watchdog.exited).toEqual({ code: 0, signal: null });
  });
});

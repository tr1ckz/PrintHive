import { describe, it, expect, afterEach, vi } from 'vitest';
import PrinterConnectionManager from '../../server/services/printerConnectionManager.js';
import { startFakePrinter } from '../helpers/fakePrinterBroker.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const quietLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, isLevelEnabled: () => false };

function makeManager(overrides = {}) {
  return new PrinterConnectionManager({
    logger: quietLogger,
    sendNotification: vi.fn(async () => {}),
    findRecentPrintByJobName: vi.fn(() => null),
    attachRealtimeBridge: vi.fn(),
    ...overrides,
  });
}

describe('PrinterConnectionManager (Phase 4 gate)', () => {
  let printer;
  let manager;

  afterEach(async () => {
    if (manager) { manager.disconnectAll(() => {}); manager = null; }
    if (printer) { try { await printer.stop(); } catch { /* killed */ } printer = null; }
  });

  it('ensureClient connects, registers the client, clears cooldown, attaches the bridge', async () => {
    printer = await startFakePrinter();
    const attachRealtimeBridge = vi.fn();
    manager = makeManager({ attachRealtimeBridge, mqttOptions: { port: printer.port, connectTimeoutMs: 5000 } });

    const deviceData = { dev_id: printer.serial, name: 'Bench Printer' };
    const key = await manager.ensureClient(deviceData, {
      deviceIp: '127.0.0.1',
      deviceAccessCode: 'code',
      deviceSerial: printer.serial,
    });

    expect(key).toBe(`127.0.0.1:${printer.serial}`);
    const client = manager.getClient(key);
    expect(client).toBeDefined();
    expect(client.connected).toBe(true);
    expect(manager.connectFailures.has(key)).toBe(false);
    expect(attachRealtimeBridge).toHaveBeenCalledWith(client, key, deviceData);
  });

  it('fires the sendNotification hook on a RUNNING→FINISH transition', async () => {
    printer = await startFakePrinter();
    const sendNotification = vi.fn(async () => {});
    manager = makeManager({ sendNotification, mqttOptions: { port: printer.port, connectTimeoutMs: 5000 } });

    const key = await manager.ensureClient({ dev_id: printer.serial, name: 'Notify Printer' }, {
      deviceIp: '127.0.0.1',
      deviceAccessCode: 'code',
      deviceSerial: printer.serial,
    });
    expect(manager.getClient(key).connected).toBe(true);

    await printer.publishReport({ print: { gcode_state: 'RUNNING', mc_percent: 99, subtask_name: 'benchy' } });
    await sleep(150);
    await printer.publishReport({ print: { gcode_state: 'FINISH', mc_percent: 100, subtask_name: 'benchy' } });
    await sleep(300);

    expect(sendNotification).toHaveBeenCalledWith('printer', expect.objectContaining({
      status: 'completed',
      printerName: 'Notify Printer',
      jobName: 'benchy',
    }));
  });

  it('reuses the existing client on subsequent polls (no duplicate connects)', async () => {
    printer = await startFakePrinter();
    manager = makeManager({ mqttOptions: { port: printer.port, connectTimeoutMs: 5000 } });
    const deviceData = { dev_id: printer.serial, name: 'Reuse Printer' };
    const args = { deviceIp: '127.0.0.1', deviceAccessCode: 'code', deviceSerial: printer.serial };

    const key = await manager.ensureClient(deviceData, args);
    const first = manager.getClient(key);
    await manager.ensureClient(deviceData, args);
    expect(manager.getClient(key)).toBe(first);
    expect(manager.clients.size).toBe(1);
  });

  it('unreachable printer: ensureClient resolves (no throw — the old inline code 500ed here), sets cooldown, leaves no client', async () => {
    manager = makeManager({ mqttOptions: { port: 59998, connectTimeoutMs: 1500 } });
    const deviceData = { dev_id: 'DEADBEEF', name: 'Ghost' };

    const key = await manager.ensureClient(deviceData, {
      deviceIp: '127.0.0.1',
      deviceAccessCode: 'code',
      deviceSerial: 'DEADBEEF',
    });

    expect(manager.getClient(key)).toBeUndefined();
    expect(manager.connectFailures.has(key)).toBe(true);
  }, 15000);

  it('cooldown: retry within the window does not re-dial', async () => {
    manager = makeManager({ cooldownMs: 60000, mqttOptions: { port: 59998, connectTimeoutMs: 1500 } });
    const deviceData = { dev_id: 'DEADBEEF', name: 'Ghost' };
    const args = { deviceIp: '127.0.0.1', deviceAccessCode: 'code', deviceSerial: 'DEADBEEF' };

    await manager.ensureClient(deviceData, args);
    const failedAt = manager.connectFailures.get('127.0.0.1:DEADBEEF');
    expect(failedAt).toBeTypeOf('number');

    const start = Date.now();
    await manager.ensureClient(deviceData, args);
    expect(Date.now() - start).toBeLessThan(200); // returned without dialing
    expect(manager.connectFailures.get('127.0.0.1:DEADBEEF')).toBe(failedAt); // timestamp not refreshed
  }, 15000);

  it('cooldown expiry: re-dial happens after the window and succeeds once the printer is back', async () => {
    manager = makeManager({ cooldownMs: 300, mqttOptions: { port: 59998, connectTimeoutMs: 1000 } });
    const deviceData = { dev_id: 'FLAKY01', name: 'Flaky' };
    const args = { deviceIp: '127.0.0.1', deviceAccessCode: 'code', deviceSerial: 'FLAKY01' };

    await manager.ensureClient(deviceData, args); // fails, cooldown starts
    expect(manager.getClient('127.0.0.1:FLAKY01')).toBeUndefined();

    // Printer "comes back" on the port the manager dials
    printer = await startFakePrinter({ serial: 'FLAKY01' });
    manager.mqttOptions = { port: printer.port, connectTimeoutMs: 5000 };

    await sleep(400); // let the cooldown lapse
    await manager.ensureClient(deviceData, args);
    expect(manager.getClient('127.0.0.1:FLAKY01')?.connected).toBe(true);
  }, 15000);

  it('disconnectAll disconnects and clears the registry', async () => {
    manager = makeManager();
    const fake = { disconnect: vi.fn() };
    manager.clients.set('k1', fake);
    manager.clients.set('k2', fake);
    manager.disconnectAll(() => {});
    expect(fake.disconnect).toHaveBeenCalledTimes(2);
    expect(manager.clients.size).toBe(0);
  });
});

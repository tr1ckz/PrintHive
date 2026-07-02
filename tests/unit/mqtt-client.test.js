import { describe, it, expect, afterEach } from 'vitest';
import BambuMqttClient from '../../server/services/mqtt-client.js';
import { startFakePrinter } from '../helpers/fakePrinterBroker.js';

function once(emitter, event, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for '${event}'`)), timeoutMs);
    emitter.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('BambuMqttClient LAN-mode semantics', () => {
  let printer;
  let client;

  afterEach(async () => {
    if (client) { client.disconnect(); client = null; }
    if (printer) { try { await printer.stop(); } catch { /* already killed */ } printer = null; }
  });

  it('connects over TLS, subscribes, and requests pushall', async () => {
    printer = await startFakePrinter();
    client = new BambuMqttClient('127.0.0.1', printer.serial, 'code', 'Test', { port: printer.port });
    await client.connect();
    expect(client.connected).toBe(true);
    expect(client.everConnected).toBe(true);
    await sleep(300);
    expect(printer.requests.some((r) => r.pushing?.command === 'pushall')).toBe(true);
  });

  it('emits job_update from a report message with parsed state', async () => {
    printer = await startFakePrinter();
    client = new BambuMqttClient('127.0.0.1', printer.serial, 'code', 'Test', { port: printer.port });
    await client.connect();

    const update = once(client, 'job_update');
    await printer.publishReport({
      print: { gcode_state: 'RUNNING', mc_percent: 42, subtask_name: 'benchy.3mf', mc_remaining_time: 30, layer_num: 10, total_layer_num: 100 },
    });
    const job = await update;
    expect(job.gcode_state).toBe('RUNNING');
    expect(job.progress).toBe(42);
    expect(job.name).toBe('benchy.3mf');
    expect(client.getCurrentJob().progress).toBe(42);
  });

  it('throttles telemetry-only churn to minJobEmitIntervalMs but emits state changes immediately', async () => {
    printer = await startFakePrinter();
    client = new BambuMqttClient('127.0.0.1', printer.serial, 'code', 'Test', { port: printer.port });
    await client.connect();

    const emitted = [];
    client.on('job_update', (j) => emitted.push({ at: Date.now(), state: j.gcode_state, progress: j.progress }));

    await printer.publishReport({ print: { gcode_state: 'RUNNING', mc_percent: 10, subtask_name: 'x' } });
    await sleep(150); // first emit is immediate
    const afterFirst = emitted.length;
    expect(afterFirst).toBe(1);

    // Meaningful progress bump inside the 750ms window → deferred, not dropped
    await printer.publishReport({ print: { gcode_state: 'RUNNING', mc_percent: 11, subtask_name: 'x' } });
    await sleep(150);
    expect(emitted.length).toBe(afterFirst); // still throttled
    await sleep(900);
    expect(emitted.length).toBe(afterFirst + 1); // flushed after interval

    // State change bypasses the throttle
    const before = emitted.length;
    await printer.publishReport({ print: { gcode_state: 'PAUSE', mc_percent: 11, subtask_name: 'x' } });
    await sleep(200);
    expect(emitted.length).toBe(before + 1);
    expect(emitted[emitted.length - 1].state).toBe('PAUSE');
  });

  it('emits print_completed on RUNNING→FINISH transition', async () => {
    printer = await startFakePrinter();
    client = new BambuMqttClient('127.0.0.1', printer.serial, 'code', 'MyPrinter', { port: printer.port });
    await client.connect();

    await printer.publishReport({ print: { gcode_state: 'RUNNING', mc_percent: 99, subtask_name: 'benchy' } });
    await sleep(100);
    const completed = once(client, 'print_completed');
    await printer.publishReport({ print: { gcode_state: 'FINISH', mc_percent: 100, subtask_name: 'benchy' } });
    const evt = await completed;
    expect(evt.printerName).toBe('MyPrinter');
    expect(evt.jobName).toBe('benchy');
  });

  it("emits connection_lost (NOT disconnected) when an established connection drops — the false-offline fix", async () => {
    printer = await startFakePrinter();
    client = new BambuMqttClient('127.0.0.1', printer.serial, 'code', 'Test', { port: printer.port });
    await client.connect();

    let sawDisconnected = false;
    client.on('disconnected', () => { sawDisconnected = true; });
    const lost = once(client, 'connection_lost');

    await printer.kill();
    await lost;
    expect(sawDisconnected).toBe(false);
    expect(client.everConnected).toBe(true); // preserved so mqtt.js auto-reconnect owns recovery
  });

  it("emits disconnected + rejects when the printer is unreachable — feeds the server-side cooldown", async () => {
    // No broker listening on this port
    client = new BambuMqttClient('127.0.0.1', 'NOPE', 'code', 'Test', { port: 59999, connectTimeoutMs: 1500 });
    client.on('error', () => {}); // the server always attaches an error handler; mirror that
    const disconnected = once(client, 'disconnected', 5000);
    await expect(client.connect()).rejects.toThrow(/timeout/i);
    await disconnected;
    expect(client.everConnected).toBe(false);
  });

  it('disconnect() force-closes and clears all state (teardown used before cooldown)', async () => {
    printer = await startFakePrinter();
    client = new BambuMqttClient('127.0.0.1', printer.serial, 'code', 'Test', { port: printer.port });
    await client.connect();
    await printer.publishReport({ print: { gcode_state: 'RUNNING', mc_percent: 5 } });
    await sleep(100);

    client.disconnect();
    expect(client.client).toBe(null);
    expect(client.connected).toBe(false);
    expect(client.getCurrentJob()).toBe(null);
    client = null;
  });
});

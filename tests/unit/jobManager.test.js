import { describe, it, expect } from 'vitest';
import { JobManager } from '../../server/jobs/jobManager.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('JobManager', () => {
  it('runs jobs and records lifecycle state', async () => {
    const jm = new JobManager();
    const job = jm.start('scan', async (j) => {
      j.progress = { current: 5, total: 10, message: 'halfway' };
      return { scanned: 10 };
    });
    expect(job.state).toBe('queued');
    await job.completion;
    expect(job.state).toBe('done');
    expect(job.result).toEqual({ scanned: 10 });
    expect(jm.getLatest('scan').id).toBe(job.id);
  });

  it('enforces per-type mutual exclusion', async () => {
    const jm = new JobManager();
    const job = jm.start('scan', () => sleep(100));
    expect(() => jm.start('scan', () => {})).toThrow(/already running/i);
    await job.completion;
    // finished -> a new one may start
    const second = jm.start('scan', async () => 'ok');
    await second.completion;
    expect(second.state).toBe('done');
  });

  it('serializes the heavy lane (concurrency 1) across job types', async () => {
    const jm = new JobManager();
    const order = [];
    const a = jm.start('convert', async () => { order.push('a-start'); await sleep(80); order.push('a-end'); }, { lane: 'heavy' });
    const b = jm.start('backup', async () => { order.push('b-start'); await sleep(10); order.push('b-end'); }, { lane: 'heavy' });
    await Promise.all([a.completion, b.completion]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('captures errors without stalling the lane', async () => {
    const jm = new JobManager();
    const bad = jm.start('boom', async () => { throw new Error('kaput'); }, { lane: 'heavy' });
    const good = jm.start('after', async () => 'fine', { lane: 'heavy' });
    await Promise.all([bad.completion, good.completion]);
    expect(bad.state).toBe('error');
    expect(bad.error).toBe('kaput');
    expect(good.state).toBe('done');
  });

  it('cancel aborts a running job via its signal', async () => {
    const jm = new JobManager();
    const job = jm.start('longhaul', (j, signal) => new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 5000);
      signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
    }));
    await sleep(20);
    expect(jm.cancel(job.id)).toBe(true);
    await job.completion;
    expect(job.state).toBe('cancelled');
  });

  it('acquireLane blocks the lane until released', async () => {
    const jm = new JobManager();
    const release = await jm.acquireLane('heavy');
    let ran = false;
    const queued = jm.runInLane('heavy', () => { ran = true; });
    await sleep(50);
    expect(ran).toBe(false); // still held
    release();
    await queued;
    expect(ran).toBe(true);
  });
});

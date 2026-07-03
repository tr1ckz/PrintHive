const crypto = require('crypto');

/**
 * In-process background job manager.
 *
 * - Per-type mutual exclusion: starting a type that is already running
 *   throws (matches the implicit "one at a time" of the legacy trackers).
 * - Lanes: named promise queues with concurrency 1. Heavy work (ffmpeg
 *   conversion, backup/restore, bulk scans) shares the 'heavy' lane so two
 *   disk/CPU-intensive jobs never run at once.
 * - Records are in-memory only: every job is a re-runnable scan/transfer,
 *   so persisting them across restarts would only display stale corpses.
 *
 * Legacy ad-hoc trackers (videoMatchJob, libraryScanJob, ...) still live in
 * simple-server.js; they migrate here as server/jobs/definitions/* in
 * follow-up commits, with route-layer shims preserving their status JSON.
 */
class JobManager {
  constructor() {
    this.jobs = new Map();       // id -> record
    this.laneTails = new Map();  // lane -> tail promise
    this.runningByType = new Map(); // type -> id
  }

  /**
   * Start a job. `run(job, signal)` receives the mutable record (update
   * job.progress freely) and an AbortSignal for cancellation.
   * Returns the job record immediately; execution is queued on the lane.
   */
  start(type, run, { lane = 'default', params = null } = {}) {
    if (this.runningByType.has(type)) {
      const existingId = this.runningByType.get(type);
      throw new Error(`Job type "${type}" is already running (${existingId})`);
    }

    const id = `${type}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const controller = new AbortController();
    const job = {
      id,
      type,
      lane,
      params,
      state: 'queued',
      progress: { current: 0, total: 0, message: '' },
      startedAt: null,
      finishedAt: null,
      error: null,
      result: null,
    };
    this.jobs.set(id, job);
    this.runningByType.set(type, id);
    this.controllersById = this.controllersById || new Map();
    this.controllersById.set(id, controller);

    const tail = this.laneTails.get(lane) || Promise.resolve();
    const execution = tail
      .then(async () => {
        if (job.state === 'cancelled') return;
        job.state = 'running';
        job.startedAt = new Date().toISOString();
        try {
          job.result = await run(job, controller.signal);
          job.state = job.state === 'cancelled' ? 'cancelled' : 'done';
        } catch (error) {
          job.state = controller.signal.aborted ? 'cancelled' : 'error';
          job.error = error?.message || String(error);
        } finally {
          job.finishedAt = new Date().toISOString();
          if (this.runningByType.get(type) === id) this.runningByType.delete(type);
          this.controllersById.delete(id);
        }
      });
    // The lane advances regardless of individual job failure.
    this.laneTails.set(lane, execution.catch(() => {}));
    job.completion = execution;

    return job;
  }

  /** Queue work on a lane without tracking it as a typed job (no exclusion). */
  runInLane(lane, fn) {
    const tail = this.laneTails.get(lane) || Promise.resolve();
    const execution = tail.then(() => fn());
    this.laneTails.set(lane, execution.then(() => {}, () => {}));
    return execution;
  }

  /**
   * Mutex-style lane access for code that can't be wrapped in a closure
   * (e.g. long inline route bodies). Resolves with a release function once
   * the lane is free; the lane stays blocked until release() is called.
   */
  acquireLane(lane) {
    const tail = this.laneTails.get(lane) || Promise.resolve();
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    this.laneTails.set(lane, tail.then(() => held));
    return tail.then(() => release);
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  getLatest(type) {
    let latest = null;
    for (const job of this.jobs.values()) {
      if (job.type === type && (!latest || job.id > latest.id)) latest = job;
    }
    return latest;
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job || job.finishedAt) return false;
    const controller = this.controllersById?.get(id);
    if (controller) controller.abort();
    if (job.state === 'queued') {
      job.state = 'cancelled';
      job.finishedAt = new Date().toISOString();
      if (this.runningByType.get(job.type) === id) this.runningByType.delete(job.type);
    }
    return true;
  }

  list() {
    return Array.from(this.jobs.values());
  }
}

module.exports = new JobManager();
module.exports.JobManager = JobManager;

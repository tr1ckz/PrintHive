const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const { dataDir } = require('../../database');

// Main-thread client for the thumbnail worker. Model rendering
// (@napi-rs/canvas + STL/3MF parsing) is genuine CPU work that used to run
// on the event loop; it now lives in a single dedicated worker_thread.
// Cache clearing is plain fs and stays on the main thread so requiring this
// module never loads the canvas native addon into the main process.

const THUMB_DIR = path.join(dataDir, 'thumbnails');

let worker = null;
let nextId = 1;
const pending = new Map();

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(path.join(__dirname, 'workers', 'thumbnail.worker.js'));
  worker.unref(); // don't keep the process alive for an idle worker

  worker.on('message', (msg) => {
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) {
      entry.resolve(msg.buffer ? Buffer.from(msg.buffer) : null);
    } else {
      entry.reject(new Error(msg.error || 'Thumbnail worker error'));
    }
  });

  const failAll = (err) => {
    for (const entry of pending.values()) entry.reject(err);
    pending.clear();
    worker = null; // next call respawns
  };
  worker.on('error', (err) => failAll(err));
  worker.on('exit', (code) => {
    if (pending.size > 0) failAll(new Error(`Thumbnail worker exited with code ${code}`));
    worker = null;
  });

  return worker;
}

function getThumbnail(file) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    try {
      // file must be structured-cloneable: pass a plain copy of the db row
      ensureWorker().postMessage({ id, op: 'getThumbnail', file: { ...file } });
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}

function clearThumbnailCache(fileId) {
  const thumbPath = path.join(THUMB_DIR, `${fileId}.png`);
  if (fs.existsSync(thumbPath)) {
    fs.unlinkSync(thumbPath);
  }
}

module.exports = { getThumbnail, clearThumbnailCache, THUMB_DIR };

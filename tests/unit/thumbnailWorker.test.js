import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Smoke test: the worker must load @napi-rs/canvas in a worker_thread and
// return a PNG buffer for the gcode fallback path (no model file needed).
// This is the check the plan flags for the Docker image as well.

// Hermetic: point the data/library dirs at a temp location BEFORE the
// client (and its worker) load database.js.
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'printhive-thumb-'));
process.env.PRINTHIVE_DATA_DIR = path.join(tempRoot, 'data');
process.env.PRINTHIVE_LIBRARY_DIR = path.join(tempRoot, 'library');

describe('thumbnail worker', () => {
  it('renders a fallback thumbnail off the main thread', async () => {
    const client = await import('../../server/jobs/thumbnailClient.js');
    const buffer = await client.getThumbnail({
      id: 999999901,
      fileName: 'does-not-exist-test-file.gcode',
      originalName: 'does-not-exist-test-file.gcode',
      fileType: 'gcode',
      fileSize: 1234,
    });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    // PNG magic bytes
    expect(buffer.subarray(0, 4).toString('hex')).toBe('89504e47');
    client.clearThumbnailCache(999999901);
  }, 30000);
});

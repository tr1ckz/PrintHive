const { parentPort } = require('worker_threads');
const { getThumbnail } = require('../../../thumbnail-generator');

// Runs the @napi-rs/canvas + geometry-parsing thumbnail pipeline off the main
// thread. Protocol: { id, op: 'getThumbnail', file } -> { id, ok, buffer|error }.

parentPort.on('message', async (msg) => {
  if (msg.op === 'getThumbnail') {
    try {
      const buffer = await getThumbnail(msg.file);
      parentPort.postMessage({ id: msg.id, ok: true, buffer });
    } catch (error) {
      parentPort.postMessage({ id: msg.id, ok: false, error: error?.message || String(error) });
    }
  } else {
    parentPort.postMessage({ id: msg.id, ok: false, error: `Unknown op: ${msg.op}` });
  }
});

const tls = require('node:tls');
const { EventEmitter } = require('node:events');
const logger = require('../../logger');

// Local chamber-camera access for P1/A1 (and X1 in this mode) printers.
//
// These printers don't expose standard RTSP; instead the chamber camera is a
// proprietary stream on TLS port 6000: connect, send an 80-byte auth packet
// (username "bblp" + access code), then read a sequence of JPEG frames, each
// prefixed by a 16-byte header whose first 4 bytes are the JPEG length (LE).
// This mirrors what the Home Assistant ha-bambulab / pybambu integration does.
//
// We re-serve the frames to browsers as MJPEG, so no go2rtc/ffmpeg is needed.

const CHAMBER_PORT = 6000;
const MAX_FRAME_BYTES = 8 * 1024 * 1024; // sanity guard against corrupt length headers
const IDLE_CLOSE_MS = 15000;             // drop the printer socket this long after the last viewer

// ---------------------------------------------------------------------------
// Pure protocol helpers (no sockets) — exported for unit testing.
// ---------------------------------------------------------------------------

// Build the 80-byte authentication payload the printer expects first:
//   uint32 LE 0x40, uint32 LE 0x3000, uint32 LE 0, uint32 LE 0,
//   username padded to 32 bytes, access code padded to 32 bytes.
function buildChamberAuthPayload(accessCode, username = 'bblp') {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(0x40, 0);
  header.writeUInt32LE(0x3000, 4);
  header.writeUInt32LE(0x00, 8);
  header.writeUInt32LE(0x00, 12);

  const user = Buffer.alloc(32);
  Buffer.from(String(username || ''), 'ascii').copy(user, 0, 0, 32);

  const code = Buffer.alloc(32);
  Buffer.from(String(accessCode || ''), 'ascii').copy(code, 0, 0, 32);

  return Buffer.concat([header, user, code]);
}

// Pull all complete frames out of an accumulated buffer. Each frame is a
// 16-byte header (first 4 bytes = JPEG length, LE) followed by the JPEG bytes.
// Returns the extracted JPEG buffers and any leftover bytes to carry forward.
function extractChamberFrames(buf) {
  const frames = [];
  let offset = 0;
  while (buf.length - offset >= 16) {
    const size = buf.readUInt32LE(offset);
    if (size <= 0 || size > MAX_FRAME_BYTES) {
      // Length header is implausible — the stream is out of sync. Bail and let
      // the caller resync (in practice the socket is reset).
      return { frames, rest: buf.subarray(offset), desync: true };
    }
    if (buf.length - offset < 16 + size) break; // wait for the rest of the frame
    frames.push(buf.subarray(offset + 16, offset + 16 + size));
    offset += 16 + size;
  }
  return { frames, rest: buf.subarray(offset), desync: false };
}

// A JPEG (SOI ff d8 ... EOI ff d9). Used to drop partial/garbage frames.
function looksLikeJpeg(frame) {
  return frame.length > 4 &&
    frame[0] === 0xff && frame[1] === 0xd8 &&
    frame[frame.length - 2] === 0xff && frame[frame.length - 1] === 0xd9;
}

// ---------------------------------------------------------------------------
// Live stream + hub.
// ---------------------------------------------------------------------------

class ChamberCameraStream extends EventEmitter {
  constructor(host, accessCode) {
    super();
    this.host = host;
    this.accessCode = accessCode;
    this.subscribers = 0;
    this.lastFrame = null;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.idleTimer = null;
  }

  connect() {
    if (this.socket || this.closed) return;
    logger.debug(`[ChamberCam] Connecting to ${this.host}:${CHAMBER_PORT}`);

    // Bambu presents a self-signed cert; skip verification (LAN device).
    const socket = tls.connect({
      host: this.host,
      port: CHAMBER_PORT,
      rejectUnauthorized: false,
      timeout: 8000,
    });
    this.socket = socket;

    socket.on('secureConnect', () => {
      socket.write(buildChamberAuthPayload(this.accessCode));
    });

    socket.on('data', (chunk) => {
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
      const { frames, rest, desync } = extractChamberFrames(this.buffer);
      this.buffer = rest;
      for (const frame of frames) {
        if (!looksLikeJpeg(frame)) continue;
        this.lastFrame = frame;
        this.emit('frame', frame);
      }
      if (desync) {
        logger.debug('[ChamberCam] Stream desync, resetting socket');
        this.reset();
      }
    });

    socket.on('timeout', () => { this.emit('camera-error', new Error('connection timed out')); socket.destroy(); });
    socket.on('error', (err) => { this.emit('camera-error', err); });
    socket.on('close', () => {
      this.socket = null;
      this.buffer = Buffer.alloc(0);
      // Reconnect only while someone is still watching.
      if (!this.closed && this.subscribers > 0) {
        setTimeout(() => this.connect(), 1500);
      }
    });
  }

  reset() {
    if (this.socket) {
      const s = this.socket;
      this.socket = null;
      this.buffer = Buffer.alloc(0);
      try { s.destroy(); } catch { /* already gone */ }
    }
  }

  addSubscriber() {
    this.subscribers += 1;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    this.connect();
  }

  removeSubscriber() {
    this.subscribers = Math.max(0, this.subscribers - 1);
    if (this.subscribers === 0 && !this.idleTimer) {
      this.idleTimer = setTimeout(() => this.close(), IDLE_CLOSE_MS);
    }
  }

  close() {
    this.closed = true;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    this.reset();
    this.emit('camera-closed');
  }
}

class ChamberCameraHub {
  constructor() {
    this.streams = new Map(); // key -> ChamberCameraStream
  }

  key(devId, host) {
    return `${devId || ''}@${host}`;
  }

  // Get (or start) the stream for a printer. If the host/access code changed
  // (e.g. code rotated, IP moved) the old stream is torn down and replaced.
  getStream(devId, host, accessCode) {
    if (!host || !accessCode) return null;
    const key = this.key(devId, host);
    let stream = this.streams.get(key);
    if (stream && stream.accessCode !== accessCode) {
      stream.close();
      this.streams.delete(key);
      stream = null;
    }
    if (!stream || stream.closed) {
      stream = new ChamberCameraStream(host, accessCode);
      stream.once('camera-closed', () => {
        if (this.streams.get(key) === stream) this.streams.delete(key);
      });
      this.streams.set(key, stream);
    }
    return stream;
  }
}

const hub = new ChamberCameraHub();

module.exports = {
  // pure
  buildChamberAuthPayload,
  extractChamberFrames,
  looksLikeJpeg,
  // live
  ChamberCameraStream,
  hub,
  CHAMBER_PORT,
};

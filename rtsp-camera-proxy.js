const { spawn } = require('child_process');

const JPEG_START = Buffer.from([0xff, 0xd8]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

class RtspCameraProxy {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.ffmpegPath = options.ffmpegPath || 'ffmpeg';
    this.idleShutdownMs = options.idleShutdownMs || 5000;
    this.frameRate = options.frameRate || 5;
    this.quality = options.quality || 5;
    this.width = options.width || 960;

    this.clients = new Set();
    this.ffmpeg = null;
    this.currentRtspUrl = '';
    this.frameBuffer = Buffer.alloc(0);
    this.stopTimer = null;
  }

  addClient(res, rtspUrl) {
    const trimmedUrl = String(rtspUrl || '').trim();
    if (!trimmedUrl) {
      throw new Error('RTSP URL is required to start the proxy');
    }

    this.clearStopTimer();

    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    this.clients.add(res);
    this.ensureProcess(trimmedUrl);

    const cleanup = () => {
      this.removeClient(res);
    };

    res.on('close', cleanup);
    res.on('finish', cleanup);
    res.on('error', cleanup);
  }

  ensureProcess(rtspUrl) {
    if (this.ffmpeg && this.currentRtspUrl === rtspUrl && !this.ffmpeg.killed) {
      return;
    }

    this.stopProcess();
    this.currentRtspUrl = rtspUrl;
    this.startProcess(rtspUrl);
  }

  startProcess(rtspUrl) {
    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel', 'error',
      '-nostdin',
      '-rtsp_transport', 'tcp',
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-rw_timeout', '5000000',
      '-i', rtspUrl,
      '-an',
      '-vf', `fps=${this.frameRate},scale=${this.width}:-1`,
      '-q:v', String(this.quality),
      '-f', 'mjpeg',
      'pipe:1',
    ];

    this.ffmpeg = spawn(this.ffmpegPath, ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.ffmpeg.stdout.on('data', (chunk) => {
      this.handleChunk(chunk);
    });

    this.ffmpeg.stderr.on('data', (chunk) => {
      const message = String(chunk || '').trim();
      if (message) {
        this.logger.warn?.('[RTSP proxy] FFmpeg:', message);
      }
    });

    this.ffmpeg.on('error', (error) => {
      this.logger.error?.('[RTSP proxy] Failed to spawn FFmpeg:', error.message);
      this.stopProcess();
    });

    this.ffmpeg.on('close', (code, signal) => {
      if (code && code !== 0) {
        this.logger.warn?.(`[RTSP proxy] FFmpeg exited with code ${code}${signal ? ` (${signal})` : ''}`);
      }

      this.ffmpeg = null;
      this.frameBuffer = Buffer.alloc(0);

      if (this.clients.size > 0 && this.currentRtspUrl) {
        this.scheduleStop();
      }
    });
  }

  handleChunk(chunk) {
    if (!chunk || !chunk.length) {
      return;
    }

    this.frameBuffer = Buffer.concat([this.frameBuffer, chunk]);

    let startIndex = this.frameBuffer.indexOf(JPEG_START);
    let endIndex = startIndex >= 0 ? this.frameBuffer.indexOf(JPEG_END, startIndex + JPEG_START.length) : -1;

    while (startIndex >= 0 && endIndex >= 0) {
      const frame = this.frameBuffer.subarray(startIndex, endIndex + JPEG_END.length);
      this.broadcastFrame(frame);
      this.frameBuffer = this.frameBuffer.subarray(endIndex + JPEG_END.length);
      startIndex = this.frameBuffer.indexOf(JPEG_START);
      endIndex = startIndex >= 0 ? this.frameBuffer.indexOf(JPEG_END, startIndex + JPEG_START.length) : -1;
    }

    if (this.frameBuffer.length > 2 * 1024 * 1024) {
      this.frameBuffer = Buffer.alloc(0);
    }
  }

  broadcastFrame(frame) {
    for (const client of Array.from(this.clients)) {
      if (client.writableEnded || client.destroyed) {
        this.clients.delete(client);
        continue;
      }

      try {
        client.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
        client.write(frame);
        client.write('\r\n');
      } catch (_error) {
        this.clients.delete(client);
      }
    }

    if (this.clients.size === 0) {
      this.scheduleStop();
    }
  }

  removeClient(res) {
    this.clients.delete(res);

    if (this.clients.size === 0) {
      this.scheduleStop();
    }
  }

  scheduleStop() {
    if (this.stopTimer) {
      return;
    }

    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      if (this.clients.size === 0) {
        this.stopProcess();
      }
    }, this.idleShutdownMs);
  }

  clearStopTimer() {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  stopProcess() {
    this.clearStopTimer();

    if (this.ffmpeg && !this.ffmpeg.killed) {
      this.ffmpeg.kill('SIGKILL');
    }

    this.ffmpeg = null;
    this.frameBuffer = Buffer.alloc(0);
    this.currentRtspUrl = '';
  }

  stopAll() {
    for (const client of Array.from(this.clients)) {
      try {
        client.end();
      } catch (_error) {
        // Ignore close errors during cleanup.
      }
    }

    this.clients.clear();
    this.stopProcess();
  }
}

module.exports = RtspCameraProxy;

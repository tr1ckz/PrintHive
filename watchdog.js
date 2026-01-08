const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_CMD = process.env.APP_CMD || 'node simple-server.js';
const RESTART_FLAG = process.env.RESTART_FLAG || '/tmp/restart.flag';
const RESTART_DELAY_MS = parseInt(process.env.RESTART_DELAY_MS || '1000', 10);

let child = null;
let stopping = false;

function startApp() {
  const [cmd, ...args] = APP_CMD.split(' ');
  console.log(`[watchdog] starting app: ${APP_CMD}`);
  child = spawn(cmd, args, { stdio: 'inherit' });

  child.on('exit', (code, signal) => {
    if (stopping) {
      console.log(`[watchdog] child exited (code=${code}, signal=${signal}), shutting down`);
      process.exit(code === null ? 0 : code);
      return;
    }
    console.log(`[watchdog] child exited (code=${code}, signal=${signal}), restarting in ${RESTART_DELAY_MS}ms`);
    setTimeout(() => startApp(), RESTART_DELAY_MS);
  });
}

function stopChild(signal = 'SIGTERM') {
  if (child && !child.killed) {
    console.log(`[watchdog] forwarding ${signal} to child`);
    child.kill(signal);
  }
}

// Handle container signals
process.on('SIGTERM', () => {
  stopping = true;
  stopChild('SIGTERM');
});

process.on('SIGINT', () => {
  stopping = true;
  stopChild('SIGINT');
});

// Support SIGHUP to force restart
process.on('SIGHUP', () => {
  console.log('[watchdog] received SIGHUP, restarting app');
  if (child && !child.killed) child.kill('SIGTERM');
});

// Optional: file-based restart trigger
setInterval(() => {
  try {
    if (fs.existsSync(RESTART_FLAG)) {
      console.log('[watchdog] restart flag detected, restarting app');
      fs.unlinkSync(RESTART_FLAG);
      if (child && !child.killed) child.kill('SIGTERM');
    }
  } catch (e) {
    // ignore
  }
}, 2000);

startApp();

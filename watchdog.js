const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const APP_CMD = process.env.APP_CMD || 'node simple-server.js';
const RESTART_FLAG = process.env.RESTART_FLAG || '/tmp/restart.flag';
const RESTART_DELAY_MS = parseInt(process.env.RESTART_DELAY_MS || '1000', 10);
const RESTART_FLAG_POLL_MS = parseInt(process.env.RESTART_FLAG_POLL_MS || '2000', 10);

let child = null;
let stopping = false;
let restartFlagTimer = null;

function startApp() {
  const [cmd, ...args] = APP_CMD.split(' ');
  logger.info(`[watchdog] starting app: ${APP_CMD}`);
  child = spawn(cmd, args, { stdio: 'inherit' });

  child.on('exit', (code, signal) => {
    if (stopping) {
      logger.info(`[watchdog] child exited (code=${code}, signal=${signal}), shutting down`);
      process.exit(code === null ? 0 : code);
      return;
    }
    logger.warn(`[watchdog] child exited (code=${code}, signal=${signal}), restarting in ${RESTART_DELAY_MS}ms`);
    setTimeout(() => startApp(), RESTART_DELAY_MS);
  });
}

function stopChild(signal = 'SIGTERM') {
  if (child && !child.killed) {
    logger.info(`[watchdog] forwarding ${signal} to child`);
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
  logger.info('[watchdog] received SIGHUP, restarting app');
  if (child && !child.killed) child.kill('SIGTERM');
});

function stopRestartWatcher() {
  if (restartFlagTimer) {
    clearTimeout(restartFlagTimer);
    restartFlagTimer = null;
  }
}

function scheduleRestartFlagCheck(delayMs = RESTART_FLAG_POLL_MS) {
  stopRestartWatcher();

  restartFlagTimer = setTimeout(() => {
    try {
      if (fs.existsSync(RESTART_FLAG)) {
        logger.info('[watchdog] restart flag detected, restarting app');
        fs.unlinkSync(RESTART_FLAG);
        if (child && !child.killed) {
          child.kill('SIGTERM');
        }
      }
    } catch (error) {
      logger.warn('[watchdog] restart flag check failed:', error.message);
    } finally {
      if (!stopping) {
        scheduleRestartFlagCheck(RESTART_FLAG_POLL_MS);
      }
    }
  }, Math.max(250, delayMs));
}

scheduleRestartFlagCheck();
startApp();

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const APP_CMD = process.env.APP_CMD || 'node simple-server.js';
const RESTART_FLAG = process.env.RESTART_FLAG || '/tmp/restart.flag';
const RESTART_DELAY_MS = parseInt(process.env.RESTART_DELAY_MS || '1000', 10);
const RESTART_FLAG_POLL_MS = parseInt(process.env.RESTART_FLAG_POLL_MS || '2000', 10);
// How long the app gets to exit after a signal before it is SIGKILLed. Longer
// than the app's own 10s forced exit, so this only fires if it is truly hung.
const KILL_GRACE_MS = parseInt(process.env.KILL_GRACE_MS || '15000', 10);

let child = null;
let stopping = false;
let restartFlagTimer = null;
let killTimer = null;

// `child.killed` only says a signal was sent, not that the process is gone, so
// liveness is judged by whether an exit has been reported yet.
function isRunning(proc) {
  return Boolean(proc && proc.pid && proc.exitCode === null && proc.signalCode === null);
}

function clearKillTimer() {
  if (killTimer) {
    clearTimeout(killTimer);
    killTimer = null;
  }
}

function startApp() {
  const [cmd, ...args] = APP_CMD.split(' ');
  logger.info(`[watchdog] starting app: ${APP_CMD}`);
  const proc = spawn(cmd, args, { stdio: 'inherit' });
  child = proc;

  // Exactly one of 'exit' / 'error' (spawn failure) ends this child's life.
  let ended = false;
  const onEnded = (describe, code) => {
    if (ended) return;
    ended = true;
    clearKillTimer();

    if (stopping) {
      logger.info(`[watchdog] ${describe}, shutting down`);
      process.exit(code === null ? 0 : code);
      return;
    }
    logger.warn(`[watchdog] ${describe}, restarting in ${RESTART_DELAY_MS}ms`);
    setTimeout(() => startApp(), RESTART_DELAY_MS);
  };

  proc.on('exit', (code, signal) => {
    onEnded(`child exited (code=${code}, signal=${signal})`, code);
  });

  // Without this a failed spawn is an unhandled 'error' event and never
  // produces an 'exit', so the watchdog would crash instead of retrying.
  proc.on('error', (error) => {
    if (isRunning(proc)) {
      logger.warn(`[watchdog] child process error: ${error.message}`);
      return;
    }
    onEnded(`failed to start app (${error.message})`, 1);
  });
}

// Signal the app, then SIGKILL it if it has not exited within the grace period
// so a hung app can never block a restart or a shutdown.
function terminateChild(signal = 'SIGTERM') {
  if (!isRunning(child)) return;

  const proc = child;
  proc.kill(signal);

  if (!killTimer) {
    killTimer = setTimeout(() => {
      killTimer = null;
      if (isRunning(proc)) {
        logger.warn(`[watchdog] child still running ${KILL_GRACE_MS}ms after ${signal}, sending SIGKILL`);
        proc.kill('SIGKILL');
      }
    }, KILL_GRACE_MS);
  }
}

function stopChild(signal = 'SIGTERM') {
  if (!isRunning(child)) {
    // Signalled between an exit and the delayed restart: nothing to wait for.
    process.exit(0);
  }
  logger.info(`[watchdog] forwarding ${signal} to child`);
  terminateChild(signal);
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
  terminateChild('SIGTERM');
});

function stopRestartWatcher() {
  if (restartFlagTimer) {
    clearTimeout(restartFlagTimer);
    restartFlagTimer = null;
  }
}

// Each check schedules the next one only after it has finished, so checks can
// never overlap however long one takes.
function scheduleRestartFlagCheck(delayMs = RESTART_FLAG_POLL_MS) {
  stopRestartWatcher();

  restartFlagTimer = setTimeout(() => {
    try {
      if (fs.existsSync(RESTART_FLAG)) {
        logger.info('[watchdog] restart flag detected, restarting app');
        fs.unlinkSync(RESTART_FLAG);
        terminateChild('SIGTERM');
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

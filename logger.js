const levels = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  WARN: 30,
  ERROR: 40
};

const levelName = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
const threshold = levels[levelName] || levels.INFO;

function ts() {
  return new Date().toISOString();
}

function logAt(level, method, args) {
  if (levels[level] >= threshold) {
    console[method](`[${ts()}] [${level}]`, ...args);
  }
}

module.exports = {
  level: levelName,
  debug: (...args) => logAt('DEBUG', 'log', args),
  info: (...args) => logAt('INFO', 'log', args),
  warn: (...args) => logAt('WARNING', 'warn', args),
  error: (...args) => logAt('ERROR', 'error', args)
};

const levels = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  WARN: 30,
  ERROR: 40
};

let levelName = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
let threshold = levels[levelName] || levels.INFO;

function ts() {
  return new Date().toISOString();
}

function logAt(level, method, args) {
  if (levels[level] >= threshold) {
    console[method](`[${ts()}] [${level}]`, ...args);
  }
}

module.exports = {
  get level() { return levelName; },
  setLevel: (lvl) => {
    const newLvl = String(lvl || '').toUpperCase();
    if (levels[newLvl]) {
      levelName = newLvl;
      threshold = levels[newLvl];
      console.log(`[${new Date().toISOString()}] [INFO] Log level set to ${newLvl}`);
    } else {
      console.log(`[${new Date().toISOString()}] [WARN] Unknown log level '${lvl}', keeping ${levelName}`);
    }
  },
  debug: (...args) => logAt('DEBUG', 'log', args),
  info: (...args) => logAt('INFO', 'log', args),
  warn: (...args) => logAt('WARNING', 'warn', args),
  error: (...args) => logAt('ERROR', 'error', args)
};

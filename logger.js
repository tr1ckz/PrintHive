const levels = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  WARN: 30,
  ERROR: 40,
  SILENT: 100
};

function normalizeLevel(level) {
  const normalized = String(level || '').trim().toUpperCase();

  if (!normalized) {
    return 'INFO';
  }

  if (normalized === 'WARNING') {
    return 'WARN';
  }

  return normalized;
}

let levelName = normalizeLevel(process.env.LOG_LEVEL || 'INFO');
let threshold = levels[levelName] || levels.INFO;
process.env.LOG_LEVEL = levelName;

function ts() {
  return new Date().toISOString();
}

function isLevelEnabled(level) {
  const candidate = normalizeLevel(level);
  return (levels[candidate] || levels.INFO) >= threshold;
}

function logAt(level, method, args) {
  if (!isLevelEnabled(level)) {
    return;
  }

  console[method](`[${ts()}] [${normalizeLevel(level)}]`, ...args);
}

module.exports = {
  get level() { return levelName; },
  isLevelEnabled,
  setLevel: (lvl) => {
    const newLvl = normalizeLevel(lvl);
    if (levels[newLvl]) {
      levelName = newLvl;
      threshold = levels[newLvl];
      process.env.LOG_LEVEL = newLvl;
      console.log(`[${ts()}] [INFO] Log level set to ${newLvl}`);
    } else {
      console.log(`[${ts()}] [WARN] Unknown log level '${lvl}', keeping ${levelName}`);
    }
  },
  debug: (...args) => logAt('DEBUG', 'log', args),
  info: (...args) => logAt('INFO', 'log', args),
  warn: (...args) => logAt('WARN', 'warn', args),
  error: (...args) => logAt('ERROR', 'error', args)
};

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { dataDir, libraryDir, videosDir } = require('../database');

const PORT = process.env.PORT || 3000;
const BCRYPT_ROUNDS = 12;

const isBcryptHash = (value) => typeof value === 'string' && /^\$2[aby]\$/.test(value);

// Session secret precedence: env var > persisted random secret. The secret
// file keeps sessions valid across restarts without requiring configuration.
function loadSessionSecret() {
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }
  const secretFile = path.join(dataDir, 'session-secret');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing) return existing;
  } catch { /* first boot */ }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  console.log('Generated new session secret at', secretFile);
  return secret;
}

function getBambuApiBase(region = 'global') {
  return region === 'china' ? 'https://api.bambulab.cn' : 'https://api.bambulab.com';
}

module.exports = {
  PORT,
  BCRYPT_ROUNDS,
  isBcryptHash,
  dataDir,
  libraryDir,
  videosDir,
  loadSessionSecret,
  getBambuApiBase,
};

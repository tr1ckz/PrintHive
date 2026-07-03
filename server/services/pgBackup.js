// PostgreSQL backup/restore helpers used by the database backup/restore
// endpoints. The application database lives in PostgreSQL, so backups capture a
// `pg_dump` (custom format) alongside the media files, and restores replay it
// with `pg_restore`. Requires the PostgreSQL client tools (pg_dump/pg_restore)
// to be available on PATH — see the Dockerfile (postgresql-client).
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { pgConfig } = require('../../database');

// Filename of the database dump stored inside a backup archive.
const DUMP_FILENAME = 'printhive_pg.dump';

const MAX_BUFFER = 256 * 1024 * 1024; // allow large notices/output

function connectionArgs() {
  return [
    '-h', pgConfig.host,
    '-p', String(pgConfig.port),
    '-U', pgConfig.user,
    '-d', pgConfig.database,
  ];
}

function childEnv() {
  return { ...process.env, PGPASSWORD: pgConfig.password };
}

// Write a custom-format dump of the current database to `filePath`.
async function dumpToFile(filePath) {
  await execFileAsync(
    'pg_dump',
    [...connectionArgs(), '--format=custom', '--no-owner', '--no-privileges', '--file', filePath],
    { env: childEnv(), maxBuffer: MAX_BUFFER }
  );
  return filePath;
}

// Restore a custom-format dump, dropping existing objects first. pg_restore may
// exit non-zero on benign "does not exist" notices when --clean runs against a
// partially-populated database; those are surfaced but not fatal on their own.
async function restoreFromFile(filePath) {
  try {
    await execFileAsync(
      'pg_restore',
      [...connectionArgs(), '--clean', '--if-exists', '--no-owner', '--no-privileges', filePath],
      { env: childEnv(), maxBuffer: MAX_BUFFER }
    );
  } catch (err) {
    // pg_restore returns non-zero when it emits warnings. Re-throw only if the
    // dump could not be read / connection failed; otherwise log and continue.
    const msg = String(err.stderr || err.message || '');
    if (/could not|connection|fatal|no such file/i.test(msg) && !/warning|already exists|does not exist/i.test(msg)) {
      throw err;
    }
    console.warn('pg_restore completed with warnings:', msg.split('\n').slice(0, 5).join(' | '));
  }
}

module.exports = { DUMP_FILENAME, dumpToFile, restoreFromFile };

const { Pool, types: pgTypes } = require('pg');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

// node-postgres returns int8/bigint and COUNT() results as strings (to avoid
// precision loss). SQLite returned them as JS numbers, and the app relies on
// numeric semantics (counts, ids). All values here fit in a JS safe integer, so
// parse int8 (OID 20) back to Number to preserve the previous behavior.
pgTypes.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));

// Ensure data directory exists (PRINTHIVE_DATA_DIR/PRINTHIVE_LIBRARY_DIR let
// tests and alternate deployments relocate all mutable state)
const dataDir = process.env.PRINTHIVE_DATA_DIR
  ? path.resolve(process.env.PRINTHIVE_DATA_DIR)
  : path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure library directory exists
const libraryDir = process.env.PRINTHIVE_LIBRARY_DIR
  ? path.resolve(process.env.PRINTHIVE_LIBRARY_DIR)
  : path.join(__dirname, 'library');
if (!fs.existsSync(libraryDir)) {
  fs.mkdirSync(libraryDir, { recursive: true });
}

// Ensure videos directory exists
const videosDir = path.join(dataDir, 'videos');
if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir, { recursive: true });
}

// Ensure backups directory exists
const backupsDir = path.join(dataDir, 'backups');
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
  console.log('Created backups directory:', backupsDir);
}

// ---------------------------------------------------------------------------
// PostgreSQL connection configuration
// ---------------------------------------------------------------------------
// PrintHive uses PostgreSQL as its primary datastore. The following environment
// variables are REQUIRED; the app refuses to boot without them.
//   PG_HOST      host or host:port (e.g. "10.0.0.5" or "10.0.0.5:5432")
//   PG_USER      database user
//   PG_PASSWORD  database password (masked in logs)
//   PG_DB        database name
function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. PrintHive requires PostgreSQL; ` +
      `set PG_HOST, PG_USER, PG_PASSWORD and PG_DB.`
    );
  }
  return String(value).trim();
}

function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 2) return '*'.repeat(value.length);
  return value[0] + '*'.repeat(Math.max(1, value.length - 2)) + value[value.length - 1];
}

const PG_HOST_RAW = requireEnv('PG_HOST');
let pgHost = PG_HOST_RAW;
let pgPort = 5432;
if (PG_HOST_RAW.includes(':')) {
  const idx = PG_HOST_RAW.lastIndexOf(':');
  pgHost = PG_HOST_RAW.slice(0, idx).trim();
  const parsedPort = parseInt(PG_HOST_RAW.slice(idx + 1), 10);
  if (!Number.isNaN(parsedPort)) pgPort = parsedPort;
}
const PG_USER = requireEnv('PG_USER');
const PG_PASSWORD = requireEnv('PG_PASSWORD');
const PG_DB = requireEnv('PG_DB');
// Optional schema override (used for test isolation); defaults to "public".
const PG_SCHEMA = (process.env.PG_SCHEMA || 'public').replace(/[^a-zA-Z0-9_]/g, '') || 'public';

console.log(
  `PostgreSQL: postgres://${PG_USER}:${maskSecret(PG_PASSWORD)}@${pgHost}:${pgPort}/${PG_DB}` +
  (PG_SCHEMA !== 'public' ? ` (schema: ${PG_SCHEMA})` : '')
);

const pool = new Pool({
  host: pgHost,
  port: pgPort,
  user: PG_USER,
  password: PG_PASSWORD,
  database: PG_DB,
  max: 10,
  idleTimeoutMillis: 30000,
  // Pin the search_path for every connection at startup (reliable, unlike a
  // 'connect' event handler which the pool does not await).
  options: `-c search_path=${PG_SCHEMA}`,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

// Expose parsed connection settings so other subsystems (e.g. pg_dump based
// backup/restore) can reuse them without re-parsing the environment.
const pgConfig = { host: pgHost, port: pgPort, user: PG_USER, password: PG_PASSWORD, database: PG_DB };

// ---------------------------------------------------------------------------
// Identifier case handling
// ---------------------------------------------------------------------------
// SQLite preserves the exact case of column names; PostgreSQL folds unquoted
// identifiers to lower case. The application reads columns back as camelCase
// (e.g. row.modelId). We keep DDL/queries unquoted (so camelCase folds to and
// matches the lower-case columns) and remap result keys back to camelCase on
// read using this map. Snake_case columns are unaffected.
const CAMEL_COLUMNS = [
  // prints
  'designId', 'designTitle', 'instanceId', 'modelId', 'coverLocal', 'videoUrl',
  'videoLocal', 'feedbackStatus', 'startTime', 'endTime', 'costTime', 'profileId',
  'plateIndex', 'plateName', 'deviceId', 'deviceModel', 'deviceName', 'bedType',
  'jobType', 'isPublicProfile', 'isPrintable', 'isDelete', 'amsDetailMapping',
  'stepSummary', 'nozzleInfos', 'snapShot', 'createdAt', 'updatedAt',
  // files / library
  'fileName', 'fileType', 'fileSize', 'filePath', 'downloadUrl', 'downloadedAt',
  'originalName', 'thumbnailPath', 'fileHash',
  // computed aliases used in the app
  'tagNames',
];
const KEY_MAP = new Map(CAMEL_COLUMNS.map((c) => [c.toLowerCase(), c]));

function remapRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const key of Object.keys(row)) {
    out[KEY_MAP.get(key) || key] = row[key];
  }
  return out;
}

// ---------------------------------------------------------------------------
// SQLite -> PostgreSQL statement translation
// ---------------------------------------------------------------------------
// Tables whose INSERTs must not receive an automatic "RETURNING id" clause
// (no serial "id" column).
const NO_ID_TABLES = new Set(['config', 'model_tags', 'library_tags']);
// Conflict targets used to translate "INSERT OR REPLACE" upserts.
const CONFLICT_TARGETS = { config: ['key'], library_shares: ['share_hash'] };

// Replace occurrences of `pattern` in SQL while skipping single-quoted string
// literals (so placeholders/keywords inside strings are left untouched).
function replaceOutsideStrings(sql, pattern, replacer) {
  let result = '';
  let inString = false;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (inString) {
      result += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") { result += sql[i + 1]; i += 2; continue; }
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === "'") { inString = true; result += ch; i += 1; continue; }
    pattern.lastIndex = i;
    const m = pattern.exec(sql);
    if (m && m.index === i) {
      result += replacer(m);
      i += m[0].length;
      continue;
    }
    result += ch;
    i += 1;
  }
  return result;
}

function normalizeValue(v) {
  return v === undefined ? null : v;
}

// Translate SQLite dialect constructs that are not valid PostgreSQL.
function translateDialect(sql) {
  let text = sql;

  // INSERT OR REPLACE INTO <table> (cols) ...  -> upsert via ON CONFLICT
  const orReplace = text.match(/^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+"?(\w+)"?\s*\(([^)]+)\)/i);
  if (orReplace) {
    const table = orReplace[1].toLowerCase();
    const cols = orReplace[2].split(',').map((c) => c.trim().replace(/"/g, ''));
    const target = CONFLICT_TARGETS[table];
    if (!target) {
      throw new Error(`No ON CONFLICT target configured for INSERT OR REPLACE INTO ${table}`);
    }
    const targetLower = target.map((t) => t.toLowerCase());
    const setCols = cols.filter((c) => !targetLower.includes(c.toLowerCase()));
    const setClause = setCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    text = text.replace(/^\s*INSERT\s+OR\s+REPLACE\s+INTO/i, 'INSERT INTO');
    text += ` ON CONFLICT (${target.join(', ')}) DO UPDATE SET ${setClause}`;
  }

  // INSERT OR IGNORE INTO ... -> INSERT ... ON CONFLICT DO NOTHING
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(text)) {
    text = text.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');
    if (!/ON\s+CONFLICT/i.test(text)) text += ' ON CONFLICT DO NOTHING';
  }

  // GROUP_CONCAT(expr) / GROUP_CONCAT(DISTINCT expr) -> string_agg(expr::text, ',')
  text = text.replace(/GROUP_CONCAT\(\s*(DISTINCT\s+)?([^()]+?)\s*\)/gi,
    (full, distinct, expr) => `string_agg(${distinct ? 'DISTINCT ' : ''}(${expr})::text, ',')`);

  return text;
}

// Translate a SQLite statement + better-sqlite3 style args into a pg query.
function translate(sql, args) {
  const values = [];
  let text = sql;

  // Only '@name' / '$name' are treated as named placeholders. ':' is excluded
  // so it never collides with PostgreSQL '::type' cast syntax.
  const namedPlaceholder = /[@$][a-zA-Z_][a-zA-Z0-9_]*/;
  const isNamed = args.length === 1 && args[0] !== null && typeof args[0] === 'object'
    && !Array.isArray(args[0]) && !(args[0] instanceof Date) && !Buffer.isBuffer(args[0])
    && namedPlaceholder.test(sql);

  if (isNamed) {
    const obj = args[0];
    const seen = new Map();
    text = replaceOutsideStrings(text, /[@$]([a-zA-Z_][a-zA-Z0-9_]*)/g, (m) => {
      const name = m[1];
      if (!seen.has(name)) {
        values.push(normalizeValue(obj[name]));
        seen.set(name, values.length);
      }
      return '$' + seen.get(name);
    });
  } else {
    const flat = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    let idx = 0;
    text = replaceOutsideStrings(text, /\?/g, () => {
      values.push(normalizeValue(flat[idx]));
      idx += 1;
      return '$' + idx;
    });
  }

  text = translateDialect(text);
  return { text, values };
}

// ---------------------------------------------------------------------------
// better-sqlite3 compatible async database facade over pg
// ---------------------------------------------------------------------------
let readyResolve;
const ready = new Promise((resolve) => { readyResolve = resolve; });
let readySignalled = false;
function signalReady() {
  if (!readySignalled) { readySignalled = true; readyResolve(); }
}

// Raw query helper used during initialization (does not wait on `ready`).
function rawQuery(text, values) {
  return pool.query(text, values);
}

const db = {
  async query(text, values) {
    await ready;
    return pool.query(text, values);
  },
  prepare(sql) {
    return {
      async get(...args) {
        await ready;
        const { text, values } = translate(sql, args);
        const res = await pool.query(text, values);
        return remapRow(res.rows[0]);
      },
      async all(...args) {
        await ready;
        const { text, values } = translate(sql, args);
        const res = await pool.query(text, values);
        return res.rows.map(remapRow);
      },
      async run(...args) {
        await ready;
        let { text, values } = translate(sql, args);
        const insertMatch = text.match(/^\s*INSERT\s+INTO\s+"?(\w+)"?/i);
        if (insertMatch && !/RETURNING/i.test(text)) {
          const table = insertMatch[1].toLowerCase();
          if (!NO_ID_TABLES.has(table)) text += ' RETURNING id';
        }
        const res = await pool.query(text, values);
        let lastInsertRowid;
        if (res.rows && res.rows[0] && Object.prototype.hasOwnProperty.call(res.rows[0], 'id')) {
          lastInsertRowid = res.rows[0].id;
        }
        return { changes: res.rowCount, lastInsertRowid };
      },
    };
  },
  async exec(sql) {
    await ready;
    return pool.query(sql);
  },
  // SQLite PRAGMAs have no PostgreSQL equivalent; treated as no-ops.
  pragma() { return []; },
  // Close the connection pool (used on graceful shutdown).
  close() { return pool.end(); },
};

// ---------------------------------------------------------------------------
// Schema (PostgreSQL dialect)
// ---------------------------------------------------------------------------
// Notes:
//  * Identifiers are left unquoted so camelCase folds to lower case, matching
//    the application's unquoted queries; results are remapped back to camelCase.
//  * SQLite did not enforce foreign keys (PRAGMA foreign_keys defaults OFF and
//    is never enabled), so we intentionally omit FK constraints to preserve the
//    exact same (non-enforcing) behavior and to avoid migration failures on
//    pre-existing orphan rows.
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT,
    email TEXT UNIQUE,
    oauth_provider TEXT,
    oauth_id TEXT,
    role TEXT DEFAULT 'user',
    display_name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    bambu_email TEXT,
    bambu_token TEXT,
    bambu_region TEXT DEFAULT 'global',
    printer_ip TEXT,
    printer_access_code TEXT,
    camera_rtsp_url TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS prints (
    id BIGINT PRIMARY KEY,
    designId BIGINT,
    designTitle TEXT,
    instanceId BIGINT,
    modelId TEXT UNIQUE,
    title TEXT,
    cover TEXT,
    coverLocal TEXT,
    videoUrl TEXT,
    videoLocal TEXT,
    status INTEGER,
    feedbackStatus INTEGER,
    startTime TEXT,
    endTime TEXT,
    weight REAL,
    length INTEGER,
    costTime INTEGER,
    profileId BIGINT,
    plateIndex INTEGER,
    plateName TEXT,
    deviceId TEXT,
    deviceModel TEXT,
    deviceName TEXT,
    bedType TEXT,
    jobType INTEGER,
    mode TEXT,
    isPublicProfile INTEGER,
    isPrintable INTEGER,
    isDelete INTEGER,
    amsDetailMapping TEXT,
    material TEXT,
    platform TEXT,
    stepSummary TEXT,
    nozzleInfos TEXT,
    snapShot TEXT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_prints_modelId ON prints(modelId);
  CREATE INDEX IF NOT EXISTS idx_prints_status ON prints(status);
  CREATE INDEX IF NOT EXISTS idx_prints_startTime ON prints(startTime);
  CREATE INDEX IF NOT EXISTS idx_prints_designTitle ON prints(designTitle);
  CREATE INDEX IF NOT EXISTS idx_prints_deviceName ON prints(deviceName);

  CREATE TABLE IF NOT EXISTS files (
    id SERIAL PRIMARY KEY,
    modelId TEXT NOT NULL,
    fileName TEXT NOT NULL,
    fileType TEXT,
    fileSize INTEGER,
    filePath TEXT,
    downloadUrl TEXT,
    downloadedAt TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_files_modelId ON files(modelId);

  CREATE TABLE IF NOT EXISTS library (
    id SERIAL PRIMARY KEY,
    fileName TEXT NOT NULL,
    originalName TEXT NOT NULL,
    fileType TEXT NOT NULL,
    fileSize INTEGER,
    filePath TEXT NOT NULL,
    thumbnailPath TEXT,
    description TEXT,
    tags TEXT,
    fileHash TEXT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_library_fileName ON library(fileName);
  CREATE INDEX IF NOT EXISTS idx_library_fileType ON library(fileType);
  CREATE INDEX IF NOT EXISTS idx_library_createdAt ON library(createdAt);
  CREATE INDEX IF NOT EXISTS idx_library_fileHash ON library(fileHash);

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tags (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

  CREATE TABLE IF NOT EXISTS model_tags (
    model_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (model_id, tag_id)
  );

  CREATE INDEX IF NOT EXISTS idx_model_tags_model ON model_tags(model_id);
  CREATE INDEX IF NOT EXISTS idx_model_tags_tag ON model_tags(tag_id);

  CREATE TABLE IF NOT EXISTS library_tags (
    library_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (library_id, tag_id)
  );

  CREATE INDEX IF NOT EXISTS idx_library_tags_library ON library_tags(library_id);
  CREATE INDEX IF NOT EXISTS idx_library_tags_tag ON library_tags(tag_id);

  CREATE TABLE IF NOT EXISTS problems (
    id SERIAL PRIMARY KEY,
    model_id INTEGER,
    print_id INTEGER,
    problem_type TEXT NOT NULL,
    severity TEXT DEFAULT 'warning',
    message TEXT,
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_problems_model ON problems(model_id);
  CREATE INDEX IF NOT EXISTS idx_problems_print ON problems(print_id);
  CREATE INDEX IF NOT EXISTS idx_problems_type ON problems(problem_type);
  CREATE INDEX IF NOT EXISTS idx_problems_resolved ON problems(resolved_at);

  CREATE TABLE IF NOT EXISTS library_shares (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL,
    share_hash TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    accessed_count INTEGER DEFAULT 0,
    last_accessed TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_library_shares_hash ON library_shares(share_hash);
  CREATE INDEX IF NOT EXISTS idx_library_shares_model ON library_shares(model_id);

  CREATE TABLE IF NOT EXISTS maintenance_tasks (
    id SERIAL PRIMARY KEY,
    printer_id TEXT,
    task_name TEXT NOT NULL,
    task_type TEXT NOT NULL,
    description TEXT,
    interval_hours INTEGER DEFAULT 100,
    last_performed TIMESTAMP,
    next_due TIMESTAMP,
    hours_until_due REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_maintenance_printer ON maintenance_tasks(printer_id);
  CREATE INDEX IF NOT EXISTS idx_maintenance_next_due ON maintenance_tasks(next_due);
  CREATE INDEX IF NOT EXISTS idx_maintenance_type ON maintenance_tasks(task_type);

  CREATE TABLE IF NOT EXISTS maintenance_history (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL,
    task_name TEXT NOT NULL,
    printer_id TEXT,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    print_hours_at_completion REAL,
    notes TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_maintenance_history_task ON maintenance_history(task_id);
  CREATE INDEX IF NOT EXISTS idx_maintenance_history_date ON maintenance_history(completed_at);

  CREATE TABLE IF NOT EXISTS printers (
    id SERIAL PRIMARY KEY,
    dev_id TEXT UNIQUE NOT NULL,
    name TEXT,
    ip_address TEXT,
    access_code TEXT,
    serial_number TEXT,
    camera_rtsp_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_printers_dev_id ON printers(dev_id);

  CREATE TABLE IF NOT EXISTS bambu_accounts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    region TEXT DEFAULT 'global',
    token TEXT,
    is_primary INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_bambu_accounts_user ON bambu_accounts(user_id);

  CREATE TABLE IF NOT EXISTS filament_inventory (
    id SERIAL PRIMARY KEY,
    tray_uuid TEXT,
    brand TEXT,
    material TEXT,
    color_name TEXT,
    color_hex TEXT,
    filament_code TEXT,
    remain_percent INTEGER,
    capacity_g INTEGER DEFAULT 1000,
    remaining_g INTEGER,
    source TEXT DEFAULT 'ams',
    last_dev_id TEXT,
    is_archived INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- One row per physical RFID spool. Partial unique index so many manual rows
  -- (tray_uuid NULL/'') can coexist while genuine Bambu spools stay de-duped.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_filament_inventory_uuid
    ON filament_inventory(tray_uuid)
    WHERE tray_uuid IS NOT NULL AND tray_uuid != '';
`;

// Tables copied during a SQLite -> PostgreSQL migration, in an order that keeps
// logically-referenced rows available first (FKs are not enforced, so order is
// only cosmetic). Each table with a serial "id" also gets its sequence reset.
const MIGRATION_TABLES = [
  { name: 'users', serial: true },
  { name: 'printers', serial: true },
  { name: 'tags', serial: true },
  { name: 'library', serial: true },
  { name: 'prints', serial: false },
  { name: 'files', serial: true },
  { name: 'config', serial: false },
  { name: 'settings', serial: true },
  { name: 'bambu_accounts', serial: true },
  { name: 'model_tags', serial: false },
  { name: 'library_tags', serial: false },
  { name: 'problems', serial: true },
  { name: 'library_shares', serial: true },
  { name: 'maintenance_tasks', serial: true },
  { name: 'maintenance_history', serial: true },
  { name: 'filament_inventory', serial: true },
];

async function tableExists(name) {
  const res = await rawQuery(
    `SELECT to_regclass($1) AS reg`, [name]
  );
  return res.rows[0] && res.rows[0].reg !== null;
}

async function getColumns(table) {
  const res = await rawQuery(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $2 AND table_name = $1`,
    [table, PG_SCHEMA]
  );
  return res.rows.map((r) => r.column_name); // lower-cased by PostgreSQL
}

async function createSchema() {
  await rawQuery(SCHEMA_SQL);
}

// Copy every row of every known table from a SQLite database into PostgreSQL.
async function migrateFromSqlite(sqlitePath) {
  const Database = require('better-sqlite3');
  const sdb = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const summary = {};
  const client = await pool.connect();
  try {
    const sqliteTables = new Set(
      sdb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
    );

    for (const { name, serial } of MIGRATION_TABLES) {
      if (!sqliteTables.has(name)) continue;

      const rows = sdb.prepare(`SELECT * FROM ${name}`).all();
      // Intersect SQLite columns with the PostgreSQL columns (case-insensitive).
      const pgCols = await getColumns(name); // lower-case
      const pgColSet = new Set(pgCols);

      let inserted = 0;
      await client.query('BEGIN');
      try {
        for (const row of rows) {
          const cols = [];
          const params = [];
          const placeholders = [];
          for (const key of Object.keys(row)) {
            const lower = key.toLowerCase();
            if (!pgColSet.has(lower)) continue;
            cols.push(lower);
            params.push(row[key]);
            placeholders.push('$' + params.length);
          }
          if (cols.length === 0) continue;
          await client.query(
            `INSERT INTO ${name} (${cols.join(', ')}) VALUES (${placeholders.join(', ')})
             ON CONFLICT DO NOTHING`,
            params
          );
          inserted += 1;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Failed migrating table "${name}": ${err.message}`);
      }

      // Reset the serial sequence so future inserts don't collide with copied ids.
      if (serial) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, 'id'),
             GREATEST(COALESCE((SELECT MAX(id) FROM ${name}), 0), 1),
             (SELECT COUNT(*) FROM ${name}) > 0)`,
          [name]
        );
      }

      summary[name] = { source: rows.length, inserted };
      console.log(`  • ${name}: ${inserted}/${rows.length} rows migrated`);
    }
  } finally {
    client.release();
    sdb.close();
  }
  return summary;
}

// Verify the migration by comparing row counts between SQLite and PostgreSQL.
async function verifyMigration(sqlitePath) {
  const Database = require('better-sqlite3');
  const sdb = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const problems = [];
  try {
    const sqliteTables = new Set(
      sdb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
    );
    for (const { name } of MIGRATION_TABLES) {
      if (!sqliteTables.has(name)) continue;
      const srcCount = sdb.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get().c;
      const dstRes = await rawQuery(`SELECT COUNT(*)::int AS c FROM ${name}`);
      const dstCount = dstRes.rows[0].c;
      if (dstCount < srcCount) {
        problems.push(`${name}: source=${srcCount} postgres=${dstCount}`);
      }
    }
  } finally {
    sdb.close();
  }
  return problems;
}

async function ensureAdminUser() {
  const res = await rawQuery('SELECT COUNT(*)::int AS count FROM users');
  if (res.rows[0].count === 0) {
    const bcrypt = require('bcryptjs');
    await rawQuery(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
      ['admin', bcrypt.hashSync('admin', 12), 'superadmin']
    );
    console.log('✓ Created default superadmin user (username: admin, password: admin)');
    return;
  }
  // Ensure admin user is always superadmin
  try {
    const adminRes = await rawQuery('SELECT id, role FROM users WHERE username = $1', ['admin']);
    const adminUser = adminRes.rows[0];
    if (adminUser) {
      console.log(`Current admin user role: ${adminUser.role}`);
      if (adminUser.role !== 'superadmin') {
        await rawQuery('UPDATE users SET role = $1 WHERE username = $2', ['superadmin', 'admin']);
        console.log('✓ Upgraded admin user to superadmin');
      } else {
        console.log('✓ Admin user already has superadmin role');
      }
    }
  } catch (e) {
    console.error('Error checking admin user:', e.message);
  }
}

let initPromise = null;
async function initDatabase() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    // Fail fast with a clear message if PostgreSQL is unreachable.
    try {
      await rawQuery('SELECT 1');
    } catch (err) {
      throw new Error(`Cannot connect to PostgreSQL at ${pgHost}:${pgPort}: ${err.message}`);
    }

    if (PG_SCHEMA !== 'public') {
      await rawQuery(`CREATE SCHEMA IF NOT EXISTS "${PG_SCHEMA}"`);
    }
    const hadSchema = await tableExists('users');
    await createSchema(); // idempotent (CREATE TABLE IF NOT EXISTS ...)

    if (!hadSchema) {
      const sqlitePath = path.join(dataDir, 'printhive.db');
      if (fs.existsSync(sqlitePath)) {
        console.log('Empty PostgreSQL schema detected — migrating data from SQLite...');
        await migrateFromSqlite(sqlitePath);

        const problems = await verifyMigration(sqlitePath);
        if (problems.length > 0) {
          throw new Error('SQLite -> PostgreSQL migration verification failed:\n  ' + problems.join('\n  '));
        }
        console.log('✓ Migration verified (row counts match)');

        // Archive the SQLite database now that PostgreSQL is the source of truth.
        for (const suffix of ['', '-wal', '-shm']) {
          const from = sqlitePath + suffix;
          if (fs.existsSync(from)) {
            const to = sqlitePath + suffix + '.BK';
            try {
              fs.renameSync(from, to);
              console.log(`✓ Archived ${path.basename(from)} -> ${path.basename(to)}`);
            } catch (err) {
              console.error(`Failed to archive ${from}:`, err.message);
            }
          }
        }
      } else {
        console.log('Fresh PostgreSQL database — no SQLite data to migrate.');
      }
    }

    await ensureAdminUser();
    signalReady();
    console.log('✓ PostgreSQL database ready');
    return true;
  })();
  return initPromise;
}

// Kick off initialization eagerly; db.* calls await `ready` regardless.
initDatabase().catch((err) => {
  console.error('FATAL: database initialization failed:', err.message);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Prepared-statement SQL (executed through the async facade)
// ---------------------------------------------------------------------------
// Upsert that preserves existing videoLocal/coverLocal on cloud resync.
const UPSERT_PRINT_SQL = `
  INSERT INTO prints (
    id, designId, designTitle, instanceId, modelId, title, cover, coverLocal, videoUrl, videoLocal, status,
    feedbackStatus, startTime, endTime, weight, length, costTime, profileId,
    plateIndex, plateName, deviceId, deviceModel, deviceName, bedType,
    jobType, mode, isPublicProfile, isPrintable, isDelete, amsDetailMapping,
    material, platform, stepSummary, nozzleInfos, snapShot, createdAt, updatedAt
  ) VALUES (
    @id, @designId, @designTitle, @instanceId, @modelId, @title, @cover, @coverLocal, @videoUrl, @videoLocal, @status,
    @feedbackStatus, @startTime, @endTime, @weight, @length, @costTime, @profileId,
    @plateIndex, @plateName, @deviceId, @deviceModel, @deviceName, @bedType,
    @jobType, @mode, @isPublicProfile, @isPrintable, @isDelete, @amsDetailMapping,
    @material, @platform, @stepSummary, @nozzleInfos, @snapShot, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
  ON CONFLICT(modelId) DO UPDATE SET
    id = excluded.id,
    designId = excluded.designId,
    designTitle = excluded.designTitle,
    instanceId = excluded.instanceId,
    title = excluded.title,
    cover = excluded.cover,
    videoUrl = excluded.videoUrl,
    status = excluded.status,
    feedbackStatus = excluded.feedbackStatus,
    startTime = excluded.startTime,
    endTime = excluded.endTime,
    weight = excluded.weight,
    length = excluded.length,
    costTime = excluded.costTime,
    profileId = excluded.profileId,
    plateIndex = excluded.plateIndex,
    plateName = excluded.plateName,
    deviceId = excluded.deviceId,
    deviceModel = excluded.deviceModel,
    deviceName = excluded.deviceName,
    bedType = excluded.bedType,
    jobType = excluded.jobType,
    mode = excluded.mode,
    isPublicProfile = excluded.isPublicProfile,
    isPrintable = excluded.isPrintable,
    isDelete = excluded.isDelete,
    amsDetailMapping = excluded.amsDetailMapping,
    material = excluded.material,
    platform = excluded.platform,
    stepSummary = excluded.stepSummary,
    nozzleInfos = excluded.nozzleInfos,
    snapShot = excluded.snapShot,
    updatedAt = CURRENT_TIMESTAMP,
    videoLocal = COALESCE(prints.videoLocal, excluded.videoLocal),
    coverLocal = COALESCE(prints.coverLocal, excluded.coverLocal)
`;

const INSERT_FILE_SQL = `
  INSERT INTO files (modelId, fileName, fileType, fileSize, filePath, downloadUrl, downloadedAt)
  VALUES (@modelId, @fileName, @fileType, @fileSize, @filePath, @downloadUrl, CURRENT_TIMESTAMP)
`;

// Helper functions
async function storePrint(printData) {
  const data = {
    id: printData.id,
    designId: printData.designId || null,
    designTitle: printData.designTitle || null,
    instanceId: printData.instanceId || null,
    modelId: printData.modelId,
    title: printData.title || null,
    cover: printData.cover || null,
    videoUrl: printData.videoUrl || null,
    videoLocal: printData.videoLocal || null,
    coverLocal: printData.coverLocal || null,
    status: printData.status,
    feedbackStatus: printData.feedbackStatus || null,
    startTime: printData.startTime || null,
    endTime: printData.endTime || null,
    weight: printData.weight || null,
    length: printData.length || null,
    costTime: printData.costTime || null,
    profileId: printData.profileId || null,
    plateIndex: printData.plateIndex || null,
    plateName: printData.plateName || null,
    deviceId: printData.deviceId || null,
    deviceModel: printData.deviceModel || null,
    deviceName: printData.deviceName || null,
    bedType: printData.bedType || null,
    jobType: printData.jobType || null,
    mode: printData.mode || null,
    isPublicProfile: printData.isPublicProfile ? 1 : 0,
    isPrintable: printData.isPrintable ? 1 : 0,
    isDelete: printData.isDelete ? 1 : 0,
    amsDetailMapping: JSON.stringify(printData.amsDetailMapping || []),
    material: JSON.stringify(printData.material || {}),
    platform: printData.platform || null,
    stepSummary: JSON.stringify(printData.stepSummary || []),
    nozzleInfos: JSON.stringify(printData.nozzleInfos || []),
    snapShot: printData.snapShot || null
  };

  return db.prepare(UPSERT_PRINT_SQL).run(data);
}

async function storePrints(printsArray) {
  let newPrints = 0;
  let updated = 0;

  for (const print of printsArray) {
    const existing = await getPrintByModelIdFromDb(print.modelId);
    if (existing) {
      updated++;
    } else {
      newPrints++;
    }
    await storePrint(print);
  }

  return { newPrints, updated, total: printsArray.length };
}

async function getAllPrintsFromDb() {
  const prints = await db.prepare('SELECT * FROM prints ORDER BY startTime DESC').all();
  return Promise.all(prints.map(parsePrint));
}

async function searchPrintsInDb(searchTerm = '', status = null) {
  const search = searchTerm ? `%${searchTerm}%` : '%';
  const prints = await db.prepare(`
    SELECT * FROM prints
    WHERE (designTitle LIKE @search OR title LIKE @search OR deviceName LIKE @search)
    AND (@status::int IS NULL OR status = @status::int)
    ORDER BY startTime DESC
  `).all({ search, status: status !== null ? status : null });
  return Promise.all(prints.map(parsePrint));
}

async function getPrintByIdFromDb(id) {
  const print = await db.prepare('SELECT * FROM prints WHERE id = ?').get(id);
  return print ? parsePrint(print) : null;
}

async function getPrintByModelIdFromDb(modelId) {
  const print = await db.prepare('SELECT * FROM prints WHERE modelId = ?').get(modelId);
  return print ? parsePrint(print) : null;
}

async function parsePrint(dbRow) {
  // Check if cover image exists locally in data/cover-cache
  const coverCacheDir = path.join(__dirname, 'data', 'cover-cache');

  let coverUrl = null; // Default to null if no local cover exists
  const jpgPath = path.join(coverCacheDir, `${dbRow.modelId}.jpg`);
  const pngPath = path.join(coverCacheDir, `${dbRow.modelId}.png`);

  if (fs.existsSync(jpgPath)) {
    coverUrl = `/images/covers/${dbRow.modelId}.jpg`;
  } else if (fs.existsSync(pngPath)) {
    coverUrl = `/images/covers/${dbRow.modelId}.png`;
  }
  // Don't use expired AWS URLs as fallback

  // Check if 3mf file exists locally (from cloud downloads)
  const files = await db.prepare('SELECT * FROM files WHERE modelId = ?').all(dbRow.modelId);
  const has3mf = files.some(f => f.fileType === '3mf' || f.fileName.endsWith('.3mf'));

  // Check if video exists locally (from printer FTP or cloud)
  let hasVideo = false;
  if (dbRow.videoLocal) {
    // Try the path as-is first
    let videoPath = path.join(videosDir, dbRow.videoLocal);
    hasVideo = fs.existsSync(videoPath);

    // If not found, try just the filename (in case it was stored with a path)
    if (!hasVideo) {
      const justFilename = path.basename(dbRow.videoLocal);
      videoPath = path.join(videosDir, justFilename);
      hasVideo = fs.existsSync(videoPath);
    }
  }

  return {
    ...dbRow,
    coverUrl: coverUrl, // Add coverUrl field for frontend
    has3mf: has3mf, // Flag indicating if 3mf file is available
    hasVideo: hasVideo, // Flag indicating if video file is available
    filamentUsed: JSON.parse(dbRow.amsDetailMapping || '[]'), // Add filamentUsed for statistics
    amsDetailMapping: JSON.parse(dbRow.amsDetailMapping || '[]'),
    material: JSON.parse(dbRow.material || '{}'),
    stepSummary: JSON.parse(dbRow.stepSummary || '[]'),
    nozzleInfos: JSON.parse(dbRow.nozzleInfos || '[]'),
    isPublicProfile: dbRow.isPublicProfile === 1,
    isPrintable: dbRow.isPrintable === 1,
    isDelete: dbRow.isDelete === 1
  };
}

async function storeFile(fileData) {
  return db.prepare(INSERT_FILE_SQL).run(fileData);
}

async function getFilesForPrint(modelId) {
  return db.prepare('SELECT * FROM files WHERE modelId = ?').all(modelId);
}

async function downloadCoverImage(coverUrl, modelId) {
  if (!coverUrl) return null;

  try {
    const response = await axios.get(coverUrl, { responseType: 'arraybuffer' });
    const imagesDir = path.join(__dirname, 'data', 'cover-cache');

    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    const ext = coverUrl.includes('.png') ? 'png' : 'jpg';
    const fileName = `${modelId}.${ext}`;
    const filePath = path.join(imagesDir, fileName);

    fs.writeFileSync(filePath, response.data);

    return `/images/covers/${fileName}`;
  } catch (error) {
    console.error(`Failed to download cover for ${modelId}:`, error.message);
    return null;
  }
}

async function downloadTimelapseVideo(videoUrl, modelId, taskId) {
  if (!videoUrl) return null;

  try {
    console.log(`Downloading timelapse for ${modelId}...`);
    const response = await axios.get(videoUrl, {
      responseType: 'stream',
      timeout: 120000 // 2 minute timeout for large videos
    });

    if (!fs.existsSync(videosDir)) {
      fs.mkdirSync(videosDir, { recursive: true });
    }

    const ext = videoUrl.includes('.mov') ? 'mov' : 'mp4';
    const fileName = `${taskId || modelId}.${ext}`;
    const filePath = path.join(videosDir, fileName);

    // Stream to file
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`✓ Downloaded timelapse for ${modelId}`);
        resolve(`/data/videos/${fileName}`);
      });
      writer.on('error', reject);
    });
  } catch (error) {
    console.error(`Failed to download timelapse for ${modelId}:`, error.message);
    return null;
  }
}

async function updatePrintVideoPath(modelId, videoLocal) {
  return db.prepare('UPDATE prints SET videoLocal = @videoLocal WHERE modelId = @modelId')
    .run({ modelId, videoLocal });
}

// Legacy: migrate Bambu credentials from the settings table into bambu_accounts.
// Retained for the /api/settings maintenance endpoint. Runs against PostgreSQL.
async function migrateBambuAccounts() {
  try {
    const hasSettings = await tableExists('settings');
    if (!hasSettings) {
      return { migrated: 0, message: 'Settings table does not exist' };
    }

    const cols = await getColumns('settings');
    if (!cols.includes('bambu_token')) {
      return { migrated: 0, message: 'No Bambu columns found in settings table' };
    }

    const bambuSettings = (await rawQuery(
      `SELECT user_id, bambu_email, bambu_region, bambu_token FROM settings
       WHERE bambu_token IS NOT NULL AND bambu_token <> ''`
    )).rows;

    if (bambuSettings.length === 0) {
      return { migrated: 0, message: 'No Bambu credentials found to migrate' };
    }

    let migrated = 0;
    for (const setting of bambuSettings) {
      const email = setting.bambu_email || 'imported@bambulab.com';
      const region = setting.bambu_region || 'global';
      const existing = await rawQuery('SELECT id FROM bambu_accounts WHERE token = $1', [setting.bambu_token]);
      if (existing.rows.length === 0) {
        const anyExists = (await rawQuery('SELECT COUNT(*)::int AS count FROM bambu_accounts')).rows[0].count > 0;
        const isPrimary = anyExists ? 0 : 1;
        await rawQuery(
          `INSERT INTO bambu_accounts (user_id, email, region, token, is_primary) VALUES ($1, $2, $3, $4, $5)`,
          [setting.user_id, email, region, setting.bambu_token, isPrimary]
        );
        migrated++;
      }
    }
    return { migrated, message: `Successfully migrated ${migrated} Bambu accounts` };
  } catch (error) {
    console.error('Bambu account migration check failed:', error.message);
    return { migrated: 0, error: error.message };
  }
}

module.exports = {
  db,
  pool,
  pgConfig,
  initDatabase,
  storePrint,
  storePrints,
  getAllPrintsFromDb,
  searchPrintsInDb,
  getPrintByIdFromDb,
  getPrintByModelIdFromDb,
  storeFile,
  getFilesForPrint,
  downloadCoverImage,
  downloadTimelapseVideo,
  updatePrintVideoPath,
  dataDir,
  libraryDir,
  videosDir,
  migrateBambuAccounts
};

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'printhive.db'));

// Ensure library directory exists
const libraryDir = path.join(__dirname, 'library');
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

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT,
    email TEXT UNIQUE,
    oauth_provider TEXT,
    oauth_id TEXT,
    role TEXT DEFAULT 'user',
    display_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    bambu_email TEXT,
    bambu_token TEXT,
    bambu_region TEXT DEFAULT 'global',
    printer_ip TEXT,
    printer_access_code TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS prints (
    id INTEGER PRIMARY KEY,
    designId INTEGER,
    designTitle TEXT,
    instanceId INTEGER,
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
    profileId INTEGER,
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
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_prints_modelId ON prints(modelId);
  CREATE INDEX IF NOT EXISTS idx_prints_status ON prints(status);
  CREATE INDEX IF NOT EXISTS idx_prints_startTime ON prints(startTime);
  CREATE INDEX IF NOT EXISTS idx_prints_designTitle ON prints(designTitle);
  CREATE INDEX IF NOT EXISTS idx_prints_deviceName ON prints(deviceName);
  
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    modelId TEXT NOT NULL,
    fileName TEXT NOT NULL,
    fileType TEXT,
    fileSize INTEGER,
    filePath TEXT,
    downloadUrl TEXT,
    downloadedAt TEXT,
    FOREIGN KEY (modelId) REFERENCES prints(modelId)
  );

  CREATE INDEX IF NOT EXISTS idx_files_modelId ON files(modelId);

  CREATE TABLE IF NOT EXISTS library (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fileName TEXT NOT NULL,
    originalName TEXT NOT NULL,
    fileType TEXT NOT NULL,
    fileSize INTEGER,
    filePath TEXT NOT NULL,
    thumbnailPath TEXT,
    description TEXT,
    tags TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_library_fileName ON library(fileName);
  CREATE INDEX IF NOT EXISTS idx_library_fileType ON library(fileType);

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

  CREATE TABLE IF NOT EXISTS model_tags (
    model_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (model_id, tag_id),
    FOREIGN KEY (model_id) REFERENCES library(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_model_tags_model ON model_tags(model_id);
  CREATE INDEX IF NOT EXISTS idx_model_tags_tag ON model_tags(tag_id);

  CREATE TABLE IF NOT EXISTS problems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id INTEGER,
    print_id INTEGER,
    problem_type TEXT NOT NULL,
    severity TEXT DEFAULT 'warning',
    message TEXT,
    detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    FOREIGN KEY (model_id) REFERENCES library(id) ON DELETE CASCADE,
    FOREIGN KEY (print_id) REFERENCES prints(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_problems_model ON problems(model_id);
  CREATE INDEX IF NOT EXISTS idx_problems_print ON problems(print_id);
  CREATE INDEX IF NOT EXISTS idx_problems_type ON problems(problem_type);
  CREATE INDEX IF NOT EXISTS idx_problems_resolved ON problems(resolved_at);

  CREATE TABLE IF NOT EXISTS library_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id INTEGER NOT NULL,
    share_hash TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    accessed_count INTEGER DEFAULT 0,
    last_accessed DATETIME,
    FOREIGN KEY (model_id) REFERENCES library(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_library_shares_hash ON library_shares(share_hash);
  CREATE INDEX IF NOT EXISTS idx_library_shares_model ON library_shares(model_id);

  CREATE TABLE IF NOT EXISTS maintenance_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    printer_id TEXT,
    task_name TEXT NOT NULL,
    task_type TEXT NOT NULL,
    description TEXT,
    interval_hours INTEGER DEFAULT 100,
    last_performed DATETIME,
    next_due DATETIME,
    hours_until_due REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_maintenance_printer ON maintenance_tasks(printer_id);
  CREATE INDEX IF NOT EXISTS idx_maintenance_next_due ON maintenance_tasks(next_due);
  CREATE INDEX IF NOT EXISTS idx_maintenance_type ON maintenance_tasks(task_type);

  CREATE TABLE IF NOT EXISTS maintenance_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    task_name TEXT NOT NULL,
    printer_id TEXT,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    print_hours_at_completion REAL,
    notes TEXT,
    FOREIGN KEY (task_id) REFERENCES maintenance_tasks(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_maintenance_history_task ON maintenance_history(task_id);
  CREATE INDEX IF NOT EXISTS idx_maintenance_history_date ON maintenance_history(completed_at);
`);

// Migration: Move settings to global config table
try {
  const hasSettings = db.prepare("SELECT COUNT(*) as count FROM settings").get();
  if (hasSettings && hasSettings.count > 0) {
    console.log('Migrating per-user settings to global config...');
    const firstSettings = db.prepare('SELECT * FROM settings ORDER BY id ASC LIMIT 1').get();
    if (firstSettings) {
      const upsert = db.prepare(`
        INSERT INTO config (key, value, updated_at) 
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
      `);
      
      if (firstSettings.bambu_email) upsert.run('bambu_email', firstSettings.bambu_email, firstSettings.bambu_email);
      if (firstSettings.bambu_token) upsert.run('bambu_token', firstSettings.bambu_token, firstSettings.bambu_token);
      if (firstSettings.bambu_region) upsert.run('bambu_region', firstSettings.bambu_region, firstSettings.bambu_region);
      if (firstSettings.printer_ip) upsert.run('printer_ip', firstSettings.printer_ip, firstSettings.printer_ip);
      if (firstSettings.printer_access_code) upsert.run('printer_access_code', firstSettings.printer_access_code, firstSettings.printer_access_code);
      if (firstSettings.camera_rtsp_url) upsert.run('camera_rtsp_url', firstSettings.camera_rtsp_url, firstSettings.camera_rtsp_url);
      
      console.log('✓ Settings migrated to global config');
    }
  }
} catch (e) {
  // Table doesn't exist or other error
  console.log('Settings migration check:', e.message);
}

// Migration: Add videoUrl and videoLocal columns if they don't exist
try {
  db.exec(`ALTER TABLE prints ADD COLUMN videoUrl TEXT`);
  console.log('✓ Added videoUrl column to prints table');
} catch (e) {
  // Column already exists or other error
  if (!e.message.includes('duplicate column')) {
    console.log('videoUrl column migration check:', e.message);
  }
}

try {
  db.exec(`ALTER TABLE prints ADD COLUMN videoLocal TEXT`);
  console.log('✓ Added videoLocal column to prints table');
} catch (e) {
  // Column already exists or other error
  if (!e.message.includes('duplicate column')) {
    console.log('videoLocal column migration check:', e.message);
  }
}

// Migration: Add fileHash column to library table
try {
  db.exec(`ALTER TABLE library ADD COLUMN fileHash TEXT`);
  console.log('✓ Added fileHash column to library table');
} catch (e) {
  if (!e.message.includes('duplicate column')) {
    console.log('fileHash column migration check:', e.message);
  }
}

try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_library_fileHash ON library(fileHash)`);
  console.log('✓ Added fileHash index to library table');
} catch (e) {
  console.log('fileHash index migration check:', e.message);
}

// Migration: Add printer credentials to settings table
try {
  db.exec(`ALTER TABLE settings ADD COLUMN printer_ip TEXT`);
  console.log('✓ Added printer_ip column to settings table');
} catch (e) {
  if (!e.message.includes('duplicate column')) {
    console.log('printer_ip column migration check:', e.message);
  }
}

try {
  db.exec(`ALTER TABLE settings ADD COLUMN printer_access_code TEXT`);
  console.log('✓ Added printer_access_code column to settings table');
} catch (e) {
  if (!e.message.includes('duplicate column')) {
    console.log('printer_access_code column migration check:', e.message);
  }
}

try {
  db.exec(`ALTER TABLE settings ADD COLUMN camera_rtsp_url TEXT`);
  console.log('✓ Added camera_rtsp_url column to settings table');
} catch (e) {
  if (!e.message.includes('duplicate column')) {
    console.log('camera_rtsp_url column migration check:', e.message);
  }
}

// Migration: Add hours_until_due column to maintenance_tasks table
try {
  db.exec(`ALTER TABLE maintenance_tasks ADD COLUMN hours_until_due REAL`);
  console.log('✓ Added hours_until_due column to maintenance_tasks table');
} catch (e) {
  if (!e.message.includes('duplicate column')) {
    console.log('hours_until_due column migration check:', e.message);
  }
}

// Migration: Add OAuth columns to users table
try {
  db.exec(`ALTER TABLE users ADD COLUMN email TEXT UNIQUE`);
  console.log('✓ Added email column to users table');
} catch (e) {
  if (!e.message.includes('duplicate column')) {
    console.log('email column migration check:', e.message);
  }
}

try {
  db.exec(`ALTER TABLE users ADD COLUMN oauth_provider TEXT`);
  console.log('✓ Added oauth_provider column to users table');
} catch (e) {
  if (!e.message.includes('duplicate column')) {
    console.log('oauth_provider column migration check:', e.message);
  }
}

try {
  db.exec(`ALTER TABLE users ADD COLUMN oauth_id TEXT`);
  console.log('✓ Added oauth_id column to users table');
} catch (e) {
  if (!e.message.includes('duplicate column')) {
    console.log('oauth_id column migration check:', e.message);
  }
}

try {
  db.exec(`ALTER TABLE users ADD COLUMN display_name TEXT`);
  console.log('✓ Added display_name column to users table');
} catch (e) {
  if (!e.message.includes('duplicate column')) {
    console.log('display_name column migration check:', e.message);
  }
}

// Create default superadmin user if no users exist
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
if (userCount.count === 0) {
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', 'admin', 'superadmin');
  console.log('✓ Created default superadmin user (username: admin, password: admin)');
}

// Ensure admin user is always superadmin
try {
  const adminUser = db.prepare('SELECT id, role FROM users WHERE username = ?').get('admin');
  if (adminUser) {
    console.log(`Current admin user role: ${adminUser.role}`);
    if (adminUser.role !== 'superadmin') {
      db.prepare('UPDATE users SET role = ? WHERE username = ?').run('superadmin', 'admin');
      console.log('✓ Upgraded admin user to superadmin');
    } else {
      console.log('✓ Admin user already has superadmin role');
    }
  }
} catch (e) {
  console.error('Error checking admin user:', e);
}

// Prepare statements
// Upsert that preserves existing videoLocal on cloud resync
const upsertPrint = db.prepare(`
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
    -- NEVER overwrite existing videoLocal - preserve matches at all costs
    videoLocal = COALESCE(prints.videoLocal, excluded.videoLocal),
    -- NEVER overwrite existing coverLocal - preserve local covers
    coverLocal = COALESCE(prints.coverLocal, excluded.coverLocal)
`);

const insertFile = db.prepare(`
  INSERT INTO files (modelId, fileName, fileType, fileSize, filePath, downloadUrl, downloadedAt)
  VALUES (@modelId, @fileName, @fileType, @fileSize, @filePath, @downloadUrl, CURRENT_TIMESTAMP)
`);

const getAllPrints = db.prepare(`
  SELECT * FROM prints ORDER BY startTime DESC
`);

const searchPrints = db.prepare(`
  SELECT * FROM prints 
  WHERE (designTitle LIKE @search OR title LIKE @search OR deviceName LIKE @search)
  AND (@status IS NULL OR status = @status)
  ORDER BY startTime DESC
`);

const getPrintById = db.prepare(`
  SELECT * FROM prints WHERE id = ?
`);

const getPrintByModelId = db.prepare(`
  SELECT * FROM prints WHERE modelId = ?
`);

const getFilesByModelId = db.prepare(`
  SELECT * FROM files WHERE modelId = ?
`);

// Helper functions
function storePrint(printData) {
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
  
  return upsertPrint.run(data);
}

function storePrints(printsArray) {
  let newPrints = 0;
  let updated = 0;
  
  const insert = db.transaction((prints) => {
    for (const print of prints) {
      const existing = getPrintByModelId.get(print.modelId);
      if (existing) {
        updated++;
      } else {
        newPrints++;
      }
      storePrint(print);
    }
  });
  
  insert(printsArray);
  
  return { newPrints, updated, total: printsArray.length };
}

function getAllPrintsFromDb() {
  const prints = getAllPrints.all();
  return prints.map(parsePrint);
}

function searchPrintsInDb(searchTerm = '', status = null) {
  const search = searchTerm ? `%${searchTerm}%` : '%';
  const prints = searchPrints.all({ 
    search, 
    status: status !== null ? status : null 
  });
  return prints.map(parsePrint);
}

function getPrintByIdFromDb(id) {
  const print = getPrintById.get(id);
  return print ? parsePrint(print) : null;
}

function getPrintByModelIdFromDb(modelId) {
  const print = getPrintByModelId.get(modelId);
  return print ? parsePrint(print) : null;
}

function parsePrint(dbRow) {
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
  const files = getFilesByModelId.all(dbRow.modelId);
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

function storeFile(fileData) {
  return insertFile.run(fileData);
}

function getFilesForPrint(modelId) {
  return getFilesByModelId.all(modelId);
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

const updatePrintVideo = db.prepare(`
  UPDATE prints SET videoLocal = @videoLocal WHERE modelId = @modelId
`);

function updatePrintVideoPath(modelId, videoLocal) {
  return updatePrintVideo.run({ modelId, videoLocal });
}

module.exports = {
  db,
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
  libraryDir,
  videosDir
};

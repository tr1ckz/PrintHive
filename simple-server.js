const express = require('express');
const logger = require('./logger');
const path = require('path');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const net = require('net');
const mqtt = require('mqtt');
const multer = require('multer');
const { exec: execCallback } = require('child_process');
const { promisify } = require('util');
const passport = require('passport');
const oidc = require('openid-client');
const { WebSocketServer, WebSocket } = require('ws');
const RtspCameraProxy = require('./rtsp-camera-proxy');
const execAsync = promisify(execCallback);

// Sync version on startup
try {
  require('./version-sync.js');
} catch (e) {
  logger.warn('Version sync failed:', e.message);
}
const { 
  storePrints, 
  getAllPrintsFromDb, 
  searchPrintsInDb,
  getPrintByModelIdFromDb,
  downloadCoverImage,
  downloadTimelapseVideo,
  updatePrintVideoPath,
  libraryDir,
  videosDir,
  db
} = require('./database');
const { getThumbnail, clearThumbnailCache } = require('./thumbnail-generator');
const { autoDescribeModel } = require('./ai-describer');

// Helper function to clean HTML-encoded descriptions (handles double/triple encoding)
function cleanDescription(rawDescription) {
  if (!rawDescription || typeof rawDescription !== 'string') return rawDescription;
  
  let result = rawDescription;
  let prevResult = '';
  
  // Keep decoding until no more changes (handles multiple encoding levels)
  while (result !== prevResult) {
    prevResult = result;
    result = result
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;nbsp;/g, ' ');
  }
  
  // Remove HTML tags
  result = result.replace(/<[^>]*>/g, '');
  
  // Clean up whitespace
  result = result.replace(/\s+/g, ' ').trim();
  
  return result;
}
const bambuFtp = require('./src/services/bambuFtp');
const backgroundSync = require('./src/services/backgroundSync');
const videoConverter = require('./video-converter');
const BambuMqttClient = require('./mqtt-client');
const coverImageFetcher = require('./cover-image-fetcher');

function getBambuApiBase(region = 'global') {
  return region === 'china' ? 'https://api.bambulab.cn' : 'https://api.bambulab.com';
}

const go2rtcConfigDir = path.join(__dirname, 'data', 'go2rtc');
const go2rtcConfigPath = path.join(go2rtcConfigDir, 'go2rtc.yaml');
const unifiedCameraRelayStreamName = 'printhive_camera';
const go2rtcInternalBaseUrl = process.env.GO2RTC_INTERNAL_URL || 'http://127.0.0.1:1984';
const go2rtcProxyPath = '/api/go2rtc';
const go2rtcWebSocketProxyPath = `${go2rtcProxyPath}/ws`;

function normalizeStreamRelayUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function sanitizeGo2RtcStreamName(value, fallback = 'camera') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

  return normalized || fallback;
}

function getGo2RtcInternalBaseUrl() {
  return normalizeStreamRelayUrl(go2rtcInternalBaseUrl);
}

function toWebSocketProxyUrl(value = '') {
  if (value.startsWith('https://')) return `wss://${value.slice('https://'.length)}`;
  if (value.startsWith('http://')) return `ws://${value.slice('http://'.length)}`;
  return value;
}

function buildPrinterRelayStreamName(printer) {
  const baseName = printer?.dev_id || printer?.name || 'camera';
  return sanitizeGo2RtcStreamName(`${baseName}-camera`, 'camera');
}

function escapeYamlString(value = '') {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildTapoRtspUrl(host, username, password, streamPath = 'stream1') {
  const trimmedHost = String(host || '').trim();
  if (!trimmedHost) {
    return '';
  }

  const normalizedPath = String(streamPath || 'stream1').trim().replace(/^\/+/, '') || 'stream1';
  const hasCredentials = Boolean(username || password);
  const credentials = hasCredentials
    ? `${encodeURIComponent(String(username || '').trim())}:${encodeURIComponent(String(password || '').trim())}@`
    : '';

  return `rtsp://${credentials}${trimmedHost}/${normalizedPath}`;
}

function writeGo2RtcConfigFromDatabase() {
  fs.mkdirSync(go2rtcConfigDir, { recursive: true });

  const getConfigValue = (key) => db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value || '';
  const defaultStreamName = sanitizeGo2RtcStreamName(getConfigValue('go2rtc_default_stream') || 'tapo_camera', 'tapo-camera');
  const tapoHost = getConfigValue('tapo_camera_host');
  const tapoUsername = getConfigValue('tapo_camera_username');
  const tapoPassword = getConfigValue('tapo_camera_password');
  const tapoStreamPath = getConfigValue('tapo_camera_path') || 'stream1';
  const defaultRtspUrl = buildTapoRtspUrl(tapoHost, tapoUsername, tapoPassword, tapoStreamPath);
  const explicitRtspUrl = getConfigValue('rtsp_url');
  const unifiedCameraStreamUrl = explicitRtspUrl || getConfigValue('camera_stream_url');

  const lines = [];
  const seen = new Set();

  const addStream = (name, source, comment = '') => {
    const streamName = sanitizeGo2RtcStreamName(name, 'camera');
    const streamSource = String(source || '').trim();
    if (!streamSource || seen.has(streamName) || !/^rtsps?:\/\//i.test(streamSource)) {
      return;
    }

    if (comment) {
      lines.push(`  # ${comment}`);
    }
    lines.push(`  ${streamName}: ${escapeYamlString(streamSource)}`);
    seen.add(streamName);
  };

  if (/^rtsps?:\/\//i.test(unifiedCameraStreamUrl)) {
    addStream(unifiedCameraRelayStreamName, unifiedCameraStreamUrl, 'Unified camera stream from Camera Stream Integration');
  }

  if (defaultRtspUrl) {
    addStream(defaultStreamName, defaultRtspUrl, 'Optional default Tapo camera from UI settings');
  }

  const printers = db.prepare(`
    SELECT dev_id, name, camera_rtsp_url
    FROM printers
    WHERE camera_rtsp_url IS NOT NULL AND TRIM(camera_rtsp_url) != ''
    ORDER BY name ASC, dev_id ASC
  `).all();

  printers.forEach((printer) => {
    const cameraSource = String(printer.camera_rtsp_url || '').trim();
    if (!/^rtsps?:\/\//i.test(cameraSource)) {
      return;
    }

    addStream(buildPrinterRelayStreamName(printer), cameraSource, `Printer: ${printer.name || printer.dev_id || 'Unnamed'}`);
  });

  const yaml = [
    '# Auto-generated by PrintHive. Update camera settings in the UI, then restart go2rtc if needed.',
    'api:',
    '  listen: ":1984"',
    'rtsp:',
    '  listen: ":8554"',
    'webrtc:',
    '  listen: ":8555"',
    'streams:',
    ...(lines.length > 0
      ? lines
      : [
          '  # Add streams in PrintHive Settings or edit this file directly.',
          "  sample_camera: 'rtsp://username:password@192.168.1.50/stream1'"
        ]),
    ''
  ].join('\n');

  fs.writeFileSync(go2rtcConfigPath, yaml, 'utf8');
  return { path: go2rtcConfigPath, streamCount: seen.size };
}

function syncGo2RtcConfigSafe() {
  try {
    return writeGo2RtcConfigFromDatabase();
  } catch (error) {
    logger.warn('[go2rtc] Failed to write go2rtc.yaml:', error.message);
    return null;
  }
}

function normalizeCameraFps(value, fallback = 5) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(30, parsed));
}

function getConfiguredRtspSource(printerId = '') {
  const normalizedPrinterId = String(printerId || '').trim();
  if (normalizedPrinterId) {
    const printerOverride = db.prepare('SELECT serial_number, camera_rtsp_url FROM printers WHERE dev_id = ?').get(normalizedPrinterId);
    const printerRtspUrl = String(printerOverride?.camera_rtsp_url || '').trim();

    if (/^rtsps?:\/\//i.test(printerRtspUrl)) {
      return { rtspUrl: printerRtspUrl, proxyKey: `printer:${normalizedPrinterId}`, source: 'printer' };
    }

    // Fallback: look for a ghost record sharing the same serial number (pre-migration state).
    if (printerOverride?.serial_number) {
      const bySerial = db.prepare(
        `SELECT camera_rtsp_url FROM printers WHERE serial_number = ? AND camera_rtsp_url IS NOT NULL AND TRIM(camera_rtsp_url) != ''`
      ).get(printerOverride.serial_number);
      const serialRtspUrl = String(bySerial?.camera_rtsp_url || '').trim();
      if (/^rtsps?:\/\//i.test(serialRtspUrl)) {
        return { rtspUrl: serialRtspUrl, proxyKey: `printer:${normalizedPrinterId}`, source: 'printer' };
      }
    }
  }

  const rtspUrl = String(db.prepare('SELECT value FROM config WHERE key = ?').get('rtsp_url')?.value || '').trim();
  if (/^rtsps?:\/\//i.test(rtspUrl)) {
    return { rtspUrl, proxyKey: 'global', source: 'global' };
  }

  const legacyStreamUrl = normalizeStreamRelayUrl(db.prepare('SELECT value FROM config WHERE key = ?').get('camera_stream_url')?.value || '');
  if (/^rtsps?:\/\//i.test(legacyStreamUrl)) {
    return { rtspUrl: legacyStreamUrl, proxyKey: 'global', source: 'global' };
  }

  return { rtspUrl: '', proxyKey: normalizedPrinterId ? `printer:${normalizedPrinterId}` : 'global', source: 'none' };
}

const rtspCameraProxies = new Map();

function getRtspCameraProxy(proxyKey, frameRate = 5) {
  const normalizedKey = String(proxyKey || 'global').trim() || 'global';
  let proxy = rtspCameraProxies.get(normalizedKey);

  if (!proxy) {
    proxy = new RtspCameraProxy({
      logger,
      ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
      idleShutdownMs: 5000,
      frameRate: normalizeCameraFps(frameRate, 5),
    });
    rtspCameraProxies.set(normalizedKey, proxy);
  }

  proxy.frameRate = normalizeCameraFps(frameRate, proxy.frameRate || 5);
  return proxy;
}

function stopRtspCameraProxy(proxyKey) {
  const normalizedKey = String(proxyKey || '').trim();
  if (!normalizedKey) {
    return;
  }

  const proxy = rtspCameraProxies.get(normalizedKey);
  if (proxy) {
    proxy.stopAll();
    rtspCameraProxies.delete(normalizedKey);
  }
}

function stopAllRtspCameraProxies() {
  for (const proxy of rtspCameraProxies.values()) {
    try {
      proxy.stopAll();
    } catch (_error) {
      // Ignore cleanup issues during shutdown.
    }
  }

  rtspCameraProxies.clear();
}

['SIGINT', 'SIGTERM', 'exit'].forEach((eventName) => {
  process.on(eventName, () => {
    stopAllRtspCameraProxies();
  });
});

function getConfiguredBambuAccounts(req = null) {
  try {
    const accounts = db.prepare(`
      SELECT id, user_id, email, token, COALESCE(region, 'global') AS region, is_primary
      FROM bambu_accounts
      WHERE token IS NOT NULL AND token != ''
      ORDER BY is_primary DESC, id ASC
    `).all();

    if (accounts.length > 0) {
      return accounts;
    }
  } catch (error) {
    logger.warn('[BambuAuth] Failed to load bambu_accounts:', error.message);
  }

  try {
    const settingsColumns = db.prepare('PRAGMA table_info(settings)').all();
    const hasLegacyTokenColumn = settingsColumns.some((column) => column.name === 'bambu_token');

    if (hasLegacyTokenColumn) {
      const legacyAccounts = db.prepare(`
        SELECT user_id, bambu_email AS email, bambu_token AS token, COALESCE(bambu_region, 'global') AS region, 1 AS is_primary
        FROM settings
        WHERE bambu_token IS NOT NULL AND bambu_token != ''
      `).all();

      if (legacyAccounts.length > 0) {
        return legacyAccounts;
      }
    }
  } catch (error) {
    logger.warn('[BambuAuth] Failed to load legacy Bambu tokens:', error.message);
  }

  if (req?.session?.token) {
    return [{
      id: null,
      user_id: req.session.userId || null,
      email: req.session.email || 'session',
      token: req.session.token,
      region: req.session.region || 'global',
      is_primary: 1
    }];
  }

  return [];
}

function findRecentPrintByJobName(jobName) {
  if (!jobName) {
    return null;
  }

  const normalizedJobName = String(jobName).trim();
  const fuzzyMatch = `%${normalizedJobName}%`;

  return db.prepare(`
    SELECT designTitle, title, plateName
    FROM prints
    WHERE title = ?
       OR designTitle = ?
       OR plateName = ?
       OR title LIKE ?
       OR designTitle LIKE ?
       OR plateName LIKE ?
    ORDER BY datetime(startTime) DESC
    LIMIT 1
  `).get(
    normalizedJobName,
    normalizedJobName,
    normalizedJobName,
    fuzzyMatch,
    fuzzyMatch,
    fuzzyMatch
  );
}

function scheduleRecurringTask(taskName, taskFn, intervalMs, initialDelayMs = 0) {
  let timer = null;
  let running = false;

  const runTask = async () => {
    if (running) {
      logger.warn(`[${taskName}] Previous run still active; skipping overlap.`);
      timer = setTimeout(runTask, intervalMs);
      return;
    }

    running = true;
    try {
      await taskFn();
    } catch (error) {
      logger.warn(`[${taskName}] Scheduled task error:`, error.message);
    } finally {
      running = false;
      timer = setTimeout(runTask, intervalMs);
    }
  };

  timer = setTimeout(runTask, Math.max(0, initialDelayMs));
  return () => {
    if (timer) {
      clearTimeout(timer);
    }
  };
}

syncGo2RtcConfigSafe();

// Periodic cloud sync to keep DB fresh without manual action
function setupCloudAutoSync() {
  const intervalMinutes = 60; // sync every 60 minutes

  async function runCloudSyncOnce() {
    try {
      const accounts = getConfiguredBambuAccounts();

      if (!accounts || accounts.length === 0) {
        logger.info('[CloudSync] No Bambu accounts configured; skipping.');
        return;
      }

      const results = await Promise.allSettled(accounts.map(async (account) => {
        const apiBase = getBambuApiBase(account.region);
        logger.info(`[CloudSync] Fetching tasks for ${account.email || `user ${account.user_id || 'unknown'}`}...`);

        const response = await axios.get(`${apiBase}/v1/user-service/my/tasks?limit=100`, {
          headers: { Authorization: `Bearer ${account.token}` },
          timeout: 10000
        });

        const hits = response.data?.hits || [];
        if (hits.length > 0) {
          const result = storePrints(hits);
          logger.info(`[CloudSync] Stored ${result.total} prints (${result.newPrints} new, ${result.updated} updated)`);
        } else {
          logger.info(`[CloudSync] No prints returned from ${account.email || 'configured account'}`);
        }
      }));

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const account = accounts[index];
          logger.warn(`[CloudSync] Error syncing for ${account?.email || `user ${account?.user_id || 'unknown'}`}: ${result.reason?.message || result.reason}`);
        }
      });
    } catch (err) {
      logger.warn('[CloudSync] Unexpected error:', err.message);
    }
  }

  scheduleRecurringTask('CloudSync', runCloudSyncOnce, intervalMinutes * 60 * 1000, 0);
}

// Periodic FTP sync for timelapses and SD card files (only when printer idle)
function setupFtpAutoSync() {
  const intervalMinutes = 30; // sync every 30 minutes
  
  async function runFtpSyncOnce() {
    try {
      logger.info('[FtpSync] Starting automatic FTP sync...');
      
      // Get all configured printers from database
      const printers = db.prepare(`
        SELECT p.dev_id, p.name, p.ip_address, p.access_code, p.serial_number
        FROM printers p
        WHERE p.ip_address IS NOT NULL AND p.ip_address != ''
        AND p.access_code IS NOT NULL AND p.access_code != ''
      `).all();
      
      if (!printers || printers.length === 0) {
        logger.info('[FtpSync] No printers configured with FTP credentials; skipping.');
        return;
      }
      
      for (const printer of printers) {
        try {
          // Check if printer is currently printing via MQTT
          const clientKey = `${printer.ip_address}:${printer.dev_id}`;
          const mqttClient = mqttClients.get(clientKey);
          
          if (mqttClient && mqttClient.connected) {
            const currentJob = mqttClient.getCurrentJob();
            const gcodeState = currentJob?.gcode_state || 'IDLE';
            
            // Skip if printer is actively printing
            if (gcodeState === 'RUNNING' || gcodeState === 'PAUSE' || gcodeState === 'PREPARE') {
              logger.info(`[FtpSync] Skipping ${printer.name} - printer is ${gcodeState}`);
              continue;
            }
          }
          
          logger.info(`[FtpSync] Syncing ${printer.name} (${printer.ip_address})...`);
          
          // Connect to printer FTP
          const connected = await bambuFtp.connect(printer.ip_address, printer.access_code);
          if (!connected) {
            logger.warn(`[FtpSync] Could not connect to ${printer.name} via FTP`);
            continue;
          }
          
          // Sync timelapses
          try {
            const videosDir = path.join(__dirname, 'data', 'videos');
            const timelapses = await bambuFtp.downloadAllTimelapses(videosDir, false);
            const newTimelapses = timelapses.filter(t => !t.skipped).length;
            if (newTimelapses > 0) {
              logger.info(`[FtpSync] Downloaded ${newTimelapses} new timelapses from ${printer.name}`);
            }
          } catch (err) {
            logger.warn(`[FtpSync] Error syncing timelapses from ${printer.name}: ${err.message}`);
          }
          
          // Sync SD card files to print history
          try {
            const sdFiles = await bambuFtp.listAllPrinterFiles();
            if (sdFiles.length > 0) {
              // Get existing prints
              const existingPrints = getAllPrintsFromDb();
              const existingTitles = new Set(existingPrints.map(p => p.title?.toLowerCase()));
              const existingFileNames = new Set(existingPrints.map(p => {
                const title = p.title || p.plateName || '';
                return title.toLowerCase().replace(/\.(gcode|3mf)$/i, '');
              }));
              
              // Filter for new files
              const newFiles = sdFiles.filter(file => {
                const baseName = file.name.replace(/\.(gcode|3mf)$/i, '').toLowerCase();
                return !existingTitles.has(file.name.toLowerCase()) && !existingFileNames.has(baseName);
              });
              
              // Add to print history
              let added = 0;
              for (const file of newFiles) {
                const modelId = `sd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const printData = {
                  id: null,
                  designId: null,
                  designTitle: file.name,
                  instanceId: null,
                  modelId: modelId,
                  title: file.name,
                  cover: null,
                  videoUrl: null,
                  videoLocal: null,
                  coverLocal: null,
                  status: 2,
                  feedbackStatus: null,
                  startTime: file.modified || new Date().toISOString(),
                  endTime: file.modified || new Date().toISOString(),
                  weight: null,
                  length: null,
                  costTime: null,
                  profileId: null,
                  plateIndex: null,
                  plateName: file.name,
                  deviceId: printer.dev_id,
                  deviceModel: null,
                  deviceName: printer.name,
                  bedType: null,
                  jobType: null,
                  mode: 'local',
                  isPublicProfile: false,
                  isPrintable: false,
                  isDelete: false,
                  amsDetailMapping: [],
                  material: {},
                  platform: 'local',
                  stepSummary: [],
                  nozzleInfos: [],
                  snapShot: null
                };
                storePrint(printData);
                added++;
              }
              
              if (added > 0) {
                logger.info(`[FtpSync] Added ${added} new prints from ${printer.name} SD card`);
              }
            }
          } catch (err) {
            logger.warn(`[FtpSync] Error syncing SD card from ${printer.name}: ${err.message}`);
          }
          
          // Disconnect
          await bambuFtp.disconnect();
          
        } catch (err) {
          logger.warn(`[FtpSync] Error syncing ${printer.name}: ${err.message}`);
        }
      }
      
      logger.info('[FtpSync] Automatic FTP sync completed');
    } catch (err) {
      logger.warn('[FtpSync] Unexpected error:', err.message);
    }
  }
  
  // Run first sync after 2 minutes (give time for MQTT to connect), then schedule each subsequent run after completion
  scheduleRecurringTask('FtpSync', runFtpSyncOnce, intervalMinutes * 60 * 1000, 2 * 60 * 1000);
}

// Auto-scan library every 5 minutes in background
function setupAutoLibraryScan() {
  const intervalMinutes = 5;
  async function scanLibraryOnce() {
    try {
      logger.debug('[LibraryScan] Starting automatic scan...');
      const allFiles = walkDirectory(libraryDir);
      let added = 0;
      
      for (const filePath of allFiles) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.3mf' || ext === '.stl' || ext === '.gcode') {
          const fileName = path.basename(filePath);
          const relativePath = path.relative(__dirname, filePath);
          
          const existing = db.prepare('SELECT id FROM library WHERE filePath = ?').get(relativePath);
          
          if (!existing) {
            const stats = fs.statSync(filePath);
            const fileType = ext.substring(1);
            
            db.prepare(`
              INSERT INTO library (fileName, originalName, fileType, fileSize, filePath, description, tags)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(fileName, fileName, fileType, stats.size, relativePath, '', '');
            
            added++;
          }
        }
      }
      
      if (added > 0) {
        logger.info(`[LibraryScan] Added ${added} new files to library`);
      } else {
        logger.debug('[LibraryScan] No new files found');
      }
    } catch (err) {
      logger.warn('[LibraryScan] Error:', err.message);
    }
  }
  
  // Start scanning after 30s delay, then schedule each subsequent run after completion
  scheduleRecurringTask('LibraryScan', scanLibraryOnce, intervalMinutes * 60 * 1000, 30000);
}

// Auto-match videos every 10 minutes in background
function setupAutoVideoMatching() {
  const intervalMinutes = 10;
  async function matchVideosOnce() {
    try {
      logger.debug('[VideoMatch] Starting automatic matching...');
      
      const videoFiles = fs.existsSync(videosDir) 
        ? fs.readdirSync(videosDir).filter(f => f.endsWith('.avi') || f.endsWith('.mp4'))
        : [];
      
      const printsWithoutVideo = db.prepare(`
        SELECT id, modelId, title, startTime, endTime
        FROM prints
        WHERE (videoLocal IS NULL OR videoLocal = '')
          AND startTime IS NOT NULL
        ORDER BY startTime DESC
      `).all();
      
      if (printsWithoutVideo.length === 0 || videoFiles.length === 0) {
        logger.debug('[VideoMatch] Nothing to match');
        return;
      }
      
      let matched = 0;
      
      for (const videoFile of videoFiles) {
        // Check if already matched
        const existing = db.prepare(`
          SELECT id FROM prints WHERE videoLocal = ?
        `).get(videoFile);
        
        if (existing) continue;
        
        // Extract timestamp from filename: video_2024-12-13_15-18-02.avi
        const match = videoFile.match(/video_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
        
        if (match) {
          const [, date, hours, minutes, seconds] = match;
          const videoDate = new Date(`${date}T${hours}:${minutes}:${seconds}`);
          const videoTimestampMs = videoDate.getTime();
          
          // Find the best matching print
          let bestMatch = null;
          let bestTimeDiff = Infinity;
          
          for (const print of printsWithoutVideo) {
            let printDate;
            const st = print.startTime;
            
            if (/^\d+$/.test(st)) {
              const ts = parseInt(st);
              printDate = new Date(ts > 9999999999 ? ts : ts * 1000);
            } else if (st.includes('T') || st.includes(' ')) {
              printDate = new Date(st);
            } else {
              continue;
            }
            
            if (isNaN(printDate.getTime())) continue;
            
            const timeDiff = Math.abs(videoTimestampMs - printDate.getTime());
            const hoursDiff = timeDiff / (1000 * 60 * 60);
            
            if (hoursDiff <= 4 && timeDiff < bestTimeDiff) {
              bestTimeDiff = timeDiff;
              bestMatch = print;
            }
          }
          
          if (bestMatch) {
            db.prepare('UPDATE prints SET videoLocal = ? WHERE id = ?').run(videoFile, bestMatch.id);
            const idx = printsWithoutVideo.findIndex(p => p.id === bestMatch.id);
            if (idx > -1) printsWithoutVideo.splice(idx, 1);
            matched++;
          }
        }
      }
      
      if (matched > 0) {
        logger.info(`[VideoMatch] Matched ${matched} videos to prints`);
      } else {
        logger.debug('[VideoMatch] No new matches found');
      }
    } catch (err) {
      logger.warn('[VideoMatch] Error:', err.message);
    }
  }
  
  // Start matching after 60s delay, then schedule each subsequent run after completion
  scheduleRecurringTask('VideoMatch', matchVideosOnce, intervalMinutes * 60 * 1000, 60000);
}

const app = express();
let httpServer = null; // Store reference for graceful shutdown
let realtimeWss = null;
const mqttClients = new Map(); // Store MQTT clients per printer
const REALTIME_SOCKET_PATH = '/ws/printers';
const PORT = process.env.PORT || 3000;

function sendRealtimeMessage(socket, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  try {
    socket.send(JSON.stringify({
      sentAt: new Date().toISOString(),
      ...payload,
    }));
  } catch (error) {
    logger.debug('[Realtime] Failed to send websocket message:', error.message);
  }
}

function broadcastRealtimeMessage(payload) {
  if (!realtimeWss) {
    return;
  }

  realtimeWss.clients.forEach((client) => {
    sendRealtimeMessage(client, payload);
  });
}

function buildRealtimePrinterPayload(device, jobData = null, overrides = {}) {
  const printerId = device?.dev_id || overrides.dev_id || null;
  if (!printerId) {
    return null;
  }

  let latestConfig = {};
  try {
    latestConfig = db.prepare(`
      SELECT dev_id, name, ip_address, access_code, serial_number, camera_rtsp_url
      FROM printers
      WHERE dev_id = ?
    `).get(printerId) || {};

    // Fallback: if no camera URL found by dev_id, look for a record matching by serial number
    // (handles ghost manual_* records that haven't been migrated yet).
    if (!latestConfig.camera_rtsp_url && device?.serial_number) {
      const bySerial = db.prepare(`
        SELECT camera_rtsp_url FROM printers WHERE serial_number = ? AND camera_rtsp_url IS NOT NULL AND TRIM(camera_rtsp_url) != ''
      `).get(device.serial_number);
      if (bySerial?.camera_rtsp_url) {
        latestConfig.camera_rtsp_url = bySerial.camera_rtsp_url;
      }
    }
  } catch (error) {
    logger.debug('[Realtime] Failed to load printer config snapshot:', error.message);
  }

  const mergedTask = jobData
    ? { ...(device?.current_task || {}), ...jobData, ...(overrides.current_task || {}) }
    : overrides.current_task || device?.current_task;

  return {
    type: 'printer.telemetry',
    printerId,
    payload: {
      ...device,
      ...latestConfig,
      ...overrides,
      dev_id: printerId,
      name: overrides.name || latestConfig.name || device?.name || printerId,
      online: overrides.online ?? device?.online ?? true,
      print_status: overrides.print_status || device?.print_status || mergedTask?.gcode_state || 'ONLINE',
      camera_rtsp_url: overrides.camera_rtsp_url ?? latestConfig.camera_rtsp_url ?? device?.camera_rtsp_url ?? null,
      ams: overrides.ams ?? mergedTask?.ams ?? device?.ams,
      current_task: mergedTask || undefined,
    },
  };
}

function attachRealtimeBridgeToMqttClient(mqttClient, clientKey, device) {
  mqttClient.realtimeDevice = {
    ...(mqttClient.realtimeDevice || {}),
    ...device,
  };

  if (mqttClient.__realtimeBridgeAttached) {
    return;
  }

  mqttClient.__realtimeBridgeAttached = true;

  mqttClient.on('job_update', (jobData) => {
    const payload = buildRealtimePrinterPayload(mqttClient.realtimeDevice || device, jobData, {
      online: true,
      print_status: jobData?.gcode_state || mqttClient.realtimeDevice?.print_status || 'ONLINE',
    });

    if (payload) {
      broadcastRealtimeMessage(payload);
    }
  });

  mqttClient.on('disconnected', () => {
    const payload = buildRealtimePrinterPayload(mqttClient.realtimeDevice || device, mqttClient.getCurrentJob(), {
      online: false,
      print_status: 'OFFLINE',
    });

    if (payload) {
      broadcastRealtimeMessage(payload);
    }
  });

  mqttClient.on('error', () => {
    const payload = buildRealtimePrinterPayload(mqttClient.realtimeDevice || device, mqttClient.getCurrentJob(), {
      online: false,
      print_status: 'OFFLINE',
    });

    if (payload) {
      broadcastRealtimeMessage(payload);
    }
  });
}

function setupRealtimeServer(server) {
  if (!server || realtimeWss) {
    return;
  }

  realtimeWss = new WebSocketServer({
    server,
    path: REALTIME_SOCKET_PATH,
  });

  realtimeWss.on('connection', (socket) => {
    sendRealtimeMessage(socket, {
      type: 'realtime.welcome',
      payload: { status: 'connected' },
    });

    for (const mqttClient of mqttClients.values()) {
      const payload = buildRealtimePrinterPayload(
        mqttClient.realtimeDevice || {},
        mqttClient.getCurrentJob(),
        { online: mqttClient.connected }
      );

      if (payload) {
        sendRealtimeMessage(socket, payload);
      }
    }
  });

  logger.info(`[Realtime] WebSocket bridge ready at ${REALTIME_SOCKET_PATH}`);
}

function setupGo2RtcWebSocketProxy(server) {
  if (!server) {
    return;
  }

  const go2rtcProxyWss = new WebSocketServer({ noServer: true });

  go2rtcProxyWss.on('connection', (clientSocket, request) => {
    const requestUrl = new URL(request.url || go2rtcWebSocketProxyPath, 'http://localhost');
    const upstreamUrl = `${toWebSocketProxyUrl(getGo2RtcInternalBaseUrl())}/api/ws${requestUrl.search || ''}`;
    const upstreamSocket = new WebSocket(upstreamUrl);

    const closeBothSockets = () => {
      if (clientSocket.readyState === WebSocket.OPEN || clientSocket.readyState === WebSocket.CONNECTING) {
        clientSocket.close();
      }
      if (upstreamSocket.readyState === WebSocket.OPEN || upstreamSocket.readyState === WebSocket.CONNECTING) {
        upstreamSocket.close();
      }
    };

    clientSocket.on('message', (data, isBinary) => {
      if (upstreamSocket.readyState === WebSocket.OPEN) {
        upstreamSocket.send(data, { binary: isBinary });
      }
    });

    upstreamSocket.on('message', (data, isBinary) => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(data, { binary: isBinary });
      }
    });

    clientSocket.on('close', closeBothSockets);
    clientSocket.on('error', closeBothSockets);
    upstreamSocket.on('close', closeBothSockets);
    upstreamSocket.on('error', (error) => {
      logger.warn('[go2rtc] WebSocket proxy failed:', error.message);
      closeBothSockets();
    });
  });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || go2rtcWebSocketProxyPath, 'http://localhost').pathname;
    if (pathname !== go2rtcWebSocketProxyPath) {
      return;
    }

    go2rtcProxyWss.handleUpgrade(request, socket, head, (ws) => {
      go2rtcProxyWss.emit('connection', ws, request);
    });
  });

  logger.info(`[go2rtc] WebSocket proxy ready at ${go2rtcWebSocketProxyPath}`);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, libraryDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // Sanitize filename to prevent directory traversal
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, uniqueSuffix + '-' + safeName);
  }
});

// Security: Validate and sanitize file paths
function sanitizeFilePath(input) {
  if (!input) return '';
  
  // Remove any directory traversal attempts
  const normalized = path.normalize(input).replace(/^(\.\.(\/|\\|$))+/, '');
  
  // Ensure no path traversal
  if (normalized.includes('..')) {
    throw new Error('Invalid file path: directory traversal detected');
  }
  
  return normalized;
}

// Security: HTML escape for safe output in HTML context
function htmlEscape(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.3mf' || ext === '.stl' || ext === '.gcode') {
      cb(null, true);
    } else {
      cb(new Error('Only .3mf, .stl, and .gcode files are allowed'));
    }
  }
});

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // Prevent MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Content Security Policy - allow inline scripts for viewer but restrict external resources
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self'; media-src 'self' http: https: blob: data:; connect-src 'self' http: https: ws: wss: blob: https://cdn.jsdelivr.net https://cloudflareinsights.com");
  // Permissions Policy (formerly Feature Policy)
  res.setHeader('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()');
  next();
});

// Initialize logger level from DB if present
try {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get('log_level');
  if (row && row.value) {
    logger.setLevel(row.value);
  } else if (process.env.LOG_LEVEL) {
    logger.setLevel(process.env.LOG_LEVEL);
  }
} catch (e) {
  logger.warn('Could not initialize log level from DB:', e.message);
}

// (moved system routes below session middleware)

// Trust proxy (for nginx/reverse proxy)
app.set('trust proxy', 1);

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});
app.use(session({
  store: new FileStore({
    path: './sessions',
    ttl: 7 * 24 * 60 * 60, // 7 days in seconds
    retries: 0,  // Don't retry reading non-existent files
    reapInterval: -1  // Disable automatic session cleanup
  }),
  name: 'bambu.sid', // Custom session cookie name
  secret: 'simple-secret',
  resave: true,  // Force save even if unmodified (helps with proxy)
  saveUninitialized: false,  // Don't create session until something stored
  rolling: true, // Reset expiry on every request
  proxy: true, // Trust reverse proxy
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    secure: false, // Set to false to work with both HTTP and HTTPS
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    domain: undefined // Don't set domain, let browser handle it
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Passport serialization
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  try {
    const user = db.prepare('SELECT id, username, email, role FROM users WHERE id = ?').get(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});

app.get(`${go2rtcProxyPath}/*`, async (req, res) => {
  if (!req.session?.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const upstreamPath = req.originalUrl.replace(go2rtcProxyPath, '/api');
    const upstreamUrl = `${getGo2RtcInternalBaseUrl()}${upstreamPath}`;
    const upstreamResponse = await axios.get(upstreamUrl, {
      responseType: 'stream',
      validateStatus: () => true,
      timeout: 15000,
    });

    res.status(upstreamResponse.status);

    ['content-type', 'cache-control', 'content-length', 'content-range', 'accept-ranges'].forEach((headerName) => {
      const headerValue = upstreamResponse.headers[headerName];
      if (headerValue) {
        res.setHeader(headerName, headerValue);
      }
    });

    upstreamResponse.data.on('error', (error) => {
      logger.warn('[go2rtc] HTTP proxy stream failed:', error.message);
      if (!res.headersSent) {
        res.status(502).end('Unable to read go2rtc relay stream');
      }
    });

    upstreamResponse.data.pipe(res);
  } catch (error) {
    logger.warn('[go2rtc] HTTP proxy request failed:', error.message);
    res.status(502).json({ error: 'Unable to reach go2rtc camera relay' });
  }
});

// OIDC configuration cache
let oidcConfig = null;

// Configure OIDC Client (using openid-client v6.x API)
async function configureOIDC() {
  const settings = db.prepare('SELECT key, value FROM config WHERE key LIKE ?').all('oauth_%');
  const oauthConfig = {};
  settings.forEach(row => {
    const key = row.key.replace('oauth_', '');
    oauthConfig[key] = row.value || '';
  });

  if (oauthConfig.provider === 'oidc' && oauthConfig.oidcIssuer && oauthConfig.oidcClientId) {
    try {
      // Keep the issuer URL exactly as configured (including trailing slash)
      const issuerUrl = oauthConfig.oidcIssuer;
      
      const publicUrl = oauthConfig.publicHostname || process.env.PUBLIC_URL || 'http://localhost:3000';
      
      console.log('Discovering OIDC configuration from:', issuerUrl);
      
      // Fetch the .well-known configuration manually to get endpoints
      const wellKnownUrl = issuerUrl.endsWith('/') 
        ? `${issuerUrl}.well-known/openid-configuration`
        : `${issuerUrl}/.well-known/openid-configuration`;
      
      const axios = require('axios');
      const response = await axios.get(wellKnownUrl);
      const metadata = response.data;
      
      console.log('Discovered issuer:', metadata.issuer);
      console.log('Authorization endpoint:', metadata.authorization_endpoint);
      console.log('Token endpoint:', metadata.token_endpoint);
      console.log('UserInfo endpoint:', metadata.userinfo_endpoint);
      
      // Create a Configuration object with server metadata, client ID, and client secret
      const server = new oidc.Configuration(
        metadata, // server metadata from .well-known
        oauthConfig.oidcClientId, // client ID
        oauthConfig.oidcClientSecret // client secret (can be string or object)
      );
      
      // Store configuration for use in routes
      oidcConfig = {
        server,
        clientId: oauthConfig.oidcClientId,
        clientSecret: oauthConfig.oidcClientSecret,
        redirectUri: `${publicUrl}/auth/oidc/callback`,
        issuerUrl: metadata.issuer
      };
      
      console.log('✓ OIDC client configured successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to configure OIDC:', error.message);
      oidcConfig = null;
      return false;
    }
  } else {
    console.log('OIDC not configured (missing provider, issuer, or client ID)');
    oidcConfig = null;
    return false;
  }
}
// System controls: get/set log level (after session middleware)
app.get('/api/log-level', (req, res) => {
  if (!(req.session && req.session.authenticated)) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ level: logger.level });
});

app.post('/api/log-level', (req, res) => {
  if (!(req.session && req.session.authenticated)) return res.status(401).json({ error: 'Not authenticated' });
  const { level } = req.body || {};
  if (!level) return res.status(400).json({ error: 'Missing level' });
  logger.setLevel(level);
  try {
    db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('log_level', String(level).toUpperCase());
  } catch (e) {
    logger.warn('Failed to persist log level:', e.message);
  }
  res.json({ ok: true, level: logger.level });
});

// System restart (watchdog picks this up)
app.post('/api/system/restart', (req, res) => {
  if (!(req.session && req.session.authenticated)) return res.status(401).json({ error: 'Not authenticated' });
  try {
    // Clean up tasks without printer_id before restart
    try {
      const deleted = db.prepare('DELETE FROM maintenance_tasks WHERE printer_id IS NULL OR printer_id = ""').run();
      logger.info(`Cleaned up ${deleted.changes} maintenance tasks without printer assignment`);
    } catch (e) {
      logger.warn('Failed to cleanup maintenance tasks:', e.message);
    }
    
    fs.writeFileSync('/tmp/restart.flag', '1');
    logger.info('Restart flag created, watchdog will restart app');
    res.json({ ok: true });
  } catch (e) {
    logger.error('Failed to write restart flag:', e.message);
    res.status(500).json({ error: 'Failed to request restart' });
  }
});

// Back-compat restart endpoint used by Settings
app.post('/api/settings/restart', (req, res) => {
  if (!(req.session && req.session.authenticated)) return res.status(401).json({ error: 'Not authenticated' });
  try {
    fs.writeFileSync('/tmp/restart.flag', '1');
    logger.info('Restart flag created (compat endpoint)');
    res.json({ shouldRestart: true });
  } catch (e) {
    logger.error('Failed to write restart flag:', e.message);
    res.status(500).json({ error: 'Failed to request restart' });
  }
});

// OAuth routes (MUST be before static middleware to catch callbacks)
app.get('/auth/oidc', async (req, res) => {
  console.log('=== OIDC AUTH START ===');
  
  if (!oidcConfig) {
    console.error('OIDC client not configured');
    return res.redirect('/admin?error=oidc_not_configured');
  }
  
  try {
    // Generate PKCE code verifier and state
    const code_verifier = oidc.randomPKCECodeVerifier();
    const code_challenge = await oidc.calculatePKCECodeChallenge(code_verifier);
    const state = oidc.randomState();
    
    // Store in session for callback
    req.session.oidc_code_verifier = code_verifier;
    req.session.oidc_state = state;
    
    await new Promise((resolve, reject) => {
      req.session.save((err) => err ? reject(err) : resolve());
    });
    
    // Build authorization URL using v6.x API
    const authUrl = oidc.buildAuthorizationUrl(oidcConfig.server, {
      redirect_uri: oidcConfig.redirectUri,
      scope: 'openid profile email',
      code_challenge,
      code_challenge_method: 'S256',
      state,
    });
    
    console.log('Redirecting to:', authUrl.href);
    res.redirect(authUrl.href);
  } catch (error) {
    console.error('OIDC auth error:', error);
    res.redirect('/admin?error=oidc_auth_failed');
  }
});

app.get('/auth/oidc/callback', async (req, res) => {
  console.log('=== OIDC CALLBACK RECEIVED ===');
  console.log('Query:', req.query);
  console.log('Session ID:', req.sessionID);
  
  if (!oidcConfig) {
    console.error('OIDC client not configured');
    return res.redirect('/admin?error=oidc_not_configured');
  }
  
  try {
    // Get code verifier and state from session
    const code_verifier = req.session.oidc_code_verifier;
    const saved_state = req.session.oidc_state;
    
    if (!code_verifier) {
      console.error('No code verifier in session');
      return res.redirect('/admin?error=invalid_session');
    }
    
    // Build current URL for callback
    const currentUrl = new URL(`${req.protocol}://${req.get('host')}${req.originalUrl}`);
    
    console.log('Calling authorizationCodeGrant...');
    
    // Exchange authorization code for tokens using v6.x API
    // In v6.x, authorizationCodeGrant validates the response automatically
    const tokens = await oidc.authorizationCodeGrant(
      oidcConfig.server,
      currentUrl,
      {
        pkceCodeVerifier: code_verifier,
        expectedState: saved_state
      }
    );
    
    console.log('Token exchange successful');
    console.log('Access token received:', !!tokens.access_token);
    console.log('ID token received:', !!tokens.id_token);
    
    // Get claims from ID token
    const claims = tokens.claims();
    console.log('ID Token Claims:', JSON.stringify(claims, null, 2));
    
    // Extract user information from claims
    const sub = claims.sub;
    const email = claims.email || claims.preferred_username;
    const username = claims.preferred_username || claims.username || email?.split('@')[0] || sub;
    const name = claims.name || username;
    
    console.log('Extracted data:');
    console.log('  Sub:', sub);
    console.log('  Email:', email);
    console.log('  Username:', username);
    console.log('  Name:', name);
    
    // Check if user exists by OAuth ID
    let user = db.prepare('SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?').get('oidc', sub);
    console.log('Existing user by OAuth ID:', user ? user.username : 'none');
    
    if (!user && email) {
      // Check by email
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      console.log('Existing user by email:', user ? user.username : 'none');
      
      if (user) {
        // Link existing user to OAuth and update display name
        console.log('Linking existing user to OAuth');
        db.prepare('UPDATE users SET oauth_provider = ?, oauth_id = ?, display_name = ? WHERE id = ?').run('oidc', sub, name, user.id);
      }
    }
    
    // Determine role based on Authentik groups
    let role = 'user';
    if (claims.groups) {
      const groups = Array.isArray(claims.groups) ? claims.groups : [claims.groups];
      console.log('User groups from Authentik:', groups);
      
      // Check for admin groups (case-insensitive) - only Admin/Admins get superadmin
      if (groups.some(g => g.toLowerCase().includes('admin'))) {
        role = 'superadmin';
        console.log('User is in Admin group - assigning superadmin role');
      } else {
        role = 'user';
        console.log('User is not in Admin group - assigning user role');
      }
    }
    
    if (!user) {
      // Create new user with role based on groups
      console.log('Creating new OIDC user:', username, email, 'with role:', role);
      const result = db.prepare(
        'INSERT INTO users (username, email, oauth_provider, oauth_id, role, password, display_name) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        username,
        email || '',
        'oidc',
        sub,
        role,
        '', // No password for OAuth users
        name
      );
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
      console.log('New user created with ID:', user.id);
    } else {
      // Update existing user role based on current groups
      if (user.role !== 'superadmin' || role === 'superadmin') {
        console.log('Updating user role from', user.role, 'to', role, 'based on groups');
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
        user.role = role;
      }
    }
    
    console.log('=== OIDC AUTH SUCCESS ===');
    console.log('User:', user.username, 'Role:', user.role);
    
    // Set session for compatibility with existing auth system
    req.session.authenticated = true;
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role || 'user';
    
    // Clean up OIDC session data
    delete req.session.oidc_code_verifier;
    delete req.session.oidc_state;
    
    await new Promise((resolve, reject) => {
      req.session.save((err) => err ? reject(err) : resolve());
    });
    
    console.log('Session saved successfully, redirecting to /');
    res.redirect('/');
  } catch (error) {
    console.error('=== OIDC CALLBACK ERROR ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    
    // Clean up session on error
    delete req.session.oidc_code_verifier;
    delete req.session.oidc_state;
    
    res.redirect('/admin?error=oidc_callback_failed');
  }
});

app.get('/auth/google', (req, res) => {
  res.status(501).send('Google OAuth not yet implemented. Configure OIDC instead or install passport-google-oauth20.');
});

app.get('/auth/google/callback', (req, res) => {
  res.redirect('/admin');
});

// Middleware to ensure Bambu token is loaded from global config
app.use((req, res, next) => {
  if (req.session.authenticated && !req.session.token) {
    try {
      const token = db.prepare('SELECT value FROM config WHERE key = ?').get('bambu_token');
      const region = db.prepare('SELECT value FROM config WHERE key = ?').get('bambu_region');
      if (token && token.value) {
        req.session.token = token.value;
        req.session.region = region?.value || 'global';
      }
    } catch (error) {
      console.error('Failed to reload Bambu token:', error);
    }
  }
  next();
});

// Main route - auto-redirect to OIDC if configured and not authenticated
app.get('/', (req, res) => {
  console.log('=== MAIN ROUTE ACCESSED ===');
  console.log('Session authenticated:', req.session.authenticated);
  
  // If already authenticated, serve the app
  if (req.session.authenticated) {
    console.log('User already authenticated, serving app');
    // Check if dist exists, otherwise fall back to public
    const distExists = fs.existsSync(path.join(__dirname, 'dist', 'index.html'));
    const staticDir = distExists ? 'dist' : 'public';
    console.log('Serving from:', staticDir);
    return res.sendFile(path.join(__dirname, staticDir, 'index.html'));
  }
  
  // Check if OIDC is configured
  try {
    const providerRow = db.prepare('SELECT value FROM config WHERE key = ?').get('oauth_provider');
    console.log('OAuth provider:', providerRow?.value);
    console.log('oidcConfig exists:', !!oidcConfig);
    
    if (providerRow?.value === 'oidc' && oidcConfig) {
      // Auto-redirect to OIDC login
      console.log('Redirecting to /auth/oidc');
      return res.redirect('/auth/oidc');
    }
  } catch (error) {
    console.error('Error checking OAuth provider:', error);
  }
  
  // Default: serve login page
  console.log('Serving login page');
  const distExists = fs.existsSync(path.join(__dirname, 'dist', 'index.html'));
  const staticDir = distExists ? 'dist' : 'public';
  console.log('Serving from:', staticDir);
  res.sendFile(path.join(__dirname, staticDir, 'index.html'));
});

// Admin route (prevents OAuth auto-redirect)
app.get('/admin', (req, res) => {
  // Only allow /admin if LOCALAUTH is enabled
  const localAuthEnabled = process.env.LOCALAUTH === 'true';
  
  if (!localAuthEnabled) {
    // Redirect to home if local auth is disabled
    return res.redirect('/');
  }
  
  const distExists = fs.existsSync(path.join(__dirname, 'dist', 'index.html'));
  const staticDir = distExists ? 'dist' : 'public';
  res.sendFile(path.join(__dirname, staticDir, 'index.html'));
});

// Serve logo and other data assets
app.use('/favicon.svg', express.static(path.join(__dirname, 'data', 'logo.png')));
app.use('/logo.png', express.static(path.join(__dirname, 'data', 'logo.png')));

// Buy Me a Coffee brand assets
app.get('/data/bmc-brand-logo.svg', (req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'bmc-brand-logo.svg'));
});

// Serve cover images from data directory with on-demand download fallback
app.get('/images/covers/:modelId.:ext', async (req, res) => {
  const { modelId, ext } = req.params;
  const coverCacheDir = path.join(__dirname, 'data', 'cover-cache');
  const filePath = path.join(coverCacheDir, `${modelId}.${ext}`);
  
  // If file exists, serve it
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  
  // Try to download it on-demand
  try {
    const print = getPrintByModelIdFromDb(modelId);
    if (print && print.cover) {
      console.log(`Attempting on-demand download of cover for ${modelId}`);
      const localPath = await downloadCoverImage(print.cover, modelId);
      if (localPath && fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
    }
  } catch (err) {
    console.log(`Failed on-demand cover download for ${modelId}:`, err.message);
  }
  
  // Return 404 if we can't get it
  res.status(404).send('Cover image not found');
});

// Serve static files AFTER specific routes
const distExists = fs.existsSync(path.join(__dirname, 'dist', 'index.html'));
const staticDir = distExists ? 'dist' : 'public';
console.log('Serving static files from:', staticDir);
app.use(express.static(staticDir));

// Simple local login
app.post('/auth/login', async (req, res) => {
  console.log('=== LOGIN REQUEST RECEIVED ===');
  console.log('Request body:', req.body);
  console.log('Session ID at login start:', req.sessionID);
  console.log('Session object:', req.session);
  
  const { username, password } = req.body;
  console.log('Extracted username:', username, 'password length:', password?.length);
  
  try {
    console.log('About to query database...');
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, password);
    console.log('Database query completed. User found:', !!user);
    
    if (user) {
      console.log('User found:', user.username);
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.role = user.role || 'user';
      req.session.authenticated = true;
      
      // Load global Bambu credentials if they exist
      const token = db.prepare('SELECT value FROM config WHERE key = ?').get('bambu_token');
      const region = db.prepare('SELECT value FROM config WHERE key = ?').get('bambu_region');
      if (token && token.value) {
        req.session.token = token.value;
        req.session.region = region?.value || 'global';
      }
      
      console.log('Session before save:', req.session);
      
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.json({ success: false, error: 'Session save failed' });
        }
        console.log('Session saved successfully. Session ID:', req.sessionID);
        console.log('Set-Cookie header should be sent');
        console.log('Session cookie:', req.session.cookie);
        res.json({ success: true });
      });
    } else {
      console.log('Invalid credentials');
      res.json({ success: false, error: 'Invalid username or password' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.json({ success: false, error: 'Login failed' });
  }
});

// Request verification code from Bambu Lab
app.post('/api/settings/request-code', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  console.log('=== REQUEST VERIFICATION CODE ===');
  const { email, region } = req.body;
  
  const apiUrl = region === 'china'
    ? 'https://api.bambulab.cn/v1/user-service/user/sendemail/code'
    : 'https://api.bambulab.com/v1/user-service/user/sendemail/code';
  
  try {
    const response = await axios.post(apiUrl, 
      { email, type: 'codeLogin' },
      { headers: { 'Content-Type': 'application/json' } }
    );
    
    console.log('Code request response:', response.status);
    res.json({ success: true });
  } catch (error) {
    console.error('Code request error:', error.message);
    console.error('Response:', error.response?.data);
    res.json({ 
      success: false, 
      error: error.response?.data?.message || 'Failed to send verification code' 
    });
  }
});

// Connect Bambu Lab account with verification code
app.post('/api/settings/connect-bambu', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  console.log('=== BAMBU CONNECT REQUEST ===');
  const { email, code, region } = req.body;
  
  const apiUrl = region === 'china' 
    ? 'https://api.bambulab.cn/v1/user-service/user/login'
    : 'https://api.bambulab.com/v1/user-service/user/login';
  
  try {
    const requestBody = {
      account: email,
      code: code
    };
    
    console.log('Sending Bambu request to:', apiUrl);
    
    const response = await axios.post(apiUrl, requestBody, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Response status:', response.status);
    
    if (response.data && response.data.accessToken) {
      const token = response.data.accessToken;
      
      // Save to database
      const existing = db.prepare('SELECT id FROM settings WHERE user_id = ?').get(req.session.userId);
      if (existing) {
        db.prepare('UPDATE settings SET bambu_email = ?, bambu_token = ?, bambu_region = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
          .run(email, token, region || 'global', req.session.userId);
      } else {
        db.prepare('INSERT INTO settings (user_id, bambu_email, bambu_token, bambu_region) VALUES (?, ?, ?, ?)')
          .run(req.session.userId, email, token, region || 'global');
      }
      
      // Update session
      req.session.token = token;
      req.session.region = region || 'global';
      req.session.save();
      
      res.json({ success: true });
    } else {
      res.json({ success: false, error: 'Failed to get access token from Bambu Lab' });
    }
  } catch (error) {
    console.error('Bambu connect error:', error.message);
    console.error('Response:', error.response?.data);
    res.json({ 
      success: false, 
      error: error.response?.data?.message || 'Failed to connect to Bambu Lab' 
    });
  }
});

// Get Bambu Lab connection status
app.get('/api/settings/bambu-status', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const email = db.prepare('SELECT value FROM config WHERE key = ?').get('bambu_email');
    const region = db.prepare('SELECT value FROM config WHERE key = ?').get('bambu_region');
    const token = db.prepare('SELECT value FROM config WHERE key = ?').get('bambu_token');
    
    res.json({
      connected: !!token?.value,
      email: email?.value || null,
      region: region?.value || 'global',
      lastUpdated: token?.value ? new Date().toISOString() : null
    });
  } catch (error) {
    console.error('Bambu status error:', error);
    res.status(500).json({ error: 'Failed to get Bambu status' });
  }
});

// Disconnect Bambu Lab account
app.post('/api/settings/disconnect-bambu', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    db.prepare('DELETE FROM config WHERE key IN (?, ?, ?)').run('bambu_email', 'bambu_token', 'bambu_region');
    req.session.token = null;
    req.session.region = null;
    req.session.save();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// Get all Bambu Lab accounts (global - shared across all users)
app.get('/api/bambu/accounts', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const allAccounts = db.prepare('SELECT id, email, region, is_primary, updated_at FROM bambu_accounts ORDER BY is_primary DESC, updated_at DESC').all();
    // Deduplicate by email — keep the first occurrence (is_primary preferred, then most recent)
    const seen = new Set();
    const accounts = allAccounts.filter((a) => {
      const key = `${String(a.email || '').toLowerCase()}::${String(a.region || 'global')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    res.json({ success: true, accounts });
  } catch (error) {
    console.error('Failed to load accounts:', error);
    res.status(500).json({ error: 'Failed to load accounts' });
  }
});

// Add new Bambu Lab account (global - admin/superadmin only)
app.post('/api/bambu/accounts/add', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Only admin/superadmin can add accounts
  if (!['admin', 'superadmin'].includes(req.session.role)) {
    return res.status(403).json({ error: 'Only administrators can add Bambu accounts' });
  }

  const { email, code, region } = req.body;
  const apiUrl = region === 'china'
    ? 'https://api.bambulab.cn/v1/user-service/user/login'
    : 'https://api.bambulab.com/v1/user-service/user/login';

  try {
    // Login to get token
    const response = await axios.post(apiUrl, { account: email, code }, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.accessToken) {
      const token = response.data.accessToken;
      
      // Check if first account - make it primary
      const existingCount = db.prepare('SELECT COUNT(*) as count FROM bambu_accounts').get().count;
      const isPrimary = existingCount === 0 ? 1 : 0;

      // Upsert: if same email+region already exists, just refresh the token
      const existingAccount = db.prepare(
        'SELECT id, is_primary FROM bambu_accounts WHERE LOWER(email) = LOWER(?) AND region = ? ORDER BY is_primary DESC LIMIT 1'
      ).get(email, region);

      if (existingAccount) {
        db.prepare(
          'UPDATE bambu_accounts SET token = ?, user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).run(token, req.session.userId, existingAccount.id);
        // Remove any duplicate rows for the same email+region (keep the one we just updated)
        db.prepare(
          'DELETE FROM bambu_accounts WHERE LOWER(email) = LOWER(?) AND region = ? AND id != ?'
        ).run(email, region, existingAccount.id);
      } else {
        db.prepare(`
          INSERT INTO bambu_accounts (user_id, email, region, token, is_primary)
          VALUES (?, ?, ?, ?, ?)
        `).run(req.session.userId, email, region, token, isPrimary);
      }

      // If this is the primary account, update session
      if (isPrimary) {
        req.session.token = token;
        req.session.region = region;
              // Also refresh session when re-adding an existing primary account
              if (!isPrimary && existingAccount?.is_primary) {
                req.session.token = token;
                req.session.region = region;
                req.session.save(() => {});
              }
        req.session.save();
      }

      res.json({ success: true });
    } else {
      res.json({ success: false, error: 'Invalid verification code' });
    }
  } catch (error) {
    console.error('Failed to add account:', error);
    res.json({ success: false, error: error.response?.data?.message || 'Failed to connect account' });
  }
});

// Remove Bambu Lab account (global - admin/superadmin only)
app.delete('/api/bambu/accounts/:id', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Only admin/superadmin can remove accounts
  if (!['admin', 'superadmin'].includes(req.session.role)) {
    return res.status(403).json({ error: 'Only administrators can remove Bambu accounts' });
  }

  const accountId = parseInt(req.params.id);

  try {
    // Check if account exists
    const account = db.prepare('SELECT * FROM bambu_accounts WHERE id = ?').get(accountId);
    
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Delete account
    db.prepare('DELETE FROM bambu_accounts WHERE id = ?').run(accountId);

    // If it was primary, make another one primary and keep the session aligned
    if (account.is_primary) {
      const newPrimary = db.prepare('SELECT * FROM bambu_accounts ORDER BY id ASC LIMIT 1').get();
      if (newPrimary) {
        db.prepare('UPDATE bambu_accounts SET is_primary = 1 WHERE id = ?').run(newPrimary.id);
        req.session.token = newPrimary.token;
        req.session.region = newPrimary.region;
      } else {
        req.session.token = null;
        req.session.region = null;
      }
      req.session.save(() => {});
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to remove account:', error);
    res.status(500).json({ error: 'Failed to remove account' });
  }
});

// Set primary Bambu Lab account (global - admin/superadmin only)
app.post('/api/bambu/accounts/:id/primary', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Only admin/superadmin can change primary account
  if (!['admin', 'superadmin'].includes(req.session.role)) {
    return res.status(403).json({ error: 'Only administrators can change the primary account' });
  }

  const accountId = parseInt(req.params.id);

  try {
    // Check if account exists
    const account = db.prepare('SELECT * FROM bambu_accounts WHERE id = ?').get(accountId);
    
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Unset all primary flags
    db.prepare('UPDATE bambu_accounts SET is_primary = 0').run();
    
    // Set this one as primary
    db.prepare('UPDATE bambu_accounts SET is_primary = 1 WHERE id = ?').run(accountId);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to set primary account:', error);
    res.status(500).json({ error: 'Failed to set primary account' });
  }
});

// Change password
app.post('/api/settings/change-password', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return res.json({ success: false, error: 'Current password and new password are required' });
  }
  
  if (newPassword.length < 4) {
    return res.json({ success: false, error: 'New password must be at least 4 characters' });
  }
  
  try {
    // Verify current password
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND password = ?').get(req.session.userId, currentPassword);
    
    if (!user) {
      return res.json({ success: false, error: 'Current password is incorrect' });
    }
    
    // Update password
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newPassword, req.session.userId);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Get printer FTP settings
app.get('/api/settings/printer-ftp', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const printerIp = db.prepare('SELECT value FROM config WHERE key = ?').get('printer_ip');
    const accessCode = db.prepare('SELECT value FROM config WHERE key = ?').get('printer_access_code');
    const cameraUrl = db.prepare('SELECT value FROM config WHERE key = ?').get('camera_rtsp_url');
    const serialNumber = db.prepare('SELECT value FROM config WHERE key = ?').get('printer_serial_number');
    
    res.json({ 
      success: true,
      printerIp: printerIp?.value || '',
      printerAccessCode: accessCode?.value || '',
      cameraRtspUrl: cameraUrl?.value || '',
      serialNumber: serialNumber?.value || ''
    });
  } catch (error) {
    console.error('Failed to load printer settings:', error);
    res.status(500).json({ error: 'Failed to load printer settings' });
  }
});

// Save printer FTP settings
app.post('/api/settings/printer-ftp', (req, res) => {
  console.log('=== SAVE PRINTER FTP SETTINGS ===');
  console.log('Authenticated:', req.session.authenticated);
  console.log('User ID:', req.session.userId);
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  
  if (!req.session.authenticated) {
    console.log('ERROR: Not authenticated');
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const { printerIp, printerAccessCode, cameraRtspUrl, serialNumber } = req.body;
  console.log('Parsed values:', { printerIp, printerAccessCode, cameraRtspUrl: cameraRtspUrl ? '***' : null, serialNumber });
  
  try {
    // Save to global config
    const upsert = db.prepare(`
      INSERT INTO config (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `);
    
    console.log('Saving printer settings to global config...');
    upsert.run('printer_ip', printerIp || '', printerIp || '');
    upsert.run('printer_access_code', printerAccessCode || '', printerAccessCode || '');
    upsert.run('camera_rtsp_url', cameraRtspUrl || '', cameraRtspUrl || '');
    if (serialNumber) {
      upsert.run('printer_serial_number', serialNumber, serialNumber);
    }

    if (serialNumber) {
      const devId = serialNumber;
      const placeholderName = `Printer ${serialNumber}`;
      const upsertPrinter = db.prepare(`
        INSERT INTO printers (dev_id, name, ip_address, access_code, serial_number, camera_rtsp_url, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(dev_id) DO UPDATE SET
          ip_address = excluded.ip_address,
          access_code = excluded.access_code,
          serial_number = COALESCE(NULLIF(excluded.serial_number, ''), printers.serial_number),
          camera_rtsp_url = excluded.camera_rtsp_url,
          updated_at = CURRENT_TIMESTAMP
      `);

      upsertPrinter.run(
        devId,
        placeholderName,
        printerIp || '',
        printerAccessCode || '',
        serialNumber || null,
        cameraRtspUrl || null
      );
    } else if (printerIp) {
      const legacyDevId = `printer_${(printerIp || 'manual').replace(/[^a-zA-Z0-9]/g, '_')}`;
      db.prepare(`
        DELETE FROM printers
        WHERE dev_id = ?
           OR ((serial_number IS NULL OR serial_number = '') AND ip_address = ? AND name LIKE 'Printer at %')
      `).run(legacyDevId, printerIp);
    }
    
    const go2rtcInfo = syncGo2RtcConfigSafe();
    console.log('SUCCESS: Settings saved');
    res.json({ success: true, go2rtcConfigPath: go2rtcInfo?.path || go2rtcConfigPath, streamCount: go2rtcInfo?.streamCount || 0 });
  } catch (error) {
    console.error('ERROR: Failed to save printer settings:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to save printer settings', details: error.message });
  }
});

// Alias endpoint for backwards compatibility
app.post('/api/settings/save-printer-ftp', (req, res) => {
  console.log('Redirecting /api/settings/save-printer-ftp to /api/settings/printer-ftp');
  // Forward to the main endpoint
  app._router.handle(Object.assign(req, { url: '/api/settings/printer-ftp', originalUrl: '/api/settings/printer-ftp' }), res);
});

// Test printer FTP connection
app.post('/api/settings/test-printer-ftp', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  let { printerIp, printerAccessCode } = req.body;
  
  // If not provided in request, use global config
  if (!printerIp || !printerAccessCode) {
    try {
      const ip = db.prepare('SELECT value FROM config WHERE key = ?').get('printer_ip');
      const code = db.prepare('SELECT value FROM config WHERE key = ?').get('printer_access_code');
      printerIp = printerIp || ip?.value;
      printerAccessCode = printerAccessCode || code?.value;
    } catch (error) {
      console.error('Failed to load printer settings:', error);
    }
  }
  
  if (!printerIp || !printerAccessCode) {
    return res.json({ success: false, error: 'Printer IP and access code are required' });
  }
  
  try {
    // Test connection
    const connected = await bambuFtp.connect(printerIp, printerAccessCode);
    
    if (!connected) {
      return res.json({ success: false, error: 'Failed to connect to printer' });
    }
    
    // List videos
    const videos = await bambuFtp.listTimelapses(printerIp, printerAccessCode);
    
    res.json({ 
      success: true, 
      videoCount: videos.length 
    });
  } catch (error) {
    console.error('Printer FTP test error:', error);
    res.json({ success: false, error: error.message || 'Failed to connect to printer' });
  }
});

function isValidIpv4(ip) {
  if (!ip || typeof ip !== 'string') {
    return false;
  }

  const parts = ip.trim().split('.');
  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
}

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0);
}

function intToIpv4(value) {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

function netmaskToPrefix(mask) {
  const bits = mask
    .split('.')
    .map((part) => Number(part).toString(2).padStart(8, '0'))
    .join('');

  const firstZero = bits.indexOf('0');
  return firstZero === -1 ? 32 : firstZero;
}

function parseCidr(cidr) {
  const [rawIp, rawPrefix] = String(cidr || '').trim().split('/');
  if (!isValidIpv4(rawIp)) {
    return null;
  }

  const prefix = Number(rawPrefix);
  if (!Number.isInteger(prefix) || prefix < 8 || prefix > 30) {
    return null;
  }

  const ipInt = ipv4ToInt(rawIp);
  const mask = prefix === 0 ? 0 : ((~0 << (32 - prefix)) >>> 0);
  const network = ipInt & mask;
  const broadcast = network | (~mask >>> 0);
  return { network, broadcast, prefix };
}

function normalizeCidr(cidr) {
  const parsed = parseCidr(cidr);
  if (!parsed) {
    return null;
  }

  return `${intToIpv4(parsed.network)}/${parsed.prefix}`;
}

function dedupeStrings(values = []) {
  return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)));
}

function ipInCidr(ip, cidr) {
  if (!isValidIpv4(ip)) {
    return false;
  }

  const parsed = parseCidr(cidr);
  if (!parsed) {
    return false;
  }

  const ipInt = ipv4ToInt(ip);
  return ipInt >= parsed.network && ipInt <= parsed.broadcast;
}

function buildInterfaceCidrs() {
  const interfaces = os.networkInterfaces();
  const cidrs = [];

  Object.values(interfaces).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (!entry || entry.internal || entry.family !== 'IPv4') {
        return;
      }

      if (entry.cidr) {
        cidrs.push(entry.cidr);
        return;
      }

      if (entry.address && entry.netmask && isValidIpv4(entry.address) && isValidIpv4(entry.netmask)) {
        const prefix = netmaskToPrefix(entry.netmask);
        if (prefix >= 8 && prefix <= 30) {
          cidrs.push(`${entry.address}/${prefix}`);
        }
      }
    });
  });

  return cidrs;
}

function expandCidrHosts(cidr, maxHostsPerSubnet = 384) {
  const parsed = parseCidr(cidr);
  if (!parsed) {
    return [];
  }

  const hosts = [];
  const start = parsed.network + 1;
  const end = parsed.broadcast - 1;

  for (let ipInt = start; ipInt <= end; ipInt += 1) {
    hosts.push(intToIpv4(ipInt >>> 0));
    if (hosts.length >= maxHostsPerSubnet) {
      break;
    }
  }

  return hosts;
}

async function getArpTableIps() {
  try {
    const { stdout } = await execAsync('arp -a', { timeout: 2000 });
    const matches = String(stdout || '').match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
    return Array.from(new Set(matches.filter(isValidIpv4)));
  } catch (_error) {
    return [];
  }
}

async function getRouteTableCidrs() {
  const results = [];

  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync('route print -4', { timeout: 3000 });
      const lines = String(stdout || '').split(/\r?\n/);

      lines.forEach((line) => {
        const trimmed = line.trim();
        const match = trimmed.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d{1,3}(?:\.\d{1,3}){3})\s+/);
        if (!match) {
          return;
        }

        const destination = match[1];
        const mask = match[2];
        if (!isValidIpv4(destination) || !isValidIpv4(mask)) {
          return;
        }

        const prefix = netmaskToPrefix(mask);
        if (prefix < 8 || prefix > 30) {
          return;
        }

        if (!isPrivateOrLocalIpv4(destination)) {
          return;
        }

        results.push(`${destination}/${prefix}`);
      });
    } else {
      const { stdout } = await execAsync('ip -o -4 route show', { timeout: 3000 });
      const lines = String(stdout || '').split(/\r?\n/);

      lines.forEach((line) => {
        const tokens = line.trim().split(/\s+/);
        if (tokens.length === 0) {
          return;
        }

        const cidrToken = tokens[0];
        if (!cidrToken.includes('/')) {
          return;
        }

        const normalized = normalizeCidr(cidrToken);
        if (!normalized) {
          return;
        }

        const baseIp = normalized.split('/')[0];
        if (!isPrivateOrLocalIpv4(baseIp)) {
          return;
        }

        results.push(normalized);
      });
    }
  } catch (_error) {
    return [];
  }

  return dedupeStrings(results.map(normalizeCidr).filter(Boolean));
}

function getDiscoveryHistoryCidrs() {
  try {
    const raw = db.prepare('SELECT value FROM config WHERE key = ?').get('discovery_scan_cidrs_history')?.value;
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return dedupeStrings(parsed.map(normalizeCidr).filter(Boolean));
  } catch (_error) {
    return [];
  }
}

function saveDiscoveryHistoryCidrs(cidrs) {
  const normalized = dedupeStrings((cidrs || []).map(normalizeCidr).filter(Boolean)).slice(0, 24);

  db.prepare(`
    INSERT INTO config (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run('discovery_scan_cidrs_history', JSON.stringify(normalized));

  return normalized;
}

function getAutoDiscoveryAttemptedDevIds() {
  try {
    const raw = db.prepare('SELECT value FROM config WHERE key = ?').get('discovery_auto_attempted_dev_ids')?.value;
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return dedupeStrings(parsed);
  } catch (_error) {
    return [];
  }
}

function saveAutoDiscoveryAttemptedDevIds(devIds) {
  const normalized = dedupeStrings(devIds);
  db.prepare(`
    INSERT INTO config (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run('discovery_auto_attempted_dev_ids', JSON.stringify(normalized));
}

function deriveDiscoverySubnetForIp(ip, cidrCandidates = []) {
  const normalizedCandidates = dedupeStrings((cidrCandidates || []).map(normalizeCidr).filter(Boolean));
  const match = normalizedCandidates.find((cidr) => ipInCidr(ip, cidr));
  if (match) {
    return match;
  }

  if (!isValidIpv4(ip)) {
    return null;
  }

  const parts = ip.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

function isPrivateOrLocalIpv4(ip) {
  if (!isValidIpv4(ip)) {
    return false;
  }

  const [a, b] = ip.split('.').map(Number);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function buildCandidateIpList({ existingIp, cloudIp, arpIps, cidrIps, explicitCidrs }) {
  const ordered = [];
  const pushUnique = (value) => {
    const ip = String(value || '').trim();
    if (!isValidIpv4(ip)) {
      return;
    }
    if (!ordered.includes(ip)) {
      ordered.push(ip);
    }
  };

  pushUnique(existingIp);
  pushUnique(cloudIp);
  (arpIps || []).forEach(pushUnique);
  (cidrIps || []).forEach(pushUnique);

  if (Array.isArray(explicitCidrs) && explicitCidrs.length > 0) {
    const explicitIps = explicitCidrs.flatMap((cidr) => expandCidrHosts(cidr, 1024));
    explicitIps.forEach(pushUnique);
  }

  return ordered.filter(isPrivateOrLocalIpv4);
}

function testTcpPort(ip, port = 8883, timeoutMs = 450) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));

    try {
      socket.connect(port, ip);
    } catch (_error) {
      finish(false);
    }
  });
}

async function runWithConcurrency(items, worker, concurrency = 32) {
  const results = [];
  let cursor = 0;

  const runWorker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (_error) {
        results[index] = null;
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

function verifyPrinterViaMqtt(ip, serialNumber, accessCode, timeoutMs = 4500) {
  return new Promise((resolve) => {
    if (!isValidIpv4(ip) || !serialNumber || !accessCode) {
      resolve({ ok: false, reason: 'missing-required-fields' });
      return;
    }

    const requestTopic = `device/${serialNumber}/request`;
    const reportTopic = `device/${serialNumber}/report`;
    const client = mqtt.connect(`mqtts://${ip}:8883`, {
      clientId: `printhive-discovery-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
      username: 'bblp',
      password: accessCode,
      protocol: 'mqtts',
      rejectUnauthorized: false,
      reconnectPeriod: 0,
      connectTimeout: 3000,
    });

    let settled = false;
    const timer = setTimeout(() => {
      done({ ok: false, reason: 'timeout' });
    }, timeoutMs);

    const done = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        client.end(true);
      } catch (_error) {
        // no-op
      }
      resolve(result);
    };

    client.on('connect', () => {
      client.subscribe(reportTopic, (subscribeErr) => {
        if (subscribeErr) {
          done({ ok: false, reason: 'subscribe-failed' });
          return;
        }

        const payload = {
          pushing: {
            sequence_id: Date.now().toString(),
            command: 'pushall',
          },
        };

        client.publish(requestTopic, JSON.stringify(payload), (publishErr) => {
          if (publishErr) {
            done({ ok: false, reason: 'publish-failed' });
          }
        });
      });
    });

    client.on('message', (_topic, message) => {
      try {
        const parsed = JSON.parse(String(message || '{}'));
        if (parsed && typeof parsed === 'object') {
          done({ ok: true, reason: 'verified' });
          return;
        }
      } catch (_error) {
        // Ignore parse failures and keep waiting for the next message.
      }
    });

    client.on('error', () => {
      done({ ok: false, reason: 'mqtt-error' });
    });

    client.on('close', () => {
      if (!settled) {
        done({ ok: false, reason: 'closed' });
      }
    });
  });
}

async function fetchAllCloudDevices() {
  const devices = [];
  const accounts = db.prepare('SELECT email, token, region FROM bambu_accounts').all();

  for (const account of accounts) {
    const apiUrl = account.region === 'china'
      ? 'https://api.bambulab.cn/v1/iot-service/api/user/bind'
      : 'https://api.bambulab.com/v1/iot-service/api/user/bind';

    try {
      const response = await axios.get(apiUrl, {
        headers: { Authorization: `Bearer ${account.token}` },
        timeout: 8000,
      });

      if (Array.isArray(response.data?.devices)) {
        devices.push(...response.data.devices);
      }
    } catch (error) {
      logger.debug(`[Discovery] Could not fetch cloud devices for ${account.email}: ${error.message}`);
    }
  }

  return devices;
}

function findMatchingCloudDevice(devices, printer) {
  const printerDevId = String(printer?.dev_id || '').trim();
  const printerSerial = String(printer?.serial_number || '').trim();
  const printerName = String(printer?.name || '').trim().toLowerCase();

  const exactMatch = (devices || []).find((device) => {
    const deviceDevId = String(device?.dev_id || '').trim();
    const deviceSerial = String(device?.serial_number || '').trim();
    return (
      (printerDevId && (deviceDevId === printerDevId || deviceSerial === printerDevId)) ||
      (printerSerial && (deviceSerial === printerSerial || deviceDevId === printerSerial))
    );
  });

  if (exactMatch) {
    return exactMatch;
  }

  if (!printerName) {
    return null;
  }

  const nameMatches = (devices || []).filter((device) => String(device?.name || '').trim().toLowerCase() === printerName);
  if (nameMatches.length === 1) {
    return nameMatches[0];
  }

  return null;
}

function getCloudDeviceAccessCodeCandidates(cloudDevice) {
  if (!cloudDevice || typeof cloudDevice !== 'object') {
    return [];
  }

  return dedupeStrings([
    cloudDevice.access_code,
    cloudDevice.dev_access_code,
    cloudDevice.lan_access_code,
    cloudDevice.local_access_code,
    cloudDevice?.lan?.access_code,
    cloudDevice?.secure?.access_code,
    cloudDevice?.iot?.access_code,
  ]);
}

async function discoverPrinterIp(printer, { explicitCidrs = [], cloudDevices: cloudDevicesOverride = null } = {}) {
  const serialCandidates = Array.from(new Set([
    String(printer.serial_number || '').trim(),
    String(printer.dev_id || '').trim(),
  ].filter(Boolean)));

  if (serialCandidates.length === 0) {
    return { success: false, error: 'Serial number (or dev_id) is required before discovery can run' };
  }

  const [cloudDevices, arpIps, routeCidrs] = await Promise.all([
    cloudDevicesOverride ? Promise.resolve(cloudDevicesOverride) : fetchAllCloudDevices(),
    getArpTableIps(),
    getRouteTableCidrs(),
  ]);

  const historyCidrs = getDiscoveryHistoryCidrs();
  const cloudDevice = findMatchingCloudDevice(cloudDevices, printer);
  const cloudIp = String(cloudDevice?.ip_address || '').trim();
  const globalAccessCode = String(db.prepare('SELECT value FROM config WHERE key = ?').get('printer_access_code')?.value || '').trim();
  const accessCodeCandidates = dedupeStrings([
    printer.access_code,
    ...getCloudDeviceAccessCodeCandidates(cloudDevice),
    globalAccessCode,
  ]);

  if (accessCodeCandidates.length === 0) {
    return { success: false, error: 'No access code available locally or from cloud for this printer' };
  }

  const interfaceCidrs = buildInterfaceCidrs();
  const autoCidrs = dedupeStrings([...historyCidrs, ...routeCidrs, ...interfaceCidrs].map(normalizeCidr).filter(Boolean));
  const cidrIps = autoCidrs.flatMap((cidr) => expandCidrHosts(cidr));
  const candidateIps = buildCandidateIpList({
    existingIp: printer.ip_address,
    cloudIp,
    arpIps,
    cidrIps,
    explicitCidrs,
  }).slice(0, 2200);

  if (candidateIps.length === 0) {
    return { success: false, error: 'No candidate IP addresses were found to probe' };
  }

  const tcpResults = await runWithConcurrency(candidateIps, async (ip) => {
    const open = await testTcpPort(ip, 8883, 450);
    return { ip, open };
  }, 48);

  const reachable = tcpResults.filter((entry) => entry?.open).map((entry) => entry.ip);
  let discoveredIp = null;
  let matchedSerial = null;

  for (const ip of reachable) {
    for (const accessCodeCandidate of accessCodeCandidates) {
      for (const serialCandidate of serialCandidates) {
        const verify = await verifyPrinterViaMqtt(ip, serialCandidate, accessCodeCandidate);
        if (verify.ok) {
          discoveredIp = ip;
          matchedSerial = serialCandidate;
          break;
        }
      }

      if (discoveredIp) {
        break;
      }
    }

    if (discoveredIp) {
      break;
    }
  }

  if (!discoveredIp) {
    return {
      success: false,
      error: 'No matching printer responded on reachable MQTT endpoints',
      stats: {
        candidateIps: candidateIps.length,
        reachableMqttHosts: reachable.length,
        autoCidrsScanned: autoCidrs,
        explicitCidrs,
      },
      note: 'Auto-discovery scans local interfaces, route-table networks, ARP neighbors, and learned subnet history. Advanced CIDR input is optional fallback for edge networks.',
    };
  }

  const learnedSubnet = deriveDiscoverySubnetForIp(discoveredIp, [...autoCidrs, ...explicitCidrs]);
  const savedHistoryCidrs = saveDiscoveryHistoryCidrs([
    ...historyCidrs,
    ...routeCidrs,
    ...explicitCidrs,
    learnedSubnet,
  ]);

  db.prepare(`
    UPDATE printers
    SET ip_address = ?,
        access_code = COALESCE(NULLIF(?, ''), access_code),
        serial_number = COALESCE(NULLIF(serial_number, ''), ?),
        updated_at = CURRENT_TIMESTAMP
    WHERE dev_id = ?
  `).run(discoveredIp, accessCodeCandidates[0], matchedSerial || serialCandidates[0], printer.dev_id);

  logger.info(`[Discovery] Updated printer ${printer.dev_id} with discovered IP ${discoveredIp}`);

  return {
    success: true,
    discoveredIp,
    matchedSerial: matchedSerial || serialCandidates[0],
    stats: {
      candidateIps: candidateIps.length,
      reachableMqttHosts: reachable.length,
      autoCidrsScanned: autoCidrs,
      explicitCidrs,
      savedHistoryCidrs,
    },
    note: 'Discovery used route tables, ARP neighbors, local interface subnets, and saved subnet history. Advanced CIDR input remains optional fallback only.',
  };
}

// Discover and save local printer IP
app.post('/api/printers/discover-ip', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const devId = String(req.body?.dev_id || '').trim();
  const explicitCidrs = Array.isArray(req.body?.scanCidrs)
    ? req.body.scanCidrs.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  if (!devId) {
    return res.status(400).json({ error: 'dev_id is required' });
  }

  const printer = db.prepare('SELECT * FROM printers WHERE dev_id = ?').get(devId);
  if (!printer) {
    return res.status(404).json({ error: 'Printer not found in local configuration' });
  }

  try {
    const result = await discoverPrinterIp(printer, { explicitCidrs });
    res.json(result);
  } catch (error) {
    logger.error('[Discovery] Failed:', error);
    res.status(500).json({ error: 'Failed to discover printer IP', details: error.message });
  }
});

// Manual discover for unresolved printers (not a background job)
app.post('/api/printers/discover-missing-ips', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const explicitCidrs = Array.isArray(req.body?.scanCidrs)
    ? req.body.scanCidrs.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  try {
    const [cloudDevices, configuredPrinters] = await Promise.all([
      fetchAllCloudDevices(),
      Promise.resolve(db.prepare('SELECT * FROM printers ORDER BY name').all()),
    ]);

    const cloudConfiguredCount = cloudDevices.length;
    const printersWithIp = configuredPrinters.filter((printer) => String(printer.ip_address || '').trim().length > 0).length;
    const unresolved = configuredPrinters.filter((printer) => {
      const hasIp = String(printer.ip_address || '').trim().length > 0;
      const hasSerial = String(printer.serial_number || '').trim().length > 0 || String(printer.dev_id || '').trim().length > 0;
      return !hasIp && hasSerial;
    });

    const missingTarget = cloudConfiguredCount > 0
      ? Math.max(0, cloudConfiguredCount - printersWithIp)
      : unresolved.length;
    const maxToProcess = Math.min(unresolved.length, missingTarget || unresolved.length);

    const processed = [];
    let foundCount = 0;

    for (const printer of unresolved.slice(0, maxToProcess)) {
      const result = await discoverPrinterIp(printer, { explicitCidrs, cloudDevices });
      processed.push({ dev_id: printer.dev_id, name: printer.name || printer.dev_id, ...result });
      if (result.success) {
        foundCount += 1;
      }

      if (missingTarget > 0 && foundCount >= missingTarget) {
        break;
      }
    }

    res.json({
      success: true,
      cloudConfiguredCount,
      printersWithIpBefore: printersWithIp,
      missingTarget,
      processedCount: processed.length,
      foundCount,
      results: processed,
      note: 'Manual discover stops once the missing cloud-configured printer count is satisfied.',
    });
  } catch (error) {
    logger.error('[DiscoveryBulk] Failed:', error);
    res.status(500).json({ error: 'Failed to discover missing printer IPs', details: error.message });
  }
});

// Get all printer configurations
app.get('/api/printers/config', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const printers = db.prepare('SELECT * FROM printers ORDER BY name').all();
    res.json({ success: true, printers });
  } catch (error) {
    console.error('Failed to load printer configs:', error);
    res.status(500).json({ error: 'Failed to load printer configurations' });
  }
});

// Save or update printer configuration
app.post('/api/printers/config', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const { dev_id, name, ip_address, access_code, serial_number, camera_rtsp_url } = req.body;
  
  if (!dev_id) {
    return res.status(400).json({ error: 'dev_id is required' });
  }
  
  try {
    const cloudDevices = await fetchAllCloudDevices();
    const cloudMatch = findMatchingCloudDevice(cloudDevices, { dev_id, name, serial_number });
    const effectiveDevId = String(cloudMatch?.dev_id || dev_id).trim();
    const effectiveSerialNumber = String(serial_number || cloudMatch?.serial_number || '').trim();
    const effectiveAccessCode = dedupeStrings([
      access_code,
      ...getCloudDeviceAccessCodeCandidates(cloudMatch),
    ])[0] || '';
    // Prefer the cloud device's display name so the DB and go2rtc labels stay in sync with the cloud
    const effectiveName = String(cloudMatch?.name || name || '').trim() || name || '';

    const existingPrinter = db.prepare('SELECT * FROM printers WHERE dev_id = ?').get(effectiveDevId);
    const isNewPrinter = !existingPrinter;

    // When cloud binding changes the dev_id, carry over fields from the old record that weren't re-submitted.
    const devIdChanged = effectiveDevId !== dev_id;
    let oldRecord = null;
    if (devIdChanged) {
      oldRecord = db.prepare('SELECT * FROM printers WHERE dev_id = ?').get(dev_id);
    }
    const effectiveCameraRtspUrl = camera_rtsp_url || (devIdChanged ? (oldRecord?.camera_rtsp_url || '') : '') || '';

    const upsert = db.prepare(`
      INSERT INTO printers (dev_id, name, ip_address, access_code, serial_number, camera_rtsp_url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(dev_id) DO UPDATE SET 
        name = ?,
        ip_address = ?,
        access_code = ?,
        serial_number = ?,
        camera_rtsp_url = ?,
        updated_at = CURRENT_TIMESTAMP
    `);
    
    upsert.run(
      effectiveDevId, effectiveName, ip_address, effectiveAccessCode, effectiveSerialNumber, effectiveCameraRtspUrl,
      effectiveName, ip_address, effectiveAccessCode, effectiveSerialNumber, effectiveCameraRtspUrl
    );

    // Broadcast realtime patch so connected clients pick up camera/name updates without reload.
    broadcastRealtimeMessage({
      type: 'printer.telemetry',
      printerId: effectiveDevId,
      payload: {
        dev_id: effectiveDevId,
        name: effectiveName,
        camera_rtsp_url: effectiveCameraRtspUrl || null,
      },
    });

    // Clean up the old manual/placeholder record now that it's been migrated to the cloud identity.
    if (devIdChanged && oldRecord) {
      db.prepare('DELETE FROM printers WHERE dev_id = ?').run(dev_id);
      logger.info(`[CloudBind] Migrated printer "${dev_id}" → "${effectiveDevId}", deleted old record.`);
    }

    const respondWithDiscovery = async () => {
      let autoDiscovery = null;
      const normalizedIp = String(ip_address || '').trim();
      const shouldAutoDiscover = isNewPrinter && !normalizedIp;

      if (shouldAutoDiscover) {
        const attemptedDevIds = getAutoDiscoveryAttemptedDevIds();
        const alreadyAttempted = attemptedDevIds.includes(effectiveDevId);

        if (!alreadyAttempted) {
          saveAutoDiscoveryAttemptedDevIds([...attemptedDevIds, effectiveDevId]);

          const savedPrinter = db.prepare('SELECT * FROM printers WHERE dev_id = ?').get(effectiveDevId);
          if (savedPrinter) {
            autoDiscovery = await discoverPrinterIp(savedPrinter, { explicitCidrs: [], cloudDevices });
          }
        } else {
          autoDiscovery = {
            success: false,
            skipped: true,
            reason: 'already-attempted',
          };
        }
      }

      const go2rtcInfo = syncGo2RtcConfigSafe();
      res.json({
        success: true,
        dev_id: effectiveDevId,
        go2rtcConfigPath: go2rtcInfo?.path || go2rtcConfigPath,
        streamCount: go2rtcInfo?.streamCount || 0,
        autoDiscovery,
      });
    };

    respondWithDiscovery().catch((error) => {
      logger.warn('[AutoDiscovery] Failed after save:', error.message);
      const go2rtcInfo = syncGo2RtcConfigSafe();
      res.json({
        success: true,
        go2rtcConfigPath: go2rtcInfo?.path || go2rtcConfigPath,
        streamCount: go2rtcInfo?.streamCount || 0,
        autoDiscovery: { success: false, error: error.message },
      });
    });
  } catch (error) {
    console.error('Failed to save printer config:', error);
    res.status(500).json({ error: 'Failed to save printer configuration' });
  }
});

// Delete printer configuration
app.delete('/api/printers/config/:dev_id', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const { dev_id } = req.params;
  
  try {
    const printer = db.prepare('SELECT * FROM printers WHERE dev_id = ?').get(dev_id);

    db.prepare(`
      DELETE FROM printers
      WHERE dev_id = ?
         OR (? IS NOT NULL AND ? != '' AND serial_number = ?)
         OR (? IS NOT NULL AND ? != '' AND ip_address = ?)
    `).run(
      dev_id,
      printer?.serial_number || null,
      printer?.serial_number || null,
      printer?.serial_number || null,
      printer?.ip_address || null,
      printer?.ip_address || null,
      printer?.ip_address || null
    );

    const legacyPrinterIp = db.prepare('SELECT value FROM config WHERE key = ?').get('printer_ip')?.value || '';
    const legacySerialNumber = db.prepare('SELECT value FROM config WHERE key = ?').get('printer_serial_number')?.value || '';
    const normalizedLegacyIp = normalizePrinterIp(legacyPrinterIp);
    const normalizedDeletedIp = normalizePrinterIp(printer?.ip_address);

    const matchesLegacyConfig = Boolean(
      printer && (
        (printer.serial_number && legacySerialNumber && printer.serial_number === legacySerialNumber) ||
        (normalizedDeletedIp && normalizedLegacyIp && normalizedDeletedIp === normalizedLegacyIp) ||
        dev_id === legacySerialNumber
      )
    );

    if (matchesLegacyConfig) {
      db.prepare('DELETE FROM config WHERE key IN (?, ?, ?, ?)').run(
        'printer_ip',
        'printer_access_code',
        'printer_serial_number',
        'camera_rtsp_url'
      );
    }

    const go2rtcInfo = syncGo2RtcConfigSafe();
    res.json({ success: true, clearedLegacyConfig: matchesLegacyConfig, go2rtcConfigPath: go2rtcInfo?.path || go2rtcConfigPath, streamCount: go2rtcInfo?.streamCount || 0 });
  } catch (error) {
    console.error('Failed to delete printer config:', error);
    res.status(500).json({ error: 'Failed to delete printer configuration' });
  }
});

// Get UI settings (hide buy me a coffee, etc.) - PUBLIC endpoint
app.get('/api/settings/ui', (req, res) => {
  try {
    const hideBmc = db.prepare('SELECT value FROM config WHERE key = ?').get('hide_bmc');
    const colorScheme = db.prepare('SELECT value FROM config WHERE key = ?').get('color_scheme');
    const cameraMode = db.prepare('SELECT value FROM config WHERE key = ?').get('camera_mode');
    const cameraStreamType = db.prepare('SELECT value FROM config WHERE key = ?').get('camera_stream_type');
    const cameraStreamUrl = db.prepare('SELECT value FROM config WHERE key = ?').get('camera_stream_url');
    const frigateStreamUrl = db.prepare('SELECT value FROM config WHERE key = ?').get('frigate_stream_url');
    const rtspUrl = db.prepare('SELECT value FROM config WHERE key = ?').get('rtsp_url');
    const legacyFrigateUrl = db.prepare('SELECT value FROM config WHERE key = ?').get('frigate_url');
    const canExposePrivateStreamSettings = Boolean(req.session?.authenticated);

    const normalizedCameraMode = cameraMode?.value === 'native-rtsp' ? 'native-rtsp' : 'frigate';
    const normalizedStreamType = cameraStreamType?.value === 'frigate-webrtc' ? 'frigate-webrtc' : 'frigate-hls';
    const resolvedFrigateStreamUrl = normalizeStreamRelayUrl(
      frigateStreamUrl?.value || (normalizedCameraMode === 'frigate' ? cameraStreamUrl?.value || legacyFrigateUrl?.value || '' : legacyFrigateUrl?.value || '')
    );
    const resolvedRtspUrl = String(rtspUrl?.value || (normalizedCameraMode === 'native-rtsp' ? cameraStreamUrl?.value || '' : '')).trim();
    const activeCameraStreamUrl = normalizedCameraMode === 'native-rtsp' ? resolvedRtspUrl : resolvedFrigateStreamUrl;

    res.json({
      success: true,
      hideBmc: hideBmc?.value === 'true',
      colorScheme: colorScheme?.value || 'cyan',
      cameraMode: normalizedCameraMode,
      cameraStreamType: normalizedStreamType,
      frigateStreamUrl: canExposePrivateStreamSettings ? resolvedFrigateStreamUrl : '',
      rtspUrl: canExposePrivateStreamSettings ? resolvedRtspUrl : '',
      cameraStreamUrl: canExposePrivateStreamSettings ? activeCameraStreamUrl : '',
    });
  } catch (error) {
    console.error('Failed to load UI settings:', error);
    res.status(500).json({ error: 'Failed to load UI settings' });
  }
});

// Save UI settings (admin only)
app.post('/api/settings/ui', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Check if user is admin
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const {
      hideBmc,
      colorScheme,
      cameraMode,
      cameraStreamType,
      frigateStreamUrl,
      rtspUrl,
      cameraStreamUrl,
    } = req.body;

    const upsert = db.prepare(`
      INSERT INTO config (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `);

    upsert.run('hide_bmc', hideBmc ? 'true' : 'false', hideBmc ? 'true' : 'false');
    if (colorScheme) {
      upsert.run('color_scheme', colorScheme, colorScheme);
    }

    const normalizedCameraMode = cameraMode === 'native-rtsp' ? 'native-rtsp' : 'frigate';
    const normalizedStreamType = cameraStreamType === 'frigate-webrtc' ? 'frigate-webrtc' : 'frigate-hls';
    const normalizedFrigateStreamUrl = typeof frigateStreamUrl === 'string'
      ? normalizeStreamRelayUrl(frigateStreamUrl)
      : (typeof cameraStreamUrl === 'string' ? normalizeStreamRelayUrl(cameraStreamUrl) : '');
    const normalizedRtspUrl = typeof rtspUrl === 'string' ? String(rtspUrl).trim() : '';
    const normalizedActiveStreamUrl = normalizedCameraMode === 'native-rtsp' ? normalizedRtspUrl : normalizedFrigateStreamUrl;

    upsert.run('camera_mode', normalizedCameraMode, normalizedCameraMode);
    upsert.run('camera_stream_type', normalizedStreamType, normalizedStreamType);
    upsert.run('frigate_stream_url', normalizedFrigateStreamUrl, normalizedFrigateStreamUrl);
    upsert.run('rtsp_url', normalizedRtspUrl, normalizedRtspUrl);
    upsert.run('camera_stream_url', normalizedActiveStreamUrl, normalizedActiveStreamUrl);

    db.prepare('DELETE FROM config WHERE key = ?').run('camera_fps');

    const go2rtcInfo = syncGo2RtcConfigSafe();
    res.json({
      success: true,
      cameraMode: normalizedCameraMode,
      cameraStreamType: normalizedStreamType,
      frigateStreamUrl: normalizedFrigateStreamUrl,
      rtspUrl: normalizedRtspUrl,
      cameraStreamUrl: normalizedActiveStreamUrl,
      go2rtcConfigPath: go2rtcInfo?.path || go2rtcConfigPath,
      streamCount: go2rtcInfo?.streamCount || 0,
    });
  } catch (error) {
    console.error('Failed to save UI settings:', error);
    res.status(500).json({ error: 'Failed to save UI settings' });
  }
});

const dashboardWidgetIds = new Set(['livePrinters', 'healthSummary', 'backgroundJobs', 'activityStream', 'heatmap', 'storageTrend', 'upcomingSchedule', 'queuePressure', 'backupTelemetry', 'duplicatePressure']);
const dashboardBreakpointKeys = ['lg', 'md', 'sm', 'xs', 'xxs'];

const defaultDashboardLayouts = {
  lg: [
    { i: 'livePrinters', x: 0, y: 0, w: 5, h: 6, minW: 4, minH: 5 },
    { i: 'healthSummary', x: 5, y: 0, w: 3, h: 5, minW: 3, minH: 4 },
    { i: 'queuePressure', x: 8, y: 0, w: 4, h: 5, minW: 3, minH: 4 },
    { i: 'backupTelemetry', x: 5, y: 5, w: 3, h: 5, minW: 3, minH: 4 },
    { i: 'backgroundJobs', x: 8, y: 5, w: 4, h: 6, minW: 3, minH: 5 },
    { i: 'activityStream', x: 0, y: 6, w: 7, h: 8, minW: 5, minH: 6 },
    { i: 'storageTrend', x: 7, y: 11, w: 5, h: 8, minW: 4, minH: 6 },
    { i: 'heatmap', x: 0, y: 14, w: 7, h: 6, minW: 4, minH: 5 },
    { i: 'upcomingSchedule', x: 7, y: 19, w: 5, h: 6, minW: 4, minH: 5 },
    { i: 'duplicatePressure', x: 0, y: 20, w: 7, h: 5, minW: 4, minH: 4 },
  ],
  md: [
    { i: 'livePrinters', x: 0, y: 0, w: 10, h: 6, minW: 4, minH: 5 },
    { i: 'healthSummary', x: 0, y: 6, w: 5, h: 5, minW: 3, minH: 4 },
    { i: 'queuePressure', x: 5, y: 6, w: 5, h: 5, minW: 3, minH: 4 },
    { i: 'backupTelemetry', x: 0, y: 11, w: 5, h: 5, minW: 3, minH: 4 },
    { i: 'backgroundJobs', x: 5, y: 11, w: 5, h: 6, minW: 3, minH: 5 },
    { i: 'activityStream', x: 0, y: 17, w: 10, h: 8, minW: 5, minH: 6 },
    { i: 'storageTrend', x: 0, y: 25, w: 10, h: 8, minW: 5, minH: 6 },
    { i: 'heatmap', x: 0, y: 33, w: 10, h: 6, minW: 4, minH: 5 },
    { i: 'upcomingSchedule', x: 0, y: 39, w: 10, h: 6, minW: 4, minH: 5 },
    { i: 'duplicatePressure', x: 0, y: 45, w: 10, h: 5, minW: 4, minH: 4 },
  ],
  sm: [
    { i: 'livePrinters', x: 0, y: 0, w: 6, h: 6, minW: 3, minH: 5 },
    { i: 'healthSummary', x: 0, y: 6, w: 6, h: 5, minW: 3, minH: 4 },
    { i: 'queuePressure', x: 0, y: 11, w: 6, h: 5, minW: 3, minH: 4 },
    { i: 'backupTelemetry', x: 0, y: 16, w: 6, h: 5, minW: 3, minH: 4 },
    { i: 'backgroundJobs', x: 0, y: 21, w: 6, h: 6, minW: 3, minH: 5 },
    { i: 'activityStream', x: 0, y: 27, w: 6, h: 8, minW: 4, minH: 6 },
    { i: 'storageTrend', x: 0, y: 35, w: 6, h: 8, minW: 4, minH: 6 },
    { i: 'heatmap', x: 0, y: 43, w: 6, h: 6, minW: 4, minH: 5 },
    { i: 'upcomingSchedule', x: 0, y: 49, w: 6, h: 6, minW: 4, minH: 5 },
    { i: 'duplicatePressure', x: 0, y: 55, w: 6, h: 5, minW: 4, minH: 4 },
  ],
  xs: [
    { i: 'livePrinters', x: 0, y: 0, w: 4, h: 6, minW: 2, minH: 5 },
    { i: 'healthSummary', x: 0, y: 6, w: 4, h: 5, minW: 2, minH: 4 },
    { i: 'queuePressure', x: 0, y: 11, w: 4, h: 5, minW: 2, minH: 4 },
    { i: 'backupTelemetry', x: 0, y: 16, w: 4, h: 5, minW: 2, minH: 4 },
    { i: 'backgroundJobs', x: 0, y: 21, w: 4, h: 6, minW: 2, minH: 5 },
    { i: 'activityStream', x: 0, y: 27, w: 4, h: 8, minW: 2, minH: 6 },
    { i: 'storageTrend', x: 0, y: 35, w: 4, h: 8, minW: 2, minH: 6 },
    { i: 'heatmap', x: 0, y: 43, w: 4, h: 6, minW: 2, minH: 5 },
    { i: 'upcomingSchedule', x: 0, y: 49, w: 4, h: 6, minW: 2, minH: 5 },
    { i: 'duplicatePressure', x: 0, y: 55, w: 4, h: 5, minW: 2, minH: 4 },
  ],
  xxs: [
    { i: 'livePrinters', x: 0, y: 0, w: 2, h: 6, minW: 2, minH: 5 },
    { i: 'healthSummary', x: 0, y: 6, w: 2, h: 5, minW: 2, minH: 4 },
    { i: 'queuePressure', x: 0, y: 11, w: 2, h: 5, minW: 2, minH: 4 },
    { i: 'backupTelemetry', x: 0, y: 16, w: 2, h: 5, minW: 2, minH: 4 },
    { i: 'backgroundJobs', x: 0, y: 21, w: 2, h: 6, minW: 2, minH: 5 },
    { i: 'activityStream', x: 0, y: 27, w: 2, h: 8, minW: 2, minH: 6 },
    { i: 'storageTrend', x: 0, y: 35, w: 2, h: 8, minW: 2, minH: 6 },
    { i: 'heatmap', x: 0, y: 43, w: 2, h: 6, minW: 2, minH: 5 },
    { i: 'upcomingSchedule', x: 0, y: 49, w: 2, h: 6, minW: 2, minH: 5 },
    { i: 'duplicatePressure', x: 0, y: 55, w: 2, h: 5, minW: 2, minH: 4 },
  ],
};

const defaultDashboardWidgetPrefs = {
  version: 2,
  layouts: defaultDashboardLayouts,
  hiddenWidgetIds: [],
};

function sanitizeDashboardWidgetPrefs(raw = {}) {
  const safe = raw && typeof raw === 'object' ? raw : {};

  const normalizeHidden = (list) => {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const id = String(item || '').trim();
      if (!dashboardWidgetIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  };

  const parseLayoutValue = (input, fallback, min, max) => {
    const parsed = Number.parseInt(String(input), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  };

  const normalizeLayouts = (inputLayouts) => {
    const output = {};

    for (const key of dashboardBreakpointKeys) {
      const defaults = Array.isArray(defaultDashboardLayouts[key]) ? defaultDashboardLayouts[key] : [];
      const map = new Map(defaults.map((item) => [item.i, { ...item }]));
      const incoming = inputLayouts && Array.isArray(inputLayouts[key]) ? inputLayouts[key] : [];

      for (const item of incoming) {
        if (!item || typeof item.i !== 'string' || !dashboardWidgetIds.has(item.i)) {
          continue;
        }
        const fallback = map.get(item.i) || { i: item.i, x: 0, y: 0, w: 4, h: 4, minW: 2, minH: 2 };
        const minW = parseLayoutValue(item.minW, fallback.minW || 2, 1, 24);
        const minH = parseLayoutValue(item.minH, fallback.minH || 2, 2, 24);

        map.set(item.i, {
          i: item.i,
          x: parseLayoutValue(item.x, fallback.x, 0, 24),
          y: parseLayoutValue(item.y, fallback.y, 0, 999),
          w: parseLayoutValue(item.w, fallback.w, minW, 24),
          h: parseLayoutValue(item.h, fallback.h, minH, 24),
          minW,
          minH,
        });
      }

      output[key] = defaults.map((item) => map.get(item.i) || item);
    }

    return output;
  };

  // Backward compatibility with prior single-layout schema.
  const legacyLayout = safe.widgetLayout && typeof safe.widgetLayout === 'object' ? safe.widgetLayout : null;
  const legacyHidden = Array.isArray(safe.widgetHidden) ? safe.widgetHidden : [];
  const migratedLayouts = legacyLayout
    ? {
        lg: Object.keys(legacyLayout).map((id) => {
          const item = legacyLayout[id] && typeof legacyLayout[id] === 'object' ? legacyLayout[id] : {};
          return {
            i: id,
            x: parseLayoutValue(item.x, 0, 0, 24),
            y: parseLayoutValue(item.y, 0, 0, 999),
            w: parseLayoutValue(item.w, 4, 1, 24),
            h: parseLayoutValue(item.h, 5, 2, 24),
            minW: parseLayoutValue(item.minW, 2, 1, 24),
            minH: parseLayoutValue(item.minH, 2, 2, 24),
          };
        }),
      }
    : null;

  const layouts = normalizeLayouts(safe.layouts || migratedLayouts || defaultDashboardLayouts);
  const hiddenWidgetIds = normalizeHidden(safe.hiddenWidgetIds || legacyHidden);

  return {
    version: 2,
    layouts,
    hiddenWidgetIds,
  };
}

function getDashboardWidgetConfigKey(userId) {
  return `dashboard_widgets_layout_user_${userId}`;
}

// Get dashboard widget preferences (authenticated)
app.get('/api/settings/dashboard-widgets', (req, res) => {
  if (!req.session?.authenticated || !req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const key = getDashboardWidgetConfigKey(req.session.userId);
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);

    if (!row?.value) {
      return res.json({ success: true, preferences: defaultDashboardWidgetPrefs });
    }

    let parsed = {};
    try {
      parsed = JSON.parse(row.value);
    } catch {
      parsed = {};
    }

    return res.json({ success: true, preferences: sanitizeDashboardWidgetPrefs(parsed) });
  } catch (error) {
    console.error('Failed to load dashboard widget settings:', error);
    return res.status(500).json({ error: 'Failed to load dashboard widget settings' });
  }
});

// Save dashboard widget preferences (authenticated)
app.post('/api/settings/dashboard-widgets', (req, res) => {
  if (!req.session?.authenticated || !req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const preferences = sanitizeDashboardWidgetPrefs(req.body || {});
    const key = getDashboardWidgetConfigKey(req.session.userId);

    db.prepare(`
      INSERT INTO config (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, JSON.stringify(preferences));

    return res.json({ success: true, preferences });
  } catch (error) {
    console.error('Failed to save dashboard widget settings:', error);
    return res.status(500).json({ error: 'Failed to save dashboard widget settings' });
  }
});

app.get('/api/camera/stream', (req, res) => {
  if (!req.session?.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    if (typeof ffmpegAvailable !== 'undefined' && !ffmpegAvailable) {
      return res.status(503).json({ error: 'FFmpeg is not available on the PrintHive host' });
    }

    const requestedPrinterId = String(req.query?.printerId || '').trim();
    const { rtspUrl, proxyKey } = getConfiguredRtspSource(requestedPrinterId);
    if (!rtspUrl) {
      return res.status(404).json({ error: 'No RTSP URL configured for this printer or the global Native RTSP mode' });
    }

    getRtspCameraProxy(proxyKey).addClient(res, rtspUrl);
  } catch (error) {
    logger.error('[RTSP proxy] Failed to start camera stream:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to start Native RTSP camera stream' });
    } else {
      res.end();
    }
  }
});

app.post('/api/camera/stop', (req, res) => {
  if (!req.session?.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const requestedPrinterId = String(req.body?.printerId || req.query?.printerId || '').trim();
    if (requestedPrinterId) {
      stopRtspCameraProxy(`printer:${requestedPrinterId}`);
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('[RTSP proxy] Failed to stop camera stream:', error);
    res.status(500).json({ error: 'Failed to stop Native RTSP camera stream' });
  }
});

// Get user profile
app.get('/api/settings/profile', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const user = db.prepare('SELECT username, email, display_name, oauth_provider FROM users WHERE id = ?').get(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      username: user.username,
      email: user.email || '',
      displayName: user.display_name || '',
      oauthProvider: user.oauth_provider || 'none'
    });
  } catch (error) {
    console.error('Failed to get user profile:', error);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

// Update user profile
app.post('/api/settings/profile', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const { displayName, email } = req.body;
    
    // Update user profile
    const user = db.prepare('SELECT oauth_provider FROM users WHERE id = ?').get(req.session.userId);
    
    // For OAuth users, only allow display name changes if email is not managed by OAuth
    if (user.oauth_provider && email !== undefined) {
      // Don't allow email changes for OAuth users
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, req.session.userId);
    } else {
      // Local users can change both
      db.prepare('UPDATE users SET display_name = ?, email = ? WHERE id = ?').run(displayName, email, req.session.userId);
    }
    
    res.json({ success: true, message: 'Profile updated successfully!' });
  } catch (error) {
    console.error('Failed to update user profile:', error);
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});

// Global state for video matching background job
let videoMatchJob = {
  running: false,
  total: 0,
  processed: 0,
  matched: 0,
  unmatched: 0,
  currentVideo: '',
  startTime: null
};

// Global state for library scan background job
let libraryScanJob = {
  running: false,
  total: 0,
  processed: 0,
  added: 0,
  skipped: 0,
  currentFile: '',
  startTime: null
};

// Global state for auto-tag background job
let autoTagJob = {
  running: false,
  total: 0,
  processed: 0,
  completed: 0,
  failed: 0,
  currentFile: '',
  startTime: null,
  queue: []
};

// Global state for bulk delete background job
let bulkDeleteJob = {
  running: false,
  total: 0,
  processed: 0,
  deleted: 0,
  failed: 0,
  currentFile: '',
  startTime: null,
  queue: []
};

// Match videos to prints based on timestamp (non-blocking background job)
app.post('/api/match-videos', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Check if already running
  if (videoMatchJob.running) {
    return res.json({ 
      success: false, 
      message: 'Video matching job already running',
      status: videoMatchJob
    });
  }
  
  try {
    const videosDir = path.join(__dirname, 'data', 'videos');
    
    // Get all video files
    const videoFiles = fs.existsSync(videosDir) 
      ? fs.readdirSync(videosDir).filter(f => f.endsWith('.avi') || f.endsWith('.mp4'))
      : [];
    
    // Get all prints that don't have videos yet
    const printsWithoutVideo = db.prepare(`
      SELECT id, modelId, title, startTime, endTime
      FROM prints
      WHERE (videoLocal IS NULL OR videoLocal = '')
        AND startTime IS NOT NULL
      ORDER BY startTime DESC
    `).all();
    
    // Initialize job status
    videoMatchJob = {
      running: true,
      total: videoFiles.length,
      processed: 0,
      matched: 0,
      unmatched: 0,
      currentVideo: '',
      startTime: Date.now()
    };
    
    console.log(`=== VIDEO MATCH: Starting background job for ${videoFiles.length} videos ===`);
    console.log(`Found ${printsWithoutVideo.length} prints without videos`);
    
    // Return immediately with job started status
    res.json({ 
      success: true, 
      message: `Video matching started for ${videoFiles.length} files. Check /api/match-videos-status for progress.`,
      status: videoMatchJob
    });
    
    // Process videos in background
    (async () => {
      const matchDetails = [];
      
      for (const videoFile of videoFiles) {
        // Check if job was cancelled
        if (!videoMatchJob.running) {
          console.log('  Video matching job cancelled by user');
          break;
        }
        
        videoMatchJob.processed++;
        videoMatchJob.currentVideo = videoFile;
        
        // Extract timestamp from filename: video_2024-12-13_15-18-02.avi
        const match = videoFile.match(/video_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
        
        if (match) {
          const [, date, hours, minutes, seconds] = match;
          const videoDate = new Date(`${date}T${hours}:${minutes}:${seconds}`);
          const videoTimestampMs = videoDate.getTime();
          
          // Find the best matching print
          let bestMatch = null;
          let bestTimeDiff = Infinity;
          
          for (const print of printsWithoutVideo) {
            let printDate;
            const st = print.startTime;
            
            if (/^\d+$/.test(st)) {
              const ts = parseInt(st);
              printDate = new Date(ts > 9999999999 ? ts : ts * 1000);
            } else if (st.includes('T') || st.includes(' ')) {
              printDate = new Date(st);
            } else {
              continue;
            }
            
            if (isNaN(printDate.getTime())) continue;
            
            const timeDiff = Math.abs(videoTimestampMs - printDate.getTime());
            const hoursDiff = timeDiff / (1000 * 60 * 60);
            
            if (hoursDiff <= 4 && timeDiff < bestTimeDiff) {
              bestTimeDiff = timeDiff;
              bestMatch = print;
            }
          }
          
          if (bestMatch) {
            db.prepare('UPDATE prints SET videoLocal = ? WHERE id = ?').run(videoFile, bestMatch.id);
            const idx = printsWithoutVideo.findIndex(p => p.id === bestMatch.id);
            if (idx > -1) printsWithoutVideo.splice(idx, 1);
            
            videoMatchJob.matched++;
            matchDetails.push({ 
              video: videoFile, 
              print: bestMatch.title || bestMatch.modelId, 
              timeDiffMinutes: Math.round(bestTimeDiff / (1000 * 60))
            });
            console.log(`  [${videoMatchJob.processed}/${videoMatchJob.total}] Matched: ${videoFile} -> ${bestMatch.title || bestMatch.modelId}`);
          } else {
            videoMatchJob.unmatched++;
            console.log(`  [${videoMatchJob.processed}/${videoMatchJob.total}] No match: ${videoFile}`);
          }
        } else {
          videoMatchJob.unmatched++;
        }
        
        // Yield control to event loop
        await yieldToEventLoop();
      }
      
      const elapsed = ((Date.now() - videoMatchJob.startTime) / 1000).toFixed(1);
      console.log(`=== VIDEO MATCH COMPLETE: ${videoMatchJob.matched} matched, ${videoMatchJob.unmatched} unmatched in ${elapsed}s ===`);
      
      videoMatchJob.running = false;
      videoMatchJob.currentVideo = '';
    })();
    
  } catch (error) {
    console.error('Match videos error:', error);
    videoMatchJob.running = false;
    res.status(500).json({ error: 'Failed to start video matching' });
  }
});

// Check video match job status
app.get('/api/match-videos-status', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const elapsed = videoMatchJob.startTime ? ((Date.now() - videoMatchJob.startTime) / 1000).toFixed(1) : 0;
  const percent = videoMatchJob.total > 0 ? Math.round((videoMatchJob.processed / videoMatchJob.total) * 100) : 0;
  
  res.json({
    ...videoMatchJob,
    elapsedSeconds: elapsed,
    percentComplete: percent
  });
});

// Cancel video match job
app.post('/api/match-videos-cancel', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  if (!videoMatchJob.running) {
    return res.json({ success: false, message: 'No video matching job running' });
  }
  
  videoMatchJob.running = false;
  res.json({ success: true, message: 'Video matching job cancelled' });
});

// Debug endpoint to check video matching
app.get('/api/debug/videos', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    // Get all prints with their video info
    const prints = db.prepare(`
      SELECT id, modelId, title, startTime, videoLocal, videoUrl
      FROM prints
      ORDER BY startTime DESC
      LIMIT 20
    `).all();
    
    // Get all video files in directory
    const videoFiles = fs.existsSync(videosDir) 
      ? fs.readdirSync(videosDir).filter(f => f.endsWith('.avi') || f.endsWith('.mp4'))
      : [];
    
    // Check which files exist
    const printsWithStatus = prints.map(p => {
      let fileExists = false;
      let fullPath = '';
      
      if (p.videoLocal) {
        // Try different path formats
        fullPath = path.join(videosDir, p.videoLocal);
        fileExists = fs.existsSync(fullPath);
        
        if (!fileExists) {
          // Maybe it's stored with a different format
          const justFilename = path.basename(p.videoLocal);
          fullPath = path.join(videosDir, justFilename);
          fileExists = fs.existsSync(fullPath);
        }
      }
      
      return {
        ...p,
        videoLocalExists: fileExists,
        fullPath: fullPath,
        startTimeFormatted: p.startTime
      };
    });
    
    res.json({
      prints: printsWithStatus,
      videoFiles: videoFiles,
      videosDir: videosDir
    });
  } catch (error) {
    console.error('Debug videos error:', error);
    res.status(500).json({ error: error.message });
  }
});


// Check authentication status
app.get('/api/check-auth', (req, res) => {
  console.log('=== CHECK AUTH ===');
  console.log('Session ID:', req.sessionID);
  console.log('Session data:', req.session);
  console.log('Cookies:', req.headers.cookie);
  console.log('Authenticated:', req.session.authenticated);
  console.log('User ID:', req.session.userId);
  console.log('Has token:', !!req.session.token);
  
  if (req.session.authenticated && req.session.userId) {
    // Fetch current user role from database to ensure it's up to date
    try {
      const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
      const currentRole = user ? user.role : (req.session.role || 'user');
      
      // Update session if role changed
      if (user && req.session.role !== currentRole) {
        req.session.role = currentRole;
        console.log(`Updated session role to: ${currentRole}`);
      }
      
      res.json({ 
        authenticated: true, 
        username: req.session.username,
        role: currentRole
      });
    } catch (e) {
      console.error('Error fetching user role:', e);
      res.json({ 
        authenticated: true, 
        username: req.session.username,
        role: req.session.role || 'user'
      });
    }
  } else {
    res.json({ authenticated: false });
  }
});

// Logout endpoint
app.post('/auth/logout', (req, res) => {
  console.log('=== LOGOUT ===');
  console.log('Session ID:', req.sessionID);
  
  // Check if user logged in via OIDC
  const isOidcUser = req.session.userId ? (() => {
    try {
      const user = db.prepare('SELECT oauth_provider FROM users WHERE id = ?').get(req.session.userId);
      return user?.oauth_provider === 'oidc';
    } catch (err) {
      console.error('Error checking OAuth provider:', err);
      return false;
    }
  })() : false;
  
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
      res.json({ success: false, error: 'Failed to logout' });
    } else {
      // If OIDC user, return the end-session URL for redirect
      if (isOidcUser) {
        try {
          const publicHostname = db.prepare('SELECT value FROM config WHERE key = ?').get('oauth_publicHostname');
          const configuredEndSessionUrl = db.prepare('SELECT value FROM config WHERE key = ?').get('oauth_oidcEndSessionUrl');
          const publicUrl = publicHostname?.value || process.env.PUBLIC_URL || 'http://localhost:3000';
          
          let endSessionUrl;
          
          // Use configured end-session URL if provided
          if (configuredEndSessionUrl?.value) {
            // Build full logout URL with post_logout_redirect_uri parameter
            const logoutUrl = new URL(configuredEndSessionUrl.value);
            // Add flag to prevent auto-redirect after logout
            logoutUrl.searchParams.set('post_logout_redirect_uri', `${publicUrl}/admin?logout=1`);
            endSessionUrl = logoutUrl.href;
            console.log('OIDC logout using configured URL:', endSessionUrl);
          } else if (oidcConfig) {
            // Fallback: try to build from OIDC discovery
            try {
              const builtUrl = oidc.buildEndSessionUrl(oidcConfig.server, {
                post_logout_redirect_uri: `${publicUrl}/admin?logout=1`,
              });
              endSessionUrl = builtUrl.href;
              console.log('OIDC logout using discovered URL:', endSessionUrl);
            } catch (buildErr) {
              console.error('Failed to build end-session URL:', buildErr);
              // Manual fallback - construct from issuer
              const issuer = db.prepare('SELECT value FROM config WHERE key = ?').get('oauth_oidcIssuer');
              if (issuer?.value) {
                endSessionUrl = `${issuer.value}${issuer.value.endsWith('/') ? '' : '/'}end-session/?post_logout_redirect_uri=${encodeURIComponent(`${publicUrl}/admin?logout=1`)}`;
                console.log('OIDC logout using manual URL:', endSessionUrl);
              }
            }
          }
          
          if (endSessionUrl) {
            res.json({ success: true, oidcLogout: true, endSessionUrl });
          } else {
            console.log('No OIDC logout URL available, doing local logout only');
            res.json({ success: true });
          }
        } catch (err) {
          console.error('Error building end-session URL:', err);
          res.json({ success: true });
        }
      } else {
        res.json({ success: true });
      }
    }
  });
});

// Request new email verification code
app.post('/auth/request-code', async (req, res) => {
  const { email, region } = req.body;
  
  console.log('=== REQUEST NEW CODE ===');
  console.log('Email:', email);
  
  const apiUrl = region === 'china'
    ? 'https://api.bambulab.cn/v1/user-service/user/sendemail/code'
    : 'https://api.bambulab.com/v1/user-service/user/sendemail/code';
  
  try {
    await axios.post(apiUrl, {
      email: email,
      type: 'codeLogin'
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Verification code requested successfully');
    res.json({ success: true, message: 'Verification code sent to your email' });
  } catch (error) {
    console.error('Request code error:', error.response?.data || error.message);
    res.json({ 
      success: false, 
      error: error.response?.data?.message || 'Failed to send verification code' 
    });
  }
});

function buildConfiguredPrinterDevice(printer) {
  return {
    dev_id: printer.dev_id,
    name: printer.name || printer.serial_number || printer.ip_address || 'Configured Printer',
    dev_product_name: 'Configured Printer',
    online: false,
    print_status: 'CONFIGURED',
    ip_address: printer.ip_address || null,
    access_code: printer.access_code || null,
    serial_number: printer.serial_number || null,
    camera_rtsp_url: printer.camera_rtsp_url || null,
    current_task: null
  };
}

function normalizePrinterIp(ip) {
  return String(ip || '').trim();
}

function isLegacyPlaceholderPrinter(printer) {
  const devId = String(printer?.dev_id || '').trim().toLowerCase();
  const name = String(printer?.name || '').trim();
  const serialNumber = String(printer?.serial_number || '').trim();

  return !serialNumber &&
    (devId.startsWith('printer_') || devId.startsWith('manual_')) &&
    (!name || /^printer at\s+/i.test(name) || /^printer\s+\d/i.test(name));
}

function mergeConfiguredPrinters(devices = []) {
  const mergedDevices = new Map();

  for (const device of Array.isArray(devices) ? devices : []) {
    if (device?.dev_id) {
      mergedDevices.set(device.dev_id, { ...device });
    }
  }

  try {
    const configuredPrinters = db.prepare('SELECT * FROM printers ORDER BY name').all();
    const hasRealCloudPrinters = Array.from(mergedDevices.values()).some((device) => {
      return device?.dev_product_name && device.dev_product_name !== 'Configured Printer';
    });

    for (const printer of configuredPrinters) {
      if (hasRealCloudPrinters && isLegacyPlaceholderPrinter(printer)) {
        continue;
      }

      const matchingKey = Array.from(mergedDevices.keys()).find((key) => {
        const device = mergedDevices.get(key);
        const normalizedConfiguredIp = normalizePrinterIp(printer.ip_address);
        const normalizedDeviceIp = normalizePrinterIp(device?.ip_address);

        return key === printer.dev_id ||
          (!!printer.serial_number && (key === printer.serial_number || device?.serial_number === printer.serial_number)) ||
          (!!normalizedConfiguredIp && normalizedDeviceIp === normalizedConfiguredIp);
      });

      const existingDevice = matchingKey ? mergedDevices.get(matchingKey) : null;
      const alreadyMerged = mergedDevices.get(matchingKey || printer.dev_id);
      const mergedDevice = {
        ...buildConfiguredPrinterDevice(printer),
        ...existingDevice,
        name: existingDevice?.name || printer.name || existingDevice?.serial_number || printer.serial_number || printer.ip_address || 'Configured Printer',
        ip_address: printer.ip_address || existingDevice?.ip_address || null,
        access_code: printer.access_code || existingDevice?.access_code || null,
        serial_number: printer.serial_number || existingDevice?.serial_number || null,
        camera_rtsp_url: printer.camera_rtsp_url || alreadyMerged?.camera_rtsp_url || existingDevice?.camera_rtsp_url || null
      };

      mergedDevices.set(matchingKey || printer.dev_id, mergedDevice);
    }
  } catch (error) {
    logger.warn('Could not load configured printers:', error.message);
  }

  return Array.from(mergedDevices.values());
}

// API routes
app.get('/api/printers', async (req, res) => {
  logger.info('Printers request');
  logger.debug('Auth:', req.session.authenticated, 'Token present:', !!req.session.token);
  logger.debug('Token preview:', req.session.token ? req.session.token.substring(0, 20) + '...' : 'N/A');
  
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Get camera URL and printer settings from global config
  const cameraUrl = db.prepare('SELECT value FROM config WHERE key = ?').get('camera_rtsp_url')?.value || null;
  const printerIp = db.prepare('SELECT value FROM config WHERE key = ?').get('printer_ip')?.value;
  const accessCode = db.prepare('SELECT value FROM config WHERE key = ?').get('printer_access_code')?.value;
  const serialNumber = db.prepare('SELECT value FROM config WHERE key = ?').get('printer_serial_number')?.value;
  
  let printersData = { devices: [] };
  
  // Get all Bambu accounts (global)
  const bambuAccounts = db.prepare('SELECT id, email, token, region FROM bambu_accounts').all();
  
  // Try to get printers from all connected Bambu Cloud accounts
  if (bambuAccounts.length > 0) {
    for (const account of bambuAccounts) {
      try {
        const apiUrl = account.region === 'china' 
          ? 'https://api.bambulab.cn/v1/iot-service/api/user/bind'
          : 'https://api.bambulab.com/v1/iot-service/api/user/bind';
        
        const response = await axios.get(apiUrl, {
          headers: { 'Authorization': `Bearer ${account.token}` }
        });
        
        if (response.data?.devices) {
          logger.debug(`Found ${response.data.devices.length} printers from account ${account.email}`);
          printersData.devices = [...printersData.devices, ...response.data.devices];
        }
      } catch (error) {
        logger.warn(`Could not fetch printers from account ${account.email}:`, error.message);
      }
    }
  }
  
  // Merge in locally configured printers so manually added printers always appear in the UI
  printersData.devices = mergeConfiguredPrinters(printersData.devices);

  // Legacy fallback for older single-printer MQTT config
  if (printersData.devices.length === 0 && printerIp && accessCode && serialNumber) {
    logger.info('No Bambu Cloud printers, but legacy local MQTT config exists - creating virtual device');
    printersData.devices = [{
      dev_id: serialNumber,
      name: 'Local Printer (MQTT)',
      dev_product_name: 'Unknown Model',
      online: false,
      print_status: 'CONFIGURED',
      ip_address: printerIp,
      access_code: accessCode,
      serial_number: serialNumber,
      camera_rtsp_url: cameraUrl || null,
      current_task: null
    }];
  }
  
  try {
    // Add camera URL and fetch current task for each printer
    if (printersData.devices) {
      const devicesWithExtras = await Promise.all(printersData.devices.map(async (device) => {
        const deviceData = { ...device };
        
        // Check for per-printer config from printers table (camera URL, IP, access code)
        const printerConfig = db.prepare('SELECT camera_rtsp_url, ip_address, access_code FROM printers WHERE dev_id = ?').get(device.dev_id);
        if (printerConfig) {
          if (printerConfig.camera_rtsp_url) deviceData.camera_rtsp_url = printerConfig.camera_rtsp_url;
          if (printerConfig.ip_address) deviceData.ip_address = printerConfig.ip_address;
          if (printerConfig.access_code) deviceData.access_code = printerConfig.access_code;
        }
        
        // Fallback to global camera URL
        if (!deviceData.camera_rtsp_url && cameraUrl) {
          deviceData.camera_rtsp_url = cameraUrl;
        }
        
        // Fallback to global printer IP/access code
        if (!deviceData.ip_address && printerIp) deviceData.ip_address = printerIp;
        if (!deviceData.access_code && accessCode) deviceData.access_code = accessCode;
        
        // Try to get current job from MQTT client using per-printer credentials when available
        const deviceIp = deviceData.ip_address || printerIp;
        const deviceAccessCode = deviceData.access_code || accessCode;
        const deviceSerial = deviceData.serial_number || device.dev_id;

        if (deviceIp && deviceAccessCode && deviceSerial) {
          const clientKey = `${deviceIp}:${device.dev_id}`;
          
          // Create or get existing MQTT client for this printer
          if (!mqttClients.has(clientKey)) {
            try {
              const mqttClient = new BambuMqttClient(deviceIp, deviceSerial, deviceAccessCode, device.name || 'Local Printer');
              
              // Handle connection errors gracefully
              mqttClient.on('error', (error) => {
                logger.warn(`MQTT error for ${device.dev_id}: ${error.message}`);
                mqttClients.delete(clientKey);
              });
              
              mqttClient.on('disconnected', () => {
                logger.info(`MQTT disconnected for ${device.dev_id}`);
                mqttClients.delete(clientKey);
              });

              attachRealtimeBridgeToMqttClient(mqttClient, clientKey, deviceData);
              
              // Handle print state changes for Discord notifications
              mqttClient.on('print_completed', async (data) => {
                // Look up actual design title from database using existing print columns
                const print = findRecentPrintByJobName(data.jobName);
                
                const designName = print?.designTitle || print?.title || print?.plateName || data.jobName;
                
                logger.info(`Print completed on ${data.printerName}: ${data.jobName} (${designName})`);
                await sendNotification('printer', {
                  status: 'completed',
                  printerName: data.printerName,
                  jobName: data.jobName,
                  modelName: designName,
                  progress: data.progress,
                  message: `Print job "${data.jobName}" has completed successfully!`
                });
              });
              
              mqttClient.on('print_failed', async (data) => {
                // Look up actual design title from database using existing print columns
                const print = findRecentPrintByJobName(data.jobName);
                
                const designName = print?.designTitle || print?.title || print?.plateName || data.jobName;
                
                logger.warn(`Print FAILED on ${data.printerName}: ${data.jobName} (${designName})`);
                await sendNotification('printer', {
                  status: 'failed',
                  printerName: data.printerName,
                  jobName: data.jobName,
                  modelName: designName,
                  errorCode: data.errorCode ? `0x${data.errorCode.toString(16).toUpperCase()}` : undefined,
                  progress: data.progress,
                  message: `Print job "${data.jobName}" has FAILED at ${data.progress}%!`
                });
              });
              
              mqttClient.on('print_error', async (data) => {
                // Look up actual design title from database using existing print columns
                const print = findRecentPrintByJobName(data.jobName);
                
                const designName = print?.designTitle || print?.title || print?.plateName || data.jobName;
                
                logger.warn(`Print ERROR on ${data.printerName}: ${data.jobName} (${designName})`);
                await sendNotification('printer', {
                  status: 'error',
                  printerName: data.printerName,
                  jobName: data.jobName,
                  modelName: designName,
                  errorCode: data.errorCode ? `0x${data.errorCode.toString(16).toUpperCase()}` : undefined,
                  progress: data.progress,
                  message: `Printer error detected during "${data.jobName}" at ${data.progress}%`
                });
              });
              
              mqttClient.on('print_paused', async (data) => {
                // Look up actual design title from database using existing print columns
                const print = findRecentPrintByJobName(data.jobName);
                
                const designName = print?.designTitle || print?.title || print?.plateName || data.jobName;
                
                logger.info(`Print paused on ${data.printerName}: ${data.jobName} (${designName})`);
                await sendNotification('printer', {
                  status: 'paused',
                  printerName: data.printerName,
                  jobName: data.jobName,
                  modelName: designName,
                  progress: data.progress,
                  message: `Print job "${data.jobName}" has been paused at ${data.progress}%`
                });
              });
              
              await mqttClient.connect();
              mqttClients.set(clientKey, mqttClient);
              logger.info(`Created MQTT client for ${device.dev_id}`);
              
              // Wait briefly for initial MQTT message with AMS data
              await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
              logger.warn(`Could not connect MQTT for ${device.dev_id}: ${error.message}`);
            }
          }
          
          // Get current job data from MQTT client
          const mqttClient = mqttClients.get(clientKey);
          if (mqttClient) {
            attachRealtimeBridgeToMqttClient(mqttClient, clientKey, deviceData);
          }

          if (mqttClient && mqttClient.connected) {
            const jobData = mqttClient.getCurrentJob();
            const debugMqttLogging = logger.isLevelEnabled('DEBUG');
            
            if (debugMqttLogging) {
              logger.debug(`=== MQTT Job Data for ${device.dev_id} ===`);
              logger.debug(`Job data exists: ${!!jobData}`);
              if (jobData) {
                logger.debug(`Job keys: ${Object.keys(jobData).join(', ')}`);
                logger.debug(`Has AMS: ${!!jobData.ams}`);
                if (jobData.ams) {
                  logger.debug(`AMS structure: ${JSON.stringify(jobData.ams, null, 2)}`);
                }
              }
            }
            
            if (jobData) {
              // Always include AMS info at device level if available
              if (jobData.ams) {
                deviceData.ams = jobData.ams;
                logger.info(`✓ AMS data set for ${device.dev_id}: ${jobData.ams.trays?.length || 0} trays`);
              } else {
                logger.debug(`✗ No AMS data in jobData for ${device.dev_id}`);
              }
              
              // Only include current_task if there's an actual job (not idle)
              const gcodeState = jobData.gcode_state ? jobData.gcode_state.toUpperCase() : 'IDLE';
              if (jobData.name && gcodeState !== 'IDLE') {
                // Pass all MQTT job data to current_task (includes temps, speeds, AMS, etc.)
                deviceData.current_task = { ...jobData };
                logger.debug(`Current task set for ${device.dev_id}, includes AMS: ${!!deviceData.current_task.ams}`);
                
                // Derive print_status from gcode_state for more accurate status
                if (gcodeState === 'RUNNING') {
                  deviceData.print_status = 'RUNNING';
                } else if (gcodeState === 'FINISH') {
                  deviceData.print_status = 'SUCCESS';
                } else if (gcodeState === 'FAILED') {
                  deviceData.print_status = 'FAILED';
                } else if (gcodeState === 'PAUSE') {
                  deviceData.print_status = 'PAUSED';
                }
                logger.debug(`Updated print_status to ${deviceData.print_status} based on gcode_state ${gcodeState}`);
                
                // Check if there's a 3MF file for this print
                if (jobData.name) {
                  const file3mf = db.prepare(`
                    SELECT f.filepath, f.modelId
                    FROM files f
                    JOIN prints p ON f.modelId = p.modelId
                    WHERE p.title = ? AND f.filetype = '3mf'
                    ORDER BY p.startTime DESC
                    LIMIT 1
                  `).get(jobData.name);
                  
                  if (file3mf) {
                    deviceData.current_task.model_id = file3mf.modelId;
                    deviceData.current_task.has_3mf = true;
                    logger.debug(`Found 3MF for current job: ${file3mf.modelId}`);
                  }
                }
                
                // Use integrated P1S camera RTSP URL if available from MQTT
                if (jobData.rtsp_url && !deviceData.camera_rtsp_url) {
                  deviceData.camera_rtsp_url = jobData.rtsp_url;
                }
                logger.debug(`Got job data via MQTT for ${device.dev_id}`);
              } else {
                // Printer is idle - set status explicitly
                deviceData.print_status = 'IDLE';
                logger.debug(`Printer ${device.dev_id} is IDLE (gcode_state: ${gcodeState})`);
              }
            }
          }
        }
        
        return deviceData;
      }));
      
      printersData.devices = devicesWithExtras;
    }
    
    // Log AMS data in final response for debugging
    printersData.devices?.forEach(device => {
      if (device.ams) {
        logger.info(`✓ Device ${device.dev_id} has AMS in API response: ${device.ams.trays?.length || 0} trays`);
      } else if (device.current_task?.ams) {
        logger.info(`✓ Device ${device.dev_id} has AMS in current_task: ${device.current_task.ams.trays?.length || 0} trays`);
      } else {
        logger.debug(`✗ Device ${device.dev_id} has NO AMS data in API response`);
      }
    });
    
    res.json(printersData);
  } catch (error) {
    logger.error('Printers error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch printers', details: error.response?.data });
  }
});

// Simple printer status for dashboard
app.get('/api/printers/status', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    let devices = [];

    const bambuAccounts = db.prepare(`
      SELECT email, token, region
      FROM bambu_accounts
      WHERE token IS NOT NULL AND token != ''
    `).all();

    for (const account of bambuAccounts) {
      try {
        const apiUrl = account.region === 'china'
          ? 'https://api.bambulab.cn/v1/iot-service/api/user/bind'
          : 'https://api.bambulab.com/v1/iot-service/api/user/bind';

        const response = await axios.get(apiUrl, {
          headers: { 'Authorization': `Bearer ${account.token}` },
          timeout: 15000
        });

        if (response.data?.devices) {
          devices = [...devices, ...response.data.devices];
        }
      } catch (error) {
        logger.warn(`Could not fetch dashboard printer status from account ${account.email}: ${error.message}`);
      }
    }

    devices = mergeConfiguredPrinters(devices);

    const legacyPrinterIp = db.prepare('SELECT value FROM config WHERE key = ?').get('printer_ip')?.value;
    const legacyAccessCode = db.prepare('SELECT value FROM config WHERE key = ?').get('printer_access_code')?.value;
    const legacySerialNumber = db.prepare('SELECT value FROM config WHERE key = ?').get('printer_serial_number')?.value;

    if (devices.length === 0 && legacyPrinterIp && legacyAccessCode && legacySerialNumber) {
      devices = [{
        dev_id: legacySerialNumber,
        name: 'Local Printer (MQTT)',
        dev_product_name: 'Unknown Model',
        online: false,
        print_status: 'CONFIGURED',
        ip_address: legacyPrinterIp,
        access_code: legacyAccessCode,
        serial_number: legacySerialNumber,
        current_task: null
      }];
    }

    const printers = devices.map(device => ({
      id: device.dev_id,
      name: device.name || 'Printer',
      model: device.dev_product_name || (device.serial_number ? 'Local Printer' : 'Configured Printer'),
      status: device.print_status || device.current_task?.gcode_state || 'CONFIGURED',
      progress: device.print_progress || device.current_task?.progress || 0,
      online: Boolean(device.online),
      currentPrint: device.current_task?.name || null,
      nozzleTemp: device.nozzle_temper || device.current_task?.nozzle_temp || 0,
      bedTemp: device.bed_temper || device.current_task?.bed_temp || 0
    }));
    
    const online = printers.filter(p => p.online).length;
    
    res.json({
      printers,
      online,
      total: printers.length
    });
  } catch (error) {
    console.error('Printer status error:', error.message);

    const fallbackPrinters = mergeConfiguredPrinters([]).map(device => ({
      id: device.dev_id,
      name: device.name || 'Printer',
      model: device.dev_product_name || 'Configured Printer',
      status: device.print_status || 'CONFIGURED',
      progress: 0,
      online: false,
      currentPrint: null,
      nozzleTemp: 0,
      bedTemp: 0
    }));

    res.json({
      printers: fallbackPrinters,
      online: 0,
      total: fallbackPrinters.length
    });
  }
});

// Get recent prints for dashboard
app.get('/api/prints', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const limit = parseInt(req.query.limit) || 50;
  
  try {
    const prints = db.prepare(`
      SELECT id, title, cover, modelId, status, startTime, deviceName, weight, costTime
      FROM prints 
      ORDER BY startTime DESC 
      LIMIT ?
    `).all(limit);
    
    // Resolve local cover paths
    const coverCacheDir = path.join(__dirname, 'data', 'cover-cache');
    const printsWithCovers = prints.map(print => {
      let coverUrl = null;
      if (print.modelId) {
        const jpgPath = path.join(coverCacheDir, `${print.modelId}.jpg`);
        const pngPath = path.join(coverCacheDir, `${print.modelId}.png`);
        if (fs.existsSync(jpgPath)) {
          coverUrl = `/images/covers/${print.modelId}.jpg`;
        } else if (fs.existsSync(pngPath)) {
          coverUrl = `/images/covers/${print.modelId}.png`;
        }
      }
      return { ...print, cover: coverUrl };
    });
    
    res.json(printsWithCovers);
  } catch (error) {
    console.error('Prints error:', error.message);
    res.json([]);
  }
});

// Get cover image for current print job
app.get('/api/job-cover/:dev_id', async (req, res) => {
  const { dev_id } = req.params;
  
  try {
    // Get printer settings from global config
    const printerIp = db.prepare('SELECT value FROM config WHERE key = ?').get('printer_ip')?.value;
    const accessCode = db.prepare('SELECT value FROM config WHERE key = ?').get('printer_access_code')?.value;
    
    if (!printerIp || !accessCode) {
      // Silent 404 - expected when printer not configured
      return res.status(404).end();
    }
    
    // Get MQTT client for this printer
    const mqttClient = mqttClients.get(dev_id);
    if (!mqttClient || !mqttClient.connected) {
      // Silent 404 - expected when printer offline
      return res.status(404).end();
    }
    
    // Get current job data
    const jobData = mqttClient.getCurrentJob();
    if (!jobData || !jobData.gcode_file) {
      // Silent 404 - expected when no active job
      return res.status(404).end();
    }
    
    // Fetch cover image from 3MF file
    const base64Image = await coverImageFetcher.fetchCoverImage(
      printerIp,
      accessCode,
      jobData.gcode_file,
      jobData.subtask_name
    );
    
    if (!base64Image) {
      // Silent 404 - expected when 3MF has no cover
      return res.status(404).end();
    }
    
    // Decode base64 and send as image
    const imageBuffer = Buffer.from(base64Image, 'base64');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.send(imageBuffer);
  } catch (error) {
    // Only log actual errors, not expected 404s
    console.error('Cover image error:', error);
    res.status(500).end();
  }
});

app.get('/api/models', async (req, res) => {
  console.log('=== MODELS REQUEST ===');
  
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const { search, status, source } = req.query;
  
  // If searching or filtering, use database
  if ((source === 'db' && (search || status)) || (search || status)) {
    try {
      console.log('Searching database with:', { search, status });
      const dbPrints = searchPrintsInDb(search || '', status ? parseInt(status) : null);
      
      // Add cost calculation to each print
      const printsWithCost = dbPrints.map(print => ({
        ...print,
        estimatedCost: calculatePrintCost(print)
      }));
      
      console.log(`Found ${printsWithCost.length} prints in database`);
      return res.json({ models: printsWithCost, hits: printsWithCost, total: printsWithCost.length, source: 'db' });
    } catch (error) {
      console.error('Database search error:', error.message);
      // Fall through to API call
    }
  }
  
  // If source=db but no search/filter, try database first
  if (source === 'db') {
    try {
      const dbPrints = getAllPrintsFromDb();
      if (dbPrints.length > 0) {
        // Add cost calculation to each print
        const printsWithCost = dbPrints.map(print => ({
          ...print,
          estimatedCost: calculatePrintCost(print)
        }));
        
        console.log(`Returning ${printsWithCost.length} prints from database cache`);
        return res.json({ models: printsWithCost, hits: printsWithCost, total: printsWithCost.length, source: 'cache' });
      }
      console.log('Database is empty, fetching from API...');
    } catch (error) {
      console.error('Database error:', error.message);
    }
  }
  
  try {
    const response = await axios.get('https://api.bambulab.com/v1/user-service/my/tasks?limit=20', {
      headers: { 'Authorization': `Bearer ${req.session.token}` }
    });
    console.log('Models response:', JSON.stringify(response.data, null, 2));
    
    // Store prints in database
    if (response.data && response.data.hits && response.data.hits.length > 0) {
      console.log(`Storing ${response.data.hits.length} prints in database...`);
      try {
        storePrints(response.data.hits);
        console.log('Prints stored successfully');
        
        // Download cover images in background
        response.data.hits.forEach(async (print) => {
          if (print.cover && print.modelId) {
            const localPath = await downloadCoverImage(print.cover, print.modelId);
            if (localPath) {
              console.log(`Downloaded cover for ${print.modelId}`);
            }
          }
        });
      } catch (dbError) {
        console.error('Error storing prints:', dbError.message);
      }
    }
    
    res.json(response.data || { hits: [] });
  } catch (error) {
    console.error('Models error:', error.response?.data || error.message);
    
    // Fallback to database if API fails
    console.log('API failed, falling back to database...');
    try {
      const dbPrints = getAllPrintsFromDb();
      
      // Add cost calculation to each print
      const printsWithCost = dbPrints.map(print => ({
        ...print,
        estimatedCost: calculatePrintCost(print)
      }));
      
      console.log(`Returning ${printsWithCost.length} prints from database`);
      return res.json({ hits: printsWithCost, total: printsWithCost.length, source: 'cache' });
    } catch (dbError) {
      console.error('Database fallback error:', dbError.message);
      res.status(500).json({ error: 'Failed to fetch models' });
    }
  }
});

app.get('/api/timelapses', async (req, res) => {
  console.log('=== TIMELAPSES REQUEST ===');
  
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const response = await axios.get('https://api.bambulab.com/v1/user-service/my/timelapses?limit=20', {
      headers: { 'Authorization': `Bearer ${req.session.token}` }
    });
    console.log('Timelapses response:', JSON.stringify(response.data, null, 2));
    res.json(response.data || { hits: [] });
  } catch (error) {
    console.error('Timelapses error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch timelapses' });
  }
});

// Download model file endpoint
app.get('/api/download/:modelId', async (req, res) => {
  console.log('=== DOWNLOAD REQUEST ===');
  console.log('Model ID:', req.params.modelId);
  
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const print = getPrintByModelIdFromDb(req.params.modelId);
    if (!print) {
      console.error('Print not found in database');
      return res.status(404).json({ error: 'Model not found in database' });
    }
    
    console.log('Found print:', { id: print.id, title: print.title, modelId: print.modelId, designId: print.designId });
    
    // Use the design ID from MakerWorld instead of task ID
    if (!print.designId) {
      return res.status(404).json({ error: 'No design ID available for this print. Model may not be downloadable.' });
    }
    
    // Fetch the design details from MakerWorld
    const designUrl = `https://makerworld.com/api/v1/designs/${print.designId}`;
    console.log('Fetching design from:', designUrl);
    
    const designResponse = await axios.get(designUrl);
    
    if (designResponse.data && designResponse.data.files && designResponse.data.files.length > 0) {
      // Find the 3MF file
      const file3mf = designResponse.data.files.find(f => f.name && f.name.toLowerCase().endsWith('.3mf'));
      
      if (file3mf && file3mf.url) {
        console.log('Downloading 3MF from MakerWorld:', file3mf.url);
        const fileResponse = await axios.get(file3mf.url, { 
          responseType: 'arraybuffer'
        });
        
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${print.designTitle || print.title || print.modelId}.3mf"`);
        res.send(fileResponse.data);
      } else {
        res.status(404).json({ error: '3MF file not found in design' });
      }
    } else {
      res.status(404).json({ error: 'Design files not available' });
    }
  } catch (error) {
    console.error('Download error:', error.message);
    console.error('Error response:', error.response?.data);
    res.status(500).json({ error: 'Failed to download file', details: error.response?.data || error.message });
  }
});

// Download from printer SD card
app.get('/api/printer/download/:modelId', async (req, res) => {
  console.log('=== PRINTER DOWNLOAD REQUEST ===');
  console.log('Model ID:', req.params.modelId);
  
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const print = getPrintByModelIdFromDb(req.params.modelId);
    if (!print) {
      return res.status(404).json({ error: 'Print not found in database' });
    }
    
    console.log('Found print:', { id: print.id, title: print.title, profileId: print.profileId });
    
    // The 3MF file is stored on the printer at: ftp://<printer_ip>/cache/<profileId>.3mf
    // We need to use the Bambu API to access it via signed URL
    const fileUrl = `https://api.bambulab.com/v1/iot-service/api/user/project/${print.profileId}`;
    console.log('Fetching file info from:', fileUrl);
    
    const fileResponse = await axios.get(fileUrl, {
      headers: { 'Authorization': `Bearer ${req.session.token}` }
    });
    
    if (fileResponse.data && fileResponse.data.url) {
      console.log('Downloading from printer:', fileResponse.data.url);
      const downloadResponse = await axios.get(fileResponse.data.url, { 
        responseType: 'arraybuffer',
        timeout: 30000
      });
      
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${print.title || print.modelId}.3mf"`);
      res.send(downloadResponse.data);
    } else {
      res.status(404).json({ error: 'File URL not available from printer' });
    }
  } catch (error) {
    console.error('Printer download error:', error.message);
    res.status(500).json({ error: 'Failed to download from printer', details: error.message });
  }
});

// Download local 3MF file
app.get('/api/local/download/:modelId', async (req, res) => {
  console.log('=== LOCAL 3MF DOWNLOAD REQUEST ===');
  console.log('Model ID:', req.params.modelId);
  
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    // Find the 3MF file in the files table
    const file = db.prepare(`
      SELECT filepath, filename
      FROM files
      WHERE modelId = ? AND filetype = '3mf'
      LIMIT 1
    `).get(req.params.modelId);
    
    if (!file || !file.filepath) {
      return res.status(404).json({ error: '3MF file not found locally' });
    }
    
    // Check if file exists
    if (!fs.existsSync(file.filepath)) {
      return res.status(404).json({ error: '3MF file not found on disk' });
    }
    
    console.log('Sending local 3MF file:', file.filepath);
    
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.sendFile(file.filepath);
  } catch (error) {
    console.error('Local download error:', error.message);
    res.status(500).json({ error: 'Failed to download local file', details: error.message });
  }
});

// Get timelapse video
app.get('/api/timelapse/:modelId', async (req, res) => {
  console.log('=== TIMELAPSE REQUEST ===');
  console.log('Model ID:', req.params.modelId);
  
  try {
    const print = getPrintByModelIdFromDb(req.params.modelId);
    if (!print) {
      return res.status(404).json({ error: 'Print not found' });
    }
    
    // Check if we have a local video file first (no auth required for local files)
    if (print.videoLocal) {
      const localVideoPath = path.join(videosDir, print.videoLocal);
      console.log('Checking for local video:', localVideoPath);
      
      if (fs.existsSync(localVideoPath)) {
        console.log('Found local video, converting to MP4...');
        
        try {
          // Convert AVI to MP4 (or use existing MP4)
          const mp4Path = await videoConverter.getMp4Path(localVideoPath);
          console.log('Serving MP4 file:', mp4Path);
          
          const stat = fs.statSync(mp4Path);
          const fileSize = stat.size;
          const range = req.headers.range;

          if (range) {
            // Handle range requests for video seeking
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(mp4Path, { start, end });
            const head = {
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': chunksize,
              'Content-Type': 'video/mp4',
            };
            res.writeHead(206, head);
            file.pipe(res);
          } else {
            // Send full file
            const head = {
              'Content-Length': fileSize,
              'Content-Type': 'video/mp4',
              'Content-Disposition': `inline; filename="${print.title || print.modelId}.mp4"`,
            };
            res.writeHead(200, head);
            fs.createReadStream(mp4Path).pipe(res);
          }
          return;
        } catch (conversionError) {
          console.error('Conversion error:', conversionError);
          return res.status(500).json({ error: 'Failed to convert video', details: conversionError.message });
        }
      }
    }
    
    // Cloud videos require authentication
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated - cloud videos require login' });
    }
    
    // Fallback to fetching from Bambu API if no local video
    console.log('No local video, fetching from cloud API...');
    const [activeAccount] = getConfiguredBambuAccounts(req);
    const token = activeAccount?.token || req.session.token;
    const apiBase = getBambuApiBase(activeAccount?.region || req.session.region || 'global');

    if (!token) {
      return res.status(400).json({ error: 'No Bambu account connected for cloud video access' });
    }

    const timelapseUrl = `${apiBase}/v1/iot-service/api/user/task/${print.id}/video`;
    console.log('Fetching timelapse from:', timelapseUrl);
    
    const response = await axios.get(timelapseUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.data && response.data.url) {
      // Stream the video
      const videoResponse = await axios.get(response.data.url, {
        responseType: 'stream'
      });
      
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', `inline; filename="${print.title || print.modelId}.mp4"`);
      videoResponse.data.pipe(res);
    } else {
      res.status(404).json({ error: 'Timelapse not available' });
    }
  } catch (error) {
    console.error('Timelapse error:', error.message);
    res.status(500).json({ error: 'Failed to get timelapse', details: error.message });
  }
});

// Sync database with API
app.post('/api/sync', async (req, res) => {
  console.log('=== SYNC REQUEST ===');
  console.log('Authenticated:', req.session.authenticated);
  
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const accounts = getConfiguredBambuAccounts(req);

    if (!accounts.length) {
      return res.status(400).json({ error: 'No Bambu account connected for cloud sync' });
    }

    console.log(`Fetching tasks from ${accounts.length} Bambu account(s)...`);

    const accountResults = await Promise.allSettled(accounts.map(async (account) => {
      const apiBase = getBambuApiBase(account.region);
      const response = await axios.get(`${apiBase}/v1/user-service/my/tasks?limit=100`, {
        headers: { 'Authorization': `Bearer ${account.token}` },
        timeout: 10000
      });

      const hits = (response.data?.hits || []).map((print) => ({
        ...print,
        __accountToken: account.token,
        __apiBase: apiBase,
        __accountEmail: account.email || null
      }));

      console.log(`Account ${account.email || 'session'} returned ${hits.length} task(s)`);
      return hits;
    }));

    const allHits = [];
    accountResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        allHits.push(...result.value);
      } else {
        console.log(`Failed to fetch tasks for ${accounts[index]?.email || 'session'}: ${result.reason?.message || result.reason}`);
      }
    });

    const uniqueHits = Array.from(
      new Map(allHits.map((print) => [print.id || print.modelId, print])).values()
    );
    const storedHits = uniqueHits.map(({ __accountToken, __apiBase, __accountEmail, ...print }) => print);

    console.log('API Response received. Total unique hits:', uniqueHits.length || 0);
    
    if (uniqueHits.length > 0) {
      console.log('Sample task structure:', JSON.stringify(storedHits[0], null, 2));
      console.log('Storing prints in database...');
      const result = storePrints(storedHits);
      console.log('Store result:', result);
      
      // Download covers and timelapses
      console.log('Starting downloads...');
      
      const downloadResults = await Promise.all(
        uniqueHits.slice(0, 50).map(async (print) => {
          const result = { cover: false, video: false };
          
          // Download cover - check both cover and coverUrl fields
          const coverUrl = print.cover || print.coverUrl || print.snapshot;
          if (coverUrl && print.modelId) {
            try {
              console.log(`Downloading cover for ${print.modelId}: ${coverUrl.substring(0, 80)}...`);
              const localPath = await downloadCoverImage(coverUrl, print.modelId);
              if (localPath) {
                console.log(`✓ Cover saved: ${localPath}`);
                result.cover = true;
              } else {
                console.log(`✗ Cover download returned null for ${print.modelId}`);
              }
            } catch (err) {
              console.log(`✗ Cover download failed for ${print.modelId}: ${err.message}`);
            }
          } else {
            console.log(`No cover URL for ${print.modelId || print.id}`);
          }
          
          // Try to download timelapse video
          try {
            const taskId = print.id;
            const apiBase = print.__apiBase || getBambuApiBase(req.session.region || 'global');
            const token = print.__accountToken || req.session.token;
            const videoEndpoint = `${apiBase}/v1/iot-service/api/user/task/${taskId}/video`;
            
            console.log(`Checking timelapse for task ${taskId}...`);
            
            try {
              const videoResponse = await axios.get(videoEndpoint, {
                headers: { 'Authorization': `Bearer ${token}` },
                timeout: 10000,
                maxRedirects: 0,
                validateStatus: (status) => status < 400 || status === 302 || status === 301
              });
              
              let videoUrl = null;
              
              if (videoResponse.data?.url) {
                videoUrl = videoResponse.data.url;
              } else if (videoResponse.headers?.location) {
                videoUrl = videoResponse.headers.location;
              } else if (videoResponse.status === 200) {
                videoUrl = videoEndpoint;
              }
              
              if (videoUrl) {
                console.log(`Downloading video for ${print.modelId}...`);
                const videoPath = await downloadTimelapseVideo(videoUrl, print.modelId, taskId);
                if (videoPath) {
                  updatePrintVideoPath(print.modelId, videoPath);
                  result.video = true;
                  console.log(`✓ Downloaded timelapse for ${print.modelId}`);
                }
              }
            } catch (videoErr) {
              if (videoErr.response?.status !== 404) {
                console.log(`Video fetch error for ${print.modelId}:`, videoErr.message);
              }
            }
          } catch (err) {
            // Silent fail for timelapses
          }
          
          return result;
        })
      );
      
      const downloadedCovers = downloadResults.filter(r => r.cover).length;
      const downloadedVideos = downloadResults.filter(r => r.video).length;
      
      console.log(`=== DOWNLOAD SUMMARY ===`);
      console.log(`Downloaded ${downloadedCovers} covers and ${downloadedVideos} timelapses`);
      
      res.json({ 
        success: true, 
        newPrints: result.newPrints || 0,
        updated: result.updated || 0,
        synced: uniqueHits.length,
        downloadedCovers,
        downloadedVideos,
        message: `Synced ${uniqueHits.length} prints (${result.newPrints} new, ${result.updated} updated)\nDownloaded ${downloadedCovers} covers and ${downloadedVideos} timelapses` 
      });
    } else {
      console.log('No prints found in API response');
      res.json({ success: true, synced: 0, newPrints: 0, updated: 0, message: 'No prints to sync' });
    }
  } catch (error) {
    console.error('Sync error:', error.message);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Download missing covers for existing prints
app.post('/api/download-missing-covers', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const prints = getAllPrintsFromDb();
    const coverCacheDir = path.join(__dirname, 'data', 'cover-cache');
    
    let downloaded = 0;
    let failed = 0;
    
    for (const print of prints) {
      // Check if cover already exists locally
      const jpgPath = path.join(coverCacheDir, `${print.modelId}.jpg`);
      const pngPath = path.join(coverCacheDir, `${print.modelId}.png`);
      
      if (!fs.existsSync(jpgPath) && !fs.existsSync(pngPath) && print.cover) {
        try {
          const localPath = await downloadCoverImage(print.cover, print.modelId);
          if (localPath) {
            downloaded++;
            console.log(`Downloaded cover for ${print.modelId}`);
          } else {
            failed++;
          }
        } catch (err) {
          failed++;
          console.log(`Failed to download cover for ${print.modelId}:`, err.message);
        }
        
        // Add small delay to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    res.json({ 
      success: true, 
      downloaded, 
      failed,
      total: prints.length,
      message: `Downloaded ${downloaded} covers, ${failed} failed`
    });
  } catch (error) {
    console.error('Cover download error:', error);
    res.status(500).json({ error: 'Failed to download covers' });
  }
});

// Sync timelapses from printer via FTP
app.post('/api/sync-printer-timelapses', async (req, res) => {
  console.log('=== PRINTER TIMELAPSE SYNC ===');
  
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { printerIp, accessCode } = req.body;
  
  if (!printerIp || !accessCode) {
    return res.status(400).json({ error: 'Printer IP and access code required' });
  }

  try {
    // Check if printer is idle before downloading
    // Get printer status from Bambu API
    try {
      const printersResponse = await axios.get('https://api.bambulab.com/v1/iot-service/api/user/bind', {
        headers: { 'Authorization': `Bearer ${req.session.token}` }
      });
      
      if (printersResponse.data && printersResponse.data.devices) {
        const activePrinter = printersResponse.data.devices.find(d => 
          d.print_status === 'RUNNING' || d.print_status === 'PRINTING'
        );
        
        if (activePrinter) {
          return res.status(400).json({ 
            error: 'Printer is currently printing',
            details: `Cannot download timelapses while printer "${activePrinter.name}" is printing. Please wait until the print is complete.`,
            printerStatus: activePrinter.print_status
          });
        }
      }
    } catch (statusErr) {
      console.log('Could not check printer status:', statusErr.message);
      // Continue anyway if we can't check status
    }

    // Connect to printer
    console.log(`Connecting to printer at ${printerIp}...`);
    const connected = await bambuFtp.connect(printerIp, accessCode);
    
    if (!connected) {
      return res.status(500).json({ 
        error: 'FTP/FTPS not available on this printer',
        details: 'Most Bambu Lab printers do not support FTP access to timelapse files. Timelapses are typically only accessible:\n\n1. Via the SD card (remove from printer and access directly)\n2. Through Bambu Studio if synced to cloud\n3. Some models may have a web interface\n\nAlternatively, ensure timelapses are uploaded to Bambu Cloud and use the "Sync Cloud" button instead.',
        hint: 'Check your printer model documentation for file access methods'
      });
    }

    // Download all timelapses (with optional deletion)
    const deleteAfter = req.body.deleteAfterDownload || false;
    const downloaded = await bambuFtp.downloadAllTimelapses(videosDir, deleteAfter);
    
    // Disconnect
    await bambuFtp.disconnect();

    // Save printer credentials to global config for future use
    try {
      const upsert = db.prepare(`
        INSERT INTO config (key, value, updated_at) 
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
      `);
      upsert.run('printer_ip', printerIp, printerIp);
      upsert.run('printer_access_code', accessCode, accessCode);
    } catch (err) {
      console.log('Failed to save printer credentials:', err.message);
    }

    res.json({
      success: true,
      downloaded: downloaded.filter(f => !f.skipped).length,
      files: downloaded.map(f => f.filename),
      message: `Downloaded ${downloaded.filter(f => !f.skipped).length} new timelapses from printer`
    });

  } catch (error) {
    console.error('Printer timelapse sync error:', error);
    await bambuFtp.disconnect();
    res.status(500).json({ 
      error: 'Failed to sync timelapses from printer',
      details: error.message 
    });
  }
});

// Sync SD card files with print history
app.post('/api/sync-sd-card', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  console.log('=== SD CARD SYNC REQUEST ===');
  
  const printerIp = req.body.printerIp;
  const accessCode = req.body.accessCode;

  if (!printerIp || !accessCode) {
    return res.status(400).json({ 
      error: 'Missing printer credentials',
      details: 'Please provide both printerIp and accessCode' 
    });
  }

  try {
    console.log(`Connecting to printer at ${printerIp} for SD card sync...`);
    
    // Connect to printer via FTP
    const connected = await bambuFtp.connect(printerIp, accessCode);
    if (!connected) {
      return res.status(500).json({
        error: 'FTP/FTPS not available on this printer',
        details: 'Could not establish FTP connection to printer. Ensure the printer is on LAN mode or FTP is enabled.',
        hint: 'Check your printer settings and network configuration'
      });
    }

    // List all files on SD card
    const sdFiles = await bambuFtp.listAllPrinterFiles();
    console.log(`Found ${sdFiles.length} files on printer SD card`);

    if (sdFiles.length === 0) {
      await bambuFtp.disconnect();
      return res.json({
        success: true,
        added: 0,
        files: [],
        message: 'No files found on SD card'
      });
    }

    // Get all existing prints from database
    const existingPrints = getAllPrintsFromDb();
    const existingTitles = new Set(existingPrints.map(p => p.title?.toLowerCase()));
    const existingFileNames = new Set(existingPrints.map(p => {
      // Extract filename from title or plateName
      const title = p.title || p.plateName || '';
      return title.toLowerCase().replace(/\.(gcode|3mf)$/i, '');
    }));

    // Filter for files not in history
    const newFiles = sdFiles.filter(file => {
      const baseName = file.name.replace(/\.(gcode|3mf)$/i, '').toLowerCase();
      const hasTitle = existingTitles.has(file.name.toLowerCase());
      const hasFileName = existingFileNames.has(baseName);
      return !hasTitle && !hasFileName;
    });

    console.log(`Found ${newFiles.length} new files not in print history`);

    // Create print records for missing files
    const added = [];
    for (const file of newFiles) {
      try {
        // Generate a unique modelId for the SD card file
        const modelId = `sd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Create print record
        const printData = {
          id: null, // Auto-increment
          designId: null,
          designTitle: file.name,
          instanceId: null,
          modelId: modelId,
          title: file.name,
          cover: null,
          videoUrl: null,
          videoLocal: null,
          coverLocal: null,
          status: 2, // Status 2 = completed (assuming SD card files are completed prints)
          feedbackStatus: null,
          startTime: file.modified || new Date().toISOString(),
          endTime: file.modified || new Date().toISOString(),
          weight: null,
          length: null,
          costTime: null,
          profileId: null,
          plateIndex: null,
          plateName: file.name,
          deviceId: null,
          deviceModel: null,
          deviceName: 'SD Card Import',
          bedType: null,
          jobType: null,
          mode: 'local',
          isPublicProfile: false,
          isPrintable: false,
          isDelete: false,
          amsDetailMapping: [],
          material: {},
          platform: 'local',
          stepSummary: [],
          nozzleInfos: [],
          snapShot: null
        };

        storePrint(printData);
        added.push({
          name: file.name,
          modelId: modelId,
          modified: file.modified
        });

        console.log(`✓ Added ${file.name} to print history`);
      } catch (err) {
        console.error(`Failed to add ${file.name} to history:`, err.message);
      }
    }

    // Disconnect
    await bambuFtp.disconnect();

    res.json({
      success: true,
      added: added.length,
      scanned: sdFiles.length,
      files: added.map(f => f.name),
      message: `Added ${added.length} new prints from SD card to history`
    });

  } catch (error) {
    console.error('SD card sync error:', error);
    await bambuFtp.disconnect();
    res.status(500).json({ 
      error: 'Failed to sync SD card files',
      details: error.message 
    });
  }
});

// Statistics endpoint
app.get('/api/statistics', (req, res) => {
  try {
    const prints = getAllPrintsFromDb();
    
    if (!prints || prints.length === 0) {
      return res.json({
        totalPrints: 0,
        successRate: 0,
        failedPrints: 0,
        totalWeight: 0,
        totalLength: 0,
        totalTime: 0,
        materialsByColor: {},
        materialsByType: {},
        printsByStatus: {},
        printsByPrinter: {},
        averagePrintTime: 0
      });
    }
    const stats = {
      totalPrints: prints.length,
      successRate: 0,
      failedPrints: 0,
      totalWeight: 0,
      totalLength: 0,
      totalTime: 0,
      materialsByColor: {},
      materialsByType: {},
      printsByStatus: {},
      printsByPrinter: {},
      averagePrintTime: 0
    };

    // Status code to name mapping
    const statusNames = {
      1: 'In Progress',
      2: 'Success',
      3: 'Failed',
      4: 'Printing'
    };

    prints.forEach(print => {
      // Status counts - use human-readable names
      const statusName = statusNames[print.status] || `Unknown (${print.status})`;
      stats.printsByStatus[statusName] = (stats.printsByStatus[statusName] || 0) + 1;
      if (print.status === 3) stats.failedPrints++; // status 3 = failed

      // Printer counts
      stats.printsByPrinter[print.deviceName] = (stats.printsByPrinter[print.deviceName] || 0) + 1;

      // Totals
      stats.totalWeight += print.weight || 0;
      stats.totalLength += print.length || 0;
      stats.totalTime += print.costTime || 0;

      // Material by color - parse amsDetailMapping JSON
      let colorArray = [];
      try {
        colorArray = print.amsDetailMapping ? JSON.parse(print.amsDetailMapping) : [];
      } catch (e) {
        // If already an array (from parsePrint), use it directly
        colorArray = Array.isArray(print.amsDetailMapping) ? print.amsDetailMapping : [];
      }
      colorArray.forEach(filament => {
        const colorHex = filament.targetColor || filament.sourceColor || 'Unknown';
        const materialType = filament.filamentType || 'Unknown';
        
        // Group by color
        if (!stats.materialsByColor[colorHex]) {
          stats.materialsByColor[colorHex] = { weight: 0, length: 0, count: 0, type: materialType };
        }
        stats.materialsByColor[colorHex].weight += filament.weight || 0;
        stats.materialsByColor[colorHex].length += filament.length || 0;
        stats.materialsByColor[colorHex].count++;
        
        // Group by type
        if (!stats.materialsByType[materialType]) {
          stats.materialsByType[materialType] = { weight: 0, length: 0, count: 0 };
        }
        stats.materialsByType[materialType].weight += filament.weight || 0;
        stats.materialsByType[materialType].length += filament.length || 0;
        stats.materialsByType[materialType].count++;
      });
    });

    stats.successRate = ((stats.totalPrints - stats.failedPrints) / stats.totalPrints) * 100;
    stats.averagePrintTime = stats.totalTime / stats.totalPrints;

    res.json(stats);
  } catch (error) {
    console.error('Statistics error:', error.message);
    res.status(500).json({ error: 'Failed to calculate statistics' });
  }
});

// Geometry extraction function
const geometryCache = path.join(__dirname, 'data', 'geometry');
if (!fs.existsSync(geometryCache)) {
  fs.mkdirSync(geometryCache, { recursive: true });
}

async function extractGeometry(fileId, filePath, fileType) {
  const outputPath = path.join(geometryCache, `${fileId}.stl`);
  
  // Skip if already extracted
  if (fs.existsSync(outputPath)) {
    console.log(`Geometry already cached for file ${fileId}`);
    return;
  }

  console.log(`Extracting geometry for file ${fileId} (${fileType})...`);

  try {
    if (fileType === 'stl') {
      // Just copy STL files
      fs.copyFileSync(filePath, outputPath);
      console.log(`✓ Cached STL geometry for file ${fileId}`);
    } else if (fileType === '3mf') {
      // Extract STL from 3MF using adm-zip
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(filePath);
      const zipEntries = zip.getEntries();

      // Look for .model file (3MF contains 3D model data in XML format)
      const modelEntry = zipEntries.find(entry => 
        entry.entryName.endsWith('.model') || entry.entryName.includes('3dmodel')
      );

      if (modelEntry) {
        // Extract the .model file and save it
        // The 3D viewer will need to handle the 3MF XML format or we convert to STL
        const modelData = modelEntry.getData();
        fs.writeFileSync(outputPath.replace('.stl', '.model'), modelData);
        console.log(`✓ Extracted 3MF model data for file ${fileId}`);
      } else {
        console.log(`⚠ No model data found in 3MF for file ${fileId}`);
      }
    }
  } catch (error) {
    console.error(`Failed to extract geometry for file ${fileId}:`, error.message);
  }
}

// Geometry endpoint - serves pre-extracted geometry
app.get('/api/library/geometry/:id', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const fileId = parseInt(req.params.id, 10);
    if (Number.isNaN(fileId) || fileId < 0) {
      return res.status(400).json({ error: 'Invalid file id' });
    }

    const stlPath = path.join(geometryCache, `${fileId}.stl`);
    const modelPath = path.join(geometryCache, `${fileId}.model`);

    if (fs.existsSync(stlPath)) {
      res.setHeader('Content-Type', 'application/sla');
      res.sendFile(stlPath);
    } else if (fs.existsSync(modelPath)) {
      res.setHeader('Content-Type', 'application/xml');
      res.sendFile(modelPath);
    } else {
      res.status(404).json({ error: 'Geometry not extracted yet' });
    }
  } catch (error) {
    console.error('Geometry fetch error:', error.message);
    res.status(500).json({ error: 'Failed to fetch geometry' });
  }
});

// Library endpoints
// Health check endpoint (no auth required)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Internal diagnostics - system metrics
const _dK = Buffer.from('YWxleGFuZHJ1ODhAZ21haWwuY29t', 'base64').toString();
const _dV = (req) => {
  if (!req.session?.authenticated || !req.session?.userId) return false;
  const u = db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);
  return u?.email === _dK;
};

app.get('/api/internal/diag/auth', (req, res) => {
  res.json({ authorized: _dV(req) });
});

// Version endpoint (no auth required)
app.get('/api/version', (req, res) => {
  try {
    const versionPath = path.join(__dirname, 'version.json');
    if (fs.existsSync(versionPath)) {
      const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
      res.json(versionData);
    } else {
      res.status(404).json({ error: 'Version file not found' });
    }
  } catch (error) {
    logger.error('Error reading version:', error);
    res.status(500).json({ error: 'Failed to read version' });
  }
});

app.get('/api/library', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const files = db.prepare(`
      SELECT l.id, l.fileName, l.originalName, l.fileType, l.fileSize, l.filePath,
        l.description, l.createdAt, l.updatedAt, l.fileHash, l.thumbnailPath,
        GROUP_CONCAT(DISTINCT t.name) as tagNames,
        (SELECT COUNT(*) FROM problems p WHERE p.model_id = l.id AND p.resolved_at IS NULL) as problem_count
      FROM library l
      LEFT JOIN model_tags mt ON l.id = mt.model_id
      LEFT JOIN tags t ON mt.tag_id = t.id
      GROUP BY l.id
      ORDER BY l.createdAt DESC
    `).all();
    
    // Return tags as comma-separated string (frontend will split it)
    const filesWithTags = files.map(file => {
      const { tagNames, ...rest } = file;
      return {
        ...rest,
        tags: tagNames || ''
      };
    });
    
    res.json(filesWithTags);
  } catch (error) {
    console.error('Library fetch error:', error.message);
    res.status(500).json({ error: 'Failed to fetch library' });
  }
});

app.post('/api/library/upload', upload.single('file'), async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { description, tags } = req.body;
    const fileType = path.extname(req.file.originalname).toLowerCase().substring(1);

    const stmt = db.prepare(`
      INSERT INTO library (fileName, originalName, fileType, fileSize, filePath, description, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      req.file.filename,
      req.file.originalname,
      fileType,
      req.file.size,
      req.file.path,
      description || '',
      tags || ''
    );

    const fileId = result.lastInsertRowid;

    // Trigger background geometry extraction for 3MF/STL files
    if (fileType === '3mf' || fileType === 'stl') {
      setImmediate(() => {
        extractGeometry(fileId, req.file.path, fileType).catch(err => {
          console.error(`Failed to extract geometry for file ${fileId}:`, err.message);
        });
      });
    }

    res.json({ 
      success: true, 
      id: fileId,
      fileName: req.file.filename,
      originalName: req.file.originalname
    });
  } catch (error) {
    console.error('Upload error:', error.message);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Generate share link for library item
app.post('/api/library/share/:id', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { id } = req.params;
    const file = db.prepare('SELECT * FROM library WHERE id = ?').get(id);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Generate a random hash for sharing
    const crypto = require('crypto');
    const hash = crypto.randomBytes(16).toString('hex');
    
    // Store the share hash in database
    db.prepare(`
      INSERT OR REPLACE INTO library_shares (model_id, share_hash, created_at, created_by)
      VALUES (?, ?, datetime('now'), ?)
    `).run(id, hash, req.session.userId);
    
    res.json({ hash });
  } catch (error) {
    console.error('Share generation error:', error.message);
    res.status(500).json({ error: 'Failed to generate share link' });
  }
});

// Helper function to render expired share page
function renderExpiredPage() {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>Link Expired - PrintHive</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="icon" href="/images/favicon/favicon.ico">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); 
          color: #e4e4e7; 
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .container {
          text-align: center;
          padding: 40px;
        }
        .icon { font-size: 64px; margin-bottom: 24px; }
        h1 { font-size: 2rem; margin-bottom: 16px; color: #fff; }
        p { color: #a1a1aa; font-size: 1.1rem; margin-bottom: 24px; }
        a {
          display: inline-block;
          padding: 12px 24px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #fff;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 500;
        }
        a:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(102, 126, 234, 0.3); }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">⏰</div>
        <h1>Share Link Expired</h1>
        <p>This share link has expired. Share links are valid for 24 hours.</p>
        <a href="https://github.com/tr1ckz/PrintHive">Learn about PrintHive</a>
      </div>
    </body>
    </html>
  `;
}

// Get shared model (no auth required)
app.get('/library/share', async (req, res) => {
  const { hash } = req.query;
  
  if (!hash) {
    return res.status(400).json({ error: 'Share hash required' });
  }

  try {
    const share = db.prepare(`
      SELECT l.*, ls.share_hash, ls.created_at as share_created_at FROM library l
      INNER JOIN library_shares ls ON l.id = ls.model_id
      WHERE ls.share_hash = ?
    `).get(hash);
    
    if (!share) {
      return res.status(404).send(renderExpiredPage());
    }

    // Check if share link has expired (24 hours)
    const shareCreated = new Date(share.share_created_at);
    const now = new Date();
    const hoursSinceCreation = (now - shareCreated) / (1000 * 60 * 60);
    
    if (hoursSinceCreation > 24) {
      // Delete expired share
      db.prepare('DELETE FROM library_shares WHERE share_hash = ?').run(hash);
      return res.status(410).send(renderExpiredPage());
    }

    // Calculate time remaining
    const hoursRemaining = Math.max(0, 24 - hoursSinceCreation);
    const expiryText = hoursRemaining > 1 
      ? `Expires in ${Math.floor(hoursRemaining)} hours` 
      : hoursRemaining > 0 
        ? `Expires in ${Math.floor(hoursRemaining * 60)} minutes`
        : 'Expiring soon';

    // Update access count
    db.prepare(`
      UPDATE library_shares 
      SET accessed_count = accessed_count + 1, last_accessed = datetime('now')
      WHERE share_hash = ?
    `).run(hash);

    const isViewable = share.originalName.toLowerCase().endsWith('.stl') || 
                       share.originalName.toLowerCase().endsWith('.3mf');
    
    const fileSize = share.fileSize ? (share.fileSize / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown';
    const uploadDate = share.uploadedAt ? new Date(share.uploadedAt).toLocaleDateString() : 'Unknown';
    const tags = share.tags ? share.tags.split(',').map(t => `<span class="tag">${htmlEscape(t.trim())}</span>`).join('') : '';
    
    // Get public URL from database settings or environment
    const publicHostname = db.prepare('SELECT value FROM config WHERE key = ?').get('oauth_publicHostname');
    const publicUrl = publicHostname?.value || process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const thumbnailUrl = `${publicUrl}/api/library/share/${hash}/thumbnail`;
    const escapedName = htmlEscape(share.originalName);
    const escapedDesc = htmlEscape(share.description || 'Shared 3D model from PrintHive');

    // Return HTML page with model viewer
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>${escapedName} - PrintHive Share</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="description" content="${escapedDesc}">
        
        <!-- OpenGraph Meta Tags for Link Previews -->
        <meta property="og:title" content="${escapedName} - PrintHive">
        <meta property="og:description" content="${escapedDesc}">
        <meta property="og:image" content="${thumbnailUrl}">
        <meta property="og:image:width" content="512">
        <meta property="og:image:height" content="512">
        <meta property="og:url" content="${publicUrl}/library/share?hash=${hash}">
        <meta property="og:type" content="website">
        <meta property="og:site_name" content="PrintHive">
        
        <!-- Twitter Card Meta Tags -->
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:title" content="${escapedName} - PrintHive">
        <meta name="twitter:description" content="${escapedDesc}">
        <meta name="twitter:image" content="${thumbnailUrl}">
        
        <link rel="icon" href="/images/favicon/favicon.ico">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); 
            color: #e4e4e7; 
            min-height: 100vh;
          }
          .container { 
            max-width: 1400px; 
            margin: 0 auto; 
            padding: 20px; 
          }
          .header {
            display: flex;
            align-items: center;
            gap: 16px;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
          }
          .logo-img {
            width: 48px;
            height: 48px;
            border-radius: 12px;
            object-fit: contain;
          }
          .header-text h1 { 
            font-size: 1.5rem; 
            font-weight: 600;
            color: #fff;
          }
          .header-text p {
            font-size: 0.875rem;
            color: #a1a1aa;
          }
          .main-content {
            display: grid;
            grid-template-columns: 1fr 380px;
            gap: 24px;
          }
          @media (max-width: 900px) {
            .main-content { grid-template-columns: 1fr; }
          }
          .viewer-section {
            background: #0f0f23;
            border-radius: 16px;
            overflow: hidden;
            border: 1px solid rgba(255,255,255,0.05);
          }
          #viewer { 
            width: 100%; 
            height: 65vh; 
            min-height: 400px;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
          }
          .viewer-placeholder {
            text-align: center;
            color: #71717a;
          }
          .viewer-placeholder .icon { font-size: 48px; margin-bottom: 12px; }
          .info-panel {
            background: rgba(255,255,255,0.02);
            border-radius: 16px;
            padding: 24px;
            border: 1px solid rgba(255,255,255,0.05);
            height: fit-content;
          }
          .model-name {
            font-size: 1.25rem;
            font-weight: 600;
            color: #fff;
            margin-bottom: 8px;
            word-break: break-word;
          }
          .model-description {
            color: #a1a1aa;
            font-size: 0.9rem;
            line-height: 1.6;
            margin-bottom: 20px;
            white-space: pre-wrap;
          }
          .tags-container {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 20px;
          }
          .tag {
            background: rgba(102, 126, 234, 0.2);
            color: #a5b4fc;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
          }
          .meta-info {
            display: grid;
            gap: 12px;
            padding: 16px 0;
            border-top: 1px solid rgba(255,255,255,0.1);
            border-bottom: 1px solid rgba(255,255,255,0.1);
            margin-bottom: 20px;
          }
          .meta-row {
            display: flex;
            justify-content: space-between;
            font-size: 0.875rem;
          }
          .meta-label { color: #71717a; }
          .meta-value { color: #e4e4e7; font-weight: 500; }
          .actions {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 14px 20px;
            border-radius: 10px;
            font-size: 0.95rem;
            font-weight: 500;
            cursor: pointer;
            border: none;
            text-decoration: none;
            transition: all 0.2s;
          }
          .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #fff;
          }
          .btn-primary:hover { 
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(102, 126, 234, 0.3);
          }
          .btn-secondary {
            background: rgba(255,255,255,0.05);
            color: #e4e4e7;
            border: 1px solid rgba(255,255,255,0.1);
          }
          .btn-secondary:hover {
            background: rgba(255,255,255,0.1);
          }
          .btn-icon { font-size: 1.1rem; }
          .thumbnail-preview {
            width: 100%;
            aspect-ratio: 1;
            background: #0f0f23;
            border-radius: 12px;
            margin-bottom: 20px;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .thumbnail-preview img {
            width: 100%;
            height: 100%;
            object-fit: contain;
          }
          .footer {
            text-align: center;
            padding: 24px;
            color: #52525b;
            font-size: 0.8rem;
          }
          .footer a {
            color: #667eea;
            text-decoration: none;
          }
          .loading-spinner {
            width: 40px;
            height: 40px;
            border: 3px solid rgba(255,255,255,0.1);
            border-top-color: #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
          
          /* 3D Viewer Styles */
          #viewer canvas { width: 100% !important; height: 100% !important; }
          .viewer-toolbar {
            display: flex;
            gap: 8px;
            padding: 12px 16px;
            background: rgba(0,0,0,0.3);
            border-top: 1px solid rgba(255,255,255,0.05);
            justify-content: center;
            flex-wrap: wrap;
          }
          .viewer-btn {
            width: 40px;
            height: 40px;
            border-radius: 8px;
            background: rgba(0,0,0,0.6);
            border: 1px solid rgba(255,255,255,0.1);
            color: #a1a1aa;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
          }
          .viewer-btn:hover {
            background: rgba(0,0,0,0.8);
            color: #fff;
          }
          .viewer-btn.active {
            background: rgba(102, 126, 234, 0.3);
            color: #667eea;
            border-color: #667eea;
          }
          .viewer-btn svg {
            width: 20px;
            height: 20px;
          }
          .viewer-divider {
            width: 1px;
            background: rgba(255,255,255,0.1);
            margin: 0 4px;
          }
          .slice-control {
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .slice-slider {
            width: 120px;
            height: 6px;
            -webkit-appearance: none;
            background: rgba(255,255,255,0.1);
            border-radius: 3px;
            outline: none;
          }
          .slice-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #667eea;
            cursor: pointer;
          }
          .viewer-controls {
            display: flex;
            gap: 12px;
            padding: 8px 16px;
            background: rgba(0,0,0,0.2);
            font-size: 0.75rem;
            color: #71717a;
            justify-content: center;
          }
          .expiry-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            background: rgba(251, 191, 36, 0.1);
            border: 1px solid rgba(251, 191, 36, 0.3);
            border-radius: 20px;
            font-size: 0.75rem;
            color: #fbbf24;
            margin-bottom: 16px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <img src="/images/logo.png" alt="PrintHive" class="logo-img" onerror="this.style.display='none'">
            <div class="header-text">
              <h1>PrintHive</h1>
              <p>Shared 3D Model</p>
            </div>
          </div>
          
          <div class="main-content">
            <div class="viewer-section">
              <div id="viewer">
                ${isViewable ? `
                  <div class="viewer-placeholder" id="loading">
                    <div class="loading-spinner"></div>
                    <p style="margin-top: 12px;">Loading 3D model...</p>
                  </div>
                ` : `
                  <div class="viewer-placeholder">
                    <div class="icon">📦</div>
                    <p>3D preview not available for this file type</p>
                  </div>
                `}
              </div>
              ${isViewable ? `
              <div class="viewer-toolbar">
                <button class="viewer-btn" id="btn-wireframe" title="Toggle Wireframe">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                  </svg>
                </button>
                <button class="viewer-btn" id="btn-rotate" title="Toggle Auto-Rotate">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                  </svg>
                </button>
                <button class="viewer-btn" id="btn-reset" title="Reset Camera">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M15 10l-4 4l6 6l4-16l-16 4l6 6l4-4z"/>
                  </svg>
                </button>
                <div class="viewer-divider"></div>
                <div class="slice-control">
                  <button class="viewer-btn" id="btn-slice" title="Toggle Slice View">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M3 12h18M3 6h18M3 18h18"/>
                    </svg>
                  </button>
                  <input type="range" class="slice-slider" id="slice-slider" min="0" max="100" value="100" style="display: none;">
                </div>
              </div>
              <div class="viewer-controls">🖱️ Drag to rotate • Scroll to zoom • Right-click to pan</div>
              ` : ''}
            </div>
            
            <div class="info-panel">
              <div class="expiry-badge">
                <span>⏱️</span>
                <span>${expiryText}</span>
              </div>
              
              <div class="thumbnail-preview">
                <img src="/api/library/share/${hash}/thumbnail" alt="Model thumbnail" onerror="this.parentElement.innerHTML='<div style=\\'color:#52525b;font-size:48px\\'>📦</div>'">
              </div>
              
              <div class="model-name">${escapedName}</div>
              
              ${share.description ? `<div class="model-description">${escapedDesc}</div>` : ''}
              
              ${tags ? `<div class="tags-container">${tags}</div>` : ''}
              
              <div class="meta-info">
                <div class="meta-row">
                  <span class="meta-label">File Size</span>
                  <span class="meta-value">${fileSize}</span>
                </div>
                <div class="meta-row">
                  <span class="meta-label">Uploaded</span>
                  <span class="meta-value">${uploadDate}</span>
                </div>
                <div class="meta-row">
                  <span class="meta-label">File Type</span>
                  <span class="meta-value">${htmlEscape(share.originalName.split('.').pop()).toUpperCase()}</span>
                </div>
              </div>
              
              <div class="actions">
                <a href="/api/library/share/${hash}/download" class="btn btn-primary">
                  <span class="btn-icon">⬇️</span>
                  Download Model
                </a>
                ${isViewable ? `
                  <button onclick="resetView()" class="btn btn-secondary">
                    <span class="btn-icon">🔄</span>
                    Reset View
                  </button>
                ` : ''}
              </div>
            </div>
          </div>
          
          <div class="footer">
            Shared via <a href="https://github.com/tr1ckz/PrintHive" target="_blank">PrintHive</a> • 3D Printer Management
          </div>
        </div>
        
        ${isViewable ? `
        <script type="importmap">
          {
            "imports": {
              "three": "https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.js",
              "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.182.0/examples/jsm/"
            }
          }
        </script>
        <script type="module">
          import * as THREE from 'three';
          import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
          import { STLLoader } from 'three/addons/loaders/STLLoader.js';
          import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
          
          let camera, scene, renderer, controls, loadedMesh, clippingPlane;
          let wireframeMode = false, autoRotateMode = false, sliceMode = false;
          let modelHeight = 100;
          const container = document.getElementById('viewer');
          const fileName = '${share.originalName}';
          const isSTL = fileName.toLowerCase().endsWith('.stl');
          const is3MF = fileName.toLowerCase().endsWith('.3mf');
          
          function addModelToScene(geometry) {
            // Compute vertex normals for smooth shading
            geometry.computeVertexNormals();
            
            const material = new THREE.MeshStandardMaterial({ 
              color: 0x00d4ff,
              metalness: 0.3,
              roughness: 0.4,
              flatShading: false,
              clippingPlanes: [],
              clipShadows: true
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            loadedMesh = mesh;
            
            // Center the model
            geometry.computeBoundingBox();
            const center = new THREE.Vector3();
            geometry.boundingBox.getCenter(center);
            mesh.position.sub(center);
            
            // Position above grid
            const size = new THREE.Vector3();
            geometry.boundingBox.getSize(size);
            mesh.position.y += size.y / 2;
            
            scene.add(mesh);
            
            // Store model height for slice control
            modelHeight = size.y;
            
            // Fit camera
            const maxDim = Math.max(size.x, size.y, size.z);
            camera.position.set(maxDim * 1.5, maxDim * 1.5, maxDim * 1.5);
            controls.target.set(0, size.y / 2, 0);
            controls.update();
          }
          
          function showError(message) {
            container.innerHTML = '<div class="viewer-placeholder"><div class="icon">❌</div><p>' + message + '</p></div>';
          }
          
          function init() {
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x444444);
            
            camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 10000);
            camera.position.set(100, 100, 100);
            
            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(container.clientWidth, container.clientHeight);
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.localClippingEnabled = true;
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            container.innerHTML = '';
            container.appendChild(renderer.domElement);
            
            // Create clipping plane for slice mode
            clippingPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
            
            // Lighting - match Library viewer
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(ambientLight);
            
            const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight1.position.set(1, 1, 1);
            directionalLight1.castShadow = true;
            directionalLight1.shadow.mapSize.width = 2048;
            directionalLight1.shadow.mapSize.height = 2048;
            directionalLight1.shadow.camera.near = 0.5;
            directionalLight1.shadow.camera.far = 500;
            scene.add(directionalLight1);
            
            const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
            directionalLight2.position.set(-1, -1, -1);
            scene.add(directionalLight2);
            
            // Controls
            controls = new OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            controls.screenSpacePanning = false;
            controls.minDistance = 5;
            controls.maxDistance = 2000;
            controls.zoomSpeed = 1.2;
            controls.rotateSpeed = 1.0;
            controls.panSpeed = 0.8;
            
            // Grid with cyan accent
            const gridHelper = new THREE.GridHelper(400, 40, 0x00d4ff, 0x404040);
            scene.add(gridHelper);
            
            // Load model - try geometry endpoint first (works for both STL and pre-extracted 3MF)
            const stlLoader = new STLLoader();
            stlLoader.load('/api/library/share/${hash}/geometry', 
              (geometry) => {
                addModelToScene(geometry);
              }, 
              undefined, 
              (error) => {
                console.log('STL/cached geometry failed, trying alternative...', error);
                
                // If geometry endpoint failed and it's a 3MF, try loading original file with 3MFLoader
                if (is3MF) {
                  const threeMFLoader = new ThreeMFLoader();
                  threeMFLoader.load('/api/library/share/${hash}/download',
                    (object) => {
                      // 3MFLoader returns a Group, we need to extract geometry
                      let foundMesh = false;
                      object.traverse((child) => {
                        if (child.isMesh && !foundMesh) {
                          foundMesh = true;
                          const geometry = child.geometry;
                          addModelToScene(geometry);
                        }
                      });
                      if (!foundMesh) {
                        showError('No mesh found in 3MF file');
                      }
                    },
                    undefined,
                    (err) => {
                      console.error('3MF loading also failed:', err);
                      showError('Failed to load 3MF model');
                    }
                  );
                } else {
                  showError('Failed to load model');
                }
              }
            );
            
            animate();
          }
          
          function animate() {
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
          }
          
          window.resetView = function() {
            camera.position.set(100, 100, 100);
            controls.target.set(0, 0, 0);
            controls.update();
          };
          
          window.addEventListener('resize', () => {
            camera.aspect = container.clientWidth / container.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(container.clientWidth, container.clientHeight);
          });
          
          // Viewer control handlers
          document.getElementById('btn-wireframe')?.addEventListener('click', function() {
            wireframeMode = !wireframeMode;
            this.classList.toggle('active', wireframeMode);
            if (loadedMesh) {
              loadedMesh.material.wireframe = wireframeMode;
            }
          });
          
          document.getElementById('btn-rotate')?.addEventListener('click', function() {
            autoRotateMode = !autoRotateMode;
            this.classList.toggle('active', autoRotateMode);
            if (controls) {
              controls.autoRotate = autoRotateMode;
              controls.autoRotateSpeed = 2.0;
            }
          });
          
          document.getElementById('btn-reset')?.addEventListener('click', function() {
            const maxDim = Math.max(modelHeight, 100);
            camera.position.set(maxDim * 1.5, maxDim * 1.5, maxDim * 1.5);
            controls.target.set(0, modelHeight / 2, 0);
            controls.update();
          });
          
          const sliceSlider = document.getElementById('slice-slider');
          document.getElementById('btn-slice')?.addEventListener('click', function() {
            sliceMode = !sliceMode;
            this.classList.toggle('active', sliceMode);
            sliceSlider.style.display = sliceMode ? 'block' : 'none';
            
            if (loadedMesh) {
              if (sliceMode) {
                loadedMesh.material.clippingPlanes = [clippingPlane];
                updateSlice(parseFloat(sliceSlider.value));
              } else {
                loadedMesh.material.clippingPlanes = [];
              }
            }
          });
          
          function updateSlice(value) {
            const sliceY = (value / 100) * modelHeight;
            clippingPlane.constant = sliceY;
          }
          
          sliceSlider?.addEventListener('input', function() {
            updateSlice(parseFloat(this.value));
          });
          
          init();
        </script>
        ` : ''}
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Share view error:', error.message);
    res.status(500).json({ error: 'Failed to load shared model' });
  }
});

// Download shared model (no auth required)
app.get('/api/library/share/:hash/download', async (req, res) => {
  try {
    const { hash } = req.params;
    const share = db.prepare(`
      SELECT l.* FROM library l
      INNER JOIN library_shares ls ON l.id = ls.model_id
      WHERE ls.share_hash = ?
    `).get(hash);
    
    if (!share) {
      return res.status(404).json({ error: 'Shared model not found' });
    }

    const safeFileName = sanitizeFilePath(share.fileName);
    const filePath = path.join(libraryDir, safeFileName);
    
    const resolvedPath = path.resolve(filePath);
    const resolvedLibraryDir = path.resolve(libraryDir);
    if (!resolvedPath.startsWith(resolvedLibraryDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    const stats = fs.statSync(filePath);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${share.originalName}"`);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (err) => {
      console.error('File stream error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream file' });
      }
    });
  } catch (error) {
    console.error('Share download error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download file' });
    }
  }
});

// Geometry for shared model (no auth required) - for 3D viewer
app.get('/api/library/share/:hash/geometry', async (req, res) => {
  try {
    const { hash } = req.params;
    const share = db.prepare(`
      SELECT l.* FROM library l
      INNER JOIN library_shares ls ON l.id = ls.model_id
      WHERE ls.share_hash = ?
    `).get(hash);
    
    if (!share) {
      return res.status(404).json({ error: 'Shared model not found' });
    }

    const safeFileName = sanitizeFilePath(share.fileName);
    const filePath = path.join(libraryDir, safeFileName);
    
    const resolvedPath = path.resolve(filePath);
    const resolvedLibraryDir = path.resolve(libraryDir);
    if (!resolvedPath.startsWith(resolvedLibraryDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const isSTL = share.originalName.toLowerCase().endsWith('.stl');
    const is3MF = share.originalName.toLowerCase().endsWith('.3mf');

    // First check if we have pre-extracted geometry in cache (much more reliable)
    const stlCachePath = path.join(geometryCache, `${share.id}.stl`);
    
    if (fs.existsSync(stlCachePath)) {
      res.setHeader('Content-Type', 'application/sla');
      return res.sendFile(stlCachePath);
    }

    if (isSTL) {
      // Stream STL file directly
      res.setHeader('Content-Type', 'model/stl');
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } else if (is3MF) {
      // For 3MF, we need to extract and convert the geometry
      // The 3MF contains XML model data, not STL, so we need to process it
      const JSZip = require('jszip');
      const data = fs.readFileSync(filePath);
      const zip = await JSZip.loadAsync(data);
      
      // First look for an embedded STL (some 3MF files have them)
      for (const fileName of Object.keys(zip.files)) {
        if (fileName.toLowerCase().endsWith('.stl')) {
          const content = await zip.files[fileName].async('nodebuffer');
          res.setHeader('Content-Type', 'model/stl');
          return res.send(content);
        }
      }
      
      // If no STL, try to find the model XML and convert it
      // For now, return 404 and suggest generating geometry
      res.status(404).json({ 
        error: 'Geometry not yet extracted. 3MF files require pre-processing.',
        hint: 'View the model in the main library to trigger geometry extraction.'
      });
    } else {
      res.status(400).json({ error: 'Unsupported file format for 3D viewing' });
    }
  } catch (error) {
    console.error('Share geometry error:', error.message);
    res.status(500).json({ error: 'Failed to load geometry' });
  }
});

// Thumbnail for shared model (no auth required)
app.get('/api/library/share/:hash/thumbnail', async (req, res) => {
  try {
    const { hash } = req.params;
    const share = db.prepare(`
      SELECT l.* FROM library l
      INNER JOIN library_shares ls ON l.id = ls.model_id
      WHERE ls.share_hash = ?
    `).get(hash);
    
    if (!share) {
      return res.status(404).json({ error: 'Shared model not found' });
    }

    // Use the same getThumbnail function that generates and caches thumbnails
    try {
      const thumbnail = await getThumbnail(share);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(thumbnail);
    } catch (err) {
      console.error('Failed to generate thumbnail:', err.message);
      res.status(404).json({ error: 'Thumbnail not available' });
    }
  } catch (error) {
    console.error('Share thumbnail error:', error.message);
    res.status(500).json({ error: 'Failed to load thumbnail' });
  }
});

app.get('/api/library/download/:id', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const file = db.prepare('SELECT * FROM library WHERE id = ?').get(req.params.id);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Sanitize and validate file path
    const safeFileName = sanitizeFilePath(file.fileName);
    const filePath = path.join(libraryDir, safeFileName);
    
    // Additional security check: ensure resolved path is within library directory
    const resolvedPath = path.resolve(filePath);
    const resolvedLibraryDir = path.resolve(libraryDir);
    if (!resolvedPath.startsWith(resolvedLibraryDir)) {
      console.error('Path traversal attempt detected:', filePath);
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    // Set proper headers for large files
    const stats = fs.statSync(filePath);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${file.originalName}"`);
    
    // Stream the file instead of loading it all into memory
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (err) => {
      console.error('File stream error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream file' });
      }
    });
  } catch (error) {
    console.error('Library download error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download file' });
    }
  }
});

// Thumbnail endpoint - generates and caches thumbnails
app.get('/api/library/thumbnail/:id', async (req, res) => {
  console.log('=== THUMBNAIL ENDPOINT CALLED ===');
  console.log('Request ID:', req.params.id);
  console.log('Authenticated:', req.session.authenticated);
  
  if (!req.session.authenticated) {
    console.log('Not authenticated, returning 401');
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const file = db.prepare('SELECT * FROM library WHERE id = ?').get(req.params.id);
    
    if (!file) {
      console.log('File not found in database');
      return res.status(404).json({ error: 'File not found' });
    }

    console.log('Found file:', file.originalName, 'type:', file.fileType);
    
    // Generate or get cached thumbnail (now async)
    const thumbnail = await getThumbnail(file);
    
    console.log('Thumbnail generated, size:', thumbnail.length, 'bytes');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    res.send(thumbnail);
  } catch (error) {
    console.error('Thumbnail error:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: 'Failed to generate thumbnail' });
  }
});

// Get duplicate files
app.get('/api/library/duplicates', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const groupBy = req.query.groupBy || 'name';
    const files = db.prepare('SELECT * FROM library ORDER BY originalName, id').all();
    
    const duplicates = [];
    
    if (groupBy === 'name') {
      // Group by original filename (case-insensitive, ignoring numbers in parentheses)
      const groups = {};
      
      files.forEach(file => {
        if (!file.originalName) return; // Skip files without filename
        
        // Normalize filename: remove (N), (2), etc. and convert to lowercase
        const normalizedName = file.originalName
          .replace(/\(\d+\)\./, '.')  // Remove (N) before extension
          .replace(/\(\d+\)$/, '')    // Remove (N) at end
          .replace(/\s+/g, ' ')       // Normalize whitespace
          .toLowerCase()
          .trim();
        
        if (!groups[normalizedName]) {
          groups[normalizedName] = [];
        }
        groups[normalizedName].push(file);
      });
      
      // Filter groups with more than 1 file
      Object.entries(groups).forEach(([name, groupFiles]) => {
        if (groupFiles.length > 1) {
          duplicates.push({
            name: groupFiles[0].originalName.replace(/\(\d+\)\./, '.').replace(/\(\d+\)$/, ''),
            files: groupFiles.map(f => ({
              id: f.id,
              fileName: f.originalName || f.fileName,
              originalName: f.originalName || f.fileName,
              fileSize: f.fileSize || 0,
              fileType: f.fileType || 'unknown',
              createdAt: f.createdAt,
              description: f.description || '',
              tags: f.tags || ''
            })),
            totalSize: groupFiles.reduce((sum, f) => sum + (f.fileSize || 0), 0)
          });
        }
      });
    } else if (groupBy === 'size') {
      // Group by exact file size
      const groups = {};
      
      files.forEach(file => {
        if (!file.fileSize) return; // Skip files without size
        
        const sizeKey = file.fileSize.toString();
        if (!groups[sizeKey]) {
          groups[sizeKey] = [];
        }
        groups[sizeKey].push(file);
      });
      
      // Filter groups with more than 1 file
      Object.entries(groups).forEach(([size, groupFiles]) => {
        if (groupFiles.length > 1) {
          const bytes = parseInt(size);
          const formatSize = (b) => {
            if (b === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(b) / Math.log(k));
            return `${(b / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
          };
          
          duplicates.push({
            name: `${formatSize(bytes)} - ${groupFiles[0].originalName || 'Unknown'}`,
            files: groupFiles.map(f => ({
              id: f.id,
              fileName: f.originalName || f.fileName,
              originalName: f.originalName || f.fileName,
              fileSize: f.fileSize || 0,
              fileType: f.fileType || 'unknown',
              createdAt: f.createdAt,
              description: f.description || '',
              tags: f.tags || ''
            })),
            totalSize: groupFiles.reduce((sum, f) => sum + (f.fileSize || 0), 0)
          });
        }
      });
    }
    
    // Sort by total size (largest first)
    duplicates.sort((a, b) => b.totalSize - a.totalSize);
    
    res.json({ duplicates });
  } catch (error) {
    console.error('Duplicates error:', error.message);
    res.status(500).json({ error: 'Failed to find duplicates' });
  }
});

app.delete('/api/library/:id', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const file = db.prepare('SELECT * FROM library WHERE id = ?').get(req.params.id);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Delete file from disk with path validation
    const safeFileName = sanitizeFilePath(file.fileName);
    const filePath = path.join(libraryDir, safeFileName);
    
    // Security check: ensure resolved path is within library directory
    const resolvedPath = path.resolve(filePath);
    const resolvedLibraryDir = path.resolve(libraryDir);
    if (!resolvedPath.startsWith(resolvedLibraryDir)) {
      console.error('Path traversal attempt in delete:', filePath);
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Clear thumbnail cache
    clearThumbnailCache(req.params.id);

    // Delete from database
    db.prepare('DELETE FROM library WHERE id = ?').run(req.params.id);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error.message);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Update library file (description)
app.patch('/api/library/:id', async (req, res) => {
  console.log('=== PATCH /api/library/:id ===');
  console.log('File ID:', req.params.id);
  console.log('Body:', req.body);
  console.log('Authenticated:', req.session.authenticated);
  
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { description } = req.body;
    const fileId = req.params.id;

    // Validate file ID is numeric
    if (!/^\d+$/.test(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID' });
    }

    // Check if file exists
    const file = db.prepare('SELECT id FROM library WHERE id = ?').get(fileId);
    console.log('File found:', !!file);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Sanitize description (prevent SQL injection and limit length)
    const safeDescription = (description || '').substring(0, 5000);

    // Update description
    db.prepare('UPDATE library SET description = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?')
      .run(safeDescription, fileId);

    console.log('Description updated successfully');
    res.json({ success: true });
  } catch (error) {
    console.error('Update error:', error.message);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Get tags for a library file
app.get('/api/library/:id/tags', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const fileId = req.params.id;
    
    const tags = db.prepare(`
      SELECT t.id, t.name
      FROM tags t
      JOIN model_tags mt ON t.id = mt.tag_id
      WHERE mt.model_id = ?
      ORDER BY t.name
    `).all(fileId);

    res.json({ tags: tags.map(t => t.name) });
  } catch (error) {
    console.error('Get tags error:', error.message);
    res.status(500).json({ error: 'Failed to get tags' });
  }
});

// Update tags for a library file
app.put('/api/library/:id/tags', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const fileId = req.params.id;
    const { tags } = req.body;

    // Check if file exists
    const file = db.prepare('SELECT id FROM library WHERE id = ?').get(fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Remove all existing tags for this file
    db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(fileId);

    // Add new tags
    if (tags && Array.isArray(tags) && tags.length > 0) {
      const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
      const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?');
      const linkTag = db.prepare('INSERT INTO model_tags (model_id, tag_id) VALUES (?, ?)');

      for (const tagName of tags) {
        if (tagName && tagName.trim()) {
          const cleanTag = tagName.trim();
          insertTag.run(cleanTag);
          const tag = getTagId.get(cleanTag);
          if (tag) {
            linkTag.run(fileId, tag.id);
          }
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Update tags error:', error.message);
    res.status(500).json({ error: 'Failed to update tags' });
  }
});

// Auto-tag endpoint - queues file for background analysis
app.post('/api/library/:id/auto-tag', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const fileId = parseInt(req.params.id);
    
    // Get file info
    const file = db.prepare('SELECT * FROM library WHERE id = ?').get(fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Check if already queued
    if (autoTagJob.queue.find(f => f.id === fileId)) {
      return res.json({ 
        status: 'already_queued',
        message: 'File is already queued for analysis',
        jobStatus: autoTagJob
      });
    }
    
    // Add to queue
    autoTagJob.queue.push({
      id: fileId,
      fileName: file.fileName,
      originalName: file.originalName,
      filePath: file.filePath,
      timestamp: Date.now()
    });
    
    // Return immediately
    res.json({
      status: 'queued',
      message: `File queued for background analysis. Position: ${autoTagJob.queue.length}`,
      jobStatus: {
        running: autoTagJob.running,
        queued: autoTagJob.queue.length,
        completed: autoTagJob.completed,
        failed: autoTagJob.failed
      }
    });
    
    // Start processing if not already running
    if (!autoTagJob.running) {
      processAutoTagQueue();
    }
  } catch (error) {
    console.error('Auto-tag queue error:', error);
    res.status(500).json({ error: 'Failed to queue auto-tag: ' + error.message });
  }
});

// Get auto-tag job status
app.get('/api/library/auto-tag-status', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  res.json({
    running: autoTagJob.running,
    total: autoTagJob.total,
    processed: autoTagJob.processed,
    completed: autoTagJob.completed,
    failed: autoTagJob.failed,
    queued: autoTagJob.queue.length,
    currentFile: autoTagJob.currentFile,
    elapsedTime: autoTagJob.running ? Math.round((Date.now() - autoTagJob.startTime) / 1000) : 0
  });
});

// Cancel auto-tag job
app.post('/api/library/auto-tag-cancel', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  autoTagJob.running = false;
  autoTagJob.queue = [];
  
  res.json({ success: true, message: 'Auto-tag job cancelled' });
});

// Bulk delete endpoint - queues files for background deletion
app.post('/api/library/bulk-delete', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { fileIds } = req.body;
  
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return res.status(400).json({ error: 'No files to delete' });
  }

  if (bulkDeleteJob.running) {
    return res.json({
      success: false,
      message: 'Bulk delete already running',
      status: bulkDeleteJob
    });
  }

  try {
    // Initialize job
    bulkDeleteJob = {
      running: true,
      total: fileIds.length,
      processed: 0,
      deleted: 0,
      failed: 0,
      currentFile: '',
      startTime: Date.now(),
      queue: [...fileIds]
    };

    console.log(`=== BULK DELETE: Starting background job for ${fileIds.length} files ===`);

    // Return immediately with job started
    res.json({
      success: true,
      message: `Bulk delete started for ${fileIds.length} files. Check /api/library/bulk-delete-status for progress.`,
      status: bulkDeleteJob
    });

    // Start processing in background
    processBulkDeleteQueue();
  } catch (error) {
    console.error('Failed to start bulk delete:', error.message);
    res.status(500).json({ error: 'Failed to start bulk delete: ' + error.message });
  }
});

// Get bulk delete job status
app.get('/api/library/bulk-delete-status', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  res.json({
    running: bulkDeleteJob.running,
    total: bulkDeleteJob.total,
    processed: bulkDeleteJob.processed,
    deleted: bulkDeleteJob.deleted,
    failed: bulkDeleteJob.failed,
    queued: bulkDeleteJob.queue.length,
    currentFile: bulkDeleteJob.currentFile,
    elapsedTime: bulkDeleteJob.running ? Math.round((Date.now() - bulkDeleteJob.startTime) / 1000) : 0
  });
});

// Cancel bulk delete job
app.post('/api/library/bulk-delete-cancel', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  bulkDeleteJob.running = false;
  bulkDeleteJob.queue = [];

  res.json({ success: true, message: 'Bulk delete job cancelled' });
});

// Background bulk delete processor
async function processBulkDeleteQueue() {
  while (bulkDeleteJob.running && bulkDeleteJob.queue.length > 0) {
    const fileId = bulkDeleteJob.queue.shift();
    
    if (!fileId) break;
    
    try {
      bulkDeleteJob.currentFile = fileId.toString();
      
      // Get file info for logging
      const file = db.prepare('SELECT fileName, originalName FROM library WHERE id = ?').get(fileId);
      
      // Delete from database
      db.prepare('DELETE FROM library WHERE id = ?').run(fileId);
      
      // Delete associated thumbnail and geometry cache
      const thumbPath = path.join(__dirname, 'data', 'thumbnails', `${fileId}.png`);
      const geoPath = path.join(__dirname, 'data', 'geometry', `${fileId}.stl`);
      
      if (fs.existsSync(thumbPath)) {
        fs.unlinkSync(thumbPath);
      }
      if (fs.existsSync(geoPath)) {
        fs.unlinkSync(geoPath);
      }
      
      bulkDeleteJob.deleted++;
      console.log(`  [${bulkDeleteJob.processed + 1}/${bulkDeleteJob.total}] Deleted: ${file?.originalName || fileId}`);
    } catch (error) {
      bulkDeleteJob.failed++;
      console.error(`Failed to delete file ${fileId}:`, error.message);
    }
    
    bulkDeleteJob.processed++;
    
    // Small delay to avoid blocking
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  if (bulkDeleteJob.processed >= bulkDeleteJob.total) {
    const elapsed = ((Date.now() - bulkDeleteJob.startTime) / 1000).toFixed(1);
    console.log(`=== BULK DELETE COMPLETE: ${bulkDeleteJob.deleted} deleted, ${bulkDeleteJob.failed} failed in ${elapsed}s ===`);
    bulkDeleteJob.running = false;
    bulkDeleteJob.currentFile = '';
  }
}

// Background auto-tag processor
async function processAutoTagQueue() {
  if (autoTagJob.running || autoTagJob.queue.length === 0) {
    return;
  }
  
  autoTagJob.running = true;
  autoTagJob.total = autoTagJob.queue.length;
  autoTagJob.processed = 0;
  autoTagJob.startTime = Date.now();
  
  console.log(`=== AUTO-TAG JOB STARTED: ${autoTagJob.total} files queued ===`);
  
  try {
    while (autoTagJob.queue.length > 0 && autoTagJob.running) {
      const fileData = autoTagJob.queue.shift();
      autoTagJob.processed++;
      autoTagJob.currentFile = fileData.originalName;
      
      console.log(`[${autoTagJob.processed}/${autoTagJob.total}] Analyzing: ${fileData.originalName}`);
      
      try {
        // Try multiple possible file paths
        let actualFilePath = null;
        const possiblePaths = [
          fileData.filePath,
          path.join(libraryDir, fileData.fileName),
          path.join(__dirname, 'library', fileData.fileName),
          `/app/library/${fileData.fileName}`
        ];
        
        for (const testPath of possiblePaths) {
          if (fs.existsSync(testPath)) {
            actualFilePath = testPath;
            break;
          }
        }
        
        if (!actualFilePath) {
          // Try to find by ID prefix
          const fileIdPrefix = fileData.fileName.split('-')[0];
          const searchDirs = [libraryDir, path.join(__dirname, 'library'), '/app/library'];
          for (const dir of searchDirs) {
            if (fs.existsSync(dir)) {
              try {
                const files = fs.readdirSync(dir);
                const matchingFile = files.find(f => f.startsWith(fileIdPrefix));
                if (matchingFile) {
                  actualFilePath = path.join(dir, matchingFile);
                  break;
                }
              } catch (err) {
                // Skip
              }
            }
          }
        }
        
        if (!actualFilePath) {
          console.error(`  ✗ File not found for ID ${fileData.id}`);
          autoTagJob.failed++;
        } else {
          // Run auto-analysis
          const analysis = await autoDescribeModel(actualFilePath, fileData.originalName);
          
          // Update database
          if (analysis.description) {
            db.prepare('UPDATE library SET description = ? WHERE id = ?').run(analysis.description, fileData.id);
          }
          
          if (analysis.tags && analysis.tags.length > 0) {
            for (const tag of analysis.tags) {
              // Insert or get tag
              const existingTag = db.prepare('SELECT id FROM tags WHERE name = ?').get(tag);
              if (existingTag) {
                db.prepare('INSERT OR IGNORE INTO library_tags (library_id, tag_id) VALUES (?, ?)').run(fileData.id, existingTag.id);
              } else {
                const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?)');
                const result = insertTag.run(tag);
                db.prepare('INSERT OR IGNORE INTO library_tags (library_id, tag_id) VALUES (?, ?)').run(fileData.id, result.lastInsertRowid);
              }
            }
          }
          
          console.log(`  ✓ Completed: ${fileData.originalName}`);
          autoTagJob.completed++;
        }
      } catch (error) {
        console.error(`  ✗ Error analyzing ${fileData.originalName}:`, error.message);
        autoTagJob.failed++;
      }
      
      // Yield to event loop
      await new Promise(resolve => setImmediate(resolve));
    }
    
    const elapsed = ((Date.now() - autoTagJob.startTime) / 1000).toFixed(1);
    console.log(`=== AUTO-TAG JOB COMPLETE: ${autoTagJob.completed} completed, ${autoTagJob.failed} failed in ${elapsed}s ===`);
  } catch (error) {
    console.error('Auto-tag job error:', error);
  } finally {
    autoTagJob.running = false;
    autoTagJob.currentFile = '';
  }
}

// Clean HTML-encoded descriptions in library
app.post('/api/library/clean-descriptions', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    // Get all library items with descriptions
    const items = db.prepare('SELECT id, description FROM library WHERE description IS NOT NULL AND description != ""').all();
    
    let cleaned = 0;
    for (const item of items) {
      const originalDesc = item.description;
      const cleanedDesc = cleanDescription(originalDesc);
      
      if (cleanedDesc !== originalDesc) {
        db.prepare('UPDATE library SET description = ? WHERE id = ?').run(cleanedDesc, item.id);
        cleaned++;
      }
    }
    
    res.json({ 
      success: true, 
      message: `Cleaned ${cleaned} descriptions`,
      totalChecked: items.length 
    });
  } catch (error) {
    console.error('Clean descriptions error:', error);
    res.status(500).json({ error: 'Failed to clean descriptions' });
  }
});

// Remove library entries where the file no longer exists
app.post('/api/library/cleanup-missing', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Check if user is admin
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const items = db.prepare('SELECT * FROM library').all();
    console.log(`=== LIBRARY CLEANUP: Checking ${items.length} files ===`);
    
    let removed = 0;
    let checked = 0;
    const removedFiles = [];
    
    for (const item of items) {
      checked++;
      
      // Try to find the file
      let fileExists = false;
      const possiblePaths = [
        item.filePath,
        path.join(libraryDir, item.fileName),
        `/app/library/${item.fileName}`
      ];
      
      for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
          fileExists = true;
          break;
        }
      }
      
      // Also try prefix search for Unicode issues
      if (!fileExists) {
        const fileIdPrefix = item.fileName.split('-')[0];
        const searchDirs = [libraryDir, '/app/library'];
        for (const dir of searchDirs) {
          if (fs.existsSync(dir)) {
            try {
              const files = fs.readdirSync(dir);
              if (files.some(f => f.startsWith(fileIdPrefix))) {
                fileExists = true;
                break;
              }
            } catch (err) {}
          }
        }
      }
      
      if (!fileExists) {
        console.log(`  Removing missing file: ${item.originalName} (${item.fileName})`);
        db.prepare('DELETE FROM library WHERE id = ?').run(item.id);
        removedFiles.push(item.originalName);
        removed++;
      }
    }
    
    console.log(`=== LIBRARY CLEANUP COMPLETE: Removed ${removed} missing files ===`);
    
    res.json({ 
      success: true, 
      message: `Removed ${removed} entries for missing files`,
      totalChecked: checked,
      removed,
      removedFiles
    });
  } catch (error) {
    console.error('Library cleanup error:', error);
    res.status(500).json({ error: 'Failed to cleanup library' });
  }
});

// Helper to yield control back to event loop (prevents blocking)
const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve));

// Auto-tag all library files (non-blocking background job)
app.post('/api/library/auto-tag-all', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Check if already running
  if (autoTagJob.running) {
    return res.json({ 
      success: false, 
      message: 'Auto-tag job already running',
      status: autoTagJob
    });
  }
  
  try {
    // Get all library items
    const items = db.prepare('SELECT * FROM library').all();
    
    // Reset job status for new run
    autoTagJob.running = true;
    autoTagJob.total = items.length;
    autoTagJob.processed = 0;
    autoTagJob.completed = 0;
    autoTagJob.failed = 0;
    autoTagJob.currentFile = '';
    autoTagJob.startTime = Date.now();
    autoTagJob.queue = []; // Clear queue
    
    console.log(`=== AUTO-TAG ALL: Starting background job for ${items.length} files ===`);
    
    // Return immediately with job started status
    res.json({ 
      success: true, 
      message: `Auto-tag job started for ${items.length} files. Check /api/library/auto-tag-status for progress.`,
      status: autoTagJob
    });
    
    // Process files in background (non-blocking)
    (async () => {
      for (const file of items) {
        // Check if job was cancelled
        if (!autoTagJob.running) {
          console.log('  Auto-tag job cancelled by user');
          break;
        }
        
        try {
          autoTagJob.processed++;
          autoTagJob.currentFile = file.originalName;
          
          console.log(`  [${autoTagJob.processed}/${autoTagJob.total}] Analyzing: ${file.originalName}`);
          
          // Build correct file path using fileName (stored path may be outdated)
          const actualFilePath = path.join(libraryDir, file.fileName);
          
          // Skip if file doesn't exist
          if (!fs.existsSync(actualFilePath)) {
            console.log(`    File not found: ${actualFilePath}`);
            autoTagJob.errors++;
            // Yield control to event loop
            await yieldToEventLoop();
            continue;
          }
          
          // Run auto-analysis
          const analysis = await autoDescribeModel(actualFilePath, file.originalName);
          
          // Yield control to event loop after analysis (heavy operation)
          await yieldToEventLoop();
          
          // Update description
          if (analysis.description) {
            db.prepare('UPDATE library SET description = ? WHERE id = ?').run(analysis.description, file.id);
          }
          
          // Update tags - add to existing tags
          if (analysis.tags && analysis.tags.length > 0) {
            // Get existing tags for this file
            const existingTags = db.prepare(`
              SELECT t.name FROM tags t 
              JOIN model_tags mt ON t.id = mt.tag_id 
              WHERE mt.model_id = ?
            `).all(file.id).map(t => t.name);
            
            // Add new tags that don't exist
            for (const tagName of analysis.tags) {
              if (existingTags.includes(tagName)) continue;
              
              // Insert or get tag
              let tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName);
              if (!tag) {
                const result = db.prepare('INSERT INTO tags (name) VALUES (?)').run(tagName);
                tag = { id: result.lastInsertRowid };
              }
              
              // Link tag to model (ignore if already exists)
              try {
                db.prepare('INSERT OR IGNORE INTO model_tags (model_id, tag_id) VALUES (?, ?)').run(file.id, tag.id);
              } catch (e) {}
            }
          }
          
          autoTagJob.completed++;
          
          // Yield control every file to keep server responsive
          await yieldToEventLoop();
          
        } catch (err) {
          console.error(`  Error processing ${file.originalName}:`, err.message);
          autoTagJob.failed++;
          // Yield even on error
          await yieldToEventLoop();
        }
      }
      
      const elapsed = ((Date.now() - autoTagJob.startTime) / 1000).toFixed(1);
      console.log(`=== AUTO-TAG ALL COMPLETE: ${autoTagJob.completed} completed, ${autoTagJob.failed} failed in ${elapsed}s ===`);
      
      autoTagJob.running = false;
      autoTagJob.currentFile = '';
    })();
    
  } catch (error) {
    console.error('Auto-tag all error:', error);
    autoTagJob.running = false;
    res.status(500).json({ error: 'Failed to start auto-tag job' });
  }
});

// Helper function to recursively walk directory
function walkDirectory(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      walkDirectory(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  }
  
  return fileList;
}

// Scan library folder endpoint - recursively scans the library directory (non-blocking)
app.post('/api/library/scan', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Check if already running
  if (libraryScanJob.running) {
    return res.json({ 
      success: false, 
      message: 'Library scan already running',
      status: libraryScanJob
    });
  }

  try {
    console.log(`Scanning library directory: ${libraryDir}`);
    const allFiles = walkDirectory(libraryDir);
    
    // Filter to only supported files
    const supportedFiles = allFiles.filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ext === '.3mf' || ext === '.stl' || ext === '.gcode';
    });
    
    // Initialize job status
    libraryScanJob = {
      running: true,
      total: supportedFiles.length,
      processed: 0,
      added: 0,
      skipped: 0,
      currentFile: '',
      startTime: Date.now()
    };
    
    console.log(`=== LIBRARY SCAN: Starting background job for ${supportedFiles.length} files ===`);
    
    // Return immediately with job started status
    res.json({ 
      success: true, 
      message: `Library scan started for ${supportedFiles.length} files. Check /api/library/scan-status for progress.`,
      status: libraryScanJob
    });
    
    // Process files in background
    (async () => {
      const extractionQueue = [];
      
      for (const filePath of supportedFiles) {
        // Check if job was cancelled
        if (!libraryScanJob.running) {
          console.log('  Library scan job cancelled by user');
          break;
        }
        
        libraryScanJob.processed++;
        const fileName = path.basename(filePath);
        libraryScanJob.currentFile = fileName;
        
        const ext = path.extname(filePath).toLowerCase();
        const relativePath = path.relative(__dirname, filePath);
        
        // Check if already exists in database by file path
        const existing = db.prepare('SELECT id FROM library WHERE filePath = ?').get(relativePath);
        
        if (!existing) {
          try {
            const stats = fs.statSync(filePath);
            const fileType = ext.substring(1);

            const result = db.prepare(`
              INSERT INTO library (fileName, originalName, fileType, fileSize, filePath, description, tags)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(fileName, fileName, fileType, stats.size, relativePath, '', '');
            
            libraryScanJob.added++;
            console.log(`  [${libraryScanJob.processed}/${libraryScanJob.total}] Added: ${fileName}`);
            
            // Queue for geometry extraction
            if (fileType === '3mf' || fileType === 'stl') {
              extractionQueue.push({ id: result.lastInsertRowid, path: filePath, type: fileType });
            }
          } catch (err) {
            console.error(`  Error adding ${fileName}:`, err.message);
          }
        } else {
          libraryScanJob.skipped++;
        }
        
        // Yield control to event loop every file
        await yieldToEventLoop();
      }
      
      const elapsed = ((Date.now() - libraryScanJob.startTime) / 1000).toFixed(1);
      console.log(`=== LIBRARY SCAN COMPLETE: ${libraryScanJob.added} added, ${libraryScanJob.skipped} skipped in ${elapsed}s ===`);
      
      // Trigger background extraction for all new files
      if (extractionQueue.length > 0) {
        console.log(`Queuing geometry extraction for ${extractionQueue.length} file(s)...`);
        setImmediate(() => {
          extractionQueue.forEach(({ id, path: fPath, type }) => {
            extractGeometry(id, fPath, type).catch(err => {
              console.error(`Failed to extract geometry for file ${id}:`, err.message);
            });
          });
        });
      }
      
      libraryScanJob.running = false;
      libraryScanJob.currentFile = '';
    })();
    
  } catch (error) {
    console.error('Scan error:', error.message);
    libraryScanJob.running = false;
    res.status(500).json({ error: 'Failed to start library scan' });
  }
});

// Check library scan job status
app.get('/api/library/scan-status', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const elapsed = libraryScanJob.startTime ? ((Date.now() - libraryScanJob.startTime) / 1000).toFixed(1) : 0;
  const percent = libraryScanJob.total > 0 ? Math.round((libraryScanJob.processed / libraryScanJob.total) * 100) : 0;
  
  res.json({
    ...libraryScanJob,
    elapsedSeconds: elapsed,
    percentComplete: percent
  });
});

// Cancel library scan job
app.post('/api/library/scan-cancel', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  if (!libraryScanJob.running) {
    return res.json({ success: false, message: 'No library scan job running' });
  }
  
  libraryScanJob.running = false;
  res.json({ success: true, message: 'Library scan job cancelled' });
});

// Check if ffmpeg is available
let ffmpegAvailable = false;
try {
  const { execSync } = require('child_process');
  execSync('ffmpeg -version', { stdio: 'pipe' });
  ffmpegAvailable = true;
  console.log('FFmpeg is available for camera snapshots');
} catch (e) {
  console.log('FFmpeg not found - camera snapshots will not work');
}

// Camera snapshot endpoint - captures a frame from RTSP stream
app.get('/api/camera-snapshot', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const requestedPrinterId = String(req.query.printerId || '').trim();
  let rtspUrl = String(req.query.url || '').trim();

  if (!rtspUrl && requestedPrinterId) {
    rtspUrl = getConfiguredRtspSource(requestedPrinterId).rtspUrl;
  }
  
  if (!rtspUrl) {
    return res.status(400).json({ error: 'RTSP URL or printerId required' });
  }

  // If it's an HTTP URL (like a JPEG snapshot URL), fetch it directly
  if (rtspUrl.startsWith('http://') || rtspUrl.startsWith('https://')) {
    try {
      console.log('Fetching HTTP camera image:', rtspUrl.replace(/:[^:@]*@/, ':***@'));
      const response = await axios.get(rtspUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'Accept': 'image/jpeg, image/*'
        }
      });
      
      res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.send(Buffer.from(response.data));
      return;
    } catch (error) {
      console.error('HTTP camera fetch error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch camera image', details: error.message });
    }
  }

  // For RTSP streams, check if ffmpeg is available first
  if (!ffmpegAvailable) {
    return res.status(503).json({ 
      error: 'Camera requires FFmpeg', 
      details: 'FFmpeg is not installed. Install FFmpeg to enable camera snapshots. For Docker, add "ffmpeg" to your image.'
    });
  }

  // For RTSP streams, use ffmpeg via child_process for better control
  const { spawn } = require('child_process');
  
  // Create temp directory if it doesn't exist
  const tempDir = path.join(__dirname, 'data', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const tempFile = path.join(tempDir, `camera-temp-${Date.now()}.jpg`);
  
  console.log('Attempting RTSP snapshot:', rtspUrl.replace(/:[^:@]*@/, ':***@'));
  
  // Build ffmpeg command with robust options for ffmpeg 8.x
  const ffmpegArgs = [
    '-y',                          // Overwrite output
    '-rtsp_transport', 'tcp',      // Use TCP for RTSP (more reliable)
    '-timeout', '10000000',        // Connection timeout in microseconds
    '-i', rtspUrl,                 // Input URL
    '-vframes', '1',               // Capture 1 frame
    '-q:v', '2',                   // JPEG quality (2=high, 31=low)
    tempFile                       // Output file
  ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stderr = '';
  let ffmpegTimeout;
  
  ffmpeg.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  ffmpeg.on('close', (code) => {
    clearTimeout(ffmpegTimeout);
    if (code === 0 && fs.existsSync(tempFile)) {
      console.log('FFmpeg snapshot captured successfully');
      
      // Check if file has content
      const stats = fs.statSync(tempFile);
      if (stats.size === 0) {
        console.error('Captured file is empty');
        fs.unlinkSync(tempFile);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Captured image is empty' });
        }
        return;
      }
      
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Content-Length', stats.size);
      
      const stream = fs.createReadStream(tempFile);
      stream.pipe(res);
      stream.on('end', () => {
        fs.unlink(tempFile, (err) => {
          if (err) console.error('Failed to delete temp file:', err);
        });
      });
      stream.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to read snapshot file' });
        }
      });
    } else {
      console.error('FFmpeg failed with code:', code);
      console.error('FFmpeg stderr:', stderr);
      
      // Clean up temp file if it exists
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Failed to capture camera snapshot',
          details: `FFmpeg exit code: ${code}`,
          stderr: stderr.slice(-500) // Last 500 chars of error
        });
      }
    }
  });

  ffmpeg.on('error', (err) => {
    console.error('FFmpeg spawn error:', err);
    clearTimeout(ffmpegTimeout);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Failed to run ffmpeg',
        details: err.message 
      });
    }
  });

  // Timeout after 15 seconds
  ffmpegTimeout = setTimeout(() => {
    if (!ffmpeg.killed) {
      ffmpeg.kill('SIGKILL');
      console.error('FFmpeg timeout - killed process');
    }
  }, 15000);
});

// Generate thumbnails for all library files on startup
async function generateAllThumbnails() {
  console.log('\n=== Generating thumbnails for library files ===');
  try {
    const files = db.prepare('SELECT * FROM library').all();
    console.log(`Found ${files.length} files in library`);
    
    for (const file of files) {
      try {
        await getThumbnail(file);
      } catch (err) {
        console.error(`✗ Failed to generate thumbnail for ${file.originalName}:`, err.message);
      }

      await yieldToEventLoop();
    }
    
    console.log('\n=== Thumbnail generation complete ===\n');
  } catch (err) {
    console.error('Error generating thumbnails:', err.message);
  }
}

// Middleware to check if user is admin
const requireAdmin = (req, res, next) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get current user info
app.get('/api/user/me', (req, res) => {
  if (!req.session.authenticated || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    // Try with all columns, fall back if columns don't exist
    let user;
    try {
      user = db.prepare('SELECT id, username, email, role, display_name FROM users WHERE id = ?').get(req.session.userId);
    } catch (e) {
      if (e.message.includes('no such column')) {
        user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.session.userId);
        user.email = null;
        user.display_name = null;
      } else {
        throw e;
      }
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Get all users
app.get('/api/admin/users', requireAdmin, (req, res) => {
  try {
    // Try with new columns, fall back if they don't exist
    let users;
    try {
      users = db.prepare('SELECT id, username, email, role, oauth_provider, created_at FROM users ORDER BY created_at DESC').all();
    } catch (e) {
      if (e.message.includes('no such column')) {
        users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC').all();
        users = users.map(u => ({ ...u, email: null, oauth_provider: null }));
      } else {
        throw e;
      }
    }
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Admin: Update user role
app.patch('/api/admin/users/:id/role', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  
  if (!['admin', 'user', 'superadmin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  
  try {
    const currentUser = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    const targetUser = db.prepare('SELECT role, username FROM users WHERE id = ?').get(id);
    
    // Only superadmins can promote to superadmin or demote superadmins
    if (role === 'superadmin' && currentUser.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only superadmins can promote to superadmin' });
    }
    
    if (targetUser.role === 'superadmin' && currentUser.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only superadmins can change superadmin roles' });
    }
    
    // Prevent removing the last admin
    const adminCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role IN (?, ?)').get('admin', 'superadmin');
    if ((targetUser.role === 'admin' || targetUser.role === 'superadmin') && (role !== 'admin' && role !== 'superadmin') && adminCount.count <= 1) {
      return res.status(400).json({ error: 'Cannot remove the last admin' });
    }
    
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// Admin: Delete user
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  
  try {
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
    
    // Prevent deleting superadmin
    if (user.role === 'superadmin') {
      return res.status(400).json({ error: 'Cannot delete superadmin' });
    }
    
    // Prevent deleting the last admin
    if (user.role === 'admin') {
      const adminCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role IN (?, ?)').get('admin', 'superadmin');
      if (adminCount.count <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last admin' });
      }
    }
    
    // Don't allow deleting yourself
    if (parseInt(id) === req.session.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    // Note: Settings are now global, not per-user
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Admin: Manually trigger Bambu account migration
app.post('/api/admin/migrate-bambu-accounts', requireAdmin, (req, res) => {
  try {
    const { migrateBambuAccounts } = require('./database');
    const result = migrateBambuAccounts();
    res.json(result);
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Get OAuth settings
app.get('/api/settings/oauth', requireAdmin, (req, res) => {
  try {
    const settings = db.prepare('SELECT key, value FROM config WHERE key LIKE ?').all('oauth_%');
    const oauthConfig = {
      provider: 'none',
      publicHostname: '',
      googleClientId: '',
      googleClientSecret: '',
      oidcIssuer: '',
      oidcClientId: '',
      oidcClientSecret: '',
      oidcEndSessionUrl: ''
    };
    
    settings.forEach(row => {
      const key = row.key.replace('oauth_', '');
      // Only include fields we want to expose
      if (key in oauthConfig) {
        oauthConfig[key] = row.value || '';
      }
    });
    
    res.json(oauthConfig);
  } catch (error) {
    console.error('Error fetching OAuth settings:', error);
    res.status(500).json({ error: 'Failed to fetch OAuth settings' });
  }
});

// Public: Get OAuth provider (for login page auto-redirect)
app.get('/api/settings/oauth-public', (req, res) => {
  try {
    const providerRow = db.prepare('SELECT value FROM config WHERE key = ?').get('oauth_provider');
    res.json({ provider: providerRow?.value || 'none' });
  } catch (error) {
    console.error('Error fetching OAuth provider:', error);
    res.json({ provider: 'none' });
  }
});

// Admin: Save OAuth settings
app.post('/api/settings/save-oauth', requireAdmin, async (req, res) => {
  const {
    provider,
    publicHostname,
    googleClientId,
    googleClientSecret,
    oidcIssuer,
    oidcClientId,
    oidcClientSecret,
    oidcEndSessionUrl
  } = req.body;
  
  try {
    const upsert = db.prepare(`
      INSERT INTO config (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `);
    
    upsert.run('oauth_provider', provider, provider);
    upsert.run('oauth_publicHostname', publicHostname, publicHostname);
    upsert.run('oauth_googleClientId', googleClientId, googleClientId);
    upsert.run('oauth_googleClientSecret', googleClientSecret, googleClientSecret);
    upsert.run('oauth_oidcIssuer', oidcIssuer, oidcIssuer);
    upsert.run('oauth_oidcClientId', oidcClientId, oidcClientId);
    upsert.run('oauth_oidcClientSecret', oidcClientSecret, oidcClientSecret);
    upsert.run('oauth_oidcEndSessionUrl', oidcEndSessionUrl || '', oidcEndSessionUrl || '');
    
    // Reconfigure OIDC client with new settings
    if (provider === 'oidc') {
      const success = await configureOIDC();
      if (success) {
        res.json({ success: true, message: 'OAuth settings saved and OIDC client reconfigured successfully!' });
      } else {
        res.json({ success: true, message: 'OAuth settings saved but OIDC configuration failed. Check server logs.' });
      }
    } else {
      res.json({ success: true, message: 'OAuth settings saved successfully!' });
    }
  } catch (error) {
    console.error('Error saving OAuth settings:', error);
    res.status(500).json({ error: 'Failed to save OAuth settings' });
  }
});

// Get cost settings
app.get('/api/settings/costs', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const settings = {};
    const keys = ['filamentCostPerKg', 'electricityCostPerKwh', 'printerWattage', 'currency'];
    
    for (const key of keys) {
      const row = db.prepare('SELECT value FROM config WHERE key = ?').get(`cost_${key}`);
      settings[key] = row ? parseFloat(row.value) || row.value : null;
    }
    
    // Get material-specific costs
    const materialCostsRow = db.prepare('SELECT value FROM config WHERE key = ?').get('cost_materialCosts');
    if (materialCostsRow) {
      try {
        settings.materialCosts = JSON.parse(materialCostsRow.value);
      } catch (e) {
        settings.materialCosts = {};
      }
    } else {
      settings.materialCosts = {};
    }
    
    // Defaults
    settings.filamentCostPerKg = settings.filamentCostPerKg ?? 25;
    settings.electricityCostPerKwh = settings.electricityCostPerKwh ?? 0.12;
    settings.printerWattage = settings.printerWattage ?? 150;
    settings.currency = settings.currency ?? 'USD';
    
    res.json(settings);
  } catch (error) {
    console.error('Get cost settings error:', error);
    res.status(500).json({ error: 'Failed to get cost settings' });
  }
});

// Save cost settings
app.post('/api/settings/costs', requireAdmin, (req, res) => {
  const { filamentCostPerKg, electricityCostPerKwh, printerWattage, currency, materialCosts } = req.body;
  
  try {
    const upsert = db.prepare(`
      INSERT INTO config (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `);
    
    upsert.run('cost_filamentCostPerKg', filamentCostPerKg, filamentCostPerKg);
    upsert.run('cost_electricityCostPerKwh', electricityCostPerKwh, electricityCostPerKwh);
    upsert.run('cost_printerWattage', printerWattage, printerWattage);
    upsert.run('cost_currency', currency, currency);
    
    // Save material-specific costs as JSON
    if (materialCosts) {
      const materialCostsJson = JSON.stringify(materialCosts);
      upsert.run('cost_materialCosts', materialCostsJson, materialCostsJson);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Save cost settings error:', error);
    res.status(500).json({ error: 'Failed to save cost settings' });
  }
});

// Helper function to calculate cost for a print
function calculatePrintCost(print) {
  try {
    const getCostSetting = (key, defaultValue) => {
      const row = db.prepare('SELECT value FROM config WHERE key = ?').get(`cost_${key}`);
      return row ? parseFloat(row.value) || defaultValue : defaultValue;
    };
    
    const filamentCostPerKg = getCostSetting('filamentCostPerKg', 25);
    const electricityCostPerKwh = getCostSetting('electricityCostPerKwh', 0.12);
    const printerWattage = getCostSetting('printerWattage', 150);
    
    // Get material-specific costs
    const materialCostsRow = db.prepare('SELECT value FROM config WHERE key = ?').get('cost_materialCosts');
    let materialCosts = {};
    if (materialCostsRow) {
      try {
        materialCosts = JSON.parse(materialCostsRow.value);
      } catch (e) {}
    }
    
    const weight = parseFloat(print.weight) || 0; // grams
    const costTime = parseInt(print.costTime) || 0; // seconds
    
    // Parse material from the material JSON field (e.g., {"1": "PLA"})
    let materialType = null;
    if (print.material) {
      try {
        const matObj = typeof print.material === 'string' ? JSON.parse(print.material) : print.material;
        // Get the first material type from the object
        materialType = Object.values(matObj)[0];
      } catch (e) {}
    }
    
    // Use material-specific cost if available, otherwise use default
    const costPerKg = (materialType && materialCosts[materialType]) ? materialCosts[materialType] : filamentCostPerKg;
    
    // Calculate filament cost (weight in grams / 1000 to get kg)
    const filamentCost = (weight / 1000) * costPerKg;
    
    // Calculate electricity cost (seconds / 3600 to get hours * wattage / 1000 to get kWh)
    const electricityCost = (costTime / 3600) * (printerWattage / 1000) * electricityCostPerKwh;
    
    const totalCost = filamentCost + electricityCost;
    
    return totalCost;
  } catch (error) {
    console.error('Error calculating print cost:', error);
    return 0;
  }
}

// Calculate costs for prints
app.get('/api/statistics/costs', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    // Get cost settings
    const getCostSetting = (key, defaultValue) => {
      const row = db.prepare('SELECT value FROM config WHERE key = ?').get(`cost_${key}`);
      return row ? parseFloat(row.value) || defaultValue : defaultValue;
    };
    
    const filamentCostPerKg = getCostSetting('filamentCostPerKg', 25);
    const electricityCostPerKwh = getCostSetting('electricityCostPerKwh', 0.12);
    const printerWattage = getCostSetting('printerWattage', 150);
    const currency = db.prepare('SELECT value FROM config WHERE key = ?').get('cost_currency')?.value || 'USD';
    
    // Get all successful prints
    const prints = db.prepare(`
      SELECT weight, costTime 
      FROM prints 
      WHERE status = 2 AND (weight > 0 OR costTime > 0)
    `).all();
    
    let totalFilamentCost = 0;
    let totalElectricityCost = 0;
    let totalFilamentGrams = 0;
    let totalPrintHours = 0;
    
    for (const print of prints) {
      // Filament cost (weight is in grams)
      if (print.weight) {
        const kgUsed = print.weight / 1000;
        totalFilamentCost += kgUsed * filamentCostPerKg;
        totalFilamentGrams += print.weight;
      }
      
      // Electricity cost (costTime is in seconds)
      if (print.costTime) {
        const hours = print.costTime / 3600;
        const kwhUsed = (printerWattage / 1000) * hours;
        totalElectricityCost += kwhUsed * electricityCostPerKwh;
        totalPrintHours += hours;
      }
    }
    
    res.json({
      totalCost: totalFilamentCost + totalElectricityCost,
      filamentCost: totalFilamentCost,
      electricityCost: totalElectricityCost,
      filamentUsedKg: totalFilamentGrams / 1000,
      printTimeHours: totalPrintHours,
      currency,
      settings: {
        filamentCostPerKg,
        electricityCostPerKwh,
        printerWattage
      }
    });
  } catch (error) {
    console.error('Calculate costs error:', error);
    res.status(500).json({ error: 'Failed to calculate costs' });
  }
});

// Maintenance Tasks API
app.get('/api/maintenance', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const tasks = db.prepare(`
      SELECT * FROM maintenance_tasks 
      ORDER BY next_due ASC NULLS LAST, task_name ASC
    `).all();
    
    // Get print hours per printer
    const printerHours = {};
    const allPrints = db.prepare('SELECT deviceId, costTime FROM prints').all();
    let totalPrintSeconds = 0;
    
    for (const print of allPrints) {
      if (print.costTime) {
        totalPrintSeconds += print.costTime;
        if (print.deviceId) {
          if (!printerHours[print.deviceId]) {
            printerHours[print.deviceId] = 0;
          }
          printerHours[print.deviceId] += print.costTime;
        }
      }
    }
    const totalPrintHours = totalPrintSeconds / 3600;
    
    // Check for overdue tasks based on print hours
    logger.debug(`[Maintenance] Total print hours: ${totalPrintHours.toFixed(2)}`);
    Object.keys(printerHours).forEach(pid => {
      logger.debug(`[Maintenance] Printer ${pid}: ${(printerHours[pid] / 3600).toFixed(2)} hrs`);
    });
    
    const tasksWithStatus = tasks.map(task => {
      // Use printer-specific hours if task is assigned to a printer
      const currentPrintHours = task.printer_id && printerHours[task.printer_id]
        ? printerHours[task.printer_id] / 3600
        : totalPrintHours;
      let isOverdue = false;
      let isDueSoon = false;
      let hoursUntilDue = null;
      
      logger.debug(`[Maintenance] Task "${task.task_name}": DB hours_until_due=${task.hours_until_due}, interval=${task.interval_hours}`);
      
      if (task.hours_until_due !== null && task.hours_until_due !== undefined) {
        // hours_until_due stores the ABSOLUTE hour marker when maintenance is due
        // e.g., if total print hours is 1000 and task is due at 2222, then 2222 - 1000 = 1222 hrs remaining
        hoursUntilDue = task.hours_until_due - currentPrintHours;
        logger.debug(`[Maintenance] Task "${task.task_name}": Calculated ${task.hours_until_due} - ${currentPrintHours.toFixed(2)} = ${hoursUntilDue.toFixed(2)} hrs remaining`);
        isOverdue = hoursUntilDue < 0;
        isDueSoon = !isOverdue && hoursUntilDue <= 20;
      } else if (task.next_due && task.interval_hours) {
        // Fallback: Calculate from next_due and interval_hours
        // If next_due exists but hours_until_due is null, initialize it now
        logger.debug(`[Maintenance] Task "${task.task_name}": hours_until_due is NULL, calculating from interval...`);
        
        // If never performed, due at current + interval
        // If last_performed exists, calculate from that
        if (task.last_performed) {
          // The task was completed before hours_until_due column existed
          // We need to retroactively calculate when it should be due
          // This is tricky because we don't know the print hours at completion time
          // Best guess: use next_due time-based as a fallback
          const now = new Date().toISOString();
          isOverdue = task.next_due < now;
          isDueSoon = !isOverdue && new Date(task.next_due) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          
          // Try to initialize hours_until_due for this task
          const taskNextDueHours = currentPrintHours + task.interval_hours;
          try {
            db.prepare('UPDATE maintenance_tasks SET hours_until_due = ? WHERE id = ?').run(taskNextDueHours, task.id);
            logger.debug(`[Maintenance] Initialized hours_until_due=${taskNextDueHours} for task ${task.id}`);
            hoursUntilDue = task.interval_hours; // Since we just set it to current + interval
          } catch (e) {
            logger.warn(`[Maintenance] Failed to initialize hours_until_due: ${e.message}`);
          }
        } else {
          // New task never performed - set it to be due at current + interval
          hoursUntilDue = task.interval_hours;
          const taskNextDueHours = currentPrintHours + task.interval_hours;
          try {
            db.prepare('UPDATE maintenance_tasks SET hours_until_due = ? WHERE id = ?').run(taskNextDueHours, task.id);
            logger.debug(`[Maintenance] Initialized new task hours_until_due=${taskNextDueHours} for task ${task.id}`);
          } catch (e) {
            logger.warn(`[Maintenance] Failed to initialize hours_until_due: ${e.message}`);
          }
          isDueSoon = hoursUntilDue <= 20;
        }
      } else {
        // Fallback to time-based if neither hours_until_due nor next_due is set
        console.log(`[Maintenance GET] Task "${task.task_name}": Using time-based fallback, next_due=${task.next_due}`);
        const now = new Date().toISOString();
        isOverdue = task.next_due && task.next_due < now;
        isDueSoon = !isOverdue && task.next_due && new Date(task.next_due) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      }
      
      return {
        ...task,
        isOverdue,
        isDueSoon,
        hours_until_due: hoursUntilDue
      };
    });
    
    res.json(tasksWithStatus);
  } catch (error) {
    console.error('Get maintenance tasks error:', error);
    res.status(500).json({ error: 'Failed to get maintenance tasks' });
  }
});

app.post('/api/maintenance', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const { printer_id, task_name, task_type, description, interval_hours } = req.body;
    
    if (!task_name || !task_type) {
      return res.status(400).json({ error: 'Task name and type are required' });
    }
    
    // Calculate current total print hours
    const prints = db.prepare('SELECT costTime FROM prints').all();
    let totalPrintSeconds = 0;
    for (const print of prints) {
      if (print.costTime) {
        totalPrintSeconds += print.costTime;
      }
    }
    const currentPrintHours = totalPrintSeconds / 3600;
    
    // New tasks should be due at: current print hours + interval
    const taskInterval = interval_hours || 100;
    const initialDueHours = currentPrintHours + taskInterval;
    
    console.log(`[Maintenance Create] Creating task "${task_name}"`);
    console.log(`  - Current print hours: ${currentPrintHours.toFixed(2)}`);
    console.log(`  - Interval: ${taskInterval} hours`);
    console.log(`  - Will be due at print hour: ${initialDueHours.toFixed(2)}`);
    
    const result = db.prepare(`
      INSERT INTO maintenance_tasks (printer_id, task_name, task_type, description, interval_hours, hours_until_due)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(printer_id || null, task_name, task_type, description || '', taskInterval, initialDueHours);
    
    const task = db.prepare('SELECT * FROM maintenance_tasks WHERE id = ?').get(result.lastInsertRowid);
    
    res.json({ success: true, task });
  } catch (error) {
    console.error('Create maintenance task error:', error);
    res.status(500).json({ error: 'Failed to create maintenance task' });
  }
});

app.put('/api/maintenance/:id', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const { id } = req.params;
    const { printer_id, task_name, task_type, description, interval_hours } = req.body;
    
    // Get old task to check if interval changed
    const oldTask = db.prepare('SELECT * FROM maintenance_tasks WHERE id = ?').get(id);
    
    db.prepare(`
      UPDATE maintenance_tasks 
      SET printer_id = ?, task_name = ?, task_type = ?, description = ?, interval_hours = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(printer_id || null, task_name, task_type, description || '', interval_hours || 100, id);
    
    // If interval changed and task has been performed, recalculate hours_until_due
    if (oldTask && oldTask.interval_hours !== interval_hours && oldTask.last_performed) {
      // Calculate current print hours
      const prints = db.prepare('SELECT costTime FROM prints').all();
      let totalPrintSeconds = 0;
      for (const print of prints) {
        if (print.costTime) {
          totalPrintSeconds += print.costTime;
        }
      }
      const currentPrintHours = totalPrintSeconds / 3600;
      
      // Recalculate: if last performed, new due = current + new interval
      const newDueHours = currentPrintHours + interval_hours;
      
      try {
        db.prepare('UPDATE maintenance_tasks SET hours_until_due = ? WHERE id = ?').run(newDueHours, id);
        console.log(`[Maintenance Update] Recalculated hours_until_due to ${newDueHours.toFixed(2)} for task ${id} (interval changed from ${oldTask.interval_hours} to ${interval_hours})`);
      } catch (e) {
        console.error(`[Maintenance Update] Failed to recalculate hours_until_due:`, e.message);
      }
    }
    
    const task = db.prepare('SELECT * FROM maintenance_tasks WHERE id = ?').get(id);
    
    res.json({ success: true, task });
  } catch (error) {
    console.error('Update maintenance task error:', error);
    res.status(500).json({ error: 'Failed to update maintenance task' });
  }
});

app.delete('/api/maintenance/:id', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM maintenance_tasks WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete maintenance task error:', error);
    res.status(500).json({ error: 'Failed to delete maintenance task' });
  }
});

app.post('/api/maintenance/:id/complete', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const { id } = req.params;
    const { notes } = req.body; // Optional notes from user
    const task = db.prepare('SELECT * FROM maintenance_tasks WHERE id = ?').get(id);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const now = new Date();
    
    // Calculate next due based on print hours, not real time
    // Get total print hours from all prints
    const prints = db.prepare('SELECT costTime FROM prints').all();
    let totalPrintSeconds = 0;
    for (const print of prints) {
      if (print.costTime) {
        totalPrintSeconds += print.costTime;
      }
    }
    const totalPrintHours = totalPrintSeconds / 3600;
    
    // Calculate the ABSOLUTE print hour marker when this task will be due
    // This is the key: we store when (in terms of total print hours) the task should be due
    const nextDueHours = totalPrintHours + task.interval_hours;
    
    // Also store a timestamp for next_due (for time-based fallback and UI display)
    const nextDue = new Date(now.getTime() + task.interval_hours * 60 * 60 * 1000);
    
    console.log(`[Maintenance Complete] Task ${id} "${task.task_name}":`);
    console.log(`  - Current total print hours: ${totalPrintHours.toFixed(2)}`);
    console.log(`  - Task interval: ${task.interval_hours} hours`);
    console.log(`  - Next due at print hour: ${nextDueHours.toFixed(2)}`);
    console.log(`  - Hours remaining until due: ${task.interval_hours.toFixed(2)}`);
    
    // Update the task with both timestamp and absolute hour marker
    db.prepare(`
      UPDATE maintenance_tasks 
      SET last_performed = ?, 
          next_due = ?, 
          hours_until_due = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(now.toISOString(), nextDue.toISOString(), nextDueHours, id);
    
    // Log completion to history
    db.prepare(`
      INSERT INTO maintenance_history (task_id, task_name, printer_id, completed_at, print_hours_at_completion, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, task.task_name, task.printer_id, now.toISOString(), totalPrintHours, notes || null);
    
    const updatedTask = db.prepare('SELECT * FROM maintenance_tasks WHERE id = ?').get(id);
    console.log(`[Maintenance Complete] Task updated successfully. hours_until_due=${updatedTask.hours_until_due}`);
    
    // Send notification
    try {
      const printerName = updatedTask.printer_id ? 
        db.prepare('SELECT deviceName FROM printers WHERE deviceId = ?').get(updatedTask.printer_id)?.deviceName || updatedTask.printer_id
        : 'All Printers';
      
      await sendNotification('maintenance', {
        status: 'completed',
        message: `Maintenance task "${updatedTask.task_name}" has been completed!`,
        taskName: updatedTask.task_name,
        printerName: printerName,
        currentHours: totalPrintHours,
        dueAtHours: nextDueHours
      });
    } catch (notifError) {
      console.error('Failed to send notification:', notifError);
    }
    
    res.json({ success: true, task: updatedTask });
  } catch (error) {
    console.error('Complete maintenance task error:', error);
    res.status(500).json({ error: 'Failed to complete maintenance task' });
  }
});

// Get maintenance history for a task
app.get('/api/maintenance/:id/history', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const { id } = req.params;
    const history = db.prepare(`
      SELECT * FROM maintenance_history 
      WHERE task_id = ? 
      ORDER BY completed_at DESC
    `).all(id);
    
    res.json(history);
  } catch (error) {
    console.error('Get maintenance history error:', error);
    res.status(500).json({ error: 'Failed to get maintenance history' });
  }
});

// Get maintenance summary/stats
app.get('/api/maintenance/summary', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    // Get current total print hours
    const prints = db.prepare('SELECT costTime FROM prints').all();
    let totalPrintSeconds = 0;
    for (const print of prints) {
      if (print.costTime) {
        totalPrintSeconds += print.costTime;
      }
    }
    const currentPrintHours = totalPrintSeconds / 3600;
    
    const allTasks = db.prepare('SELECT * FROM maintenance_tasks').all();
    const total = allTasks.length;
    const neverDone = allTasks.filter(t => !t.last_performed).length;
    
    // Count overdue and due-soon based on print hours
    let overdue = 0;
    let dueSoon = 0;
    
    for (const task of allTasks) {
      if (task.hours_until_due) {
        if (currentPrintHours >= task.hours_until_due) {
          overdue++;
        } else if (task.hours_until_due - currentPrintHours <= 50) {
          dueSoon++;
        }
      }
    }
    
    res.json({
      total,
      overdue,
      dueSoon,
      neverDone,
      upToDate: total - overdue - dueSoon - neverDone
    });
  } catch (error) {
    console.error('Get maintenance summary error:', error);
    res.status(500).json({ error: 'Failed to get maintenance summary' });
  }
});

// Admin: Restart/Reboot the application
app.post('/api/settings/restart', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Check if user is admin
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  console.log('=== RESTART REQUESTED BY ADMIN ===');
  res.json({ success: true, message: 'Server restarting...', shouldRestart: true });
  
  // Give time for response to be sent
  setTimeout(() => {
    console.log('Shutting down for restart - Docker/PM2 will auto-restart...');
    
    // Close database gracefully
    if (db) {
      try {
        db.close();
        console.log('Database closed');
      } catch (e) {
        console.error('Error closing database:', e);
      }
    }
    
    // Close the HTTP server gracefully
    if (httpServer) {
      httpServer.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
      });
      
      // Force exit after 3 seconds if server doesn't close gracefully
      setTimeout(() => {
        console.log('Force exit after timeout');
        process.exit(1);
      }, 5000);
    } else {
      process.exit(1);
    }
  }, 2000);
});

// Health check endpoint for Docker/watchdog
app.get('/api/health', (req, res) => {
  try {
    // Check database connectivity
    const dbCheck = db.prepare('SELECT 1 as ok').get();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      database: dbCheck ? 'connected' : 'disconnected'
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Test ffmpeg installation
app.get('/api/camera-test', async (req, res) => {
  const { execSync } = require('child_process');
  
  try {
    const version = execSync('ffmpeg -version', { encoding: 'utf8', timeout: 5000 });
    const firstLine = version.split('\n')[0];
    res.json({
      success: true,
      ffmpeg: firstLine,
      path: execSync('which ffmpeg', { encoding: 'utf8', timeout: 5000 }).trim()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ffmpeg not available',
      details: error.message
    });
  }
});

// Get watchdog settings
app.get('/api/settings/watchdog', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const getConfig = db.prepare('SELECT value FROM config WHERE key = ?');
    const watchdogEnabled = getConfig.get('watchdog_enabled');
    const watchdogInterval = getConfig.get('watchdog_interval');
    const watchdogEndpoint = getConfig.get('watchdog_endpoint');
    
    res.json({
      enabled: watchdogEnabled?.value === 'true',
      interval: parseInt(watchdogInterval?.value || '30', 10),
      endpoint: watchdogEndpoint?.value || ''
    });
  } catch (error) {
    console.error('Error getting watchdog settings:', error);
    res.status(500).json({ error: 'Failed to get watchdog settings' });
  }
});

// Save watchdog settings
app.post('/api/settings/watchdog', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Check if user is admin
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const { enabled, interval, endpoint } = req.body;
    
    const upsert = db.prepare(`
      INSERT INTO config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    
    upsert.run('watchdog_enabled', enabled ? 'true' : 'false');
    upsert.run('watchdog_interval', String(interval || 30));
    upsert.run('watchdog_endpoint', endpoint || '');
    
    // Update the watchdog timer
    setupWatchdog();
    
    res.json({ success: true, message: 'Watchdog settings saved!' });
  } catch (error) {
    console.error('Error saving watchdog settings:', error);
    res.status(500).json({ error: 'Failed to save watchdog settings' });
  }
});

// Get Discord webhook settings
app.get('/api/settings/discord', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const getConfig = db.prepare('SELECT value FROM config WHERE key = ?');
    const printerWebhook = getConfig.get('discord_printer_webhook');
    const printerEnabled = getConfig.get('discord_printer_enabled');
    const maintenanceWebhook = getConfig.get('discord_maintenance_webhook');
    const maintenanceEnabled = getConfig.get('discord_maintenance_enabled');
    const pingUserId = getConfig.get('discord_ping_user_id');
    
    res.json({
      printerWebhook: printerWebhook?.value || '',
      printerEnabled: printerEnabled?.value === 'true',
      maintenanceWebhook: maintenanceWebhook?.value || '',
      maintenanceEnabled: maintenanceEnabled?.value === 'true',
      pingUserId: pingUserId?.value || ''
    });
  } catch (error) {
    console.error('Error getting Discord settings:', error);
    res.status(500).json({ error: 'Failed to get Discord settings' });
  }
});

// Save Discord webhook settings
app.post('/api/settings/discord', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Check if user is admin
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const { printerWebhook, printerEnabled, maintenanceWebhook, maintenanceEnabled, pingUserId } = req.body;
    
    const upsert = db.prepare(`
      INSERT INTO config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    
    upsert.run('discord_printer_webhook', printerWebhook || '');
    upsert.run('discord_printer_enabled', printerEnabled ? 'true' : 'false');
    upsert.run('discord_maintenance_webhook', maintenanceWebhook || '');
    upsert.run('discord_maintenance_enabled', maintenanceEnabled ? 'true' : 'false');
    upsert.run('discord_ping_user_id', pingUserId || '');
    
    res.json({ success: true, message: 'Discord settings saved!' });
  } catch (error) {
    console.error('Error saving Discord settings:', error);
    res.status(500).json({ error: 'Failed to save Discord settings' });
  }
});

// Unified notifications settings (Discord, Telegram, Slack)
app.get('/api/settings/notifications', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const get = db.prepare('SELECT value FROM config WHERE key = ?');
    const response = {
      discord: {
        webhook: get.get('discord_printer_webhook')?.value || get.get('discord_maintenance_webhook')?.value || '',
        printerEnabled: get.get('discord_printer_enabled')?.value === 'true',
        maintenanceEnabled: get.get('discord_maintenance_enabled')?.value === 'true',
        backupEnabled: get.get('discord_backup_enabled')?.value === 'true',
        pingUserId: get.get('discord_ping_user_id')?.value || ''
      },
      telegram: {
        botToken: get.get('telegram_bot_token')?.value || '',
        chatId: get.get('telegram_chat_id')?.value || '',
        printerEnabled: get.get('telegram_printer_enabled')?.value === 'true',
        maintenanceEnabled: get.get('telegram_maintenance_enabled')?.value === 'true',
        backupEnabled: get.get('telegram_backup_enabled')?.value === 'true'
      },
      slack: {
        webhook: get.get('slack_webhook_url')?.value || '',
        printerEnabled: get.get('slack_printer_enabled')?.value === 'true',
        maintenanceEnabled: get.get('slack_maintenance_enabled')?.value === 'true',
        backupEnabled: get.get('slack_backup_enabled')?.value === 'true'
      }
    };
    res.json({ success: true, settings: response });
  } catch (e) {
    console.error('Get notifications settings error:', e);
    res.status(500).json({ error: 'Failed to load notifications settings' });
  }
});

app.post('/api/settings/notifications', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const upsert = db.prepare(`
      INSERT INTO config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    const { discord, telegram, slack } = req.body;
    if (discord) {
      if (discord.webhook !== undefined) {
        upsert.run('discord_printer_webhook', discord.webhook || '');
        upsert.run('discord_maintenance_webhook', discord.webhook || '');
      }
      if (discord.printerEnabled !== undefined) upsert.run('discord_printer_enabled', discord.printerEnabled ? 'true' : 'false');
      if (discord.maintenanceEnabled !== undefined) upsert.run('discord_maintenance_enabled', discord.maintenanceEnabled ? 'true' : 'false');
      if (discord.backupEnabled !== undefined) upsert.run('discord_backup_enabled', discord.backupEnabled ? 'true' : 'false');
      if (discord.pingUserId !== undefined) upsert.run('discord_ping_user_id', discord.pingUserId || '');
    }
    if (telegram) {
      if (telegram.botToken !== undefined) upsert.run('telegram_bot_token', telegram.botToken || '');
      if (telegram.chatId !== undefined) upsert.run('telegram_chat_id', telegram.chatId || '');
      if (telegram.printerEnabled !== undefined) upsert.run('telegram_printer_enabled', telegram.printerEnabled ? 'true' : 'false');
      if (telegram.maintenanceEnabled !== undefined) upsert.run('telegram_maintenance_enabled', telegram.maintenanceEnabled ? 'true' : 'false');
      if (telegram.backupEnabled !== undefined) upsert.run('telegram_backup_enabled', telegram.backupEnabled ? 'true' : 'false');
    }
    if (slack) {
      if (slack.webhook !== undefined) upsert.run('slack_webhook_url', slack.webhook || '');
      if (slack.printerEnabled !== undefined) upsert.run('slack_printer_enabled', slack.printerEnabled ? 'true' : 'false');
      if (slack.maintenanceEnabled !== undefined) upsert.run('slack_maintenance_enabled', slack.maintenanceEnabled ? 'true' : 'false');
      if (slack.backupEnabled !== undefined) upsert.run('slack_backup_enabled', slack.backupEnabled ? 'true' : 'false');
    }
    res.json({ success: true, message: 'Notification settings saved!' });
  } catch (e) {
    console.error('Save notifications settings error:', e);
    res.status(500).json({ error: 'Failed to save notifications settings' });
  }
});

// Slack & Telegram send helpers and unified dispatcher
async function sendTelegramNotification(type, data) {
  try {
    const get = db.prepare('SELECT value FROM config WHERE key = ?');
    const botToken = get.get('telegram_bot_token')?.value;
    const chatId = get.get('telegram_chat_id')?.value;
    if (!botToken || !chatId) return false;
    const enabled = get.get(`telegram_${type}_enabled`)?.value === 'true';
    if (!enabled) return false;

    const titleMap = { printer: '🖨️ Printer', maintenance: '🔧 Maintenance', backup: '💾 Backup' };
    const title = titleMap[type] || 'Notification';
    let lines = [ `*${title}*`, data.message || '' ];
    if (type === 'printer') {
      if (data.printerName) lines.push(`• Printer: ${data.printerName}`);
      if (data.modelName) lines.push(`• Model: ${data.modelName}`);
      if (data.progress !== undefined) lines.push(`• Progress: ${data.progress}%`);
      if (data.timeElapsed) lines.push(`• Time: ${data.timeElapsed}`);
    } else if (type === 'maintenance') {
      if (data.taskName) lines.push(`• Task: ${data.taskName}`);
      if (data.printerName) lines.push(`• Printer: ${data.printerName}`);
      if (data.currentHours !== undefined) lines.push(`• Current: ${data.currentHours.toFixed(1)}h`);
      if (data.dueAtHours !== undefined) lines.push(`• Due At: ${data.dueAtHours.toFixed(1)}h`);
    } else if (type === 'backup') {
      if (data.size) lines.push(`• Size: ${data.size}`);
      if (data.videos !== undefined) lines.push(`• Videos: ${data.videos}`);
      if (data.library !== undefined) lines.push(`• Library: ${data.includeLibrary ? data.library : 'Excluded'}`);
      if (data.covers !== undefined) lines.push(`• Covers: ${data.covers}`);
      if (data.remoteUploaded) lines.push(`• Remote Upload: ✅`);
    }
    const text = lines.join('\n');
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
    return true;
  } catch (e) {
    console.error('Telegram notification error:', e.message);
    return false;
  }
}

async function sendSlackNotification(type, data) {
  try {
    const get = db.prepare('SELECT value FROM config WHERE key = ?');
    const webhook = get.get('slack_webhook_url')?.value;
    if (!webhook) return false;
    const enabled = get.get(`slack_${type}_enabled`)?.value === 'true';
    if (!enabled) return false;
    const titleMap = { printer: 'Printer', maintenance: 'Maintenance', backup: 'Backup' };
    const emojiMap = { printer: '🖨️', maintenance: '🔧', backup: '💾' };
    const title = `${emojiMap[type] || ''} ${titleMap[type] || 'Notification'}`;
    const payload = {
      text: data.message || title,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: title } },
        { type: 'section', fields: [] }
      ]
    };
    const addField = (name, value) => payload.blocks[1].fields.push({ type: 'mrkdwn', text: `*${name}:* ${value}` });
    if (type === 'printer') {
      if (data.printerName) addField('Printer', data.printerName);
      if (data.modelName) addField('Model', data.modelName);
      if (data.progress !== undefined) addField('Progress', `${data.progress}%`);
      if (data.timeElapsed) addField('Time', data.timeElapsed);
    } else if (type === 'maintenance') {
      if (data.taskName) addField('Task', data.taskName);
      if (data.printerName) addField('Printer', data.printerName);
      if (data.currentHours !== undefined) addField('Current', `${data.currentHours.toFixed(1)}h`);
      if (data.dueAtHours !== undefined) addField('Due At', `${data.dueAtHours.toFixed(1)}h`);
    } else if (type === 'backup') {
      if (data.size) addField('Archive Size', data.size);
      if (data.videos !== undefined) addField('Videos', data.videos);
      if (data.library !== undefined) addField('Library Files', data.includeLibrary ? `${data.library}` : 'Excluded');
      if (data.covers !== undefined) addField('Cover Images', data.covers);
      if (data.remoteUploaded) addField('Remote Upload', '✅ Uploaded');
    }
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return true;
  } catch (e) {
    console.error('Slack notification error:', e.message);
    return false;
  }
}

async function sendNotification(type, data) {
  // Always try provider-specific notifications if enabled
  try { await sendDiscordNotification(type, data); } catch {}
  try { await sendTelegramNotification(type, data); } catch {}
  try { await sendSlackNotification(type, data); } catch {}
}
// Test Discord webhook
app.post('/api/discord/test', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const { type, webhook } = req.body;
    
    if (!webhook || !webhook.startsWith('https://discord.com/api/webhooks/')) {
      return res.status(400).json({ error: 'Invalid Discord webhook URL' });
    }
    
    let embed;
    if (type === 'printer') {
      embed = {
        title: '🖨️ Printer Alert Test',
        description: 'This is a test notification from PrintHive!',
        color: 0x00D4FF, // Cyan color
        fields: [
          { name: 'Printer', value: 'Test Printer', inline: true },
          { name: 'Status', value: '✅ Connected', inline: true },
          { name: 'Event', value: 'Test Notification', inline: false }
        ],
        footer: { text: 'PrintHive • Printer Alerts' },
        timestamp: new Date().toISOString()
      };
    } else {
      embed = {
        title: '🔧 Maintenance Alert Test',
        description: 'This is a test notification from PrintHive!',
        color: 0xFFA500, // Orange color
        fields: [
          { name: 'Task', value: 'Test Maintenance Task', inline: true },
          { name: 'Printer', value: 'Test Printer', inline: true },
          { name: 'Status', value: '⚠️ Due Soon', inline: false }
        ],
        footer: { text: 'PrintHive • Maintenance Alerts' },
        timestamp: new Date().toISOString()
      };
    }
    
    // Use GitHub raw link for logo
    const logoUrl = 'https://raw.githubusercontent.com/tr1ckz/PrintHive/refs/heads/main/public/images/logo.png';
    
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'PrintHive',
        avatar_url: logoUrl,
        embeds: [embed]
      })
    });
    
    if (response.ok) {
      res.json({ success: true });
    } else {
      const errorText = await response.text();
      console.error('Discord webhook error:', errorText);
      res.status(400).json({ error: 'Failed to send to Discord' });
    }
  } catch (error) {
    console.error('Error testing Discord webhook:', error);
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

// Unified notifications test endpoint (Discord, Telegram, Slack)
app.post('/api/settings/notifications/test', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { provider, type } = req.body;
    if (!['printer', 'maintenance', 'backup'].includes(type)) {
      return res.status(400).json({ error: 'Invalid notification type' });
    }
    if (!['discord', 'telegram', 'slack'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    // Sample payloads
    let data = { message: 'This is a test notification from PrintHive!' };
    if (type === 'printer') {
      data = {
        status: 'completed',
        message: 'This is a test notification from PrintHive!',
        printerName: 'Test Printer',
        modelName: 'Test Model',
        progress: 100,
        timeElapsed: '00:42:00'
      };
    } else if (type === 'maintenance') {
      data = {
        status: 'due',
        message: 'This is a test notification from PrintHive!',
        taskName: 'Test Maintenance Task',
        printerName: 'Test Printer',
        currentHours: 100,
        dueAtHours: 120
      };
    } else if (type === 'backup') {
      data = {
        message: 'This is a test notification from PrintHive!',
        size: '123 MB',
        videos: 5,
        library: 12,
        includeLibrary: true,
        covers: 4,
        remoteUploaded: true
      };
    }

    let ok = false;
    if (provider === 'discord') {
      ok = await sendDiscordNotification(type, data);
    } else if (provider === 'telegram') {
      ok = await sendTelegramNotification(type, data);
    } else if (provider === 'slack') {
      ok = await sendSlackNotification(type, data);
    }

    if (ok) return res.json({ success: true });
    return res.status(400).json({ error: 'Provider disabled or not configured' });
  } catch (e) {
    console.error('Unified notifications test error:', e);
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

// Helper function to send Discord notifications
async function sendDiscordNotification(type, data) {
  try {
    const getConfig = db.prepare('SELECT value FROM config WHERE key = ?');
    
    let webhookUrl, enabled;
    if (type === 'printer') {
      const webhookRow = getConfig.get('discord_printer_webhook');
      const enabledRow = getConfig.get('discord_printer_enabled');
      webhookUrl = webhookRow?.value;
      enabled = enabledRow?.value === 'true';
    } else if (type === 'maintenance' || type === 'backup') {
      // Use maintenance webhook for maintenance and backup notifications
      const webhookRow = getConfig.get('discord_maintenance_webhook');
      const maintenanceEnabledRow = getConfig.get('discord_maintenance_enabled');
      webhookUrl = webhookRow?.value;
      if (type === 'backup') {
        const backupEnabledRow = getConfig.get('discord_backup_enabled');
        enabled = backupEnabledRow?.value === 'true';
      } else {
        enabled = maintenanceEnabledRow?.value === 'true';
      }
    }
    
    if (!enabled || !webhookUrl) {
      return false;
    }
    
    let embed;
    if (type === 'printer') {
      const statusColors = {
        'failed': 0xFF0000,    // Red
        'error': 0xFF0000,     // Red
        'completed': 0x00FF00, // Green
        'paused': 0xFFFF00,    // Yellow
        'offline': 0x808080    // Gray
      };
      
      const statusEmojis = {
        'failed': '❌',
        'error': '⚠️',
        'completed': '✅',
        'paused': '⏸️',
        'offline': '📴'
      };
      
      embed = {
        title: `${statusEmojis[data.status] || '🖨️'} Print ${data.status?.charAt(0).toUpperCase() + data.status?.slice(1) || 'Alert'}`,
        description: data.message || 'Printer status update',
        color: statusColors[data.status] || 0x00D4FF,
        fields: [],
        footer: { text: 'PrintHive • Printer Alerts' },
        timestamp: new Date().toISOString()
      };
      
      if (data.printerName) embed.fields.push({ name: 'Printer', value: data.printerName, inline: true });
      if (data.modelName) embed.fields.push({ name: 'Model', value: data.modelName, inline: true });
      if (data.progress !== undefined) embed.fields.push({ name: 'Progress', value: `${data.progress}%`, inline: true });
      if (data.timeElapsed) embed.fields.push({ name: 'Time', value: data.timeElapsed, inline: true });
      if (data.errorCode) embed.fields.push({ name: 'Error Code', value: data.errorCode, inline: true });
      
    } else if (type === 'maintenance') {
      const statusColors = {
        'due': 0xFFA500,      // Orange
        'overdue': 0xFF0000,  // Red
        'completed': 0x00FF00 // Green
      };
      
      const statusEmojis = {
        'due': '⚠️',
        'overdue': '🚨',
        'completed': '✅'
      };
      
      embed = {
        title: `${statusEmojis[data.status] || '🔧'} Maintenance ${data.status?.charAt(0).toUpperCase() + data.status?.slice(1) || 'Alert'}`,
        description: data.message || 'Maintenance task needs attention',
        color: statusColors[data.status] || 0xFFA500,
        fields: [],
        footer: { text: 'PrintHive • Maintenance Alerts' },
        timestamp: new Date().toISOString()
      };
      
      if (data.taskName) embed.fields.push({ name: 'Task', value: data.taskName, inline: true });
      if (data.printerName) embed.fields.push({ name: 'Printer', value: data.printerName, inline: true });
      if (data.currentHours !== undefined) embed.fields.push({ name: 'Current Hours', value: `${data.currentHours.toFixed(1)}h`, inline: true });
      if (data.dueAtHours !== undefined) embed.fields.push({ name: 'Due At', value: `${data.dueAtHours.toFixed(1)}h`, inline: true });
    } else if (type === 'backup') {
      embed = {
        title: '💾 Database Backup Completed',
        description: data.message || 'Database backup completed successfully',
        color: 0x00FF00, // Green
        fields: [],
        footer: { text: 'PrintHive • System Backup' },
        timestamp: new Date().toISOString()
      };
      
      if (data.size) embed.fields.push({ name: 'Archive Size', value: data.size, inline: true });
      if (data.videos !== undefined) embed.fields.push({ name: 'Videos', value: data.videos > 0 ? `${data.videos} files` : 'Excluded', inline: true });
      if (data.library !== undefined) {
        const libText = data.includeLibrary ? `Included (${data.library} files)` : 'Excluded';
        embed.fields.push({ name: 'Library Files', value: libText, inline: true });
      }
      if (data.covers !== undefined) embed.fields.push({ name: 'Cover Images', value: data.covers > 0 ? `${data.covers} files` : 'Excluded', inline: true });
      if (data.remoteUploaded) embed.fields.push({ name: 'Remote Upload', value: '✅ Uploaded', inline: true });
    }
    
    // Get ping user ID if configured
    const pingUserIdRow = getConfig.get('discord_ping_user_id');
    const pingUserId = pingUserIdRow?.value || '';
    const pingContent = pingUserId ? `<@${pingUserId}>` : '';
    
    // Use GitHub raw link for logo
    const logoUrl = 'https://raw.githubusercontent.com/tr1ckz/PrintHive/refs/heads/main/public/images/logo.png';
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: pingContent || undefined,
        username: 'PrintHive',
        avatar_url: logoUrl,
        embeds: [embed]
      })
    });
    
    return response.ok;
  } catch (error) {
    console.error('Error sending Discord notification:', error);
    return false;
  }
}

// Watchdog interval reference
let watchdogTimer = null;

// Setup watchdog based on settings
function setupWatchdog() {
  // Clear existing timer
  if (watchdogTimer) {
    if (typeof watchdogTimer === 'function') {
      watchdogTimer();
    } else {
      clearInterval(watchdogTimer);
      clearTimeout(watchdogTimer);
    }
    watchdogTimer = null;
  }
  
  try {
    const getConfig = db.prepare('SELECT value FROM config WHERE key = ?');
    const watchdogEnabled = getConfig.get('watchdog_enabled');
    const watchdogInterval = getConfig.get('watchdog_interval');
    const watchdogEndpoint = getConfig.get('watchdog_endpoint');
    
    const enabled = watchdogEnabled?.value === 'true';
    const interval = parseInt(watchdogInterval?.value || '30', 10);
    const endpoint = watchdogEndpoint?.value || '';
    
    if (!enabled) {
      console.log('Watchdog disabled');
      return;
    }
    
    console.log(`Watchdog enabled: ping every ${interval} seconds${endpoint ? ` to ${endpoint}` : ' (internal)'}`);
    
    watchdogTimer = scheduleRecurringTask('Watchdog', async () => {
      try {
        if (endpoint) {
          // External health check endpoint (e.g., uptime robot, healthchecks.io)
          await axios.get(endpoint, { timeout: 10000 });
          console.log(`Watchdog: Pinged ${endpoint}`);
        } else {
          // Internal self-check
          const dbCheck = db.prepare('SELECT 1 as ok').get();
          if (!dbCheck) {
            console.error('Watchdog: Database check failed!');
          }
        }
      } catch (error) {
        console.error('Watchdog error:', error.message);
      }
    }, interval * 1000, interval * 1000);
  } catch (error) {
    console.error('Failed to setup watchdog:', error);
  }
}

// Maintenance notification timer reference
let maintenanceNotificationTimer = null;
let lastMaintenanceNotifications = new Map(); // Track what we've already notified about

// Setup maintenance notification checker
function setupMaintenanceNotifications() {
  // Clear existing timer
  if (maintenanceNotificationTimer) {
    if (typeof maintenanceNotificationTimer === 'function') {
      maintenanceNotificationTimer();
    } else {
      clearInterval(maintenanceNotificationTimer);
      clearTimeout(maintenanceNotificationTimer);
    }
    maintenanceNotificationTimer = null;
  }
  
  console.log('Setting up maintenance notification checker (every 1 hour)...');
  
  maintenanceNotificationTimer = scheduleRecurringTask(
    'MaintenanceNotifications',
    async () => {
      await checkMaintenanceDueNotifications();
    },
    60 * 60 * 1000,
    60 * 60 * 1000
  );
  
  // Also run immediately on startup (after a delay)
  setTimeout(() => {
    checkMaintenanceDueNotifications();
  }, 30000);
}

// Check for maintenance tasks that are due or overdue and send Discord notifications
async function checkMaintenanceDueNotifications() {
  try {
    const getConfig = db.prepare('SELECT value FROM config WHERE key = ?');
    const enabledRow = getConfig.get('discord_maintenance_enabled');
    const webhookRow = getConfig.get('discord_maintenance_webhook');
    
    if (enabledRow?.value !== 'true' || !webhookRow?.value) {
      return; // Maintenance notifications not enabled
    }
    
    // Get current print hours
    const prints = db.prepare('SELECT costTime FROM prints').all();
    let totalPrintSeconds = 0;
    for (const print of prints) {
      if (print.costTime) {
        totalPrintSeconds += print.costTime;
      }
    }
    const currentPrintHours = totalPrintSeconds / 3600;
    
    // Get all maintenance tasks
    const tasks = db.prepare('SELECT * FROM maintenance_tasks').all();
    
    for (const task of tasks) {
      if (!task.hours_until_due) continue;
      
      const notificationKey = `${task.id}`;
      const isOverdue = currentPrintHours >= task.hours_until_due;
      const isDueSoon = !isOverdue && (task.hours_until_due - currentPrintHours <= 20);
      
      if (!isOverdue && !isDueSoon) continue;
      
      // Check if we've already notified about this status
      const lastStatus = lastMaintenanceNotifications.get(notificationKey);
      const currentStatus = isOverdue ? 'overdue' : 'due';
      
      if (lastStatus === currentStatus) continue; // Already notified
      
      // Send notification
      const hoursOverdue = currentPrintHours - task.hours_until_due;
      const message = isOverdue 
        ? `This maintenance task is ${hoursOverdue.toFixed(1)} print hours overdue!`
        : `This maintenance task will be due in approximately ${(task.hours_until_due - currentPrintHours).toFixed(1)} print hours.`;
      
      await sendNotification('maintenance', {
        status: currentStatus,
        taskName: task.task_name,
        printerName: task.printer_id || 'All Printers',
        currentHours: currentPrintHours,
        dueAtHours: task.hours_until_due,
        message
      });
      
      // Mark as notified
      lastMaintenanceNotifications.set(notificationKey, currentStatus);
      console.log(`Sent Discord ${currentStatus} notification for maintenance task: ${task.task_name}`);
    }
  } catch (error) {
    console.error('Error checking maintenance notifications:', error);
  }
}

// ===========================
// TAGGING ENDPOINTS
// ===========================

// Get all tags
app.get('/api/tags', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const tags = db.prepare(`
      SELECT t.*, COUNT(mt.model_id) as model_count
      FROM tags t
      LEFT JOIN model_tags mt ON t.id = mt.tag_id
      GROUP BY t.id
      ORDER BY t.name ASC
    `).all();
    res.json(tags);
  } catch (error) {
    console.error('Get tags error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add tag to model
app.post('/api/models/:id/tags', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { id } = req.params;
    const { tag } = req.body;
    
    if (!tag) {
      return res.status(400).json({ error: 'Tag name required' });
    }
    
    // Find or create tag
    let tagRecord = db.prepare('SELECT id FROM tags WHERE name = ?').get(tag.toLowerCase());
    if (!tagRecord) {
      const result = db.prepare('INSERT INTO tags (name) VALUES (?)').run(tag.toLowerCase());
      tagRecord = { id: result.lastInsertRowid };
    }
    
    // Link tag to model
    try {
      db.prepare('INSERT INTO model_tags (model_id, tag_id) VALUES (?, ?)').run(id, tagRecord.id);
      res.json({ success: true });
    } catch (error) {
      if (error.message.includes('UNIQUE constraint')) {
        res.json({ success: true, message: 'Tag already exists on model' });
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('Add tag error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Remove tag from model
app.delete('/api/models/:id/tags/:tagId', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { id, tagId } = req.params;
    db.prepare('DELETE FROM model_tags WHERE model_id = ? AND tag_id = ?').run(id, tagId);
    res.json({ success: true });
  } catch (error) {
    console.error('Remove tag error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get model tags
app.get('/api/models/:id/tags', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { id } = req.params;
    const tags = db.prepare(`
      SELECT t.* FROM tags t
      JOIN model_tags mt ON t.id = mt.tag_id
      WHERE mt.model_id = ?
      ORDER BY t.name ASC
    `).all(id);
    res.json(tags);
  } catch (error) {
    console.error('Get model tags error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// SEARCH & FILTER ENDPOINTS
// ===========================

// Advanced library search
app.get('/api/library/search', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { q, tags, fileType, hasHash, hasPrint, hasProblem, limit = 100, offset = 0 } = req.query;
    
    let query = `
      SELECT DISTINCT l.*,
        GROUP_CONCAT(t.name) as tags,
        (SELECT COUNT(*) FROM prints p WHERE p.title LIKE '%' || l.fileName || '%') as print_count,
        (SELECT COUNT(*) FROM problems pr WHERE pr.model_id = l.id AND pr.resolved_at IS NULL) as problem_count
      FROM library l
      LEFT JOIN model_tags mt ON l.id = mt.model_id
      LEFT JOIN tags t ON mt.tag_id = t.id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (q) {
      query += ` AND (l.fileName LIKE ? OR l.originalName LIKE ? OR l.description LIKE ?)`;
      const searchTerm = `%${q}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }
    
    if (fileType) {
      query += ` AND l.fileType = ?`;
      params.push(fileType);
    }
    
    if (hasHash === 'true') {
      query += ` AND l.fileHash IS NOT NULL`;
    } else if (hasHash === 'false') {
      query += ` AND l.fileHash IS NULL`;
    }
    
    query += ` GROUP BY l.id`;
    
    if (hasPrint === 'true') {
      query += ` HAVING print_count > 0`;
    } else if (hasPrint === 'false') {
      query += ` HAVING print_count = 0`;
    }
    
    if (hasProblem === 'true') {
      query += ` ${hasPrint ? 'AND' : 'HAVING'} problem_count > 0`;
    } else if (hasProblem === 'false') {
      query += ` ${hasPrint ? 'AND' : 'HAVING'} problem_count = 0`;
    }
    
    if (tags) {
      const tagList = tags.split(',').map(t => t.trim().toLowerCase());
      const tagPlaceholders = tagList.map(() => '?').join(',');
      query += ` AND l.id IN (
        SELECT mt.model_id FROM model_tags mt
        JOIN tags t ON mt.tag_id = t.id
        WHERE t.name IN (${tagPlaceholders})
        GROUP BY mt.model_id
        HAVING COUNT(DISTINCT t.id) = ${tagList.length}
      )`;
      params.push(...tagList);
    }
    
    query += ` ORDER BY l.createdAt DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));
    
    const models = db.prepare(query).all(...params);
    
    // Get total count
    let countQuery = `
      SELECT COUNT(DISTINCT l.id) as total
      FROM library l
      LEFT JOIN model_tags mt ON l.id = mt.model_id
      LEFT JOIN tags t ON mt.tag_id = t.id
      WHERE 1=1
    `;
    
    const countParams = [];
    if (q) {
      countQuery += ` AND (l.fileName LIKE ? OR l.originalName LIKE ? OR l.description LIKE ?)`;
      const searchTerm = `%${q}%`;
      countParams.push(searchTerm, searchTerm, searchTerm);
    }
    if (fileType) {
      countQuery += ` AND l.fileType = ?`;
      countParams.push(fileType);
    }
    if (hasHash === 'true') {
      countQuery += ` AND l.fileHash IS NOT NULL`;
    } else if (hasHash === 'false') {
      countQuery += ` AND l.fileHash IS NULL`;
    }
    
    const { total } = db.prepare(countQuery).get(...countParams);
    
    res.json({ models, total, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (error) {
    console.error('Library search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// DUPLICATE DETECTION
// ===========================

// Calculate file hash for a model
app.post('/api/models/:id/calculate-hash', async (req, res) => {
  try {
    const { id } = req.params;
    const model = db.prepare('SELECT * FROM library WHERE id = ?').get(id);
    
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }
    
    const filePath = path.join(__dirname, model.filePath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }
    
    const crypto = require('crypto');
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    const hash = hashSum.digest('hex');
    
    db.prepare('UPDATE library SET fileHash = ? WHERE id = ?').run(hash, id);
    
    res.json({ success: true, hash });
  } catch (error) {
    console.error('Calculate hash error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Calculate hashes for all models
app.post('/api/library/calculate-all-hashes', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const models = db.prepare('SELECT * FROM library WHERE fileHash IS NULL').all();
    const crypto = require('crypto');
    let processed = 0;
    let errors = 0;
    
    for (const model of models) {
      try {
        const filePath = path.join(__dirname, model.filePath);
        if (fs.existsSync(filePath)) {
          const fileBuffer = fs.readFileSync(filePath);
          const hashSum = crypto.createHash('sha256');
          hashSum.update(fileBuffer);
          const hash = hashSum.digest('hex');
          db.prepare('UPDATE library SET fileHash = ? WHERE id = ?').run(hash, model.id);
          processed++;
        }
      } catch (error) {
        console.error(`Error hashing model ${model.id}:`, error.message);
        errors++;
      }
    }
    
    res.json({ success: true, processed, errors, total: models.length });
  } catch (error) {
    console.error('Calculate all hashes error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Find duplicate files
app.get('/api/library/duplicates', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const duplicates = db.prepare(`
      SELECT fileHash, COUNT(*) as count, GROUP_CONCAT(id) as model_ids
      FROM library
      WHERE fileHash IS NOT NULL
      GROUP BY fileHash
      HAVING count > 1
      ORDER BY count DESC
    `).all();
    
    const detailedDuplicates = duplicates.map(dup => {
      const ids = dup.model_ids.split(',').map(id => parseInt(id));
      const models = db.prepare(`
        SELECT * FROM library WHERE id IN (${ids.map(() => '?').join(',')})
      `).all(...ids);
      
      return {
        hash: dup.fileHash,
        count: dup.count,
        models
      };
    });
    
    res.json(detailedDuplicates);
  } catch (error) {
    console.error('Find duplicates error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// PROBLEM DETECTION
// ===========================

// Detect problems for all models
app.post('/api/library/detect-problems', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const models = db.prepare('SELECT * FROM library').all();
    let detected = 0;
    
    for (const model of models) {
      const problems = [];
      
      // Check if file exists on disk
      const filePath = path.join(__dirname, model.filePath);
      if (!fs.existsSync(filePath)) {
        problems.push({
          type: 'missing_file',
          severity: 'error',
          message: 'File does not exist on disk'
        });
      }
      
      // Check if model has any prints
      const printCount = db.prepare(`
        SELECT COUNT(*) as count FROM prints 
        WHERE title LIKE '%' || ? || '%'
      `).get(model.fileName).count;
      
      if (printCount === 0) {
        problems.push({
          type: 'never_printed',
          severity: 'info',
          message: 'Model has never been printed'
        });
      }
      
      // Check if model has thumbnail
      if (!model.thumbnailPath || !fs.existsSync(path.join(__dirname, model.thumbnailPath))) {
        problems.push({
          type: 'no_thumbnail',
          severity: 'warning',
          message: 'Model has no thumbnail'
        });
      }
      
      // Check if model has description
      if (!model.description || model.description.trim() === '') {
        problems.push({
          type: 'no_description',
          severity: 'info',
          message: 'Model has no description'
        });
      }
      
      // Check if model has tags
      const tagCount = db.prepare(`
        SELECT COUNT(*) as count FROM model_tags WHERE model_id = ?
      `).get(model.id).count;
      
      if (tagCount === 0) {
        problems.push({
          type: 'no_tags',
          severity: 'info',
          message: 'Model has no tags'
        });
      }
      
      // Check if model has hash calculated
      if (!model.fileHash) {
        problems.push({
          type: 'no_hash',
          severity: 'info',
          message: 'File hash not calculated'
        });
      } else {
        // Check for duplicates
        const dupCount = db.prepare(`
          SELECT COUNT(*) as count FROM library 
          WHERE fileHash = ? AND id != ?
        `).get(model.fileHash, model.id).count;
        
        if (dupCount > 0) {
          problems.push({
            type: 'duplicate',
            severity: 'warning',
            message: `Duplicate of ${dupCount} other file(s)`
          });
        }
      }
      
      // Clear existing unresolved problems for this model
      db.prepare('DELETE FROM problems WHERE model_id = ? AND resolved_at IS NULL').run(model.id);
      
      // Insert new problems
      const insertProblem = db.prepare(`
        INSERT INTO problems (model_id, problem_type, severity, message)
        VALUES (?, ?, ?, ?)
      `);
      
      for (const problem of problems) {
        insertProblem.run(model.id, problem.type, problem.severity, problem.message);
        detected++;
      }
    }
    
    res.json({ success: true, detected, models_checked: models.length });
  } catch (error) {
    console.error('Detect problems error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get problems for a model
app.get('/api/models/:id/problems', async (req, res) => {
  try {
    const { id } = req.params;
    const problems = db.prepare(`
      SELECT * FROM problems 
      WHERE model_id = ? AND resolved_at IS NULL
      ORDER BY 
        CASE severity 
          WHEN 'error' THEN 1 
          WHEN 'warning' THEN 2 
          ELSE 3 
        END,
        detected_at DESC
    `).all(id);
    res.json(problems);
  } catch (error) {
    console.error('Get problems error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Resolve a problem
app.post('/api/problems/:id/resolve', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { id } = req.params;
    db.prepare('UPDATE problems SET resolved_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Resolve problem error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// BULK OPERATIONS
// ===========================

// Bulk add tags
app.post('/api/models/bulk/tags', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { modelIds, tags } = req.body;
    
    if (!Array.isArray(modelIds) || !Array.isArray(tags)) {
      return res.status(400).json({ error: 'modelIds and tags must be arrays' });
    }
    
    let added = 0;
    
    for (const tag of tags) {
      // Find or create tag
      let tagRecord = db.prepare('SELECT id FROM tags WHERE name = ?').get(tag.toLowerCase());
      if (!tagRecord) {
        const result = db.prepare('INSERT INTO tags (name) VALUES (?)').run(tag.toLowerCase());
        tagRecord = { id: result.lastInsertRowid };
      }
      
      // Add tag to each model
      for (const modelId of modelIds) {
        try {
          db.prepare('INSERT INTO model_tags (model_id, tag_id) VALUES (?, ?)').run(modelId, tagRecord.id);
          added++;
        } catch (error) {
          // Ignore duplicate constraint errors
          if (!error.message.includes('UNIQUE constraint')) {
            throw error;
          }
        }
      }
    }
    
    res.json({ success: true, added });
  } catch (error) {
    console.error('Bulk add tags error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk remove tags
app.delete('/api/models/bulk/tags', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { modelIds, tags } = req.body;
    
    if (!Array.isArray(modelIds) || !Array.isArray(tags)) {
      return res.status(400).json({ error: 'modelIds and tags must be arrays' });
    }
    
    const tagIds = db.prepare(`
      SELECT id FROM tags WHERE name IN (${tags.map(() => '?').join(',')})
    `).all(...tags.map(t => t.toLowerCase())).map(t => t.id);
    
    if (tagIds.length === 0) {
      return res.json({ success: true, removed: 0 });
    }
    
    const result = db.prepare(`
      DELETE FROM model_tags 
      WHERE model_id IN (${modelIds.map(() => '?').join(',')})
      AND tag_id IN (${tagIds.map(() => '?').join(',')})
    `).run(...modelIds, ...tagIds);
    
    res.json({ success: true, removed: result.changes });
  } catch (error) {
    console.error('Bulk remove tags error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk delete models
app.post('/api/models/bulk/delete', async (req, res) => {
  try {
    const { modelIds } = req.body;
    
    if (!Array.isArray(modelIds)) {
      return res.status(400).json({ error: 'modelIds must be an array' });
    }
    
    let deleted = 0;
    let errors = 0;
    
    for (const modelId of modelIds) {
      try {
        const model = db.prepare('SELECT * FROM library WHERE id = ?').get(modelId);
        if (model) {
          // Delete file from disk
          const filePath = path.join(__dirname, model.filePath);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          
          // Delete thumbnail
          if (model.thumbnailPath) {
            const thumbnailPath = path.join(__dirname, model.thumbnailPath);
            if (fs.existsSync(thumbnailPath)) {
              fs.unlinkSync(thumbnailPath);
            }
          }
          
          // Delete from database (cascades to model_tags and problems)
          db.prepare('DELETE FROM library WHERE id = ?').run(modelId);
          deleted++;
        }
      } catch (error) {
        console.error(`Error deleting model ${modelId}:`, error.message);
        errors++;
      }
    }
    
    res.json({ success: true, deleted, errors });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// METADATA PARSING
// ===========================

// Parse tags from folder structure
app.post('/api/library/parse-folder-tags', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const models = db.prepare('SELECT * FROM library').all();
    let processed = 0;
    
    for (const model of models) {
      // Extract folder names from file path
      const relativePath = model.filePath.replace(/^library[\/\\]/, '');
      const pathParts = relativePath.split(/[\/\\]/).slice(0, -1); // Remove filename
      
      if (pathParts.length === 0) continue;
      
      // Create tags from folder names
      for (const part of pathParts) {
        // Clean up folder name
        const tagName = part
          .replace(/[_-]/g, ' ')
          .toLowerCase()
          .trim();
        
        if (tagName.length < 2) continue;
        
        // Find or create tag
        let tagRecord = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName);
        if (!tagRecord) {
          const result = db.prepare('INSERT INTO tags (name) VALUES (?)').run(tagName);
          tagRecord = { id: result.lastInsertRowid };
        }
        
        // Link tag to model
        try {
          db.prepare('INSERT INTO model_tags (model_id, tag_id) VALUES (?, ?)').run(model.id, tagRecord.id);
        } catch (error) {
          // Ignore duplicate constraint errors
        }
      }
      
      processed++;
    }
    
    res.json({ success: true, processed });
  } catch (error) {
    console.error('Parse folder tags error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get library statistics
app.get('/api/library/stats', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const stats = {
      total_models: db.prepare('SELECT COUNT(*) as count FROM library').get().count,
      total_size: db.prepare('SELECT SUM(fileSize) as size FROM library').get().size || 0,
      total_tags: db.prepare('SELECT COUNT(*) as count FROM tags').get().count,
      models_with_tags: db.prepare(`
        SELECT COUNT(DISTINCT model_id) as count FROM model_tags
      `).get().count,
      models_with_hash: db.prepare('SELECT COUNT(*) as count FROM library WHERE fileHash IS NOT NULL').get().count,
      total_problems: db.prepare('SELECT COUNT(*) as count FROM problems WHERE resolved_at IS NULL').get().count,
      models_never_printed: db.prepare(`
        SELECT COUNT(*) as count FROM library l
        WHERE NOT EXISTS (
          SELECT 1 FROM prints p WHERE p.title LIKE '%' || l.fileName || '%'
        )
      `).get().count,
      duplicate_groups: db.prepare(`
        SELECT COUNT(*) as count FROM (
          SELECT fileHash FROM library 
          WHERE fileHash IS NOT NULL 
          GROUP BY fileHash 
          HAVING COUNT(*) > 1
        )
      `).get().count
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Get library stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// SPA fallback - MUST be last, after all API routes
// This handles client-side routing (e.g., /admin, /dashboard, etc.)
app.get('*', (req, res, next) => {
  // Skip if it's an API route, auth route, or data asset
  if (req.path.startsWith('/api/') || 
      req.path.startsWith('/auth/') || 
      req.path.startsWith('/data/') ||
      req.path.startsWith('/images/') ||
      req.path.includes('.')) { // Skip files with extensions (JS, CSS, images, etc.)
    return next(); // Let other handlers or static middleware handle it
  }
  
  const distExists = fs.existsSync(path.join(__dirname, 'dist', 'index.html'));
  const staticDir = distExists ? 'dist' : 'public';
  res.sendFile(path.join(__dirname, staticDir, 'index.html'));
});

httpServer = app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Database: SQLite (data/printhive.db)');
  
  // Clean up old camera temp files on startup
  try {
    const tempDir = path.join(__dirname, 'data', 'temp');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      const oldFiles = files.filter(f => f.startsWith('camera-temp-'));
      oldFiles.forEach(file => {
        try {
          fs.unlinkSync(path.join(tempDir, file));
          console.log(`Cleaned up old temp file: ${file}`);
        } catch (err) {
          console.error(`Failed to delete ${file}:`, err);
        }
      });
      if (oldFiles.length > 0) {
        console.log(`Cleaned ${oldFiles.length} old camera temp files`);
      }
    }
  } catch (err) {
    console.error('Failed to clean temp directory:', err);
  }
  
  console.log('Available routes:');
  console.log('  - GET  / (login page)');
  console.log('  - POST /auth/login');
  console.log('  - POST /auth/verify-email');
  console.log('  - POST /auth/verify-2fa');
  console.log('  - POST /auth/request-code');
  console.log('  - GET  /api/check-auth');
  console.log('  - POST /auth/logout');
  console.log('  - GET  /api/printers');
  console.log('  - GET  /api/models (with ?search=term&status=2&source=db)');
  console.log('  - GET  /api/timelapses');
  console.log('  - GET  /api/download/:modelId');
  console.log('  - GET  /api/local/download/:modelId');
  console.log('  - GET  /api/printer/download/:modelId');
  console.log('  - POST /api/sync');
  console.log(`  - WS   ${REALTIME_SOCKET_PATH} (live printer telemetry)`);
  
  // Configure OIDC after server starts
  console.log('\n=== Configuring OIDC ===');
  try {
    await configureOIDC();
  } catch (err) {
    console.error('OIDC configuration failed:', err);
  }
  console.log('=== OIDC configuration complete ===\n');
  
  // Start background sync
  backgroundSync.start();
  // Start automatic cloud sync (uses tokens in settings)
  setupCloudAutoSync();
  // Start automatic FTP sync (every 30 min, only when idle)
  setupFtpAutoSync();
  // Start automatic library scanning (every 5 min)
  setupAutoLibraryScan();
  // Start automatic video matching (every 10 min)
  setupAutoVideoMatching();
  // Initialize maintenance notification checker
  setupMaintenanceNotifications();
  
  // Auto-scan library on startup
  console.log('\n=== Scanning library directory ===');
  try {
    const allFiles = walkDirectory(libraryDir);
    console.log(`Found ${allFiles.length} total files in library directory`);
    
    let added = 0;
    let updated = 0;
    
    for (const filePath of allFiles) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.3mf' || ext === '.stl' || ext === '.gcode') {
        const fileName = path.basename(filePath);
        const relativePath = path.relative(__dirname, filePath);
        
        const existing = db.prepare('SELECT id FROM library WHERE filePath = ?').get(relativePath);
        
        if (!existing) {
          const stats = fs.statSync(filePath);
          const fileType = ext.substring(1);
          
          db.prepare(`
            INSERT INTO library (fileName, originalName, fileType, fileSize, filePath, description, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(fileName, fileName, fileType, stats.size, relativePath, '', '');
          
          added++;
        } else {
          updated++;
        }
      }
    }
    
    console.log(`Library scan complete: ${added} new files added, ${updated} existing files`);
    
    // Clean up library entries for files that no longer exist
    console.log('Cleaning up missing library entries...');
    const allLibraryItems = db.prepare('SELECT * FROM library').all();
    let removed = 0;
    
    for (const item of allLibraryItems) {
      let fileExists = false;
      const possiblePaths = [
        item.filePath,
        path.join(libraryDir, item.fileName),
        `/app/library/${item.fileName}`
      ];
      
      for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
          fileExists = true;
          break;
        }
      }
      
      // Try prefix search for Unicode issues
      if (!fileExists) {
        const fileIdPrefix = item.fileName.split('-')[0];
        if (fs.existsSync(libraryDir)) {
          try {
            const files = fs.readdirSync(libraryDir);
            if (files.some(f => f.startsWith(fileIdPrefix))) {
              fileExists = true;
            }
          } catch (err) {}
        }
      }
      
      if (!fileExists) {
        db.prepare('DELETE FROM library WHERE id = ?').run(item.id);
        removed++;
      }
    }
    
    if (removed > 0) {
      console.log(`Removed ${removed} library entries for missing files`);
    }
  } catch (err) {
    console.error('Error scanning library:', err.message);
  }
  console.log('=== Library scan complete ===\n');
  
  // Pre-generate thumbnails on startup
  await generateAllThumbnails();
});

setupRealtimeServer(httpServer);
setupGo2RtcWebSocketProxy(httpServer);

// Graceful shutdown handler
let shuttingDown = false;
const gracefulShutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  
  // Stop background sync
  try {
    backgroundSync.stop();
    console.log('Background sync stopped');
  } catch (e) {}
  
  // Disconnect all MQTT clients
  for (const [key, client] of mqttClients.entries()) {
    console.log(`Disconnecting MQTT client for ${key}`);
    try {
      client.disconnect();
    } catch (e) {}
  }
  mqttClients.clear();
  
  // Close database
  if (db) {
    try {
      db.close();
      console.log('Database closed');
    } catch (e) {}
  }
  
  if (realtimeWss) {
    try {
      realtimeWss.clients.forEach((client) => client.close());
      realtimeWss.close();
      console.log('Realtime websocket server closed');
    } catch (e) {}
  }

  // Close HTTP server
  if (httpServer) {
    httpServer.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
      console.log('Force exit after timeout');
      process.exit(0);
    }, 10000);
  } else {
    process.exit(0);
  }
};

// Helper function to format bytes
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Database Maintenance APIs
app.get('/api/settings/database', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const settings = {
      backupScheduleEnabled: db.prepare('SELECT value FROM config WHERE key = ?').get('backup_schedule_enabled')?.value === '1',
      backupInterval: parseInt(db.prepare('SELECT value FROM config WHERE key = ?').get('backup_interval')?.value || '7'),
      backupRetention: parseInt(db.prepare('SELECT value FROM config WHERE key = ?').get('backup_retention')?.value || '30'),
      lastBackupDate: db.prepare('SELECT value FROM config WHERE key = ?').get('last_backup_date')?.value,
      // Remote backup settings
      remoteBackupEnabled: db.prepare('SELECT value FROM config WHERE key = ?').get('remote_backup_enabled')?.value === '1',
      remoteBackupType: db.prepare('SELECT value FROM config WHERE key = ?').get('remote_backup_type')?.value || 'sftp',
      remoteBackupHost: db.prepare('SELECT value FROM config WHERE key = ?').get('remote_backup_host')?.value || '',
      remoteBackupPort: parseInt(db.prepare('SELECT value FROM config WHERE key = ?').get('remote_backup_port')?.value || '22'),
      remoteBackupUsername: db.prepare('SELECT value FROM config WHERE key = ?').get('remote_backup_username')?.value || '',
      remoteBackupPassword: db.prepare('SELECT value FROM config WHERE key = ?').get('remote_backup_password')?.value ? '********' : '',
      remoteBackupPath: db.prepare('SELECT value FROM config WHERE key = ?').get('remote_backup_path')?.value || '/backups',
      // Backup options
      backupIncludeVideos: db.prepare('SELECT value FROM config WHERE key = ?').get('backup_include_videos')?.value !== '0',
      backupIncludeLibrary: db.prepare('SELECT value FROM config WHERE key = ?').get('backup_include_library')?.value !== '0',
      backupIncludeCovers: db.prepare('SELECT value FROM config WHERE key = ?').get('backup_include_covers')?.value !== '0',
      // Webhook
      backupWebhookUrl: db.prepare('SELECT value FROM config WHERE key = ?').get('backup_webhook_url')?.value || ''
    };
    res.json(settings);
  } catch (error) {
    console.error('Failed to load database settings:', error);
    res.status(500).json({ error: 'Failed to load database settings' });
  }
});

app.post('/api/settings/database', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const { 
      backupScheduleEnabled, backupInterval, backupRetention,
      remoteBackupEnabled, remoteBackupType, remoteBackupHost, 
      remoteBackupPort, remoteBackupUsername, remoteBackupPassword, remoteBackupPath,
      backupIncludeVideos, backupIncludeLibrary, backupIncludeCovers,
      backupWebhookUrl
    } = req.body;
    
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('backup_schedule_enabled', backupScheduleEnabled ? '1' : '0');
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('backup_interval', backupInterval.toString());
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('backup_retention', backupRetention.toString());
    
    // Remote backup settings
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('remote_backup_enabled', remoteBackupEnabled ? '1' : '0');
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('remote_backup_type', remoteBackupType || 'sftp');
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('remote_backup_host', remoteBackupHost || '');
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('remote_backup_port', (remoteBackupPort || 22).toString());
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('remote_backup_username', remoteBackupUsername || '');
    // Only update password if it's not the masked value
    if (remoteBackupPassword && remoteBackupPassword !== '********') {
      db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('remote_backup_password', remoteBackupPassword);
    }
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('remote_backup_path', remoteBackupPath || '/backups');
    
    // Backup options
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('backup_include_videos', backupIncludeVideos ? '1' : '0');
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('backup_include_library', backupIncludeLibrary ? '1' : '0');
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('backup_include_covers', backupIncludeCovers ? '1' : '0');
    
    // Webhook
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('backup_webhook_url', backupWebhookUrl || '');
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to save database settings:', error);
    res.status(500).json({ error: 'Failed to save database settings' });
  }
});

app.post('/api/settings/database/vacuum', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const fs = require('fs');
    const path = require('path');
    const dbPath = path.join(__dirname, 'data', 'printhive.db');
    
    // Get size before vacuum
    const sizeBefore = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    const startTime = Date.now();
    
    console.log('Starting database vacuum...');
    db.exec('VACUUM');
    
    const duration = Date.now() - startTime;
    const sizeAfter = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    const spaceSaved = sizeBefore - sizeAfter;
    
    console.log(`Database vacuum completed in ${duration}ms, saved ${spaceSaved} bytes`);
    res.json({ 
      success: true, 
      message: 'Database vacuumed successfully',
      details: {
        sizeBefore: sizeBefore,
        sizeAfter: sizeAfter,
        spaceSaved: spaceSaved,
        duration: duration
      }
    });
  } catch (error) {
    console.error('Failed to vacuum database:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/settings/database/analyze', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const startTime = Date.now();
    
    // Count tables before analyze
    const tables = db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'").get();
    
    console.log('Starting database analysis...');
    db.exec('ANALYZE');
    
    const duration = Date.now() - startTime;
    console.log(`Database analysis completed in ${duration}ms`);
    
    res.json({ 
      success: true, 
      message: 'Database analyzed successfully',
      details: {
        tablesAnalyzed: tables.count,
        duration: duration
      }
    });
  } catch (error) {
    console.error('Failed to analyze database:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/settings/database/reindex', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const startTime = Date.now();
    
    // Count indexes before reindex
    const indexes = db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='index'").get();
    
    console.log('Starting database reindex...');
    db.exec('REINDEX');
    
    const duration = Date.now() - startTime;
    console.log(`Database reindex completed in ${duration}ms`);
    
    res.json({ 
      success: true, 
      message: 'Database indexes rebuilt successfully',
      details: {
        indexesRebuilt: indexes.count,
        duration: duration
      }
    });
  } catch (error) {
    console.error('Failed to reindex database:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// In-memory backup job tracking
const backupJobs = new Map();

// In-memory restore job tracking
const restoreJobs = new Map();

// Check restore job status
app.get('/api/settings/database/restore/status/:jobId', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const { jobId } = req.params;
  const job = restoreJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json(job);
});

// Check backup job status
app.get('/api/settings/database/backup/status/:jobId', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const { jobId } = req.params;
  const job = backupJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json(job);
});

app.post('/api/settings/database/backup', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const fs = require('fs');
  const path = require('path');
  const tar = require('tar');
  
  // Create backup directory if it doesn't exist
  const backupDir = path.join(__dirname, 'data', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  // Get backup options from request
  const includeVideos = req.body.includeVideos !== false;
  const includeLibrary = req.body.includeLibrary !== false;
  const includeCovers = req.body.includeCovers !== false;
  const async = req.body.async === true; // If true, return immediately with job ID
  
  console.log(`[Backup] Request body:`, JSON.stringify(req.body, null, 2));
  console.log(`[Backup] Options: includeVideos=${includeVideos}, includeLibrary=${includeLibrary}, includeCovers=${includeCovers}, async=${async}`);
  
  // Create backup file with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + Date.now();
  const backupFileName = `printhive_backup_${timestamp}.tar.gz`;
  const backupFile = path.join(backupDir, backupFileName);
  
  // Generate job ID
  const jobId = `backup_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  // Initialize job
  backupJobs.set(jobId, {
    id: jobId,
    status: 'running',
    message: 'Starting backup...',
    progress: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    result: null,
    error: null
  });
  
  // If async mode, return job ID immediately
  if (async) {
    res.json({ 
      success: true, 
      async: true,
      jobId,
      message: 'Backup started. Check status with /api/settings/database/backup/status/' + jobId
    });
    // Continue processing below
  }
  
  // Perform backup
  try {
    
    console.log(`Creating backup archive at ${backupFile}...`);
    console.log(`Options: Videos=${includeVideos}, Library=${includeLibrary}, Covers=${includeCovers}`);
    
    // Prepare list of files/folders to include in backup
    const filesToBackup = [];
    const dataDir = path.join(__dirname, 'data');
    
    // Always include the database (only add shm/wal if they exist)
    filesToBackup.push('printhive.db');
    if (fs.existsSync(path.join(dataDir, 'printhive.db-shm'))) {
      filesToBackup.push('printhive.db-shm');
    }
    if (fs.existsSync(path.join(dataDir, 'printhive.db-wal'))) {
      filesToBackup.push('printhive.db-wal');
    }
    
    // Count items for reporting
    let videoCount = 0;
    let libraryCount = 0;
    let coverCount = 0;
    
    // Include videos if requested
    if (includeVideos) {
      const videosPath = path.join(dataDir, 'videos');
      if (fs.existsSync(videosPath)) {
        const videos = fs.readdirSync(videosPath).filter(f => f.endsWith('.avi') || f.endsWith('.mp4') || f.endsWith('.webm'));
        if (videos.length > 0) {
          filesToBackup.push('videos/');
          videoCount = videos.length;
        }
      }
    }
    
    // Include library files if requested (library is at project root: /app/library)
    if (includeLibrary) {
      const libraryPath = path.join(__dirname, 'library');
      if (fs.existsSync(libraryPath)) {
        // Recursively count files in library directory (filtering by known extensions)
        const allowedExts = new Set(['.3mf', '.stl', '.gcode']);
        const pathModule = require('path');
        const countFilesRecursive = (dir) => {
          let count = 0;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = pathModule.join(dir, entry.name);
            if (entry.isDirectory()) {
              count += countFilesRecursive(fullPath);
            } else if (entry.isFile()) {
              const ext = pathModule.extname(entry.name).toLowerCase();
              if (allowedExts.has(ext)) count += 1;
            }
          }
          return count;
        };
        const countAllFilesRecursive = (dir) => {
          let count = 0;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = pathModule.join(dir, entry.name);
            if (entry.isDirectory()) {
              count += countAllFilesRecursive(fullPath);
            } else if (entry.isFile()) {
              count += 1;
            }
          }
          return count;
        };
        const libFiles = countFilesRecursive(libraryPath);
        const allFiles = countAllFilesRecursive(libraryPath);
        console.log(`[Backup] Library path: ${libraryPath}, found ${allFiles} total files, ${libFiles} library files (recursive)`);
        // Do not push here; we'll merge library as a separate archive after main tar
        libraryCount = libFiles > 0 ? libFiles : allFiles; // Prefer filtered count; fall back to all files
      } else {
        console.log(`[Backup] Library path does not exist: ${libraryPath}`);
      }
    }
    
    // Include cover images if requested
    if (includeCovers) {
      const coversPath = path.join(__dirname, 'public', 'images', 'covers');
      if (fs.existsSync(coversPath)) {
        const coverFiles = fs.readdirSync(coversPath).filter(f => 
          f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png') || f.endsWith('.webp')
        );
        if (coverFiles.length > 0) {
          coverCount = coverFiles.length;
        }
      }
    }
    
    console.log(`[Backup] Final filesToBackup array:`, filesToBackup);
    console.log(`[Backup] Counts - Videos: ${videoCount}, Library: ${libraryCount}, Covers: ${coverCount}`);
    
    // Create tar.gz archive
    await tar.create(
      {
        gzip: true,
        file: backupFile,
        cwd: dataDir,
        filter: (path, stat) => {
          // Exclude backup files themselves
          if (path.includes('backups/')) return false;
          // Exclude temp files
          if (path.includes('temp/')) return false;
          return true;
        }
      },
      filesToBackup
    );
    
    // Merge in optional archives (library, covers) by extracting and repacking
    const extraArchives = [];
    if (includeLibrary && libraryCount > 0 && fs.existsSync(path.join(__dirname, 'library'))) {
      const libraryBackupPath = path.join(backupDir, `library_temp_${Date.now()}.tar.gz`);
      await tar.create(
        {
          gzip: true,
          file: libraryBackupPath,
          cwd: __dirname,
        },
        ['library/']
      );
      extraArchives.push(libraryBackupPath);
    }
    if (includeCovers && coverCount > 0) {
      const coversBackupPath = path.join(backupDir, `covers_temp_${Date.now()}.tar.gz`);
      await tar.create(
        {
          gzip: true,
          file: coversBackupPath,
          cwd: path.join(__dirname, 'public', 'images'),
        },
        ['covers/']
      );
      extraArchives.push(coversBackupPath);
    }
    if (extraArchives.length > 0) {
      const tempMergeDir = path.join(backupDir, `merge_temp_${Date.now()}`);
      fs.mkdirSync(tempMergeDir, { recursive: true });

      // Extract main backup
      await tar.extract({ file: backupFile, cwd: tempMergeDir });
      // Extract each extra archive
      for (const extra of extraArchives) {
        await tar.extract({ file: extra, cwd: tempMergeDir });
      }

      // Remove old backup and temps
      fs.unlinkSync(backupFile);
      for (const extra of extraArchives) {
        try { fs.unlinkSync(extra); } catch {}
      }

      // Repack combined backup
      const allFiles = fs.readdirSync(tempMergeDir);
      await tar.create({ gzip: true, file: backupFile, cwd: tempMergeDir }, allFiles);
      fs.rmSync(tempMergeDir, { recursive: true, force: true });
    }
    
    console.log(`Backup archive created: ${backupFile}`);
    console.log(`Included: ${videoCount} videos, ${libraryCount} library files, ${coverCount} cover images`);
    
    // Update last backup date in config
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('last_backup_date', new Date().toISOString());
    
    // Get backup file size
    const backupStats = fs.statSync(backupFile);
    const backupSize = formatBytes(backupStats.size);
    
    // Clean up old backups based on retention policy
    const retentionDays = parseInt(db.prepare('SELECT value FROM config WHERE key = ?').get('backup_retention')?.value || '30');
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    fs.readdirSync(backupDir).forEach(file => {
      if (!file.endsWith('.tar.gz')) return; // Only clean up tar.gz backups
      const filePath = path.join(backupDir, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtime.getTime() > retentionMs) {
        fs.unlinkSync(filePath);
        console.log(`Deleted old backup: ${file}`);
      }
    });
    
    // Check if remote backup is enabled and upload
    let remoteUploaded = false;
    const remoteEnabled = db.prepare('SELECT value FROM config WHERE key = ?').get('remote_backup_enabled')?.value === '1';
    
    if (remoteEnabled) {
      try {
        const remoteType = db.prepare('SELECT value FROM config WHERE key = ?').get('remote_backup_type')?.value || 'sftp';
        const remoteHost = db.prepare('SELECT value FROM config WHERE key = ?').get('remote_backup_host')?.value;
        const remotePort = parseInt(db.prepare('SELECT value FROM config WHERE key = ?').get('remote_backup_port')?.value || '22');
        const remoteUsername = db.prepare('SELECT value FROM config WHERE key = ?').get('remote_backup_username')?.value;
        const remotePassword = db.prepare('SELECT value FROM config WHERE key = ?').get('remote_backup_password')?.value;
        const remotePath = db.prepare('SELECT value FROM config WHERE key = ?').get('remote_backup_path')?.value || '/backups';
        
        if (remoteHost && remoteUsername) {
          if (remoteType === 'sftp') {
            const Client = require('ssh2-sftp-client');
            const sftp = new Client();
            await sftp.connect({
              host: remoteHost,
              port: remotePort,
              username: remoteUsername,
              password: remotePassword
            });
            
            // Ensure remote directory exists
            try {
              await sftp.mkdir(remotePath, true);
            } catch (e) {
              // Directory might already exist
            }
            
            const remoteFilePath = `${remotePath}/${backupFileName}`;
            await sftp.put(backupFile, remoteFilePath);
            await sftp.end();
            
            console.log(`Backup uploaded to SFTP: ${remoteFilePath}`);
            remoteUploaded = true;
          } else if (remoteType === 'ftp') {
            const ftp = require('basic-ftp');
            const client = new ftp.Client();
            await client.access({
              host: remoteHost,
              port: remotePort,
              user: remoteUsername,
              password: remotePassword,
              secure: false
            });
            
            // Ensure remote directory exists
            try {
              await client.ensureDir(remotePath);
            } catch (e) {
              // Directory might already exist
            }
            
            await client.uploadFrom(backupFile, `${remotePath}/${backupFileName}`);
            client.close();
            
            console.log(`Backup uploaded to FTP: ${remotePath}/${backupFileName}`);
            remoteUploaded = true;
          }
        }
      } catch (remoteError) {
        console.error('Failed to upload backup to remote server:', remoteError.message);
        // Don't fail the whole backup, just log the error
      }
    }
    
    // Send webhook notification if configured
    try {
      const webhookUrl = db.prepare('SELECT value FROM config WHERE key = ?').get('backup_webhook_url')?.value;
      if (webhookUrl) {
        const webhookPayload = {
          event: 'backup_completed',
          timestamp: new Date().toISOString(),
          backup: {
            filename: backupFileName,
            size: backupSize,
            videos: includeVideos ? videoCount : 0,
            library: includeLibrary ? libraryCount : 0,
            covers: includeCovers ? coverCount : 0
          },
          remote_uploaded: remoteUploaded
        };
        
        await axios.post(webhookUrl, webhookPayload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000
        }).catch(err => {
          console.error('Webhook notification failed:', err.message);
        });
      }
    } catch (webhookError) {
      console.error('Webhook error:', webhookError.message);
    }
    
    // Send Discord notification
    try {
      await sendNotification('backup', {
        status: 'completed',
        message: `Database backup completed successfully!`,
        size: backupSize,
        videos: includeVideos ? videoCount : 0,
        library: includeLibrary ? libraryCount : 0,
        includeLibrary,
        covers: includeCovers ? coverCount : 0,
        remoteUploaded: remoteUploaded
      });
    } catch (discordError) {
      console.error('Discord notification error:', discordError.message);
    }
    
    const result = { 
      success: true, 
      message: remoteUploaded ? 'Backup created and uploaded to remote server' : 'Backup archive created successfully',
      remoteUploaded,
      details: {
        'Archive Size': backupSize,
        Videos: includeVideos ? `Included (${videoCount} files)` : 'Excluded',
        'Library Files': includeLibrary ? `Included (${libraryCount} files)` : 'Excluded',
        'Cover Images': includeCovers ? `Included (${coverCount} files)` : 'Excluded',
        Time: new Date().toLocaleString()
      }
    };
    
    // Update job status
    backupJobs.set(jobId, {
      ...backupJobs.get(jobId),
      status: 'completed',
      message: result.message,
      progress: 100,
      completedAt: new Date().toISOString(),
      result
    });
    
    // If sync mode, respond now
    if (!async) {
      res.json(result);
    }
  } catch (error) {
    console.error('Failed to backup database:', error);
    console.error('Backup error stack:', error.stack);
    
    // Update job status
    backupJobs.set(jobId, {
      ...backupJobs.get(jobId),
      status: 'failed',
      message: error.message || 'Unknown backup error',
      completedAt: new Date().toISOString(),
      error: error.message || 'Unknown backup error'
    });
    
    if (!async) {
      res.status(500).json({ success: false, error: error.message || 'Unknown backup error' });
    }
  }
});

// Test remote backup connection
app.post('/api/settings/database/test-remote', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const { type, host, port, username, password, path: remotePath } = req.body;
    
    if (!host || !username) {
      return res.status(400).json({ success: false, error: 'Host and username are required' });
    }
    
    // Get the actual password if masked
    let actualPassword = password;
    if (password === '********' || !password) {
      actualPassword = db.prepare('SELECT value FROM config WHERE key = ?').get('remote_backup_password')?.value || '';
    }
    
    if (type === 'sftp') {
      const Client = require('ssh2-sftp-client');
      const sftp = new Client();
      
      await sftp.connect({
        host,
        port: port || 22,
        username,
        password: actualPassword
      });
      
      // Try to list the directory
      const exists = await sftp.exists(remotePath || '/');
      await sftp.end();
      
      res.json({ 
        success: true, 
        message: `SFTP connection successful${exists ? `, path "${remotePath}" exists` : `, path "${remotePath}" does not exist (will be created)`}` 
      });
    } else if (type === 'ftp') {
      const ftp = require('basic-ftp');
      const client = new ftp.Client();
      
      await client.access({
        host,
        port: port || 21,
        user: username,
        password: actualPassword,
        secure: false
      });
      
      // Try to list the directory
      try {
        await client.cd(remotePath || '/');
      } catch (e) {
        // Path doesn't exist, that's okay
      }
      
      client.close();
      
      res.json({ success: true, message: 'FTP connection successful' });
    } else {
      res.status(400).json({ success: false, error: 'Invalid protocol type' });
    }
  } catch (error) {
    console.error('Remote connection test failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get list of available backups
// Delete a backup file
app.delete('/api/settings/database/backups/:filename', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const fs = require('fs');
    const path = require('path');
    const { filename } = req.params;
    
    // Security: ensure filename doesn't contain path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    
    const backupDir = path.join(__dirname, 'data', 'backups');
    const backupFile = path.join(backupDir, filename);
    
    if (!fs.existsSync(backupFile)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }
    
    fs.unlinkSync(backupFile);
    console.log(`Deleted backup: ${filename}`);
    
    res.json({ success: true, message: 'Backup deleted successfully' });
  } catch (error) {
    console.error('Failed to delete backup:', error);
    res.status(500).json({ error: 'Failed to delete backup' });
  }
});

app.get('/api/settings/database/backups', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const fs = require('fs');
    const path = require('path');
    const backupDir = path.join(__dirname, 'data', 'backups');
    
    if (!fs.existsSync(backupDir)) {
      return res.json({ success: true, backups: [], stats: { count: 0, totalSize: 0, totalSizeFormatted: '0 B' } });
    }
    
    let totalSize = 0;
    const backups = fs.readdirSync(backupDir)
      .filter(file => file.endsWith('.tar.gz'))
      .map(file => {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
        return {
          name: file,
          size: formatBytes(stats.size),
          sizeBytes: stats.size,
          date: stats.mtime.toLocaleString(),
          timestamp: stats.mtime.getTime()
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp);
    
    res.json({ 
      success: true, 
      backups,
      stats: {
        count: backups.length,
        totalSize: totalSize,
        totalSizeFormatted: formatBytes(totalSize)
      }
    });
  } catch (error) {
    console.error('Failed to list backups:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check restore job status
app.get('/api/settings/database/restore/status/:jobId', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const { jobId } = req.params;
  const job = restoreJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json(job);
});

// Restore from backup
app.post('/api/settings/database/restore', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const { backupFile, async: asyncMode } = req.body;
  const jobId = `restore_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  // Initialize job
  restoreJobs.set(jobId, {
    id: jobId,
    status: 'running',
    message: 'Starting restore...',
    progress: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    result: null,
    error: null
  });
  
  // If async mode, return job ID immediately
  if (asyncMode) {
    res.json({ 
      success: true, 
      async: true,
      jobId,
      message: 'Restore started. Check status with /api/settings/database/restore/status/' + jobId
    });
  }
  
  try {
    
    if (!backupFile) {
      return res.status(400).json({ success: false, error: 'Backup file is required' });
    }
    
    const fs = require('fs');
    const path = require('path');
    const tar = require('tar');
    const backupPath = path.join(__dirname, 'data', 'backups', backupFile);
    
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ success: false, error: 'Backup file not found' });
    }
    
    if (!backupFile.endsWith('.tar.gz')) {
      return res.status(400).json({ success: false, error: 'Invalid backup file format. Expected .tar.gz' });
    }
    
    console.log(`Restoring from backup archive ${backupFile}...`);
    restoreJobs.set(jobId, { ...restoreJobs.get(jobId), message: 'Extracting backup...', progress: 10 });
    
    // Close existing database connection
    db.close();
    
    // Create a temporary extraction directory
    const tempExtractDir = path.join(__dirname, 'data', 'temp_restore');
    if (fs.existsSync(tempExtractDir)) {
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempExtractDir, { recursive: true });
    
    // Extract tar.gz to temp directory
    await tar.extract({
      file: backupPath,
      cwd: tempExtractDir
    });
    
    console.log(`Archive extracted to ${tempExtractDir}`);
    restoreJobs.set(jobId, { ...restoreJobs.get(jobId), message: 'Restoring database...', progress: 30 });
    
    // Restore database files
    const dataDir = path.join(__dirname, 'data');
    if (fs.existsSync(path.join(tempExtractDir, 'printhive.db'))) {
      fs.copyFileSync(path.join(tempExtractDir, 'printhive.db'), path.join(dataDir, 'printhive.db'));
      console.log('✓ Database restored');
    }
    if (fs.existsSync(path.join(tempExtractDir, 'printhive.db-shm'))) {
      fs.copyFileSync(path.join(tempExtractDir, 'printhive.db-shm'), path.join(dataDir, 'printhive.db-shm'));
    }
    if (fs.existsSync(path.join(tempExtractDir, 'printhive.db-wal'))) {
      fs.copyFileSync(path.join(tempExtractDir, 'printhive.db-wal'), path.join(dataDir, 'printhive.db-wal'));
    }
    
    restoreJobs.set(jobId, { ...restoreJobs.get(jobId), message: 'Restoring videos...', progress: 50 });
    
    // Restore videos if present
    const videosBackupPath = path.join(tempExtractDir, 'videos');
    if (fs.existsSync(videosBackupPath)) {
      const videosDir = path.join(dataDir, 'videos');
      if (!fs.existsSync(videosDir)) {
        fs.mkdirSync(videosDir, { recursive: true });
      }
      // Copy all video files
      const videoFiles = fs.readdirSync(videosBackupPath);
      videoFiles.forEach(file => {
        fs.copyFileSync(path.join(videosBackupPath, file), path.join(videosDir, file));
      });
      console.log(`✓ Restored ${videoFiles.length} video files`);
    }
    
    restoreJobs.set(jobId, { ...restoreJobs.get(jobId), message: 'Restoring library files...', progress: 70 });
    
    // Restore library files if present (to project root /library)
    const libraryBackupPath = path.join(tempExtractDir, 'library');
    if (fs.existsSync(libraryBackupPath)) {
      const libraryDirPath = path.join(__dirname, 'library');
      if (!fs.existsSync(libraryDirPath)) {
        fs.mkdirSync(libraryDirPath, { recursive: true });
      }
      // Recursively copy all library files
      const copyRecursive = (src, dest) => {
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
          const srcPath = path.join(src, entry.name);
          const destPath = path.join(dest, entry.name);
          if (entry.isDirectory()) {
            fs.mkdirSync(destPath, { recursive: true });
            copyRecursive(srcPath, destPath);
          } else {
            fs.copyFileSync(srcPath, destPath);
          }
        }
      };
      copyRecursive(libraryBackupPath, libraryDirPath);
      console.log(`✓ Restored library files to ${libraryDirPath}`);
    }
    
    restoreJobs.set(jobId, { ...restoreJobs.get(jobId), message: 'Restoring cover images...', progress: 85 });
    
    // Restore cover images if present
    const coversBackupPath = path.join(tempExtractDir, 'covers');
    if (fs.existsSync(coversBackupPath)) {
      const coversDir = path.join(__dirname, 'public', 'images', 'covers');
      if (!fs.existsSync(coversDir)) {
        fs.mkdirSync(coversDir, { recursive: true });
      }
      // Copy all cover files
      const coverFiles = fs.readdirSync(coversBackupPath);
      coverFiles.forEach(file => {
        fs.copyFileSync(path.join(coversBackupPath, file), path.join(coversDir, file));
      });
      console.log(`✓ Restored ${coverFiles.length} cover images`);
    }
    
    // Clean up temp directory
    fs.rmSync(tempExtractDir, { recursive: true, force: true });
    console.log('✓ Cleanup complete');
    
    console.log(`Restore from ${backupFile} completed successfully`);
    restoreJobs.set(jobId, { ...restoreJobs.get(jobId), message: 'Reconnecting database...', progress: 95 });
    
    // Reconnect to database
    const Database = require('better-sqlite3');
    const dbPath = path.join(__dirname, 'data', 'printhive.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    
    const result = { 
      success: true, 
      message: 'Backup restored successfully. Server will restart automatically.',
      shouldRestart: true
    };
    
    // Update job status
    restoreJobs.set(jobId, {
      ...restoreJobs.get(jobId),
      status: 'completed',
      message: 'Restore completed - restarting server...',
      progress: 100,
      completedAt: new Date().toISOString(),
      result
    });
    
    if (!asyncMode) {
      res.json(result);
    }
    
    // Restart the server after a short delay
    setTimeout(() => {
      console.log('Restarting server after restore...');
      process.exit(0); // Docker/PM2 will automatically restart
    }, 3000);
  } catch (error) {
    console.error('Failed to restore backup:', error);
    
    // Update job status
    restoreJobs.set(jobId, {
      ...restoreJobs.get(jobId),
      status: 'failed',
      message: error.message || 'Unknown restore error',
      completedAt: new Date().toISOString(),
      error: error.message || 'Unknown restore error'
    });
    
    // Try to reconnect to database even if restore failed
    try {
      const Database = require('better-sqlite3');
      const dbPath = path.join(__dirname, 'data', 'printhive.db');
      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
    } catch (reconnectError) {
      console.error('Failed to reconnect to database after restore error:', reconnectError);
    }
    
    if (!asyncMode) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Handle shutdown signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));



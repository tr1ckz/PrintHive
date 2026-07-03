const express = require('express');
const fs = require('fs');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const logger = require('../../logger');
const { db } = require('../../database');
const { BCRYPT_ROUNDS, isBcryptHash } = require('../config');
const { requireAdmin } = require('../middleware/requireAuth');
const { configureOIDC } = require('../services/oidcProvider');
const { sendNotification, sendDiscordNotification, sendTelegramNotification, sendSlackNotification } = require('../services/notifications');
const bambuFtp = require('../services/bambuFtp');

// Settings, admin-user, and integration routes. ctx carries the few helpers
// that still live in simple-server.js (camera config sync, watchdog timer).
module.exports = function createSettingsRouter({ setupWatchdog, syncGo2RtcConfigSafe, go2rtcConfigPath, normalizeStreamRelayUrl }) {
  const router = express.Router();

// System controls: get/set log level (after session middleware)
router.get('/api/log-level', (req, res) => {
  if (!(req.session && req.session.authenticated)) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ level: logger.level });
});

router.post('/api/log-level', (req, res) => {
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
router.post('/api/system/restart', (req, res) => {
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
router.post('/api/settings/restart', (req, res) => {
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

// Request verification code from Bambu Lab
router.post('/api/settings/request-code', async (req, res) => {
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
router.post('/api/settings/connect-bambu', async (req, res) => {
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
router.get('/api/settings/bambu-status', (req, res) => {
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
router.post('/api/settings/disconnect-bambu', (req, res) => {
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

// Change password
router.post('/api/settings/change-password', async (req, res) => {
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
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    const currentMatches = user && user.password && isBcryptHash(user.password)
      && await bcrypt.compare(String(currentPassword), user.password);

    if (!currentMatches) {
      return res.json({ success: false, error: 'Current password is incorrect' });
    }

    // Update password
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS), req.session.userId);

    res.json({ success: true });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Get printer FTP settings
router.get('/api/settings/printer-ftp', (req, res) => {
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
const savePrinterFtpHandler = (req, res) => {
  console.log('=== SAVE PRINTER FTP SETTINGS ===');

  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { printerIp, printerAccessCode, cameraRtspUrl, serialNumber } = req.body;
  console.log('Parsed values:', { printerIp, printerAccessCode: printerAccessCode ? '***' : null, cameraRtspUrl: cameraRtspUrl ? '***' : null, serialNumber });
  
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
};
router.post('/api/settings/printer-ftp', savePrinterFtpHandler);
// Alias endpoint for backwards compatibility (was an app._router.handle hack)
router.post('/api/settings/save-printer-ftp', savePrinterFtpHandler);

// Test printer FTP connection
router.post('/api/settings/test-printer-ftp', async (req, res) => {
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

// Get UI settings (hide buy me a coffee, etc.) - PUBLIC endpoint
router.get('/api/settings/ui', (req, res) => {
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
router.post('/api/settings/ui', (req, res) => {
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

const dashboardWidgetIds = new Set(['livePrinters', 'healthSummary', 'materialUsage', 'queuePressure', 'fleetAlerts', 'backgroundJobs', 'activityStream', 'upcomingSchedule', 'failureWatch', 'mqttStatus']);
const dashboardBreakpointKeys = ['lg', 'md', 'sm', 'xs', 'xxs'];

const defaultDashboardLayouts = {
  lg: [
    { i: 'livePrinters', x: 0, y: 0, w: 5, h: 7, minW: 4, minH: 5 },
    { i: 'healthSummary', x: 5, y: 0, w: 3, h: 5, minW: 3, minH: 4 },
    { i: 'materialUsage', x: 0, y: 7, w: 5, h: 5, minW: 4, minH: 4 },
    { i: 'queuePressure', x: 5, y: 11, w: 3, h: 6, minW: 3, minH: 5 },
    { i: 'fleetAlerts', x: 8, y: 0, w: 4, h: 5, minW: 3, minH: 4 },
    { i: 'upcomingSchedule', x: 5, y: 5, w: 3, h: 6, minW: 3, minH: 5 },
    { i: 'backgroundJobs', x: 8, y: 5, w: 4, h: 6, minW: 3, minH: 5 },
    { i: 'activityStream', x: 8, y: 11, w: 4, h: 8, minW: 4, minH: 6 },
    { i: 'failureWatch', x: 5, y: 17, w: 3, h: 4, minW: 3, minH: 4 },
    { i: 'mqttStatus', x: 0, y: 12, w: 5, h: 5, minW: 4, minH: 4 },
  ],
  md: [
    { i: 'livePrinters', x: 0, y: 0, w: 6, h: 6, minW: 4, minH: 5 },
    { i: 'healthSummary', x: 6, y: 0, w: 4, h: 5, minW: 3, minH: 4 },
    { i: 'materialUsage', x: 0, y: 6, w: 6, h: 5, minW: 4, minH: 4 },
    { i: 'queuePressure', x: 6, y: 10, w: 4, h: 6, minW: 3, minH: 5 },
    { i: 'fleetAlerts', x: 6, y: 5, w: 4, h: 5, minW: 3, minH: 4 },
    { i: 'upcomingSchedule', x: 0, y: 11, w: 4, h: 6, minW: 3, minH: 5 },
    { i: 'backgroundJobs', x: 4, y: 11, w: 6, h: 6, minW: 3, minH: 5 },
    { i: 'activityStream', x: 0, y: 17, w: 10, h: 8, minW: 5, minH: 6 },
    { i: 'failureWatch', x: 0, y: 25, w: 10, h: 5, minW: 5, minH: 4 },
    { i: 'mqttStatus', x: 0, y: 30, w: 10, h: 5, minW: 5, minH: 4 },
  ],
  sm: [
    { i: 'livePrinters', x: 0, y: 0, w: 6, h: 6, minW: 3, minH: 5 },
    { i: 'healthSummary', x: 0, y: 6, w: 6, h: 5, minW: 3, minH: 4 },
    { i: 'materialUsage', x: 0, y: 11, w: 6, h: 5, minW: 3, minH: 4 },
    { i: 'queuePressure', x: 0, y: 16, w: 6, h: 6, minW: 3, minH: 5 },
    { i: 'fleetAlerts', x: 0, y: 22, w: 6, h: 5, minW: 3, minH: 4 },
    { i: 'backgroundJobs', x: 0, y: 27, w: 6, h: 6, minW: 3, minH: 5 },
    { i: 'upcomingSchedule', x: 0, y: 33, w: 6, h: 6, minW: 4, minH: 5 },
    { i: 'activityStream', x: 0, y: 39, w: 6, h: 8, minW: 4, minH: 6 },
    { i: 'failureWatch', x: 0, y: 47, w: 6, h: 6, minW: 4, minH: 5 },
    { i: 'mqttStatus', x: 0, y: 53, w: 6, h: 5, minW: 4, minH: 4 },
  ],
  xs: [
    { i: 'livePrinters', x: 0, y: 0, w: 4, h: 6, minW: 2, minH: 5 },
    { i: 'healthSummary', x: 0, y: 6, w: 4, h: 5, minW: 2, minH: 4 },
    { i: 'materialUsage', x: 0, y: 11, w: 4, h: 5, minW: 2, minH: 4 },
    { i: 'queuePressure', x: 0, y: 16, w: 4, h: 6, minW: 2, minH: 5 },
    { i: 'fleetAlerts', x: 0, y: 22, w: 4, h: 5, minW: 2, minH: 4 },
    { i: 'backgroundJobs', x: 0, y: 27, w: 4, h: 6, minW: 2, minH: 5 },
    { i: 'upcomingSchedule', x: 0, y: 33, w: 4, h: 6, minW: 2, minH: 5 },
    { i: 'activityStream', x: 0, y: 39, w: 4, h: 8, minW: 2, minH: 6 },
    { i: 'failureWatch', x: 0, y: 47, w: 4, h: 6, minW: 2, minH: 5 },
    { i: 'mqttStatus', x: 0, y: 53, w: 4, h: 5, minW: 2, minH: 4 },
  ],
  xxs: [
    { i: 'livePrinters', x: 0, y: 0, w: 2, h: 6, minW: 2, minH: 5 },
    { i: 'healthSummary', x: 0, y: 6, w: 2, h: 5, minW: 2, minH: 4 },
    { i: 'materialUsage', x: 0, y: 11, w: 2, h: 5, minW: 2, minH: 4 },
    { i: 'queuePressure', x: 0, y: 16, w: 2, h: 6, minW: 2, minH: 5 },
    { i: 'fleetAlerts', x: 0, y: 22, w: 2, h: 5, minW: 2, minH: 4 },
    { i: 'backgroundJobs', x: 0, y: 27, w: 2, h: 6, minW: 2, minH: 5 },
    { i: 'upcomingSchedule', x: 0, y: 33, w: 2, h: 6, minW: 2, minH: 5 },
    { i: 'activityStream', x: 0, y: 39, w: 2, h: 8, minW: 2, minH: 6 },
    { i: 'failureWatch', x: 0, y: 47, w: 2, h: 6, minW: 2, minH: 5 },
    { i: 'mqttStatus', x: 0, y: 53, w: 2, h: 5, minW: 2, minH: 4 },
  ],
};

const defaultDashboardWidgetPrefs = {
  version: 3,
  layouts: defaultDashboardLayouts,
  hiddenWidgetIds: ['mqttStatus'],
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

  const sourceVersion = Number.parseInt(String(safe.version || 0), 10);
  const normalizedVersion = Number.isFinite(sourceVersion) ? sourceVersion : 0;
  const nextHiddenWidgetIds = normalizedVersion >= 3
    ? hiddenWidgetIds
    : (hiddenWidgetIds.includes('mqttStatus') ? hiddenWidgetIds : [...hiddenWidgetIds, 'mqttStatus']);

  return {
    version: 3,
    layouts,
    hiddenWidgetIds: nextHiddenWidgetIds,
  };
}

function getDashboardWidgetConfigKey(userId) {
  return `dashboard_widgets_layout_user_${userId}`;
}

// Get dashboard widget preferences (authenticated)
router.get('/api/settings/dashboard-widgets', (req, res) => {
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
router.post('/api/settings/dashboard-widgets', (req, res) => {
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

// Get user profile
router.get('/api/settings/profile', (req, res) => {
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
router.post('/api/settings/profile', (req, res) => {
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

// Admin: Get all users
router.get('/api/admin/users', requireAdmin, (req, res) => {
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
router.patch('/api/admin/users/:id/role', requireAdmin, (req, res) => {
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
router.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
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
router.post('/api/admin/migrate-bambu-accounts', requireAdmin, (req, res) => {
  try {
    const { migrateBambuAccounts } = require('../../database');
    const result = migrateBambuAccounts();
    res.json(result);
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({ error: error.message });
  }
});

const SECRET_MASK = '••••••••';

router.get('/api/settings/oauth', requireAdmin, (req, res) => {
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

    // Never return stored secrets; the UI shows a mask and sends it back
    // unchanged unless the admin types a new value.
    if (oauthConfig.oidcClientSecret) oauthConfig.oidcClientSecret = SECRET_MASK;
    if (oauthConfig.googleClientSecret) oauthConfig.googleClientSecret = SECRET_MASK;

    res.json(oauthConfig);
  } catch (error) {
    console.error('Error fetching OAuth settings:', error);
    res.status(500).json({ error: 'Failed to fetch OAuth settings' });
  }
});

// Public: Get OAuth provider (for login page auto-redirect)
router.get('/api/settings/oauth-public', (req, res) => {
  try {
    const providerRow = db.prepare('SELECT value FROM config WHERE key = ?').get('oauth_provider');
    res.json({ provider: providerRow?.value || 'none' });
  } catch (error) {
    console.error('Error fetching OAuth provider:', error);
    res.json({ provider: 'none' });
  }
});

// Admin: Save OAuth settings
router.post('/api/settings/save-oauth', requireAdmin, async (req, res) => {
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
    upsert.run('oauth_oidcIssuer', oidcIssuer, oidcIssuer);
    upsert.run('oauth_oidcClientId', oidcClientId, oidcClientId);
    upsert.run('oauth_oidcEndSessionUrl', oidcEndSessionUrl || '', oidcEndSessionUrl || '');

    // The GET endpoint masks stored secrets; a masked or empty value coming
    // back means "keep the existing secret".
    if (googleClientSecret && googleClientSecret !== SECRET_MASK) {
      upsert.run('oauth_googleClientSecret', googleClientSecret, googleClientSecret);
    }
    if (oidcClientSecret && oidcClientSecret !== SECRET_MASK) {
      upsert.run('oauth_oidcClientSecret', oidcClientSecret, oidcClientSecret);
    }
    
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
router.get('/api/settings/costs', (req, res) => {
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
router.post('/api/settings/costs', requireAdmin, (req, res) => {
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

// Get watchdog settings
router.get('/api/settings/watchdog', async (req, res) => {
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
router.post('/api/settings/watchdog', async (req, res) => {
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
router.get('/api/settings/discord', async (req, res) => {
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
router.post('/api/settings/discord', async (req, res) => {
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
router.get('/api/settings/notifications', (req, res) => {
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

router.post('/api/settings/notifications', (req, res) => {
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

// Test Discord webhook
router.post('/api/discord/test', async (req, res) => {
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
router.post('/api/settings/notifications/test', async (req, res) => {
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

  return router;
};

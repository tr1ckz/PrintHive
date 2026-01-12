/**
 * Anonymous Telemetry System
 * 
 * Sends anonymous usage statistics to a configurable endpoint.
 * NO personal data is collected - only:
 * - Random install ID (UUID)
 * - App version
 * - Basic counts (printers, prints, library items)
 * - Platform info (OS type only)
 * 
 * Enabled via TELEMETRY_ENDPOINT environment variable.
 * If not set, telemetry is completely disabled.
 */

const crypto = require('crypto');
const axios = require('axios');
const os = require('os');
const logger = require('./logger');

let db = null;
let telemetryInterval = null;

// Initialize telemetry with database reference
function init(database) {
  db = database;
  
  const endpoint = process.env.TELEMETRY_ENDPOINT;
  if (!endpoint) {
    logger.debug('[Telemetry] Disabled (no TELEMETRY_ENDPOINT configured)');
    return;
  }
  
  logger.info('[Telemetry] Enabled, sending anonymous stats to configured endpoint');
  
  // Ensure we have an install ID
  getOrCreateInstallId();
  
  // Send initial heartbeat after 60 seconds (let app fully start)
  setTimeout(() => {
    sendHeartbeat();
  }, 60000);
  
  // Then send heartbeat every 24 hours
  telemetryInterval = setInterval(() => {
    sendHeartbeat();
  }, 24 * 60 * 60 * 1000);
}

// Get or create anonymous install ID
function getOrCreateInstallId() {
  try {
    const existing = db.prepare('SELECT value FROM config WHERE key = ?').get('install_id');
    if (existing?.value) {
      return existing.value;
    }
    
    // Generate new random UUID
    const installId = crypto.randomUUID();
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('install_id', installId);
    logger.info('[Telemetry] Generated new anonymous install ID');
    return installId;
  } catch (error) {
    logger.error('[Telemetry] Failed to get/create install ID:', error.message);
    return null;
  }
}

// Collect anonymous statistics
function collectStats() {
  try {
    const installId = getOrCreateInstallId();
    if (!installId) return null;
    
    // Get version
    let version = 'unknown';
    try {
      const versionFile = require('./version.json');
      version = versionFile.version || 'unknown';
    } catch (e) {}
    
    // Count printers (from settings with bambu_token or printer_ip)
    let printerCount = 0;
    try {
      const withToken = db.prepare(`SELECT COUNT(*) as count FROM settings WHERE bambu_token IS NOT NULL AND bambu_token != ''`).get();
      const withIp = db.prepare(`SELECT COUNT(DISTINCT printer_ip) as count FROM settings WHERE printer_ip IS NOT NULL AND printer_ip != ''`).get();
      printerCount = Math.max(withToken?.count || 0, withIp?.count || 0);
    } catch (e) {}
    
    // Count prints
    let printCount = 0;
    try {
      const result = db.prepare('SELECT COUNT(*) as count FROM prints').get();
      printCount = result?.count || 0;
    } catch (e) {}
    
    // Count library items
    let libraryCount = 0;
    try {
      const result = db.prepare('SELECT COUNT(*) as count FROM library').get();
      libraryCount = result?.count || 0;
    } catch (e) {}
    
    // Count users
    let userCount = 0;
    try {
      const result = db.prepare('SELECT COUNT(*) as count FROM users').get();
      userCount = result?.count || 0;
    } catch (e) {}
    
    // Feature flags (what's enabled)
    const features = {};
    try {
      const discordEnabled = db.prepare(`SELECT value FROM config WHERE key = 'discord_webhook_url'`).get();
      features.discord = !!(discordEnabled?.value);
      
      const telegramEnabled = db.prepare(`SELECT value FROM config WHERE key = 'telegram_bot_token'`).get();
      features.telegram = !!(telegramEnabled?.value);
      
      const watchdogEnabled = db.prepare(`SELECT value FROM config WHERE key = 'watchdog_enabled'`).get();
      features.watchdog = watchdogEnabled?.value === '1';
      
      const oauthEnabled = db.prepare(`SELECT value FROM config WHERE key = 'google_client_id'`).get();
      features.oauth = !!(oauthEnabled?.value);
    } catch (e) {}
    
    return {
      install_id: installId,
      version: version,
      platform: os.platform(),
      arch: os.arch(),
      node_version: process.version,
      stats: {
        printers: printerCount,
        prints: printCount,
        library: libraryCount,
        users: userCount
      },
      features: features,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('[Telemetry] Failed to collect stats:', error.message);
    return null;
  }
}

// Send heartbeat to configured endpoint
async function sendHeartbeat() {
  const endpoint = process.env.TELEMETRY_ENDPOINT;
  if (!endpoint) return;
  
  try {
    const stats = collectStats();
    if (!stats) {
      logger.warn('[Telemetry] No stats to send');
      return;
    }
    
    logger.debug('[Telemetry] Sending heartbeat...');
    
    await axios.post(endpoint, stats, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    
    logger.debug('[Telemetry] Heartbeat sent successfully');
    
    // Store last successful send
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('telemetry_last_sent', new Date().toISOString());
  } catch (error) {
    // Silent fail - don't spam logs if endpoint is down
    logger.debug('[Telemetry] Heartbeat failed:', error.message);
  }
}

// Cleanup
function shutdown() {
  if (telemetryInterval) {
    clearInterval(telemetryInterval);
    telemetryInterval = null;
  }
}

module.exports = {
  init,
  sendHeartbeat,
  collectStats,
  getOrCreateInstallId,
  shutdown
};

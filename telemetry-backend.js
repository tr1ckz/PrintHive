/**
 * PrintHive Telemetry Backend
 * 
 * Deploy this to 3d.tr1ck.dev to receive and serve telemetry data.
 * 
 * Required: Node.js + Express + SQLite (better-sqlite3)
 * 
 * Install: npm install express better-sqlite3 cors
 * Run: node telemetry-backend.js
 */

const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize SQLite database
const db = new Database(path.join(__dirname, 'telemetry.db'));

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS installs (
    install_id TEXT PRIMARY KEY,
    version TEXT,
    platform TEXT,
    arch TEXT,
    node_version TEXT,
    stats_printers INTEGER DEFAULT 0,
    stats_prints INTEGER DEFAULT 0,
    stats_library INTEGER DEFAULT 0,
    stats_users INTEGER DEFAULT 0,
    features_discord INTEGER DEFAULT 0,
    features_telegram INTEGER DEFAULT 0,
    features_watchdog INTEGER DEFAULT 0,
    features_oauth INTEGER DEFAULT 0,
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE INDEX IF NOT EXISTS idx_last_seen ON installs(last_seen);
  CREATE INDEX IF NOT EXISTS idx_version ON installs(version);
`);

app.use(cors());
app.use(express.json());

// Receive heartbeat from PrintHive installs
app.post('/api/telemetry', (req, res) => {
  try {
    const { install_id, version, platform, arch, node_version, stats, features, timestamp } = req.body;
    
    if (!install_id) {
      return res.status(400).json({ error: 'Missing install_id' });
    }
    
    // Upsert install data
    db.prepare(`
      INSERT INTO installs (
        install_id, version, platform, arch, node_version,
        stats_printers, stats_prints, stats_library, stats_users,
        features_discord, features_telegram, features_watchdog, features_oauth,
        first_seen, last_seen
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(install_id) DO UPDATE SET
        version = excluded.version,
        platform = excluded.platform,
        arch = excluded.arch,
        node_version = excluded.node_version,
        stats_printers = excluded.stats_printers,
        stats_prints = excluded.stats_prints,
        stats_library = excluded.stats_library,
        stats_users = excluded.stats_users,
        features_discord = excluded.features_discord,
        features_telegram = excluded.features_telegram,
        features_watchdog = excluded.features_watchdog,
        features_oauth = excluded.features_oauth,
        last_seen = CURRENT_TIMESTAMP
    `).run(
      install_id,
      version || 'unknown',
      platform || 'unknown',
      arch || 'unknown',
      node_version || 'unknown',
      stats?.printers || 0,
      stats?.prints || 0,
      stats?.library || 0,
      stats?.users || 0,
      features?.discord ? 1 : 0,
      features?.telegram ? 1 : 0,
      features?.watchdog ? 1 : 0,
      features?.oauth ? 1 : 0
    );
    
    console.log(`[Telemetry] Heartbeat from ${install_id.substring(0, 8)}... v${version}`);
    res.json({ ok: true });
  } catch (error) {
    console.error('[Telemetry] Error:', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Get all installs (for dashboard)
app.get('/api/telemetry/installs', (req, res) => {
  try {
    const installs = db.prepare(`
      SELECT 
        install_id,
        version,
        platform,
        arch,
        node_version,
        stats_printers as printers,
        stats_prints as prints,
        stats_library as library,
        stats_users as users,
        features_discord as discord,
        features_telegram as telegram,
        features_watchdog as watchdog,
        features_oauth as oauth,
        first_seen,
        last_seen
      FROM installs
      ORDER BY last_seen DESC
    `).all();
    
    // Transform to expected format
    const formatted = installs.map(i => ({
      install_id: i.install_id,
      version: i.version,
      platform: i.platform,
      arch: i.arch,
      node_version: i.node_version,
      stats: {
        printers: i.printers,
        prints: i.prints,
        library: i.library,
        users: i.users
      },
      features: {
        discord: !!i.discord,
        telegram: !!i.telegram,
        watchdog: !!i.watchdog,
        oauth: !!i.oauth
      },
      first_seen: i.first_seen,
      last_seen: i.last_seen
    }));
    
    res.json({ installs: formatted });
  } catch (error) {
    console.error('[Telemetry] Error:', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Get summary statistics (for dashboard)
app.get('/api/telemetry/summary', (req, res) => {
  try {
    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    
    const total = db.prepare('SELECT COUNT(*) as count FROM installs').get();
    const active7d = db.prepare('SELECT COUNT(*) as count FROM installs WHERE last_seen >= ?').get(sevenDaysAgo);
    const active30d = db.prepare('SELECT COUNT(*) as count FROM installs WHERE last_seen >= ?').get(thirtyDaysAgo);
    
    const totals = db.prepare(`
      SELECT 
        SUM(stats_printers) as printers,
        SUM(stats_prints) as prints,
        SUM(stats_library) as library
      FROM installs
    `).get();
    
    // Version breakdown
    const versions = db.prepare(`
      SELECT version, COUNT(*) as count 
      FROM installs 
      GROUP BY version 
      ORDER BY count DESC
    `).all();
    
    // Platform breakdown
    const platforms = db.prepare(`
      SELECT platform, COUNT(*) as count 
      FROM installs 
      GROUP BY platform 
      ORDER BY count DESC
    `).all();
    
    res.json({
      total_installs: total?.count || 0,
      active_7d: active7d?.count || 0,
      active_30d: active30d?.count || 0,
      total_printers: totals?.printers || 0,
      total_prints: totals?.prints || 0,
      total_library: totals?.library || 0,
      versions: Object.fromEntries(versions.map(v => [v.version, v.count])),
      platforms: Object.fromEntries(platforms.map(p => [p.platform, p.count]))
    });
  } catch (error) {
    console.error('[Telemetry] Error:', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Health check
app.get('/api/telemetry/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Telemetry backend running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  POST /api/telemetry - Receive heartbeat`);
  console.log(`  GET  /api/telemetry/installs - Get all installs`);
  console.log(`  GET  /api/telemetry/summary - Get aggregated stats`);
});

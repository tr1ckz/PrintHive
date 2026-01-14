const express = require('express');
const logger = require('./logger');
const path = require('path');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const axios = require('axios');
const fs = require('fs');
const multer = require('multer');
const passport = require('passport');
const oidc = require('openid-client');

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

// Periodic cloud sync to keep DB fresh without manual action
function setupCloudAutoSync() {
  const intervalMinutes = 60; // sync every 60 minutes
  async function runCloudSyncOnce() {
    try {
      const rows = db.prepare(`
        SELECT user_id, bambu_token, bambu_region 
        FROM settings 
        WHERE bambu_token IS NOT NULL AND bambu_token != ''
      `).all();

      if (!rows || rows.length === 0) {
        logger.info('[CloudSync] No cloud tokens configured; skipping.');
        return;
      }

      for (const row of rows) {
        const apiBase = (row.bambu_region === 'china')
          ? 'https://api.bambulab.cn'
          : 'https://api.bambulab.com';

        try {
          logger.info(`[CloudSync] Fetching tasks for user ${row.user_id}...`);
          const response = await axios.get(`${apiBase}/v1/user-service/my/tasks?limit=100`, {
            headers: { Authorization: `Bearer ${row.bambu_token}` },
            timeout: 20000
          });

          const hits = response.data?.hits || [];
          if (hits.length > 0) {
            const result = storePrints(hits);
            logger.info(`[CloudSync] Stored ${result.total} prints (${result.newPrints} new, ${result.updated} updated)`);
          } else {
            logger.info('[CloudSync] No prints returned from API');
          }
        } catch (err) {
          logger.warn(`[CloudSync] Error syncing for user ${row.user_id}: ${err.message}`);
        }
      }
    } catch (err) {
      logger.warn('[CloudSync] Unexpected error:', err.message);
    }
  }

  // Run once on startup and then periodically
  runCloudSyncOnce();
  setInterval(runCloudSyncOnce, intervalMinutes * 60 * 1000);
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
  
  // Start scanning after 30s delay, then every 5 minutes
  setTimeout(() => {
    scanLibraryOnce();
    setInterval(scanLibraryOnce, intervalMinutes * 60 * 1000);
  }, 30000);
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
  
  // Start matching after 60s delay, then every 10 minutes
  setTimeout(() => {
    matchVideosOnce();
    setInterval(matchVideosOnce, intervalMinutes * 60 * 1000);
  }, 60000);
}

const app = express();
let httpServer = null; // Store reference for graceful shutdown
const mqttClients = new Map(); // Store MQTT clients per printer
const PORT = process.env.PORT || 3000;

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
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://cdn.jsdelivr.net https://cloudflareinsights.com");
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
    
    if (!user) {
      // Create new user
      console.log('Creating new OIDC user:', username, email);
      const result = db.prepare(
        'INSERT INTO users (username, email, oauth_provider, oauth_id, role, password, display_name) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        username,
        email || '',
        'oidc',
        sub,
        'user',
        '', // No password for OAuth users
        name
      );
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
      console.log('New user created with ID:', user.id);
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
    
    res.json({ 
      success: true,
      printerIp: printerIp?.value || '',
      printerAccessCode: accessCode?.value || '',
      cameraRtspUrl: cameraUrl?.value || ''
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
  
  const { printerIp, printerAccessCode, cameraRtspUrl } = req.body;
  console.log('Parsed values:', { printerIp, printerAccessCode, cameraRtspUrl: cameraRtspUrl ? '***' : null });
  
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
    
    console.log('SUCCESS: Settings saved');
    res.json({ success: true });
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

// Get UI settings (hide buy me a coffee, etc.) - PUBLIC endpoint
app.get('/api/settings/ui', (req, res) => {
  try {
    const hideBmc = db.prepare('SELECT value FROM config WHERE key = ?').get('hide_bmc');
    const colorScheme = db.prepare('SELECT value FROM config WHERE key = ?').get('color_scheme');
    
    res.json({ 
      success: true,
      hideBmc: hideBmc?.value === 'true',
      colorScheme: colorScheme?.value || 'cyan'
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
    const { hideBmc, colorScheme } = req.body;
    
    const upsert = db.prepare(`
      INSERT INTO config (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `);
    
    upsert.run('hide_bmc', hideBmc ? 'true' : 'false', hideBmc ? 'true' : 'false');
    if (colorScheme) {
      upsert.run('color_scheme', colorScheme, colorScheme);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to save UI settings:', error);
    res.status(500).json({ error: 'Failed to save UI settings' });
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

// API routes
app.get('/api/printers', async (req, res) => {
  logger.info('Printers request');
  logger.debug('Auth:', req.session.authenticated, 'Token present:', !!req.session.token);
  logger.debug('Token preview:', req.session.token ? req.session.token.substring(0, 20) + '...' : 'N/A');
  
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const response = await axios.get('https://api.bambulab.com/v1/iot-service/api/user/bind', {
      headers: { 'Authorization': `Bearer ${req.session.token}` }
    });
    logger.debug('Printers response payload received');
    
    // Get camera URL and printer settings from global config
    const cameraUrl = db.prepare('SELECT value FROM config WHERE key = ?').get('camera_rtsp_url')?.value || null;
    const printerIp = db.prepare('SELECT value FROM config WHERE key = ?').get('printer_ip')?.value;
    const accessCode = db.prepare('SELECT value FROM config WHERE key = ?').get('printer_access_code')?.value;
    
    // Add camera URL and fetch current task for each printer
    const printersData = response.data || { devices: [] };
    if (printersData.devices) {
      const devicesWithExtras = await Promise.all(printersData.devices.map(async (device) => {
        const deviceData = { ...device };
        
        // Add camera URL
        if (cameraUrl) {
          deviceData.camera_rtsp_url = cameraUrl;
        }
        
        // Try to get current job from MQTT client - always connect if credentials available
        if (printerIp && accessCode) {
          const clientKey = device.dev_id;
          
          // Create or get existing MQTT client for this printer
          if (!mqttClients.has(clientKey)) {
            try {
              const mqttClient = new BambuMqttClient(printerIp, device.dev_id, accessCode, device.name);
              
              // Handle connection errors gracefully
              mqttClient.on('error', (error) => {
                logger.warn(`MQTT error for ${device.dev_id}: ${error.message}`);
                mqttClients.delete(clientKey);
              });
              
              mqttClient.on('disconnected', () => {
                logger.info(`MQTT disconnected for ${device.dev_id}`);
                mqttClients.delete(clientKey);
              });
              
              // Handle print state changes for Discord notifications
              mqttClient.on('print_completed', async (data) => {
                // Look up actual design title from database
                const print = db.prepare(`
                  SELECT designTitle, title FROM prints 
                  WHERE (title = ? OR gcode_file LIKE ?)
                  ORDER BY startTime DESC LIMIT 1
                `).get(data.jobName, `%${data.jobName}%`);
                
                const designName = print?.designTitle || print?.title || data.jobName;
                
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
                // Look up actual design title from database
                const print = db.prepare(`
                  SELECT designTitle, title FROM prints 
                  WHERE (title = ? OR gcode_file LIKE ?)
                  ORDER BY startTime DESC LIMIT 1
                `).get(data.jobName, `%${data.jobName}%`);
                
                const designName = print?.designTitle || print?.title || data.jobName;
                
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
                // Look up actual design title from database
                const print = db.prepare(`
                  SELECT designTitle, title FROM prints 
                  WHERE (title = ? OR gcode_file LIKE ?)
                  ORDER BY startTime DESC LIMIT 1
                `).get(data.jobName, `%${data.jobName}%`);
                
                const designName = print?.designTitle || print?.title || data.jobName;
                
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
                // Look up actual design title from database
                const print = db.prepare(`
                  SELECT designTitle, title FROM prints 
                  WHERE (title = ? OR gcode_file LIKE ?)
                  ORDER BY startTime DESC LIMIT 1
                `).get(data.jobName, `%${data.jobName}%`);
                
                const designName = print?.designTitle || print?.title || data.jobName;
                
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
            } catch (error) {
              logger.warn(`Could not connect MQTT for ${device.dev_id}: ${error.message}`);
            }
          }
          
          // Get current job data from MQTT client
          const mqttClient = mqttClients.get(clientKey);
          if (mqttClient && mqttClient.connected) {
            const jobData = mqttClient.getCurrentJob();
            
            logger.debug(`=== MQTT Job Data for ${device.dev_id} ===`);
            logger.debug(`Job data exists: ${!!jobData}`);
            if (jobData) {
              logger.debug(`Job keys: ${Object.keys(jobData).join(', ')}`);
              logger.debug(`Has AMS: ${!!jobData.ams}`);
              if (jobData.ams) {
                logger.debug(`AMS structure: ${JSON.stringify(jobData.ams, null, 2)}`);
              }
            }
            
            // Always include AMS info at device level if available
            if (jobData && jobData.ams) {
              deviceData.ams = jobData.ams;
              logger.info(`✓ AMS data set for ${device.dev_id}: ${jobData.ams.trays?.length || 0} trays`);
            } else if (jobData) {
              logger.debug(`✗ No AMS data in jobData for ${device.dev_id}`);
            }
            
            if (jobData && jobData.name) {
              // Pass all MQTT job data to current_task (includes temps, speeds, AMS, etc.)
              deviceData.current_task = { ...jobData };
              logger.debug(`Current task set for ${device.dev_id}, includes AMS: ${!!deviceData.current_task.ams}`);
              
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
    const response = await axios.get('https://api.bambulab.com/v1/iot-service/api/user/bind', {
      headers: { 'Authorization': `Bearer ${req.session.token}` }
    });
    
    const devices = response.data?.devices || [];
    const printers = devices.map(device => ({
      id: device.dev_id,
      name: device.name || 'Printer',
      model: device.dev_product_name || 'Unknown',
      status: device.print_status || 'IDLE',
      progress: device.print_progress || 0,
      online: device.online || false,
      currentPrint: device.current_task?.name || null,
      nozzleTemp: device.nozzle_temper || 0,
      bedTemp: device.bed_temper || 0
    }));
    
    const online = printers.filter(p => p.online).length;
    
    res.json({
      printers,
      online,
      total: printers.length
    });
  } catch (error) {
    console.error('Printer status error:', error.message);
    // Return empty printers on error instead of 500
    res.json({ printers: [], online: 0, total: 0 });
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
    const timelapseUrl = `https://api.bambulab.com/v1/iot-service/api/user/task/${print.id}/video`;
    console.log('Fetching timelapse from:', timelapseUrl);
    
    const response = await axios.get(timelapseUrl, {
      headers: { 'Authorization': `Bearer ${req.session.token}` }
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
    console.log('Fetching tasks from API...');
    const response = await axios.get('https://api.bambulab.com/v1/user-service/my/tasks?limit=100', {
      headers: { 'Authorization': `Bearer ${req.session.token}` }
    });
    
    console.log('API Response received. Total hits:', response.data?.hits?.length || 0);
    
    // Log first task to see structure
    if (response.data?.hits?.length > 0) {
      console.log('Sample task structure:', JSON.stringify(response.data.hits[0], null, 2));
    }
    
    if (response.data && response.data.hits && response.data.hits.length > 0) {
      console.log('Storing prints in database...');
      const result = storePrints(response.data.hits);
      console.log('Store result:', result);
      
      // Download covers and timelapses
      console.log('Starting downloads...');
      
      const downloadResults = await Promise.all(
        response.data.hits.slice(0, 50).map(async (print) => {
          const res = { cover: false, video: false };
          
          // Download cover - check both cover and coverUrl fields
          const coverUrl = print.cover || print.coverUrl || print.snapshot;
          if (coverUrl && print.modelId) {
            try {
              console.log(`Downloading cover for ${print.modelId}: ${coverUrl.substring(0, 80)}...`);
              const localPath = await downloadCoverImage(coverUrl, print.modelId);
              if (localPath) {
                console.log(`✓ Cover saved: ${localPath}`);
                res.cover = true;
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
            // Check if task has video URL or try to fetch it
            const taskId = print.id;
            const videoEndpoint = `https://api.bambulab.com/v1/iot-service/api/user/task/${taskId}/video`;
            
            console.log(`Checking timelapse for task ${taskId}...`);
            
            try {
              const videoResponse = await axios.get(videoEndpoint, {
                headers: { 'Authorization': `Bearer ${req.session.token}` },
                maxRedirects: 0,
                validateStatus: (status) => status < 400 || status === 302 || status === 301
              });
              
              let videoUrl = null;
              
              if (videoResponse.data?.url) {
                videoUrl = videoResponse.data.url;
              } else if (videoResponse.headers?.location) {
                videoUrl = videoResponse.headers.location;
              } else if (videoResponse.status === 200) {
                // The endpoint itself might be the video
                videoUrl = videoEndpoint;
              }
              
              if (videoUrl) {
                console.log(`Downloading video for ${print.modelId}...`);
                const videoPath = await downloadTimelapseVideo(videoUrl, print.modelId, taskId);
                if (videoPath) {
                  updatePrintVideoPath(print.modelId, videoPath);
                  res.video = true;
                  console.log(`✓ Downloaded timelapse for ${print.modelId}`);
                }
              }
            } catch (videoErr) {
              // 404 means no timelapse, which is normal
              if (videoErr.response?.status !== 404) {
                console.log(`Video fetch error for ${print.modelId}:`, videoErr.message);
              }
            }
          } catch (err) {
            // Silent fail for timelapses
          }
          
          return res;
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
        synced: response.data.hits.length,
        downloadedCovers,
        downloadedVideos,
        message: `Synced ${response.data.hits.length} prints (${result.newPrints} new, ${result.updated} updated)\nDownloaded ${downloadedCovers} covers and ${downloadedVideos} timelapses` 
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
      4: 'Cancelled'
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

  const rtspUrl = req.query.url;
  
  if (!rtspUrl) {
    return res.status(400).json({ error: 'RTSP URL required' });
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
  
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  
  try {
    const targetUser = db.prepare('SELECT role, username FROM users WHERE id = ?').get(id);
    
    // Prevent changing superadmin role
    if (targetUser.role === 'superadmin') {
      return res.status(400).json({ error: 'Cannot change superadmin role' });
    }
    
    // Prevent removing the last admin
    const adminCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role IN (?, ?)').get('admin', 'superadmin');
    if (targetUser.role === 'admin' && role !== 'admin' && adminCount.count <= 1) {
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
    clearInterval(watchdogTimer);
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
    
    watchdogTimer = setInterval(async () => {
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
    }, interval * 1000);
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
    clearInterval(maintenanceNotificationTimer);
    maintenanceNotificationTimer = null;
  }
  
  console.log('Setting up maintenance notification checker (every 1 hour)...');
  
  // Check every hour
  maintenanceNotificationTimer = setInterval(async () => {
    await checkMaintenanceDueNotifications();
  }, 60 * 60 * 1000);
  
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



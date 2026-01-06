const express = require('express');
const path = require('path');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const axios = require('axios');
const fs = require('fs');
const multer = require('multer');
const passport = require('passport');
const oidc = require('openid-client');
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

const app = express();
const mqttClients = new Map(); // Store MQTT clients per printer
const PORT = process.env.PORT || 3000;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, libraryDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
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
    
    res.json({ 
      success: true,
      hideBmc: hideBmc?.value === 'true'
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
    const { hideBmc } = req.body;
    
    const upsert = db.prepare(`
      INSERT INTO config (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `);
    
    upsert.run('hide_bmc', hideBmc ? 'true' : 'false', hideBmc ? 'true' : 'false');
    
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

// Match videos to prints based on timestamp
app.post('/api/match-videos', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const fs = require('fs');
    const videosDir = path.join(__dirname, 'data', 'videos');
    
    // Get all video files
    const videoFiles = fs.existsSync(videosDir) 
      ? fs.readdirSync(videosDir).filter(f => f.endsWith('.avi') || f.endsWith('.mp4'))
      : [];
    
    // Debug: Log some sample startTime values from prints
    const samplePrints = db.prepare('SELECT id, title, startTime FROM prints WHERE startTime IS NOT NULL LIMIT 5').all();
    console.log('Sample print startTime values:');
    samplePrints.forEach(p => console.log(`  Print ${p.id}: ${p.startTime}`));
    
    let matched = 0;
    let unmatched = 0;
    const matchDetails = [];
    
    for (const videoFile of videoFiles) {
      // Extract timestamp from filename: video_2024-12-13_15-18-02.avi
      const match = videoFile.match(/video_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
      
      if (match) {
        const [, date, hours, minutes, seconds] = match;
        // Video timestamp in ISO format: 2024-12-13T15:18:02
        const videoTimestamp = `${date}T${hours}:${minutes}:${seconds}`;
        
        console.log(`Matching video ${videoFile} with timestamp ${videoTimestamp}`);
        
        // First try exact-ish match (within 2 hour window)
        let print = db.prepare(`
          SELECT id, modelId, title, startTime, endTime
          FROM prints
          WHERE videoLocal IS NULL
            AND startTime IS NOT NULL
            AND (
              -- Video timestamp is within 2 hours of print start
              datetime(startTime) >= datetime(?, '-2 hours')
              AND datetime(startTime) <= datetime(?, '+2 hours')
            )
          ORDER BY ABS(julianday(startTime) - julianday(?))
          LIMIT 1
        `).get(videoTimestamp, videoTimestamp, videoTimestamp);
        
        // If no match with ISO format, try with space instead of T
        if (!print) {
          const videoTimestampSpace = `${date} ${hours}:${minutes}:${seconds}`;
          print = db.prepare(`
            SELECT id, modelId, title, startTime, endTime
            FROM prints
            WHERE videoLocal IS NULL
              AND startTime IS NOT NULL
              AND (
                datetime(startTime) >= datetime(?, '-2 hours')
                AND datetime(startTime) <= datetime(?, '+2 hours')
              )
            ORDER BY ABS(julianday(startTime) - julianday(?))
            LIMIT 1
          `).get(videoTimestampSpace, videoTimestampSpace, videoTimestampSpace);
        }
        
        if (print) {
          db.prepare('UPDATE prints SET videoLocal = ? WHERE id = ?').run(videoFile, print.id);
          matched++;
          matchDetails.push({ video: videoFile, print: print.title || print.modelId, printStart: print.startTime });
          console.log(`  Matched to print: ${print.title || print.modelId} (startTime: ${print.startTime})`);
        } else {
          unmatched++;
          console.log(`  No matching print found`);
        }
      } else {
        unmatched++;
        console.log(`  Could not parse timestamp from: ${videoFile}`);
      }
    }
    
    res.json({ 
      success: true, 
      matched, 
      unmatched,
      total: videoFiles.length,
      details: matchDetails
    });
  } catch (error) {
    console.error('Match videos error:', error);
    res.status(500).json({ error: 'Failed to match videos' });
  }
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
  console.log('=== PRINTERS REQUEST ===');
  console.log('Authenticated:', req.session.authenticated);
  console.log('Token:', req.session.token ? 'Present' : 'Missing');
  console.log('Token preview:', req.session.token ? req.session.token.substring(0, 20) + '...' : 'N/A');
  
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const response = await axios.get('https://api.bambulab.com/v1/iot-service/api/user/bind', {
      headers: { 'Authorization': `Bearer ${req.session.token}` }
    });
    console.log('Printers response:', JSON.stringify(response.data, null, 2));
    
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
        
        // Try to get current job from MQTT client if printer is running
        if (device.print_status === 'RUNNING' && printerIp && accessCode) {
          const clientKey = device.dev_id;
          
          // Create or get existing MQTT client for this printer
          if (!mqttClients.has(clientKey)) {
            try {
              const mqttClient = new BambuMqttClient(printerIp, device.dev_id, accessCode);
              
              // Handle connection errors gracefully
              mqttClient.on('error', (error) => {
                console.log(`MQTT error for ${device.dev_id}:`, error.message);
                mqttClients.delete(clientKey);
              });
              
              mqttClient.on('disconnected', () => {
                console.log(`MQTT disconnected for ${device.dev_id}`);
                mqttClients.delete(clientKey);
              });
              
              await mqttClient.connect();
              mqttClients.set(clientKey, mqttClient);
              console.log(`Created MQTT client for ${device.dev_id}`);
            } catch (error) {
              console.log(`Could not connect MQTT for ${device.dev_id}:`, error.message);
            }
          }
          
          // Get current job data from MQTT client
          const mqttClient = mqttClients.get(clientKey);
          if (mqttClient && mqttClient.connected) {
            const jobData = mqttClient.getCurrentJob();
            if (jobData) {
              deviceData.current_task = {
                name: jobData.name,
                progress: jobData.progress,
                remaining_time: jobData.remaining_time,
                end_time: jobData.end_time,
                layer_num: jobData.layer_num,
                total_layers: jobData.total_layers
              };
              
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
                  console.log(`Found 3MF for current job: ${file3mf.modelId}`);
                }
              }
              
              // Use integrated P1S camera RTSP URL if available from MQTT
              if (jobData.rtsp_url && !deviceData.camera_rtsp_url) {
                deviceData.camera_rtsp_url = jobData.rtsp_url;
              }
              console.log(`Got job data via MQTT for ${device.dev_id}`);
            }
          }
        }
        
        return deviceData;
      }));
      
      printersData.devices = devicesWithExtras;
    }
    
    res.json(printersData);
  } catch (error) {
    console.error('Printers error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch printers', details: error.response?.data });
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
      return res.status(404).json({ error: 'Printer settings not configured' });
    }
    
    // Get MQTT client for this printer
    const mqttClient = mqttClients.get(dev_id);
    if (!mqttClient || !mqttClient.connected) {
      return res.status(503).json({ error: 'Printer not connected' });
    }
    
    // Get current job data
    const jobData = mqttClient.getCurrentJob();
    if (!jobData || !jobData.gcode_file) {
      return res.status(404).json({ error: 'No active print job' });
    }
    
    // Fetch cover image from 3MF file
    const base64Image = await coverImageFetcher.fetchCoverImage(
      printerIp,
      accessCode,
      jobData.gcode_file,
      jobData.subtask_name
    );
    
    if (!base64Image) {
      return res.status(404).json({ error: 'Cover image not found' });
    }
    
    // Decode base64 and send as image
    const imageBuffer = Buffer.from(base64Image, 'base64');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.send(imageBuffer);
  } catch (error) {
    console.error('Cover image error:', error);
    res.status(500).json({ error: 'Failed to fetch cover image', details: error.message });
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
      console.log(`Found ${dbPrints.length} prints in database`);
      return res.json({ models: dbPrints, hits: dbPrints, total: dbPrints.length, source: 'db' });
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
        console.log(`Returning ${dbPrints.length} prints from database cache`);
        return res.json({ models: dbPrints, hits: dbPrints, total: dbPrints.length, source: 'cache' });
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
      console.log(`Returning ${dbPrints.length} prints from database`);
      return res.json({ hits: dbPrints, total: dbPrints.length, source: 'cache' });
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
  
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const print = getPrintByModelIdFromDb(req.params.modelId);
    if (!print) {
      return res.status(404).json({ error: 'Print not found' });
    }
    
    // Check if we have a local video file first
    if (print.videoLocal) {
      const localVideoPath = path.join(videosDir, print.videoLocal);
      console.log('Checking for local video:', localVideoPath);
      
      if (fs.existsSync(localVideoPath)) {
        console.log('Found local AVI, converting to MP4...');
        
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
          
          // Download cover
          if (print.cover && print.modelId) {
            try {
              const localPath = await downloadCoverImage(print.cover, print.modelId);
              if (localPath) res.cover = true;
            } catch (err) {
              console.log(`Cover download failed for ${print.modelId}`);
            }
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
    const fileId = req.params.id;
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

app.get('/api/library/download/:id', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const file = db.prepare('SELECT * FROM library WHERE id = ?').get(req.params.id);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    const filePath = path.join(libraryDir, file.fileName);
    
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
              filename: f.originalName,
              filesize: f.fileSize,
              filetype: f.fileType,
              upload_date: f.createdAt,
              description: f.description,
              tags: ''
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
              filename: f.originalName,
              filesize: f.fileSize,
              filetype: f.fileType,
              upload_date: f.createdAt,
              description: f.description,
              tags: ''
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

    // Delete file from disk
    const filePath = path.join(libraryDir, file.fileName);
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

    // Check if file exists
    const file = db.prepare('SELECT id FROM library WHERE id = ?').get(fileId);
    console.log('File found:', !!file);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Update description
    db.prepare('UPDATE library SET description = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?')
      .run(description || '', fileId);

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

// Auto-tag endpoint - analyzes file and suggests description/tags
app.post('/api/library/:id/auto-tag', async (req, res) => {
  try {
    const fileId = parseInt(req.params.id);
    console.log(`=== AUTO-TAG REQUEST for file ${fileId} ===`);
    
    // Get file info
    const file = db.prepare('SELECT * FROM library WHERE id = ?').get(fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    console.log(`  Analyzing: ${file.originalName}`);
    
    // Build correct file path using fileName (stored path may be outdated)
    const actualFilePath = path.join(libraryDir, file.fileName);
    console.log(`  File path: ${actualFilePath}`);
    
    // Check if file exists
    if (!fs.existsSync(actualFilePath)) {
      console.log(`  ERROR: File not found at ${actualFilePath}`);
      return res.status(404).json({ error: 'File not found on disk' });
    }
    
    // Run auto-analysis
    const analysis = await autoDescribeModel(actualFilePath, file.originalName);
    
    console.log(`  Auto-generated description: ${analysis.description}`);
    console.log(`  Auto-generated tags: ${analysis.tags.join(', ')}`);
    
    res.json({
      success: true,
      description: analysis.description,
      tags: analysis.tags,
      metadata: analysis.metadata
    });
  } catch (error) {
    console.error('Auto-tag error:', error);
    res.status(500).json({ error: 'Failed to auto-tag file: ' + error.message });
  }
});

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

// Auto-tag all library files
app.post('/api/library/auto-tag-all', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    // Get all library items
    const items = db.prepare('SELECT * FROM library').all();
    
    console.log(`=== AUTO-TAG ALL: Processing ${items.length} files ===`);
    
    let processed = 0;
    let updated = 0;
    let errors = 0;
    
    for (const file of items) {
      try {
        processed++;
        console.log(`  [${processed}/${items.length}] Analyzing: ${file.originalName}`);
        
        // Build correct file path using fileName (stored path may be outdated)
        const actualFilePath = path.join(libraryDir, file.fileName);
        
        // Skip if file doesn't exist
        if (!fs.existsSync(actualFilePath)) {
          console.log(`    File not found: ${actualFilePath}`);
          errors++;
          continue;
        }
        
        // Run auto-analysis
        const analysis = await autoDescribeModel(actualFilePath, file.originalName);
        
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
        
        updated++;
      } catch (err) {
        console.error(`  Error processing ${file.originalName}:`, err.message);
        errors++;
      }
    }
    
    console.log(`=== AUTO-TAG ALL COMPLETE: ${updated} updated, ${errors} errors ===`);
    
    res.json({ 
      success: true, 
      message: `Processed ${processed} files: ${updated} updated, ${errors} errors`,
      processed,
      updated,
      errors
    });
  } catch (error) {
    console.error('Auto-tag all error:', error);
    res.status(500).json({ error: 'Failed to auto-tag all files' });
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

// Scan library folder endpoint - recursively scans the library directory for new files
app.post('/api/library/scan', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    console.log(`Scanning library directory: ${libraryDir}`);
    const allFiles = walkDirectory(libraryDir);
    console.log(`Found ${allFiles.length} total files in library`);
    
    let added = 0;
    let skipped = 0;
    const extractionQueue = [];

    for (const filePath of allFiles) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.3mf' || ext === '.stl' || ext === '.gcode') {
        const fileName = path.basename(filePath);
        const relativePath = path.relative(__dirname, filePath);
        
        // Check if already exists in database by file path
        const existing = db.prepare('SELECT id FROM library WHERE filePath = ?').get(relativePath);
        
        if (!existing) {
          const stats = fs.statSync(filePath);
          const fileType = ext.substring(1);

          const result = db.prepare(`
            INSERT INTO library (fileName, originalName, fileType, fileSize, filePath, description, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(fileName, fileName, fileType, stats.size, relativePath, '', '');
          
          added++;
          console.log(`  Added: ${relativePath}`);
          
          // Queue for geometry extraction
          if (fileType === '3mf' || fileType === 'stl') {
            extractionQueue.push({ id: result.lastInsertRowid, path: filePath, type: fileType });
          }
        } else {
          skipped++;
        }
      }
    }

    console.log(`Scan complete: ${added} added, ${skipped} skipped`);

    // Trigger background extraction for all new files
    if (extractionQueue.length > 0) {
      setImmediate(() => {
        console.log(`Extracting geometry for ${extractionQueue.length} file(s)...`);
        extractionQueue.forEach(({ id, path, type }) => {
          extractGeometry(id, path, type).catch(err => {
            console.error(`Failed to extract geometry for file ${id}:`, err.message);
          });
        });
      });
    }

    res.json({ success: true, added, skipped, total: allFiles.length });
  } catch (error) {
    console.error('Scan error:', error.message);
    res.status(500).json({ error: 'Failed to scan folder' });
  }
});

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

  // For RTSP streams, use ffmpeg via child_process for better control
  const { spawn } = require('child_process');
  const path = require('path');
  const fs = require('fs');
  
  const tempFile = path.join(__dirname, 'data', `camera-temp-${Date.now()}.jpg`);
  
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
  
  ffmpeg.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  ffmpeg.on('close', (code) => {
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
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Failed to run ffmpeg',
        details: err.message 
      });
    }
  });

  // Timeout after 15 seconds
  setTimeout(() => {
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
  res.json({ success: true, message: 'Application will restart in 2 seconds...' });
  
  // Give time for response to be sent
  setTimeout(() => {
    console.log('Restarting application...');
    // Use exit code 1 to ensure Docker restarts the container
    // exit code 0 might be treated as intentional stop with "unless-stopped" policy
    process.exit(1);
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

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Database: SQLite (data/bambu.db)');
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
  
  // Initialize watchdog
  setupWatchdog();
  
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
  } catch (err) {
    console.error('Error scanning library:', err.message);
  }
  console.log('=== Library scan complete ===\n');
  
  // Pre-generate thumbnails on startup
  await generateAllThumbnails();
});

// Cleanup on shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  
  // Disconnect all MQTT clients
  for (const [key, client] of mqttClients.entries()) {
    console.log(`Disconnecting MQTT client for ${key}`);
    client.disconnect();
  }
  mqttClients.clear();
  
  process.exit(0);
});



const express = require('express');
const path = require('path');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const axios = require('axios');
const fs = require('fs');
const multer = require('multer');
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
  secret: 'simple-secret',
  resave: false,  // Don't save session if unmodified
  saveUninitialized: false,  // Don't create session until something stored
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    secure: false,
    httpOnly: true
  }
}));

// Serve static files
const staticDir = process.env.NODE_ENV === 'production' ? 'dist' : 'public';
app.use(express.static(staticDir));

// Logo routes
app.get('/favicon.svg', (req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'logo.png'));
});
app.get('/logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'logo.png'));
});

// Buy Me a Coffee brand assets
app.get('/data/bmc-brand-logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'bmc-brand-logo.png'));
});
app.get('/data/bmc-brand-logo.svg', (req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'bmc-brand-logo.svg'));
});
app.get('/data/bmc-brand-icon.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'bmc-brand-icon.png'));
});
app.get('/data/bmc-brand-icon.svg', (req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'bmc-brand-icon.svg'));
});

// Cover images route
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

// Middleware to ensure Bambu token is loaded from database
app.use((req, res, next) => {
  if (req.session.authenticated && req.session.userId && !req.session.token) {
    try {
      const settings = db.prepare('SELECT bambu_token, bambu_region FROM settings WHERE user_id = ?').get(req.session.userId);
      if (settings && settings.bambu_token) {
        req.session.token = settings.bambu_token;
        req.session.region = settings.bambu_region || 'global';
      }
    } catch (error) {
      console.error('Failed to reload Bambu token:', error);
    }
  }
  next();
});

// Main route
app.get('/', (req, res) => {
  const staticDir = process.env.NODE_ENV === 'production' ? 'dist' : 'public';
  res.sendFile(path.join(__dirname, staticDir, 'index.html'));
});

// Simple local login
app.post('/auth/login', async (req, res) => {
  console.log('=== LOGIN REQUEST RECEIVED ===');
  const { username, password } = req.body;
  
  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, password);
    
    if (user) {
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.role = user.role || 'user';
      req.session.authenticated = true;
      
      // Load Bambu credentials if they exist
      const settings = db.prepare('SELECT bambu_token, bambu_region FROM settings WHERE user_id = ?').get(user.id);
      if (settings && settings.bambu_token) {
        req.session.token = settings.bambu_token;
        req.session.region = settings.bambu_region || 'global';
      }
      
      req.session.save((err) => {
        if (err) console.error('Session save error:', err);
      });
      
      res.json({ success: true });
    } else {
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
    const settings = db.prepare('SELECT bambu_email, bambu_region, updated_at FROM settings WHERE user_id = ?').get(req.session.userId);
    
    res.json({
      connected: !!req.session.token,
      email: settings?.bambu_email || null,
      region: settings?.bambu_region || 'global',
      lastUpdated: settings?.updated_at || null
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
    db.prepare('DELETE FROM settings WHERE user_id = ?').run(req.session.userId);
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
    const settings = db.prepare('SELECT printer_ip, printer_access_code, camera_rtsp_url FROM settings WHERE user_id = ?').get(req.session.userId);
    
    res.json({ 
      success: true,
      printerIp: settings?.printer_ip || '',
      printerAccessCode: settings?.printer_access_code || '',
      cameraRtspUrl: settings?.camera_rtsp_url || ''
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
    // Check if settings exist
    const existing = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.session.userId);
    console.log('Existing settings:', existing ? 'Found' : 'Not found');
    
    if (existing) {
      // Update existing settings
      console.log('Updating existing settings...');
      const result = db.prepare('UPDATE settings SET printer_ip = ?, printer_access_code = ?, camera_rtsp_url = ? WHERE user_id = ?')
        .run(printerIp || null, printerAccessCode || null, cameraRtspUrl || null, req.session.userId);
      console.log('Update result:', result);
    } else {
      // Insert new settings
      console.log('Inserting new settings...');
      const result = db.prepare('INSERT INTO settings (user_id, printer_ip, printer_access_code, camera_rtsp_url) VALUES (?, ?, ?, ?)')
        .run(req.session.userId, printerIp || null, printerAccessCode || null, cameraRtspUrl || null);
      console.log('Insert result:', result);
    }
    
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
  
  // If not provided in request, use DB credentials
  if (!printerIp || !printerAccessCode) {
    try {
      const settings = db.prepare('SELECT printer_ip, printer_access_code FROM settings WHERE user_id = ?').get(req.session.userId);
      printerIp = printerIp || settings?.printer_ip;
      printerAccessCode = printerAccessCode || settings?.printer_access_code;
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
    
    let matched = 0;
    let unmatched = 0;
    
    for (const videoFile of videoFiles) {
      // Extract timestamp from filename: video_2025-12-01_22-16-41.avi
      const match = videoFile.match(/video_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
      
      if (match) {
        const [, date, hours, minutes, seconds] = match;
        const videoTimestamp = `${date} ${hours}:${minutes}:${seconds}`;
        
        // Find print with closest timestamp
        // Video can start up to 10 minutes after print start (bed leveling delay)
        // Allow up to 24 hours before for local-only prints
        const result = db.prepare(`
          UPDATE prints 
          SET videoLocal = ? 
          WHERE videoLocal IS NULL
            AND datetime(startTime) <= datetime(?, '+10 minutes')
            AND datetime(startTime) >= datetime(?, '-24 hours')
          ORDER BY abs(julianday(startTime) - julianday(?))
          LIMIT 1
        `).run(videoFile, videoTimestamp, videoTimestamp, videoTimestamp);
        
        if (result.changes > 0) {
          matched++;
        } else {
          unmatched++;
        }
      }
    }
    
    res.json({ 
      success: true, 
      matched, 
      unmatched,
      total: videoFiles.length 
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
  console.log('Authenticated:', req.session.authenticated);
  console.log('Has token:', !!req.session.token);
  
  if (req.session.authenticated) {
    res.json({ 
      authenticated: true, 
      username: req.session.username,
      role: req.session.role || 'user'
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Logout endpoint
app.post('/auth/logout', (req, res) => {
  console.log('=== LOGOUT ===');
  console.log('Session ID:', req.sessionID);
  
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
      res.json({ success: false, error: 'Failed to logout' });
    } else {
      res.json({ success: true });
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
    
    // Get camera URL from settings
    const settings = db.prepare('SELECT camera_rtsp_url, printer_ip, printer_access_code FROM settings WHERE user_id = ?').get(req.session.userId);
    const cameraUrl = settings?.camera_rtsp_url || null;
    const printerIp = settings?.printer_ip;
    const accessCode = settings?.printer_access_code;
    
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
    // Get printer settings from database
    const settings = db.prepare('SELECT printer_ip, printer_access_code FROM settings WHERE id = 1').get();
    
    if (!settings || !settings.printer_ip || !settings.printer_access_code) {
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
      settings.printer_ip,
      settings.printer_access_code,
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

    // Save printer credentials for future use
    try {
      db.prepare(`
        UPDATE settings 
        SET printer_ip = ?, printer_access_code = ? 
        WHERE user_id = ?
      `).run(printerIp, accessCode, req.session.userId);
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

    prints.forEach(print => {
      // Status counts - convert numeric to descriptive
      if (print.status !== null && print.status !== undefined) {
        const statusNum = typeof print.status === 'string' ? parseInt(print.status) : print.status;
        const statusStr = statusNum === 2 ? 'success' : 
                         statusNum === 3 ? 'failed' : 
                         statusNum === 1 ? 'running' : 'idle';
        stats.printsByStatus[statusStr] = (stats.printsByStatus[statusStr] || 0) + 1;
        if (print.status === 3) stats.failedPrints++; // status 3 = failed
      }

      // Printer counts
      if (print.deviceName) {
        stats.printsByPrinter[print.deviceName] = (stats.printsByPrinter[print.deviceName] || 0) + 1;
      }

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
    const files = db.prepare('SELECT * FROM library ORDER BY createdAt DESC').all();
    res.json(files);
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
    const groupBy = req.query.groupBy || 'hash';
    const files = db.prepare('SELECT * FROM library ORDER BY filename, id').all();
    
    const duplicates = [];
    
    if (groupBy === 'hash') {
      // Group by file hash (actual duplicate content detection)
      const groups = {};
      
      files.forEach(file => {
        if (!file.fileHash) return; // Skip files without hash
        
        if (!groups[file.fileHash]) {
          groups[file.fileHash] = [];
        }
        groups[file.fileHash].push(file);
      });
      
      // Filter groups with more than 1 file (true duplicates)
      Object.entries(groups).forEach(([hash, groupFiles]) => {
        if (groupFiles.length > 1) {
          duplicates.push({
            name: `${groupFiles[0].originalName || groupFiles[0].fileName}`,
            files: groupFiles,
            totalSize: groupFiles.reduce((sum, f) => sum + (f.fileSize || 0), 0),
            reason: 'Identical content'
          });
        }
      });
    } else if (groupBy === 'name') {
      // Group by similar filename (fuzzy matching)
      const groups = {};
      
      files.forEach(file => {
        if (!file.originalName && !file.fileName) return;
        
        const name = file.originalName || file.fileName;
        // More aggressive normalization: remove numbers, version info, parentheses
        const normalized = name
          .toLowerCase()
          .replace(/\s*\([^)]*\)/g, '') // Remove anything in parentheses
          .replace(/\s*v?\d+(\.\d+)*/g, '') // Remove version numbers
          .replace(/[-_\s]+/g, ' ') // Normalize separators to spaces
          .replace(/\.[^.]+$/, '') // Remove extension
          .trim();
        
        if (!groups[normalized]) {
          groups[normalized] = [];
        }
        groups[normalized].push(file);
      });
      
      // Filter groups with more than 1 file
      Object.entries(groups).forEach(([normalizedName, groupFiles]) => {
        if (groupFiles.length > 1) {
          duplicates.push({
            name: groupFiles[0].originalName || groupFiles[0].fileName,
            files: groupFiles,
            totalSize: groupFiles.reduce((sum, f) => sum + (f.fileSize || 0), 0),
            reason: 'Similar name'
          });
        }
      });
    } else if (groupBy === 'size') {
      // Group by exact file size
      const groups = {};
      
      files.forEach(file => {
        if (!file.fileSize) return;
        
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
            name: `${formatSize(bytes)}`,
            files: groupFiles,
            totalSize: groupFiles.reduce((sum, f) => sum + (f.fileSize || 0), 0),
            reason: 'Same size'
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

// Scan library folder endpoint - scans the library directory for new files
app.post('/api/library/scan', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const files = fs.readdirSync(libraryDir);
    let added = 0;
    const extractionQueue = [];

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (ext === '.3mf' || ext === '.stl' || ext === '.gcode') {
        // Check if already exists in database
        const existing = db.prepare('SELECT id FROM library WHERE fileName = ?').get(file);
        
        if (!existing) {
          const filePath = path.join(libraryDir, file);
          const stats = fs.statSync(filePath);
          const fileType = ext.substring(1);

          const result = db.prepare(`
            INSERT INTO library (fileName, originalName, fileType, fileSize, filePath, description, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(file, file, fileType, stats.size, filePath, '', '');
          
          added++;
          
          // Queue for geometry extraction
          if (fileType === '3mf' || fileType === 'stl') {
            extractionQueue.push({ id: result.lastInsertRowid, path: filePath, type: fileType });
          }
        }
      }
    }

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

    res.json({ success: true, added });
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

  try {
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    const path = require('path');
    const fs = require('fs');
    
    ffmpeg.setFfmpegPath(ffmpegPath);

    console.log('Attempting to capture frame from RTSP:', rtspUrl.replace(/:[^:@]*@/, ':***@'));
    
    // Create a temporary file path
    const tempFile = path.join(__dirname, 'data', `camera-temp-${Date.now()}.jpg`);
    
    // Try UDP first (more compatible), fallback to direct connection
    ffmpeg(rtspUrl)
      .inputOptions([
        '-rtsp_transport', 'udp',
        '-timeout', '10000000',
        '-analyzeduration', '1000000',
        '-probesize', '1000000'
      ])
      .outputOptions([
        '-vframes', '1',
        '-q:v', '3'
      ])
      .output(tempFile)
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine.replace(/:[^:@]*@/, ':***@'));
      })
      .on('end', () => {
        console.log('FFmpeg snapshot captured successfully');
        // Send the file
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        
        const stream = fs.createReadStream(tempFile);
        stream.pipe(res);
        stream.on('end', () => {
          // Clean up temp file
          fs.unlink(tempFile, (err) => {
            if (err) console.error('Failed to delete temp file:', err);
          });
        });
      })
      .on('error', (err, stdout, stderr) => {
        console.error('FFmpeg snapshot error:', err.message);
        if (stderr) {
          console.error('FFmpeg full stderr:', stderr);
        }
        
        // Clean up temp file if it exists
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
        
        if (!res.headersSent) {
          res.status(500).send('Failed to capture camera snapshot: ' + err.message);
        }
      })
      .run();
  } catch (error) {
    console.error('Camera snapshot error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to capture snapshot', details: error.message });
    }
  }
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
    // Try with email column, fall back without it if column doesn't exist
    let user;
    try {
      user = db.prepare('SELECT id, username, email, role FROM users WHERE id = ?').get(req.session.userId);
    } catch (e) {
      if (e.message.includes('no such column')) {
        user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.session.userId);
        user.email = null;
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
    db.prepare('DELETE FROM settings WHERE user_id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
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
  
  // Start background sync
  backgroundSync.start();
  
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

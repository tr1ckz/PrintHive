const bambuFtp = require('./bambuFtp');
const { db } = require('../../database');
const path = require('path');
const videoConverter = require('../../video-converter');
const fs = require('fs');

class BackgroundSyncService {
  constructor() {
    this.syncInterval = null;
    this.isRunning = false;
    this.syncIntervalMinutes = 30; // Sync every 30 minutes
  }

  /**
   * Start the background sync service
   */
  start() {
    if (this.isRunning) {
      console.log('Background sync already running');
      return;
    }

    console.log(`Starting background printer sync (every ${this.syncIntervalMinutes} minutes)...`);
    this.isRunning = true;

    // Run immediately on start
    this.runSync();

    // Then run periodically
    this.syncInterval = setInterval(() => {
      this.runSync();
    }, this.syncIntervalMinutes * 60 * 1000);
  }

  /**
   * Stop the background sync service
   */
  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.isRunning = false;
    console.log('Background printer sync stopped');
  }

  /**
   * Run a sync cycle for all configured printers
   */
  async runSync() {
    console.log(`\n[${new Date().toISOString()}] Running background printer sync...`);

    try {
      // Get all users with printer credentials
      const users = db.prepare(`
        SELECT user_id, printer_ip, printer_access_code 
        FROM settings 
        WHERE printer_ip IS NOT NULL 
          AND printer_access_code IS NOT NULL
          AND printer_ip != ''
          AND printer_access_code != ''
      `).all();

      if (users.length === 0) {
        console.log('No printer credentials configured. Skipping sync.');
        return;
      }

      console.log(`Found ${users.length} user(s) with printer credentials`);

      for (const user of users) {
        try {
          await this.syncUserPrinter(user);
        } catch (error) {
          console.error(`Failed to sync printer for user ${user.user_id}:`, error.message);
        }
      }

      console.log('Background sync completed\n');
    } catch (error) {
      console.error('Background sync error:', error);
    }
  }

  /**
   * Sync timelapses for a specific user's printer
   */
  async syncUserPrinter(user) {
    const { user_id, printer_ip, printer_access_code } = user;
    
    console.log(`  Syncing printer ${printer_ip} for user ${user_id}...`);

    // Connect to printer
    const connected = await bambuFtp.connect(printer_ip, printer_access_code);
    if (!connected) {
      console.log(`  ✗ Failed to connect to printer ${printer_ip}`);
      return;
    }

    // Download timelapses
    const videosDir = path.join(__dirname, '..', '..', 'data', 'videos');
    const downloaded = await bambuFtp.downloadAllTimelapses(videosDir);
    
    if (downloaded.length > 0) {
      const newVideos = downloaded.filter(d => !d.skipped).length;
      console.log(`  ✓ Synced ${downloaded.length} timelapse videos (${newVideos} new) from ${printer_ip}`);
    }

    // Download 3MF files from /model directory
    const modelsDir = path.join(__dirname, '..', '..', 'data', 'models');
    const downloaded3mf = await bambuFtp.downloadAll3mfFiles(modelsDir);
    
    // Also download 3MF files from /cache directory (current prints)
    const downloaded3mfCache = await bambuFtp.downloadAll3mfFiles(modelsDir, '/cache');
    
    const new3mfs = downloaded3mf.filter(d => !d.skipped).length + downloaded3mfCache.filter(d => !d.skipped).length;
    console.log(`  ✓ Synced ${downloaded3mf.length + downloaded3mfCache.length} 3MF files (${new3mfs} new) from ${printer_ip}`);

    // Disconnect from printer
    await bambuFtp.disconnect();

    // Convert existing AVI files to MP4
    console.log(`  Converting existing AVI files to MP4...`);
    if (fs.existsSync(videosDir)) {
      const aviFiles = fs.readdirSync(videosDir).filter(f => f.endsWith('.avi'));
      const mp4Files = fs.readdirSync(videosDir).filter(f => f.endsWith('.mp4'));
      
      let convertedCount = 0;
      for (const aviFile of aviFiles) {
        const aviPath = path.join(videosDir, aviFile);
        const mp4Path = aviPath.replace(/\.avi$/, '.mp4');
        
        // Skip if MP4 already exists
        if (fs.existsSync(mp4Path)) continue;
        
        try {
          await videoConverter.getMp4Path(aviPath);
          convertedCount++;
          console.log(`    ✓ Converted ${aviFile}`);
          
          // Match the video to a model immediately after conversion
          try {
            const modelId = videoConverter.matchVideoToModel(mp4Path, db);
            if (modelId) {
              console.log(`    ✓ Matched ${aviFile} to model ${modelId}`);
            }
          } catch (matchErr) {
            console.log(`    Warning: Could not match ${aviFile}: ${matchErr.message}`);
          }
        } catch (err) {
          console.log(`    Warning: Failed to convert ${aviFile}: ${err.message}`);
        }
      }
      
      // Also try to match existing MP4 files that might not be matched
      console.log(`  Matching existing MP4 files...`);
      let matchedCount = 0;
      for (const mp4File of mp4Files) {
        const mp4Path = path.join(videosDir, mp4File);
        
        // Check if this video is already matched
        const baseName = path.basename(mp4File, '.mp4');
        const existing = db.prepare(`
          SELECT modelId FROM prints WHERE videoPath LIKE ?
        `).get(`%${baseName}%`);
        
        if (existing) continue; // Already matched
        
        try {
          const modelId = videoConverter.matchVideoToModel(mp4Path, db);
          if (modelId) {
            matchedCount++;
            console.log(`    ✓ Matched ${mp4File} to model ${modelId}`);
          }
        } catch (matchErr) {
          // Silent - most videos may not have matching prints yet
        }
      }
      
      if (convertedCount > 0) {
        console.log(`  ✓ Converted ${convertedCount} video(s) to MP4`);
      } else {
        console.log(`  ✓ All videos already converted`);
      }
      if (matchedCount > 0) {
        console.log(`  ✓ Matched ${matchedCount} existing MP4 video(s)`);
      }
    }

    // Update database with new video paths
    for (const video of downloaded) {
      if (video.skipped) continue;

      try {
        // Try to match video to a print by timestamp
        // Video filename format: video_2025-12-01_22-16-41.avi
        const match = video.filename.match(/video_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
        
        if (match) {
          const [, date, hours, minutes, seconds] = match;
          const videoTimestamp = `${date} ${hours}:${minutes}:${seconds}`;
          
          // Find print with matching or close timestamp
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
          `).run(video.filename, videoTimestamp, videoTimestamp, videoTimestamp);
          
          if (result.changes > 0) {
            console.log(`    ✓ Linked ${video.filename} to print`);
          }
        }
      } catch (err) {
        console.log(`    Warning: Could not link video ${video.filename} to print:`, err.message);
      }
    }

    // Match 3MF files to prints by timestamp OR title
    const all3mfFiles = [...downloaded3mf, ...downloaded3mfCache];
    for (const model of all3mfFiles) {
      if (model.skipped) continue;

      try {
        // Extract base filename without extension and path
        const baseFilename = path.basename(model.filename, '.3mf');
        
        // Try timestamp matching first (for files with timestamps)
        const timestampMatch = baseFilename.match(/(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
        
        let print = null;
        
        if (timestampMatch) {
          // Match by timestamp
          const [, date, hours, minutes, seconds] = timestampMatch;
          const modelTimestamp = `${date} ${hours}:${minutes}:${seconds}`;
          
          print = db.prepare(`
            SELECT modelId
            FROM prints
            WHERE datetime(startTime) <= datetime(?, '+10 minutes')
              AND datetime(startTime) >= datetime(?, '-24 hours')
            ORDER BY abs(julianday(startTime) - julianday(?))
            LIMIT 1
          `).get(modelTimestamp, modelTimestamp, modelTimestamp);
          
          if (print) {
            console.log(`    ✓ Matched ${baseFilename} by timestamp`);
          }
        }
        
        // If no timestamp match, try matching by title (exact or fuzzy)
        if (!print) {
          // Try exact title match first
          print = db.prepare(`
            SELECT modelId, title
            FROM prints
            WHERE title = ?
            ORDER BY startTime DESC
            LIMIT 1
          `).get(baseFilename);
          
          if (print) {
            console.log(`    ✓ Matched ${baseFilename} by exact title`);
          } else {
            // Try fuzzy match - check if title contains the filename or vice versa
            print = db.prepare(`
              SELECT modelId, title
              FROM prints
              WHERE title LIKE ? OR ? LIKE '%' || title || '%'
              ORDER BY startTime DESC
              LIMIT 1
            `).get(`%${baseFilename}%`, baseFilename);
            
            if (print) {
              console.log(`    ✓ Matched ${baseFilename} to "${print.title}" by fuzzy match`);
            }
          }
        }
        
        if (print) {
          // Store 3MF in files table
          const stats = require('fs').statSync(model.path);
          db.prepare(`
            INSERT OR IGNORE INTO files (modelId, filename, filepath, filetype, filesize)
            VALUES (?, ?, ?, '3mf', ?)
          `).run(print.modelId, model.filename, model.path, stats.size);
          
          console.log(`    ✓ Linked ${model.filename} to print ${print.modelId}`);
        } else {
          console.log(`    ✗ No match found for ${baseFilename}`);
        }
      } catch (err) {
        console.log(`    Warning: Could not link 3MF ${model.filename} to print:`, err.message);
      }
    }
  }

  /**
   * Manually trigger a sync (useful for testing)
   */
  async triggerSync() {
    if (!this.isRunning) {
      console.log('Background sync is not running. Starting it...');
      this.start();
    } else {
      await this.runSync();
    }
  }
}

// Export singleton instance
module.exports = new BackgroundSyncService();

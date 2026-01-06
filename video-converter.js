const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const fs = require('fs');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Check if a file is still being written to (download in progress)
 * @param {string} filePath - Path to the file
 * @param {number} waitMs - Time to wait between size checks (default 2000ms)
 * @returns {Promise<boolean>} - True if file is stable, false if still being written
 */
async function isFileStable(filePath, waitMs = 2000) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  
  try {
    const stat1 = fs.statSync(filePath);
    const size1 = stat1.size;
    const mtime1 = stat1.mtimeMs;
    
    // Wait and check again
    await new Promise(resolve => setTimeout(resolve, waitMs));
    
    if (!fs.existsSync(filePath)) {
      return false;
    }
    
    const stat2 = fs.statSync(filePath);
    const size2 = stat2.size;
    const mtime2 = stat2.mtimeMs;
    
    // File is stable if size and mtime haven't changed
    const stable = size1 === size2 && mtime1 === mtime2;
    
    if (!stable) {
      console.log(`File still being written: ${path.basename(filePath)} (${size1} -> ${size2} bytes)`);
    }
    
    return stable;
  } catch (err) {
    console.error(`Error checking file stability: ${err.message}`);
    return false;
  }
}

/**
 * Wait for a file to finish downloading
 * @param {string} filePath - Path to the file
 * @param {number} maxWaitMs - Maximum time to wait (default 5 minutes)
 * @param {number} checkIntervalMs - Time between checks (default 2 seconds)
 * @returns {Promise<boolean>} - True if file is ready, false if timed out
 */
async function waitForFileReady(filePath, maxWaitMs = 300000, checkIntervalMs = 2000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    if (await isFileStable(filePath, checkIntervalMs)) {
      return true;
    }
    // Small additional delay between stability checks
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.warn(`Timed out waiting for file to be ready: ${path.basename(filePath)}`);
  return false;
}

/**
 * Convert AVI to MP4
 * @param {string} inputPath - Path to AVI file
 * @param {string} outputPath - Path to output MP4 file
 * @returns {Promise<string>} - Resolves with output path
 */
async function convertAviToMp4(inputPath, outputPath) {
  console.log(`Converting ${path.basename(inputPath)} to MP4...`);
  
  // Wait for file to be fully downloaded before converting
  console.log('  Checking if file is ready...');
  const isReady = await waitForFileReady(inputPath, 300000, 2000);
  
  if (!isReady) {
    throw new Error('File is still being written or timed out waiting');
  }
  
  console.log('  File is ready, starting conversion...');
  
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264',      // H.264 video codec
        '-preset fast',      // Fast encoding
        '-crf 23',           // Quality (lower = better, 18-28 is good)
        '-c:a aac',          // AAC audio codec
        '-b:a 128k',         // Audio bitrate
        '-movflags +faststart' // Enable streaming
      ])
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          process.stdout.write(`\r  Progress: ${progress.percent.toFixed(1)}%`);
        }
      })
      .on('end', () => {
        console.log(`\n✓ Converted to ${path.basename(outputPath)}`);
        
        // Delete the original AVI file to save space
        try {
          fs.unlinkSync(inputPath);
          console.log(`  Deleted original AVI file to save space`);
        } catch (err) {
          console.log(`  Warning: Could not delete AVI file: ${err.message}`);
        }
        
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error(`\n✗ Conversion failed: ${err.message}`);
        reject(err);
      })
      .run();
  });
}

/**
 * Get MP4 path for a video file (converts if needed)
 * @param {string} videoPath - Path to video file (AVI or MP4)
 * @returns {Promise<string>} - Path to MP4 file
 */
async function getMp4Path(videoPath) {
  // If it's already an MP4, just return it
  if (videoPath.toLowerCase().endsWith('.mp4')) {
    if (fs.existsSync(videoPath)) {
      return videoPath;
    }
    throw new Error(`MP4 file not found: ${videoPath}`);
  }
  
  const mp4Path = videoPath.replace(/\.avi$/i, '.mp4');
  
  // Check if MP4 already exists
  if (fs.existsSync(mp4Path)) {
    // If AVI no longer exists (deleted after conversion), just use the MP4
    if (!fs.existsSync(videoPath)) {
      return mp4Path;
    }
    
    // Both exist - check if MP4 is up to date
    const aviStat = fs.statSync(videoPath);
    const mp4Stat = fs.statSync(mp4Path);
    
    if (mp4Stat.mtime >= aviStat.mtime) {
      // MP4 is up to date
      return mp4Path;
    }
  }
  
  // Need to convert - but only if AVI exists
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }
  
  // Convert AVI to MP4
  await convertAviToMp4(videoPath, mp4Path);
  return mp4Path;
}

/**
 * Convert all AVI files in a directory
 * @param {string} dirPath - Directory path
 */
async function convertAllInDirectory(dirPath) {
  const files = fs.readdirSync(dirPath).filter(f => f.toLowerCase().endsWith('.avi'));
  
  console.log(`\nFound ${files.length} AVI files to convert`);
  
  let converted = 0;
  let skipped = 0;
  
  for (const file of files) {
    const aviPath = path.join(dirPath, file);
    const mp4Path = aviPath.replace(/\.avi$/i, '.mp4');
    
    if (fs.existsSync(mp4Path)) {
      const aviStat = fs.statSync(aviPath);
      const mp4Stat = fs.statSync(mp4Path);
      
      if (mp4Stat.mtime >= aviStat.mtime) {
        console.log(`Skipping ${file} (MP4 already exists)`);
        skipped++;
        continue;
      }
    }
    
    try {
      await convertAviToMp4(aviPath, mp4Path);
      converted++;
    } catch (err) {
      console.error(`Failed to convert ${file}:`, err.message);
    }
  }
  
  console.log(`\n=== Conversion Complete ===`);
  console.log(`Converted: ${converted}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total: ${files.length}`);
}

module.exports = {
  convertAviToMp4,
  getMp4Path,
  convertAllInDirectory,
  isFileStable,
  waitForFileReady,
  matchVideoToModel
};

/**
 * Match a video file to a model in the database
 * @param {string} videoPath - Path to the video file
 * @param {object} db - Database connection
 */
function matchVideoToModel(videoPath, db) {
  const baseFilename = path.basename(videoPath, path.extname(videoPath));
  
  // Try timestamp matching first
  const timestampMatch = baseFilename.match(/(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  
  let print = null;
  
  if (timestampMatch) {
    const [, date, hours, minutes, seconds] = timestampMatch;
    const videoTimestamp = `${date} ${hours}:${minutes}:${seconds}`;
    
    print = db.prepare(`
      SELECT modelId, title
      FROM prints
      WHERE datetime(startTime) <= datetime(?, '+10 minutes')
        AND datetime(startTime) >= datetime(?, '-24 hours')
      ORDER BY abs(julianday(startTime) - julianday(?))
      LIMIT 1
    `).get(videoTimestamp, videoTimestamp, videoTimestamp);
    
    if (print) {
      console.log(`✓ Matched ${baseFilename} to "${print.title}" by timestamp`);
    }
  }
  
  // If no timestamp match, try title matching
  if (!print) {
    print = db.prepare(`
      SELECT modelId, title
      FROM prints
      WHERE title = ?
      ORDER BY startTime DESC
      LIMIT 1
    `).get(baseFilename);
    
    if (print) {
      console.log(`✓ Matched ${baseFilename} to "${print.title}" by exact title`);
    } else {
      // Try fuzzy match
      print = db.prepare(`
        SELECT modelId, title
        FROM prints
        WHERE title LIKE ? OR ? LIKE '%' || title || '%'
        ORDER BY startTime DESC
        LIMIT 1
      `).get(`%${baseFilename}%`, baseFilename);
      
      if (print) {
        console.log(`✓ Matched ${baseFilename} to "${print.title}" by fuzzy match`);
      }
    }
  }
  
  if (print) {
    // Update the print with video path
    const videoFilename = path.basename(videoPath);
    db.prepare(`
      UPDATE prints 
      SET videoPath = ? 
      WHERE modelId = ? AND (videoPath IS NULL OR videoPath = '')
    `).run(videoFilename, print.modelId);
    
    return print.modelId;
  }
  
  return null;
}

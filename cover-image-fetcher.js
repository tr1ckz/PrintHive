const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const AdmZip = require('adm-zip');

const CACHE_DIR = path.join(__dirname, 'data', 'cover-cache');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

class CoverImageFetcher {
  constructor() {
    this.cache = new Map();
    this.pendingFetches = new Map();
    this.maxCacheEntries = 100;
  }

  rememberCacheEntry(cacheKey, value) {
    this.cache.set(cacheKey, value);
    if (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
  }

  async fetchCoverImage(printerIp, accessCode, gcodeFile, subtaskName) {
    // Generate cache key
    const cacheKey = `${printerIp}-${subtaskName || gcodeFile}`;
    
    // Check memory cache
    if (this.cache.has(cacheKey)) {
      console.log('Returning cached cover image for', cacheKey);
      return this.cache.get(cacheKey);
    }

    // Deduplicate concurrent requests for the same cover
    if (this.pendingFetches.has(cacheKey)) {
      return this.pendingFetches.get(cacheKey);
    }

    // Check disk cache
    const cacheFile = path.join(CACHE_DIR, `${Buffer.from(cacheKey).toString('base64').replace(/\//g, '_')}.jpg`);
    if (fs.existsSync(cacheFile)) {
      console.log('Found disk cached cover image for', cacheKey);
      const imageData = fs.readFileSync(cacheFile, 'base64');
      this.rememberCacheEntry(cacheKey, imageData);
      return imageData;
    }

    const fetchPromise = (async () => {
      try {
        const possibleNames = [];
      
      if (subtaskName) {
        possibleNames.push(`${subtaskName}.3mf`);
        possibleNames.push(`${subtaskName}.gcode.3mf`);
      }
      if (gcodeFile && gcodeFile !== subtaskName) {
        possibleNames.push(gcodeFile.endsWith('.3mf') ? gcodeFile : `${gcodeFile}.3mf`);
        possibleNames.push(gcodeFile.endsWith('.gcode.3mf') ? gcodeFile : `${gcodeFile}.gcode.3mf`);
      }

      console.log('Attempting to fetch 3MF file from printer:', possibleNames);

        const client = new ftp.Client(10000);
        client.ftp.verbose = false;
        client.ftp.timeout = 10000;

        await client.access({
        host: printerIp,
        port: 990,
        user: 'bblp',
        password: accessCode,
        secure: 'implicit',
        secureOptions: {
          rejectUnauthorized: false
        }
      });

      // Search in /cache/ and / directories
      const searchPaths = ['/cache/', '/'];
      
      for (const searchPath of searchPaths) {
        for (const fileName of possibleNames) {
          try {
            const remotePath = searchPath + fileName;
            const tempFile = path.join(CACHE_DIR, `temp-${Date.now()}.3mf`);
            
            console.log(`Trying to download: ${remotePath}`);
            await client.downloadTo(tempFile, remotePath);
            
            console.log('Successfully downloaded 3MF, extracting cover image...');
            
            // Extract cover image from 3MF
            const zip = new AdmZip(tempFile);
            const zipEntries = zip.getEntries();
            
            // Look for plate_*.png in Metadata folder
            let coverEntry = zipEntries.find(entry => 
              entry.entryName.match(/Metadata\/plate_\d+\.png/)
            );
            
            if (!coverEntry) {
              // Try model_cover.png
              coverEntry = zipEntries.find(entry => 
                entry.entryName === 'Metadata/model_cover.png'
              );
            }

            if (coverEntry) {
              const imageBuffer = coverEntry.getData();
              const base64Image = imageBuffer.toString('base64');
              
              // Save to disk cache
              fs.writeFileSync(cacheFile, base64Image);
              
              // Save to memory cache
              this.rememberCacheEntry(cacheKey, base64Image);
              
              // Cleanup temp file
              fs.unlinkSync(tempFile);
              
              client.close();
              console.log('Successfully extracted and cached cover image');
              return base64Image;
            } else {
              console.log('No cover image found in 3MF file');
              fs.unlinkSync(tempFile);
            }
          } catch (error) {
            // File not found or error downloading, try next
            continue;
          }
        }
      }

        client.close();
        console.log('Could not find 3MF file on printer');
        return null;
      } catch (error) {
        console.error('Error fetching cover image:', error.message);
        return null;
      } finally {
        this.pendingFetches.delete(cacheKey);
      }
    })();

    this.pendingFetches.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  clearCache(cacheKey) {
    if (cacheKey) {
      this.cache.delete(cacheKey);
      const cacheFile = path.join(CACHE_DIR, `${Buffer.from(cacheKey).toString('base64').replace(/\//g, '_')}.jpg`);
      if (fs.existsSync(cacheFile)) {
        fs.unlinkSync(cacheFile);
      }
    } else {
      // Clear all cache
      this.cache.clear();
      const files = fs.readdirSync(CACHE_DIR);
      files.forEach(file => {
        fs.unlinkSync(path.join(CACHE_DIR, file));
      });
    }
  }
}

module.exports = new CoverImageFetcher();

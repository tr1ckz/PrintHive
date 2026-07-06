const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../../logger');
const { db, dataDir, libraryDir } = require('../../database');
const { getThumbnail, clearThumbnailCache } = require('../jobs/thumbnailClient');
const { autoDescribeModel } = require('../../ai-describer');

// Library (model file) routes: listing, upload, sharing, geometry, thumbnails,
// tagging, duplicate detection, background scan / auto-tag / bulk-delete jobs.
// The job-state objects live in simple-server.js (the dashboard job summary
// reads them too) and are injected by reference; helpers that are shared with
// startup (walkDirectory) or other routes (upload) are injected as well.
const ROOT = path.join(__dirname, '..', '..');
const geometryCache = path.join(dataDir, 'geometry');
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

module.exports = function createLibraryRouter(ctx) {
  const {
    libraryScanJob,
    autoTagJob,
    bulkDeleteJob,
    upload,
    walkDirectory,
    sanitizeFilePath,
    cleanDescription,
  } = ctx;

  const router = express.Router();

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
  router.get('/api/library/geometry/:id', async (req, res) => {
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

  router.get('/api/library', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      const files = (await db.prepare(`
        SELECT l.id, l.fileName, l.originalName, l.fileType, l.fileSize, l.filePath,
          l.description, l.createdAt, l.updatedAt, l.fileHash, l.thumbnailPath,
          GROUP_CONCAT(DISTINCT t.name) as tagNames,
          (SELECT COUNT(*) FROM problems p WHERE p.model_id = l.id AND p.resolved_at IS NULL) as problem_count
        FROM library l
        LEFT JOIN model_tags mt ON l.id = mt.model_id
        LEFT JOIN tags t ON mt.tag_id = t.id
        GROUP BY l.id
        ORDER BY l.createdAt DESC
      `).all());
      
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

  router.post('/api/library/upload', upload.single('file'), async (req, res) => {
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

      const result = (await stmt.run(
        req.file.filename,
        req.file.originalname,
        fileType,
        req.file.size,
        req.file.path,
        description || '',
        tags || ''
      ));

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
  router.post('/api/library/share/:id', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      const { id } = req.params;
      const file = (await db.prepare('SELECT * FROM library WHERE id = ?').get(id));
      
      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }

      // Generate a random hash for sharing
      const crypto = require('crypto');
      const hash = crypto.randomBytes(16).toString('hex');
      
      // Store the share hash in database
      (await db.prepare(`
        INSERT OR REPLACE INTO library_shares (model_id, share_hash, created_at, created_by)
        VALUES (?, ?, now(), ?)
      `).run(id, hash, req.session.userId));
      
      res.json({ hash });
    } catch (error) {
      console.error('Share generation error:', error.message);
      res.status(500).json({ error: 'Failed to generate share link' });
    }
  });

  // Download shared model (no auth required)
  router.get('/api/library/share/:hash/download', async (req, res) => {
    try {
      const { hash } = req.params;
      const share = (await db.prepare(`
        SELECT l.* FROM library l
        INNER JOIN library_shares ls ON l.id = ls.model_id
        WHERE ls.share_hash = ?
      `).get(hash));
      
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
  router.get('/api/library/share/:hash/geometry', async (req, res) => {
    try {
      const { hash } = req.params;
      const share = (await db.prepare(`
        SELECT l.* FROM library l
        INNER JOIN library_shares ls ON l.id = ls.model_id
        WHERE ls.share_hash = ?
      `).get(hash));
      
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
  router.get('/api/library/share/:hash/thumbnail', async (req, res) => {
    try {
      const { hash } = req.params;
      const share = (await db.prepare(`
        SELECT l.* FROM library l
        INNER JOIN library_shares ls ON l.id = ls.model_id
        WHERE ls.share_hash = ?
      `).get(hash));
      
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

  router.get('/api/library/download/:id', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      const file = (await db.prepare('SELECT * FROM library WHERE id = ?').get(req.params.id));
      
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
  router.get('/api/library/thumbnail/:id', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      const file = (await db.prepare('SELECT * FROM library WHERE id = ?').get(req.params.id));

      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }

      // Generate or get cached thumbnail (now async)
      const thumbnail = await getThumbnail(file);

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
  router.get('/api/library/duplicates', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      const groupBy = req.query.groupBy || 'name';
      const files = (await db.prepare('SELECT * FROM library ORDER BY originalName, id').all());
      
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

  router.delete('/api/library/:id', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      const file = (await db.prepare('SELECT * FROM library WHERE id = ?').get(req.params.id));
      
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
      (await db.prepare('DELETE FROM library WHERE id = ?').run(req.params.id));

      res.json({ success: true });
    } catch (error) {
      console.error('Delete error:', error.message);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  });

  // Update library file (description)
  router.patch('/api/library/:id', async (req, res) => {
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
      const file = (await db.prepare('SELECT id FROM library WHERE id = ?').get(fileId));
      console.log('File found:', !!file);
      
      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }

      // Sanitize description (prevent SQL injection and limit length)
      const safeDescription = (description || '').substring(0, 5000);

      // Update description
      (await db.prepare('UPDATE library SET description = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?')
        .run(safeDescription, fileId));

      console.log('Description updated successfully');
      res.json({ success: true });
    } catch (error) {
      console.error('Update error:', error.message);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  });

  // Get tags for a library file
  router.get('/api/library/:id/tags', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      const fileId = req.params.id;
      
      const tags = (await db.prepare(`
        SELECT t.id, t.name
        FROM tags t
        JOIN model_tags mt ON t.id = mt.tag_id
        WHERE mt.model_id = ?
        ORDER BY t.name
      `).all(fileId));

      res.json({ tags: tags.map(t => t.name) });
    } catch (error) {
      console.error('Get tags error:', error.message);
      res.status(500).json({ error: 'Failed to get tags' });
    }
  });

  // Update tags for a library file
  router.put('/api/library/:id/tags', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      const fileId = req.params.id;
      const { tags } = req.body;

      // Check if file exists
      const file = (await db.prepare('SELECT id FROM library WHERE id = ?').get(fileId));
      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }

      // Remove all existing tags for this file
      (await db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(fileId));

      // Add new tags
      if (tags && Array.isArray(tags) && tags.length > 0) {
        const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
        const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?');
        const linkTag = db.prepare('INSERT INTO model_tags (model_id, tag_id) VALUES (?, ?)');

        for (const tagName of tags) {
          if (tagName && tagName.trim()) {
            const cleanTag = tagName.trim();
            (await insertTag.run(cleanTag));
            const tag = (await getTagId.get(cleanTag));
            if (tag) {
              (await linkTag.run(fileId, tag.id));
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
  router.post('/api/library/:id/auto-tag', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
      const fileId = parseInt(req.params.id);
      
      // Get file info
      const file = (await db.prepare('SELECT * FROM library WHERE id = ?').get(fileId));
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
        (await processAutoTagQueue());
      }
    } catch (error) {
      console.error('Auto-tag queue error:', error);
      res.status(500).json({ error: 'Failed to queue auto-tag: ' + error.message });
    }
  });

  // Get auto-tag job status
  router.get('/api/library/auto-tag-status', (req, res) => {
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
  router.post('/api/library/auto-tag-cancel', (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    autoTagJob.running = false;
    autoTagJob.queue = [];
    
    res.json({ success: true, message: 'Auto-tag job cancelled' });
  });

  // Bulk delete endpoint - queues files for background deletion
  router.post('/api/library/bulk-delete', async (req, res) => {
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
      Object.assign(bulkDeleteJob, {
        running: true,
        total: fileIds.length,
        processed: 0,
        deleted: 0,
        failed: 0,
        currentFile: '',
        startTime: Date.now(),
        queue: [...fileIds]
      });

      console.log(`=== BULK DELETE: Starting background job for ${fileIds.length} files ===`);

      // Return immediately with job started
      res.json({
        success: true,
        message: `Bulk delete started for ${fileIds.length} files. Check /api/library/bulk-delete-status for progress.`,
        status: bulkDeleteJob
      });

      // Start processing in background
      (await processBulkDeleteQueue());
    } catch (error) {
      console.error('Failed to start bulk delete:', error.message);
      res.status(500).json({ error: 'Failed to start bulk delete: ' + error.message });
    }
  });

  // Get bulk delete job status
  router.get('/api/library/bulk-delete-status', (req, res) => {
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
  router.post('/api/library/bulk-delete-cancel', (req, res) => {
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
        const file = (await db.prepare('SELECT fileName, originalName FROM library WHERE id = ?').get(fileId));
        
        // Delete from database
        (await db.prepare('DELETE FROM library WHERE id = ?').run(fileId));
        
        // Delete associated thumbnail and geometry cache
        const thumbPath = path.join(dataDir, 'thumbnails', `${fileId}.png`);
        const geoPath = path.join(dataDir, 'geometry', `${fileId}.stl`);
        
        const [thumbExists, geoExists] = await Promise.all([
          fs.promises.access(thumbPath).then(() => true).catch(() => false),
          fs.promises.access(geoPath).then(() => true).catch(() => false),
        ]);

        if (thumbExists) {
          await fs.promises.unlink(thumbPath).catch(() => {});
        }
        if (geoExists) {
          await fs.promises.unlink(geoPath).catch(() => {});
        }
        
        bulkDeleteJob.deleted++;
        console.log(`  [${bulkDeleteJob.processed + 1}/${bulkDeleteJob.total}] Deleted: ${file?.originalName || fileId}`);
      } catch (error) {
        bulkDeleteJob.failed++;
        console.error(`Failed to delete file ${fileId}:`, error.message);
      }
      
      bulkDeleteJob.processed++;
      
      await yieldToEventLoop();
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
            path.join(libraryDir, fileData.fileName),
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
            const searchDirs = [libraryDir, '/app/library'];
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
              (await db.prepare('UPDATE library SET description = ? WHERE id = ?').run(analysis.description, fileData.id));
            }
            
            if (analysis.tags && analysis.tags.length > 0) {
              for (const tag of analysis.tags) {
                // Insert or get tag
                const existingTag = (await db.prepare('SELECT id FROM tags WHERE name = ?').get(tag));
                if (existingTag) {
                  (await db.prepare('INSERT OR IGNORE INTO library_tags (library_id, tag_id) VALUES (?, ?)').run(fileData.id, existingTag.id));
                } else {
                  const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?)');
                  const result = (await insertTag.run(tag));
                  (await db.prepare('INSERT OR IGNORE INTO library_tags (library_id, tag_id) VALUES (?, ?)').run(fileData.id, result.lastInsertRowid));
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
  router.post('/api/library/clean-descriptions', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
      // Get all library items with descriptions
      const items = (await db.prepare('SELECT id, description FROM library WHERE description IS NOT NULL AND description != ""').all());
      
      let cleaned = 0;
      for (const item of items) {
        const originalDesc = item.description;
        const cleanedDesc = cleanDescription(originalDesc);
        
        if (cleanedDesc !== originalDesc) {
          (await db.prepare('UPDATE library SET description = ? WHERE id = ?').run(cleanedDesc, item.id));
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
  router.post('/api/library/cleanup-missing', async (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Check if user is admin
    const user = (await db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId));
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    try {
      const items = (await db.prepare('SELECT * FROM library').all());
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
          (await db.prepare('DELETE FROM library WHERE id = ?').run(item.id));
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

  // Auto-tag all library files (non-blocking background job)
  router.post('/api/library/auto-tag-all', async (req, res) => {
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
      const items = (await db.prepare('SELECT * FROM library').all());
      
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
              (await db.prepare('UPDATE library SET description = ? WHERE id = ?').run(analysis.description, file.id));
            }
            
            // Update tags - add to existing tags
            if (analysis.tags && analysis.tags.length > 0) {
              // Get existing tags for this file
              const existingTags = (await db.prepare(`
                SELECT t.name FROM tags t 
                JOIN model_tags mt ON t.id = mt.tag_id 
                WHERE mt.model_id = ?
              `).all(file.id)).map(t => t.name);
              
              // Add new tags that don't exist
              for (const tagName of analysis.tags) {
                if (existingTags.includes(tagName)) continue;
                
                // Insert or get tag
                let tag = (await db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName));
                if (!tag) {
                  const result = (await db.prepare('INSERT INTO tags (name) VALUES (?)').run(tagName));
                  tag = { id: result.lastInsertRowid };
                }
                
                // Link tag to model (ignore if already exists)
                try {
                  (await db.prepare('INSERT OR IGNORE INTO model_tags (model_id, tag_id) VALUES (?, ?)').run(file.id, tag.id));
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

  // Scan library folder endpoint - recursively scans the library directory (non-blocking)
  router.post('/api/library/scan', async (req, res) => {
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
      Object.assign(libraryScanJob, {
        running: true,
        total: supportedFiles.length,
        processed: 0,
        added: 0,
        skipped: 0,
        currentFile: '',
        startTime: Date.now()
      });
      
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
          const relativePath = path.relative(ROOT, filePath);
          
          // Check if already exists in database by file path
          const existing = (await db.prepare('SELECT id FROM library WHERE filePath = ?').get(relativePath));
          
          if (!existing) {
            try {
              const stats = fs.statSync(filePath);
              const fileType = ext.substring(1);

              const result = (await db.prepare(`
                INSERT INTO library (fileName, originalName, fileType, fileSize, filePath, description, tags)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `).run(fileName, fileName, fileType, stats.size, relativePath, '', ''));
              
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
  router.get('/api/library/scan-status', (req, res) => {
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
  router.post('/api/library/scan-cancel', (req, res) => {
    if (!req.session.authenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    if (!libraryScanJob.running) {
      return res.json({ success: false, message: 'No library scan job running' });
    }
    
    libraryScanJob.running = false;
    res.json({ success: true, message: 'Library scan job cancelled' });
  });

  // Advanced library search
  router.get('/api/library/search', async (req, res) => {
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
      
      const models = (await db.prepare(query).all(...params));
      
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
      
      const { total } = (await db.prepare(countQuery).get(...countParams));
      
      res.json({ models, total, limit: parseInt(limit), offset: parseInt(offset) });
    } catch (error) {
      console.error('Library search error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Calculate hashes for all models
  router.post('/api/library/calculate-all-hashes', async (req, res) => {
    if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const models = (await db.prepare('SELECT * FROM library WHERE fileHash IS NULL').all());
      const crypto = require('crypto');
      let processed = 0;
      let errors = 0;
      
      for (const model of models) {
        try {
          const filePath = path.join(ROOT, model.filePath);
          if (fs.existsSync(filePath)) {
            const fileBuffer = fs.readFileSync(filePath);
            const hashSum = crypto.createHash('sha256');
            hashSum.update(fileBuffer);
            const hash = hashSum.digest('hex');
            (await db.prepare('UPDATE library SET fileHash = ? WHERE id = ?').run(hash, model.id));
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

  // Detect problems for all models
  router.post('/api/library/detect-problems', async (req, res) => {
    if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const models = (await db.prepare('SELECT * FROM library').all());
      let detected = 0;
      
      for (const model of models) {
        const problems = [];
        
        // Check if file exists on disk
        const filePath = path.join(ROOT, model.filePath);
        if (!fs.existsSync(filePath)) {
          problems.push({
            type: 'missing_file',
            severity: 'error',
            message: 'File does not exist on disk'
          });
        }
        
        // Check if model has any prints
        const printCount = (await db.prepare(`
          SELECT COUNT(*) as count FROM prints 
          WHERE title LIKE '%' || ? || '%'
        `).get(model.fileName)).count;
        
        if (printCount === 0) {
          problems.push({
            type: 'never_printed',
            severity: 'info',
            message: 'Model has never been printed'
          });
        }
        
        // Check if model has thumbnail
        if (!model.thumbnailPath || !fs.existsSync(path.join(ROOT, model.thumbnailPath))) {
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
        const tagCount = (await db.prepare(`
          SELECT COUNT(*) as count FROM model_tags WHERE model_id = ?
        `).get(model.id)).count;
        
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
          const dupCount = (await db.prepare(`
            SELECT COUNT(*) as count FROM library 
            WHERE fileHash = ? AND id != ?
          `).get(model.fileHash, model.id)).count;
          
          if (dupCount > 0) {
            problems.push({
              type: 'duplicate',
              severity: 'warning',
              message: `Duplicate of ${dupCount} other file(s)`
            });
          }
        }
        
        // Clear existing unresolved problems for this model
        (await db.prepare('DELETE FROM problems WHERE model_id = ? AND resolved_at IS NULL').run(model.id));
        
        // Insert new problems
        const insertProblem = db.prepare(`
          INSERT INTO problems (model_id, problem_type, severity, message)
          VALUES (?, ?, ?, ?)
        `);
        
        for (const problem of problems) {
          (await insertProblem.run(model.id, problem.type, problem.severity, problem.message));
          detected++;
        }
      }
      
      res.json({ success: true, detected, models_checked: models.length });
    } catch (error) {
      console.error('Detect problems error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Parse tags from folder structure
  router.post('/api/library/parse-folder-tags', async (req, res) => {
    if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const models = (await db.prepare('SELECT * FROM library').all());
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
          let tagRecord = (await db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName));
          if (!tagRecord) {
            const result = (await db.prepare('INSERT INTO tags (name) VALUES (?)').run(tagName));
            tagRecord = { id: result.lastInsertRowid };
          }
          
          // Link tag to model
          try {
            (await db.prepare('INSERT INTO model_tags (model_id, tag_id) VALUES (?, ?)').run(model.id, tagRecord.id));
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
  router.get('/api/library/stats', async (req, res) => {
    if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const stats = {
        total_models: (await db.prepare('SELECT COUNT(*) as count FROM library').get()).count,
        total_size: (await db.prepare('SELECT SUM(fileSize) as size FROM library').get()).size || 0,
        total_tags: (await db.prepare('SELECT COUNT(*) as count FROM tags').get()).count,
        models_with_tags: (await db.prepare(`
          SELECT COUNT(DISTINCT model_id) as count FROM model_tags
        `).get()).count,
        models_with_hash: (await db.prepare('SELECT COUNT(*) as count FROM library WHERE fileHash IS NOT NULL').get()).count,
        total_problems: (await db.prepare('SELECT COUNT(*) as count FROM problems WHERE resolved_at IS NULL').get()).count,
        models_never_printed: (await db.prepare(`
          SELECT COUNT(*) as count FROM library l
          WHERE NOT EXISTS (
            SELECT 1 FROM prints p WHERE p.title LIKE '%' || l.fileName || '%'
          )
        `).get()).count,
        duplicate_groups: (await db.prepare(`
          SELECT COUNT(*) as count FROM (
            SELECT fileHash FROM library 
            WHERE fileHash IS NOT NULL 
            GROUP BY fileHash 
            HAVING COUNT(*) > 1
          )
        `).get()).count
      };
      
      res.json(stats);
    } catch (error) {
      console.error('Get library stats error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};

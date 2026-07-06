const express = require('express');
const fs = require('fs');
const path = require('path');
const { db } = require('../../database');

// Model tag, hash, problem, and bulk routes. Self-contained on the DB; file
// paths stored in the library are relative to the project root.
const ROOT = path.join(__dirname, '..', '..');

const router = express.Router();

// Add tag to model
router.post('/api/models/:id/tags', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { id } = req.params;
    const { tag } = req.body;

    if (!tag) {
      return res.status(400).json({ error: 'Tag name required' });
    }

    // Find or create tag
    let tagRecord = (await db.prepare('SELECT id FROM tags WHERE name = ?').get(tag.toLowerCase()));
    if (!tagRecord) {
      const result = (await db.prepare('INSERT INTO tags (name) VALUES (?)').run(tag.toLowerCase()));
      tagRecord = { id: result.lastInsertRowid };
    }

    // Link tag to model
    try {
      (await db.prepare('INSERT INTO model_tags (model_id, tag_id) VALUES (?, ?)').run(id, tagRecord.id));
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
router.delete('/api/models/:id/tags/:tagId', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { id, tagId } = req.params;
    (await db.prepare('DELETE FROM model_tags WHERE model_id = ? AND tag_id = ?').run(id, tagId));
    res.json({ success: true });
  } catch (error) {
    console.error('Remove tag error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get model tags
router.get('/api/models/:id/tags', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { id } = req.params;
    const tags = (await db.prepare(`
      SELECT t.* FROM tags t
      JOIN model_tags mt ON t.id = mt.tag_id
      WHERE mt.model_id = ?
      ORDER BY t.name ASC
    `).all(id));
    res.json(tags);
  } catch (error) {
    console.error('Get model tags error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Calculate file hash for a model
router.post('/api/models/:id/calculate-hash', async (req, res) => {
  try {
    const { id } = req.params;
    const model = (await db.prepare('SELECT * FROM library WHERE id = ?').get(id));

    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const filePath = path.join(ROOT, model.filePath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    const crypto = require('crypto');
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    const hash = hashSum.digest('hex');

    (await db.prepare('UPDATE library SET fileHash = ? WHERE id = ?').run(hash, id));

    res.json({ success: true, hash });
  } catch (error) {
    console.error('Calculate hash error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get problems for a model
router.get('/api/models/:id/problems', async (req, res) => {
  try {
    const { id } = req.params;
    const problems = (await db.prepare(`
      SELECT * FROM problems
      WHERE model_id = ? AND resolved_at IS NULL
      ORDER BY
        CASE severity
          WHEN 'error' THEN 1
          WHEN 'warning' THEN 2
          ELSE 3
        END,
        detected_at DESC
    `).all(id));
    res.json(problems);
  } catch (error) {
    console.error('Get problems error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk add tags
router.post('/api/models/bulk/tags', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { modelIds, tags } = req.body;

    if (!Array.isArray(modelIds) || !Array.isArray(tags)) {
      return res.status(400).json({ error: 'modelIds and tags must be arrays' });
    }

    let added = 0;

    for (const tag of tags) {
      // Find or create tag
      let tagRecord = (await db.prepare('SELECT id FROM tags WHERE name = ?').get(tag.toLowerCase()));
      if (!tagRecord) {
        const result = (await db.prepare('INSERT INTO tags (name) VALUES (?)').run(tag.toLowerCase()));
        tagRecord = { id: result.lastInsertRowid };
      }

      // Add tag to each model
      for (const modelId of modelIds) {
        try {
          (await db.prepare('INSERT INTO model_tags (model_id, tag_id) VALUES (?, ?)').run(modelId, tagRecord.id));
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
router.delete('/api/models/bulk/tags', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { modelIds, tags } = req.body;

    if (!Array.isArray(modelIds) || !Array.isArray(tags)) {
      return res.status(400).json({ error: 'modelIds and tags must be arrays' });
    }

    const tagIds = (await db.prepare(`
      SELECT id FROM tags WHERE name IN (${tags.map(() => '?').join(',')})
    `).all(...tags.map(t => t.toLowerCase()))).map(t => t.id);

    if (tagIds.length === 0) {
      return res.json({ success: true, removed: 0 });
    }

    const result = (await db.prepare(`
      DELETE FROM model_tags
      WHERE model_id IN (${modelIds.map(() => '?').join(',')})
      AND tag_id IN (${tagIds.map(() => '?').join(',')})
    `).run(...modelIds, ...tagIds));

    res.json({ success: true, removed: result.changes });
  } catch (error) {
    console.error('Bulk remove tags error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk delete models
router.post('/api/models/bulk/delete', async (req, res) => {
  try {
    const { modelIds } = req.body;

    if (!Array.isArray(modelIds)) {
      return res.status(400).json({ error: 'modelIds must be an array' });
    }

    let deleted = 0;
    let errors = 0;

    for (const modelId of modelIds) {
      try {
        const model = (await db.prepare('SELECT * FROM library WHERE id = ?').get(modelId));
        if (model) {
          // Delete file from disk
          const filePath = path.join(ROOT, model.filePath);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }

          // Delete thumbnail
          if (model.thumbnailPath) {
            const thumbnailPath = path.join(ROOT, model.thumbnailPath);
            if (fs.existsSync(thumbnailPath)) {
              fs.unlinkSync(thumbnailPath);
            }
          }

          // Delete from database (cascades to model_tags and problems)
          (await db.prepare('DELETE FROM library WHERE id = ?').run(modelId));
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

module.exports = router;

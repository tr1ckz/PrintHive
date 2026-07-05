const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const logger = require('../../logger');
const {
  listInventory,
  addManualSpool,
  updateSpool,
  deleteSpool,
  applyImportedItems,
  adjustSpare,
  adjustSpareForColor,
  patchSpare,
  deleteSpare,
} = require('../services/filamentInventory');
const { parseBambuReceipt } = require('../services/bambuReceiptParser');
const { hexForColorName } = require('../constants/bambuFilamentColors');

const router = express.Router();

// In-memory upload for receipt screenshots (OCR). Small cap — these are emails.
const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

// Attach a display hex to each parsed line so the preview can show a swatch.
function enrichParsedItems(items) {
  return items.map((it) => ({
    ...it,
    color_hex: it.color_hex || hexForColorName(it.material, it.colorName) || null,
  }));
}

// Run the local `tesseract` binary on an image buffer and return its text.
// Rejects clearly if tesseract isn't installed so the caller can tell the user
// to paste text instead.
function ocrImage(buffer) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `receipt-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    try {
      fs.writeFileSync(tmp, buffer);
    } catch (e) {
      return reject(new Error('Could not buffer the uploaded image'));
    }
    execFile('tesseract', [tmp, 'stdout'], { timeout: 30000 }, (err, stdout) => {
      try { fs.unlinkSync(tmp); } catch { /* best effort */ }
      if (err) {
        if (err.code === 'ENOENT') return reject(Object.assign(new Error('OCR engine not available'), { ocrMissing: true }));
        return reject(err);
      }
      resolve(String(stdout || ''));
    });
  });
}

// Anyone signed in can view the inventory; only admins mutate it (matches the
// rest of the admin-gated write surface).
function requireAdminRole(req, res, next) {
  if (!req.session?.authenticated) return res.status(401).json({ error: 'Not authenticated' });
  if (!['admin', 'superadmin'].includes(req.session.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// GET /api/filament — grouped inventory + totals
router.get('/api/filament', async (req, res) => {
  if (!req.session?.authenticated) return res.status(401).json({ error: 'Not authenticated' });
  try {
    res.json(await listInventory());
  } catch (error) {
    logger.error('[Filament] Failed to list inventory:', error.message);
    res.status(500).json({ error: 'Failed to load filament inventory' });
  }
});

// POST /api/filament — add a spool by hand (non-Bambu, or not in an AMS)
router.post('/api/filament', requireAdminRole, async (req, res) => {
  try {
    const id = await addManualSpool(req.body || {});
    res.json({ success: true, id });
  } catch (error) {
    logger.error('[Filament] Failed to add spool:', error.message);
    res.status(500).json({ error: 'Failed to add filament' });
  }
});

// PATCH /api/filament/:id — edit weight/capacity/colour/etc.
router.patch('/api/filament/:id', requireAdminRole, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const ok = await updateSpool(id, req.body || {});
    if (!ok) return res.status(404).json({ error: 'Filament not found' });
    res.json({ success: true });
  } catch (error) {
    logger.error('[Filament] Failed to update spool:', error.message);
    res.status(500).json({ error: 'Failed to update filament' });
  }
});

// DELETE /api/filament/:id
router.delete('/api/filament/:id', requireAdminRole, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const ok = await deleteSpool(id);
    if (!ok) return res.status(404).json({ error: 'Filament not found' });
    res.json({ success: true });
  } catch (error) {
    logger.error('[Filament] Failed to delete spool:', error.message);
    res.status(500).json({ error: 'Failed to delete filament' });
  }
});

// POST /api/filament/import — parse pasted order text into a preview (no write).
router.post('/api/filament/import', requireAdminRole, async (req, res) => {
  try {
    const text = String(req.body?.text || '');
    if (!text.trim()) return res.status(400).json({ error: 'No text provided' });
    const items = enrichParsedItems(parseBambuReceipt(text));
    res.json({ items });
  } catch (error) {
    logger.error('[Filament] Receipt parse failed:', error.message);
    res.status(500).json({ error: 'Failed to parse receipt' });
  }
});

// POST /api/filament/import/image — OCR a receipt screenshot, then parse it.
router.post('/api/filament/import/image', requireAdminRole, receiptUpload.single('image'), async (req, res) => {
  if (!req.file?.buffer) return res.status(400).json({ error: 'No image uploaded' });
  try {
    const text = await ocrImage(req.file.buffer);
    const items = enrichParsedItems(parseBambuReceipt(text));
    res.json({ items, text });
  } catch (error) {
    if (error.ocrMissing) {
      return res.status(501).json({ error: 'OCR is not available on this server — paste the order text instead.' });
    }
    logger.error('[Filament] Receipt OCR failed:', error.message);
    res.status(500).json({ error: 'Failed to read the image' });
  }
});

// POST /api/filament/spares — apply a confirmed import: "Refill" lines become
// spare counts, "Filament with spool" lines become ready rolls in inventory.
router.post('/api/filament/spares', requireAdminRole, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: 'No items provided' });
    const { spares, spools } = await applyImportedItems(items);
    res.json({ success: true, added: spares + spools, spares, spools, inventory: await listInventory() });
  } catch (error) {
    logger.error('[Filament] Failed to apply import:', error.message);
    res.status(500).json({ error: 'Failed to add items' });
  }
});

// POST /api/filament/spares/adjust — add/remove spares for a colour identity
// (creates the row on the first +1), so a colour with no spares yet can be
// managed straight from its spool.
router.post('/api/filament/spares/adjust', requireAdminRole, async (req, res) => {
  const { brand, material, color_hex, color_name, filament_code, delta } = req.body || {};
  if (!Number.isFinite(Number(delta))) return res.status(400).json({ error: 'delta required' });
  try {
    const count = await adjustSpareForColor({ brand, material, color_hex, color_name, filament_code }, Number(delta));
    res.json({ success: true, count, inventory: await listInventory() });
  } catch (error) {
    logger.error('[Filament] Failed to adjust colour spares:', error.message);
    res.status(500).json({ error: 'Failed to adjust spares' });
  }
});

// PATCH /api/filament/spares/:id — adjust a spare count ({delta}), or edit a
// spare's details ({brand, material, color_name, color_hex, filament_code, ...}).
router.patch('/api/filament/spares/:id', requireAdminRole, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const ok = Number.isFinite(Number(req.body?.delta))
      ? await adjustSpare(id, Number(req.body.delta))
      : await patchSpare(id, req.body || {});
    if (!ok) return res.status(404).json({ error: 'Spare not found' });
    res.json({ success: true, inventory: await listInventory() });
  } catch (error) {
    logger.error('[Filament] Failed to update spare:', error.message);
    res.status(500).json({ error: 'Failed to update spare' });
  }
});

// DELETE /api/filament/spares/:id
router.delete('/api/filament/spares/:id', requireAdminRole, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const ok = await deleteSpare(id);
    if (!ok) return res.status(404).json({ error: 'Spare not found' });
    res.json({ success: true, inventory: await listInventory() });
  } catch (error) {
    logger.error('[Filament] Failed to delete spare:', error.message);
    res.status(500).json({ error: 'Failed to delete spare' });
  }
});

module.exports = router;

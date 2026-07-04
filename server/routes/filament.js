const express = require('express');
const logger = require('../../logger');
const {
  listInventory,
  addManualSpool,
  updateSpool,
  deleteSpool,
} = require('../services/filamentInventory');

const router = express.Router();

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

module.exports = router;

// Filament inventory: turns AMS tray telemetry into a persistent list of spools
// you own, grouped by brand + material, and backs the /api/filament CRUD routes.
//
// Only genuine Bambu RFID spools carry the identity fields (tray_uuid, remain %,
// filament code, colour name), so auto-sync is limited to trays that report a
// tray_uuid; everything else can still be added manually.

const { db } = require('../../database');
const logger = require('../../logger');

// ---------------------------------------------------------------------------
// Pure helpers (no DB) — exported for unit testing.
// ---------------------------------------------------------------------------

// Bambu reports an all-zero uuid for empty / unknown slots; treat that as "no
// spool identity" so those trays don't collide on a single inventory row.
function normalizeTrayUuid(uuid) {
  const s = String(uuid || '').trim();
  if (!s || /^0+$/.test(s)) return null;
  return s;
}

// AMS colours arrive as RRGGBB or RRGGBBAA hex (no '#'); normalize to #RRGGBB.
function normalizeHex(color) {
  if (!color) return null;
  const s = String(color).replace(/^#/, '').trim();
  if (s.length < 6) return null;
  return `#${s.substring(0, 6).toUpperCase()}`;
}

// Split a sub-brand string ("Bambu PLA Matte") into a brand + material. Falls
// back to the raw material type (e.g. "PLA") when no sub-brand is present.
function deriveBrandMaterial(tray) {
  const sub = String(tray.sub_brands || '').trim();
  const type = String(tray.type || '').trim();
  if (sub) {
    if (/bambu/i.test(sub)) {
      const material = sub.replace(/bambu\s+lab\s+/i, '').replace(/bambu\s+/i, '').trim();
      return { brand: 'Bambu Lab', material: material || type || 'Filament' };
    }
    return { brand: 'Generic', material: sub };
  }
  return { brand: 'Generic', material: type || 'Filament' };
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// Build an inventory spool from one AMS tray, or null if the tray is empty /
// not a trackable (RFID) spool.
function buildSpoolFromTray(devId, tray) {
  if (!tray) return null;
  const tray_uuid = normalizeTrayUuid(tray.tray_uuid);
  if (!tray_uuid) return null; // only auto-track spools with an RFID identity

  const { brand, material } = deriveBrandMaterial(tray);
  const capacity_g = 1000;
  const remain_percent = tray.remain != null && tray.remain >= 0 ? toInt(tray.remain) : null;
  const remaining_g = remain_percent != null ? Math.round((remain_percent / 100) * capacity_g) : null;

  return {
    tray_uuid,
    brand,
    material,
    color_name: tray.tray_id_name ? String(tray.tray_id_name).trim() : null,
    color_hex: normalizeHex(tray.color),
    filament_code: tray.tray_info_idx ? String(tray.tray_info_idx).trim() : null,
    remain_percent,
    capacity_g,
    remaining_g,
    source: 'ams',
    last_dev_id: devId || null,
  };
}

// Group flat inventory rows by "Brand Material" for the grouped UI, with a
// per-group spool count and total remaining weight.
function groupInventory(rows) {
  const groups = new Map();
  for (const row of rows) {
    const brand = row.brand || 'Generic';
    const material = row.material || 'Filament';
    const label = `${brand} ${material}`.trim();
    if (!groups.has(label)) {
      groups.set(label, { label, brand, material, count: 0, totalRemainingG: 0, spools: [] });
    }
    const g = groups.get(label);
    g.count += 1;
    g.totalRemainingG += Number(row.remaining_g) || 0;
    g.spools.push(row);
  }
  const out = Array.from(groups.values());
  out.sort((a, b) => a.label.localeCompare(b.label));
  for (const g of out) {
    g.spools.sort((a, b) => String(a.color_name || '').localeCompare(String(b.color_name || '')) || (a.id - b.id));
  }
  return out;
}

// ---------------------------------------------------------------------------
// DB-backed operations.
// ---------------------------------------------------------------------------

// In-memory guard so a burst of identical AMS telemetry doesn't hammer the DB;
// we only write when a spool's remaining % actually changed.
const lastSynced = new Map(); // tray_uuid -> remain_percent

async function upsertSpool(spool) {
  const existing = (await db.prepare('SELECT id, source FROM filament_inventory WHERE tray_uuid = ?').get(spool.tray_uuid));
  if (existing) {
    (await db.prepare(`
      UPDATE filament_inventory
      SET brand = ?, material = ?, color_name = ?, color_hex = ?, filament_code = ?,
          remain_percent = ?, remaining_g = ?, capacity_g = COALESCE(capacity_g, ?),
          last_dev_id = ?, is_archived = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      spool.brand, spool.material, spool.color_name, spool.color_hex, spool.filament_code,
      spool.remain_percent, spool.remaining_g, spool.capacity_g, spool.last_dev_id, existing.id
    ));
    return existing.id;
  }
  const res = (await db.prepare(`
    INSERT INTO filament_inventory
      (tray_uuid, brand, material, color_name, color_hex, filament_code,
       remain_percent, capacity_g, remaining_g, source, last_dev_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ams', ?)
  `).run(
    spool.tray_uuid, spool.brand, spool.material, spool.color_name, spool.color_hex,
    spool.filament_code, spool.remain_percent, spool.capacity_g, spool.remaining_g, spool.last_dev_id
  ));
  return res.lastInsertRowid;
}

// Sync all trays for a device into the inventory. Safe to call on every AMS
// telemetry update — it no-ops trays without an RFID identity and skips writes
// when nothing changed.
async function syncTraysToInventory(devId, trays) {
  if (!Array.isArray(trays) || trays.length === 0) return 0;
  let written = 0;
  for (const tray of trays) {
    const spool = buildSpoolFromTray(devId, tray);
    if (!spool) continue;
    if (lastSynced.get(spool.tray_uuid) === spool.remain_percent) continue; // unchanged
    try {
      await upsertSpool(spool);
      lastSynced.set(spool.tray_uuid, spool.remain_percent);
      written += 1;
    } catch (error) {
      logger.debug('[Filament] Failed to sync tray to inventory:', error.message);
    }
  }
  return written;
}

async function listInventory() {
  const rows = (await db.prepare(
    'SELECT * FROM filament_inventory WHERE is_archived = 0 ORDER BY brand, material, color_name'
  ).all());
  const groups = groupInventory(rows);
  const totalSpools = rows.length;
  const totalRemainingG = rows.reduce((sum, r) => sum + (Number(r.remaining_g) || 0), 0);
  return { groups, totals: { spools: totalSpools, remainingG: totalRemainingG } };
}

async function addManualSpool(data = {}) {
  const capacity_g = toInt(data.capacity_g) ?? 1000;
  let remaining_g = data.remaining_g != null ? toInt(data.remaining_g) : capacity_g;
  if (remaining_g != null && remaining_g < 0) remaining_g = 0;
  const remain_percent = capacity_g > 0 && remaining_g != null
    ? Math.max(0, Math.min(100, Math.round((remaining_g / capacity_g) * 100)))
    : null;
  const res = (await db.prepare(`
    INSERT INTO filament_inventory
      (tray_uuid, brand, material, color_name, color_hex, filament_code,
       remain_percent, capacity_g, remaining_g, source, last_dev_id)
    VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL)
  `).run(
    (data.brand || 'Generic').trim(), (data.material || 'Filament').trim(),
    data.color_name || null, normalizeHex(data.color_hex), data.filament_code || null,
    remain_percent, capacity_g, remaining_g
  ));
  return res.lastInsertRowid;
}

const EDITABLE_TEXT = ['brand', 'material', 'color_name', 'filament_code'];

async function updateSpool(id, patch = {}) {
  const row = (await db.prepare('SELECT * FROM filament_inventory WHERE id = ?').get(id));
  if (!row) return false;

  const next = { ...row };
  for (const key of EDITABLE_TEXT) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  if (patch.color_hex !== undefined) next.color_hex = normalizeHex(patch.color_hex);
  if (patch.capacity_g !== undefined) next.capacity_g = toInt(patch.capacity_g) ?? next.capacity_g;
  if (patch.remaining_g !== undefined) {
    next.remaining_g = Math.max(0, toInt(patch.remaining_g) ?? 0);
  }
  // Keep remaining_g and remain_percent consistent when either weight field moves.
  if (patch.remaining_g !== undefined || patch.capacity_g !== undefined) {
    const cap = Number(next.capacity_g) || 0;
    next.remain_percent = cap > 0 && next.remaining_g != null
      ? Math.max(0, Math.min(100, Math.round((next.remaining_g / cap) * 100)))
      : next.remain_percent;
  }

  (await db.prepare(`
    UPDATE filament_inventory
    SET brand = ?, material = ?, color_name = ?, color_hex = ?, filament_code = ?,
        remain_percent = ?, capacity_g = ?, remaining_g = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    next.brand, next.material, next.color_name, next.color_hex, next.filament_code,
    next.remain_percent, next.capacity_g, next.remaining_g, id
  ));
  return true;
}

async function deleteSpool(id) {
  const row = (await db.prepare('SELECT tray_uuid FROM filament_inventory WHERE id = ?').get(id));
  if (!row) return false;
  (await db.prepare('DELETE FROM filament_inventory WHERE id = ?').run(id));
  if (row.tray_uuid) lastSynced.delete(row.tray_uuid); // allow re-sync if reinserted
  return true;
}

module.exports = {
  // pure
  normalizeTrayUuid,
  normalizeHex,
  deriveBrandMaterial,
  buildSpoolFromTray,
  groupInventory,
  // db
  syncTraysToInventory,
  listInventory,
  addManualSpool,
  updateSpool,
  deleteSpool,
};

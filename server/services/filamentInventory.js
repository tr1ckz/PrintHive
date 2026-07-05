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

// Build an inventory spool from one AMS tray, or null when the tray is empty.
// Genuine Bambu spools carry an RFID tag (tray_uuid) used as identity. Spools
// without a tag (third-party, AMS Lite) still get surfaced via a stable
// per-(device, slot) identity as long as the slot has a configured material —
// so a loaded spool shows up the moment MQTT reports it, tag or not.
function buildSpoolFromTray(devId, tray) {
  if (!tray) return null;

  let tray_uuid = normalizeTrayUuid(tray.tray_uuid);
  if (!tray_uuid) {
    const hasFilament = (tray.type && String(tray.type).trim()) ||
      (tray.sub_brands && String(tray.sub_brands).trim());
    // Empty/unconfigured slot, or we can't form a stable key — skip it.
    if (!hasFilament || tray.slot == null || !devId) return null;
    tray_uuid = `slot:${devId}:${tray.slot}`;
  }

  const { brand, material } = deriveBrandMaterial(tray);
  const capacity_g = 1000;
  // The AMS reports `remain` as a percentage (usually whole numbers → 10g steps
  // on a 1kg spool). Compute grams from the raw value rather than rounding the
  // percent first, so any sub-percent precision the firmware provides is kept.
  const remainRaw = tray.remain != null && tray.remain >= 0 ? Number(tray.remain) : null;
  const remain_percent = remainRaw != null ? toInt(remainRaw) : null;
  const remaining_g = remainRaw != null ? Math.round((remainRaw / 100) * capacity_g) : null;

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
// keyed by tray_uuid -> a change signature.
const lastSynced = new Map();
// Tracks which RFID tag was last seen in each (device, slot) so we can detect a
// roll being swapped out and, if it was empty, archive it. Rebuilt on restart.
const slotUuid = new Map(); // `${devId}:${slot}` -> tray_uuid

// A roll at/under this remaining is considered "used up" for auto-archiving on
// replacement (AMS often stops reading a few % above zero once removed).
const EMPTY_PERCENT = 5;

async function upsertSpool(spool) {
  const existing = (await db.prepare('SELECT id FROM filament_inventory WHERE tray_uuid = ?').get(spool.tray_uuid));
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

  // Adoption: if exactly one hand-added roll (no tag) matches this spool's
  // brand + material + colour, attach the tag to it instead of creating a
  // duplicate — so a roll you pre-entered at "100g" becomes the tracked one the
  // moment the AMS reads it. Ambiguous cases (0 or >1 matches, e.g. you keep two
  // of the same) fall through to a fresh row so nothing is mis-merged.
  const candidates = (await db.prepare(`
    SELECT id FROM filament_inventory
    WHERE (tray_uuid IS NULL OR tray_uuid = '') AND is_archived = 0
      AND LOWER(COALESCE(brand,'')) = LOWER(?)
      AND LOWER(COALESCE(material,'')) = LOWER(?)
      AND UPPER(COALESCE(color_hex,'')) = UPPER(COALESCE(?, ''))
  `).all(spool.brand, spool.material, spool.color_hex));

  if (candidates.length === 1) {
    (await db.prepare(`
      UPDATE filament_inventory
      SET tray_uuid = ?, filament_code = COALESCE(?, filament_code),
          color_name = COALESCE(?, color_name),
          remain_percent = COALESCE(?, remain_percent),
          remaining_g = COALESCE(?, remaining_g),
          source = 'ams', last_dev_id = ?, is_archived = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      spool.tray_uuid, spool.filament_code, spool.color_name,
      spool.remain_percent, spool.remaining_g, spool.last_dev_id, candidates[0].id
    ));
    return candidates[0].id;
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

// When a slot's tag changes, the previous roll was removed. If it was basically
// empty, archive it (the "ran to 0, put a fresh roll in" case). If it still had
// filament, leave it in inventory — it's a partial you pulled out, still owned.
async function handleSlotReplacement(devId, slot, newUuid) {
  if (slot == null) return;
  const key = `${devId || ''}:${slot}`;
  const prevUuid = slotUuid.get(key);
  slotUuid.set(key, newUuid);
  if (!prevUuid || prevUuid === newUuid) return;
  try {
    (await db.prepare(`
      UPDATE filament_inventory
      SET is_archived = 1, updated_at = CURRENT_TIMESTAMP
      WHERE tray_uuid = ? AND is_archived = 0
        AND (remain_percent IS NULL OR remain_percent <= ?)
    `).run(prevUuid, EMPTY_PERCENT));
  } catch (error) {
    logger.debug('[Filament] Slot-replacement archive failed:', error.message);
  }
}

// A compact signature of the fields we care about, so we write (and notify) on
// any meaningful change — including a live gram-level change during a print.
function spoolSignature(spool) {
  return `${spool.remaining_g}|${spool.remain_percent}|${spool.color_hex}|${spool.type ?? ''}|${spool.material}|${spool.filament_code ?? ''}`;
}

// Live, gram-level remaining during a print. The AMS only reports whole-percent
// (10g steps), but the printer knows the job's total filament weight and how far
// along it is — so we interpolate: anchor to the AMS grams at the moment we
// start tracking, then subtract consumed = print_weight * progress. When the AMS
// %-step ground truth drops below our estimate, we re-anchor so drift can't
// accumulate. Only the active tray of a running print is interpolated.
const printAnchors = new Map(); // tray_uuid -> { amsG, consumedAtStep }

function liveRemainingGrams(spool, ctx, isActive) {
  const printing = isActive && ctx &&
    /RUNNING|PREPARE|SLICING|PAUSE/i.test(ctx.gcodeState || '') &&
    Number(ctx.printWeight) > 0;
  if (!printing) { printAnchors.delete(spool.tray_uuid); return spool.remaining_g; }

  const amsG = spool.remaining_g;
  if (amsG == null) return null;

  const consumed = (Number(ctx.printWeight) * (Number(ctx.progress) || 0)) / 100;
  let anchor = printAnchors.get(spool.tray_uuid);
  // (Re)anchor at each AMS %-step: record how much the job had consumed then,
  // and interpolate downward from that reading until the next step.
  if (!anchor || anchor.amsG !== amsG) {
    anchor = { amsG, consumedAtStep: consumed };
    printAnchors.set(spool.tray_uuid, anchor);
  }
  const live = Math.round(amsG - (consumed - anchor.consumedAtStep));
  return Math.max(0, Math.min(amsG, live)); // only ever interpolate below the AMS reading
}

// Sync all trays for a device into the inventory. Safe to call on every AMS
// telemetry update — it no-ops trays without an RFID identity and skips writes
// when nothing changed. Returns the number of rows actually written so callers
// can push a live update only when something changed.
async function syncTraysToInventory(devId, trays, ctx = null) {
  if (!Array.isArray(trays) || trays.length === 0) return 0;
  let written = 0;
  for (const tray of trays) {
    const spool = buildSpoolFromTray(devId, tray);
    if (!spool) continue;
    // Detect a roll swap in this physical slot and archive the emptied one.
    await handleSlotReplacement(devId, tray.slot, spool.tray_uuid);
    // Interpolate gram-level remaining for the active tray of a running print.
    if (ctx) {
      const isActive = ctx.activeTray != null && Number(tray.slot) === Number(ctx.activeTray);
      const live = liveRemainingGrams(spool, ctx, isActive);
      if (live != null && live !== spool.remaining_g) {
        spool.remaining_g = live;
        spool.remain_percent = spool.capacity_g > 0 ? Math.round((live / spool.capacity_g) * 100) : spool.remain_percent;
      }
    }
    const sig = spoolSignature(spool);
    if (lastSynced.get(spool.tray_uuid) === sig) continue; // unchanged
    try {
      await upsertSpool(spool);
      lastSynced.set(spool.tray_uuid, sig);
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
  // Empty/replaced rolls kept for history — shown separately so the active list
  // stays clean but nothing is silently lost.
  const archived = (await db.prepare(
    'SELECT * FROM filament_inventory WHERE is_archived = 1 ORDER BY updated_at DESC'
  ).all());
  const groups = groupInventory(rows);
  const totalSpools = rows.length;
  const totalRemainingG = rows.reduce((sum, r) => sum + (Number(r.remaining_g) || 0), 0);
  return { groups, archived, totals: { spools: totalSpools, remainingG: totalRemainingG } };
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
  // "Refill" resets a roll to full capacity and brings it back into the active
  // list (used to restore an archived/empty roll you've physically replaced).
  if (patch.refill) {
    next.remaining_g = Number(next.capacity_g) || 1000;
    next.is_archived = 0;
  }
  if (patch.archived !== undefined) next.is_archived = patch.archived ? 1 : 0;
  // Keep remaining_g and remain_percent consistent when either weight field moves.
  if (patch.remaining_g !== undefined || patch.capacity_g !== undefined || patch.refill) {
    const cap = Number(next.capacity_g) || 0;
    next.remain_percent = cap > 0 && next.remaining_g != null
      ? Math.max(0, Math.min(100, Math.round((next.remaining_g / cap) * 100)))
      : next.remain_percent;
  }

  (await db.prepare(`
    UPDATE filament_inventory
    SET brand = ?, material = ?, color_name = ?, color_hex = ?, filament_code = ?,
        remain_percent = ?, capacity_g = ?, remaining_g = ?, is_archived = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    next.brand, next.material, next.color_name, next.color_hex, next.filament_code,
    next.remain_percent, next.capacity_g, next.remaining_g, next.is_archived ? 1 : 0, id
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
  liveRemainingGrams,
  // db
  syncTraysToInventory,
  listInventory,
  addManualSpool,
  updateSpool,
  deleteSpool,
};

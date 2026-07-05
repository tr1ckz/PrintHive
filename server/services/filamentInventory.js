// Filament inventory: turns AMS tray telemetry into a persistent list of spools
// you own, grouped by brand + material, and backs the /api/filament CRUD routes.
//
// Only genuine Bambu RFID spools carry the identity fields (tray_uuid, remain %,
// filament code, colour name), so auto-sync is limited to trays that report a
// tray_uuid; everything else can still be added manually.

const { db } = require('../../database');
const logger = require('../../logger');
const {
  isPlaceholderColorName,
  lookupBambuColorName,
  describeColor,
  nearestBasicColorName,
  brandMaterialForCode,
  hexForColorName,
} = require('../constants/bambuFilamentColors');

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

  // The filament code (tray_info_idx, e.g. "GFA01") authoritatively identifies
  // the product, so prefer it — it corrects "Generic PLA Matte" to "Bambu Lab
  // PLA Matte" for genuine Bambu spools. Fall back to sub_brands/type parsing.
  const filament_code = tray.tray_info_idx ? String(tray.tray_info_idx).trim() : null;
  const { brand, material } = brandMaterialForCode(filament_code) || deriveBrandMaterial(tray);
  const capacity_g = 1000;
  // The AMS reports `remain` as a percentage (usually whole numbers → 10g steps
  // on a 1kg spool). Compute grams from the raw value rather than rounding the
  // percent first, so any sub-percent precision the firmware provides is kept.
  const remainRaw = tray.remain != null && tray.remain >= 0 ? Number(tray.remain) : null;
  const remain_percent = remainRaw != null ? toInt(remainRaw) : null;
  const remaining_g = remainRaw != null ? Math.round((remainRaw / 100) * capacity_g) : null;

  // The printer's own name wins, but only when it's a real name — many reads
  // report a variant/material code ("A01-R1", "GFA01") in this field, which we
  // treat as no-name and resolve from the canonical hex instead.
  const color_hex = normalizeHex(tray.color);
  const reportedName = tray.tray_id_name ? String(tray.tray_id_name).trim() : null;
  const color_name = (reportedName && !isPlaceholderColorName(reportedName))
    ? reportedName
    : describeColor(filament_code, color_hex);

  return {
    tray_uuid,
    brand,
    material,
    color_name: color_name || null,
    color_hex,
    filament_code,
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
  // A genuinely new spool row means a fresh roll was just loaded — use up one
  // matching spare if we're tracking any for this colour.
  await consumeSpareOnLoad(spool);
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
  return `${spool.remaining_g}|${spool.remain_percent}|${spool.color_hex}|${spool.type ?? ''}|${spool.material}|${spool.filament_code ?? ''}|${spool.color_name ?? ''}`;
}

// Live, gram-level remaining during a print. The AMS only reports whole-percent
// (10g steps on a 1kg spool), and the P1S local MQTT push does NOT include the
// job's filament weight (print_weight is cloud-only), so we can't just do
// weight * progress. Instead we self-calibrate: watch how many grams the AMS
// drops (always 10) against how much print progress elapsed over that drop, which
// gives grams-per-percent for this job. Between AMS steps we interpolate down
// from the last reading using that rate and the live progress, so the number
// ticks by ~1-2 g instead of jumping 10. Each real AMS step re-anchors, so the
// estimate can't drift past the ground truth. When print_weight *is* available
// (cloud), we use it directly as the rate. Only the active tray of a running
// print is interpolated.
const printAnchors = new Map(); // tray_uuid -> { amsG, progressAtStep, gPerPct }

function liveRemainingGrams(spool, ctx, isActive) {
  const printing = isActive && ctx &&
    /RUNNING|PREPARE|SLICING|PAUSE/i.test(ctx.gcodeState || '');
  if (!printing) { printAnchors.delete(spool.tray_uuid); return spool.remaining_g; }

  const amsG = spool.remaining_g;
  if (amsG == null) return null;

  const progress = Number(ctx.progress) || 0;
  // Explicit rate from cloud weight if we ever get it; else learned from the AMS.
  const explicitRate = Number(ctx.printWeight) > 0 ? Number(ctx.printWeight) / 100 : null;

  let anchor = printAnchors.get(spool.tray_uuid);

  // First sighting, spool swap, or a refill (AMS went up): (re)anchor, no guess.
  if (!anchor || amsG > anchor.amsG) {
    printAnchors.set(spool.tray_uuid, { amsG, progressAtStep: progress, gPerPct: explicitRate });
    return amsG;
  }

  // AMS stepped down (ground truth): learn the consumption rate from how much
  // progress that 10 g took, then re-anchor at the new reading.
  if (amsG < anchor.amsG) {
    const dProg = progress - anchor.progressAtStep;
    const observed = dProg > 0 ? (anchor.amsG - amsG) / dProg : null;
    printAnchors.set(spool.tray_uuid, {
      amsG,
      progressAtStep: progress,
      gPerPct: explicitRate ?? observed ?? anchor.gPerPct,
    });
    return amsG;
  }

  // Same AMS band — interpolate downward using the (learned or explicit) rate.
  const rate = explicitRate ?? anchor.gPerPct;
  if (!rate || rate <= 0) return amsG; // not calibrated yet
  const live = Math.round(amsG - rate * (progress - anchor.progressAtStep));
  // Stay within this 10 g band until the AMS itself confirms the next step.
  return Math.max(amsG - 9, Math.max(0, Math.min(amsG, live)));
}

// Sync all trays for a device into the inventory. Safe to call on every AMS
// telemetry update — it no-ops trays without an RFID identity and skips writes
// when nothing changed. Returns the number of rows actually written so callers
// can push a live update only when something changed.
// Last-resort name fill: reuse a real name any printer has previously reported
// for the same colour hex. Never invents a name; returns null if we have none,
// so the UI just shows the hex. The static catalog is applied earlier in
// buildSpoolFromTray, so this only helps for colours not in that table.
async function resolveColorName(colorHex) {
  if (!colorHex) return null;
  try {
    const learned = (await db.prepare(`
      SELECT color_name FROM filament_inventory
      WHERE UPPER(color_hex) = UPPER(?) AND color_name IS NOT NULL AND TRIM(color_name) != ''
      ORDER BY updated_at DESC LIMIT 1
    `).get(colorHex));
    if (learned?.color_name && !isPlaceholderColorName(learned.color_name)) {
      return learned.color_name;
    }
  } catch (error) {
    logger.debug('[Filament] color-name lookup failed:', error.message);
  }
  return null;
}

async function syncTraysToInventory(devId, trays, ctx = null) {
  if (!Array.isArray(trays) || trays.length === 0) return 0;
  let written = 0;
  for (const tray of trays) {
    const spool = buildSpoolFromTray(devId, tray);
    if (!spool) continue;
    // Fill a still-missing colour name from a name previously learned for this
    // hex (buildSpoolFromTray already applied the printer name + static catalog).
    if (!spool.color_name && spool.color_hex) {
      spool.color_name = await resolveColorName(spool.color_hex);
    }
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

// One-shot repair at startup so existing inventory reflects the current catalog
// without waiting for the printer to re-sync each slot:
//   - colour name: fill placeholders/blanks from the catalog (never overwrites a
//     real, user-entered name);
//   - brand + material: for AMS spools, re-derive from the filament code, so a
//     GFA01 roll stored as "Generic PLA Matte" becomes "Bambu Lab PLA Matte".
//     Manual entries are left untouched.
async function backfillColorNames() {
  let fixed = 0;
  try {
    const rows = (await db.prepare(
      'SELECT id, source, brand, material, color_name, color_hex, filament_code FROM filament_inventory'
    ).all());
    for (const row of rows) {
      const sets = [];
      const params = [];

      // Colour name. Fill a placeholder/blank from the catalog; and upgrade an
      // auto-generated generic name (e.g. "Light Blue") to the exact catalog
      // name ("Ice Blue") now that we know it. A user-typed name won't equal the
      // generic nearest name, so it's left untouched.
      const exactName = lookupBambuColorName(row.filament_code, row.color_hex);
      if (!row.color_name || isPlaceholderColorName(row.color_name)) {
        const resolved = exactName
          || (await resolveColorName(row.color_hex))
          || nearestBasicColorName(row.color_hex);
        if (resolved && resolved !== row.color_name) { sets.push('color_name = ?'); params.push(resolved); }
      } else if (exactName && row.color_name !== exactName && row.color_name === nearestBasicColorName(row.color_hex)) {
        sets.push('color_name = ?'); params.push(exactName);
      }

      // Brand + material — re-derive from the filament code for AMS spools only.
      if (row.source !== 'manual') {
        const bm = brandMaterialForCode(row.filament_code);
        if (bm && (bm.brand !== row.brand || bm.material !== row.material)) {
          sets.push('brand = ?', 'material = ?');
          params.push(bm.brand, bm.material);
        }
      }

      if (sets.length) {
        params.push(row.id);
        (await db.prepare(
          `UPDATE filament_inventory SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).run(...params));
        fixed += 1;
      }
    }
    if (fixed) logger.info(`[Filament] Backfilled ${fixed} inventory row(s) from catalog`);
  } catch (error) {
    logger.debug('[Filament] Inventory backfill failed:', error.message);
  }
  return fixed;
}

// ---------------------------------------------------------------------------
// Spare / unopened refills — a count of sealed rolls you own per colour.
// ---------------------------------------------------------------------------

// A colour identity for matching a spare to an inventory spool. Prefer the hex
// (canonical), fall back to the colour name; always scoped by brand + material.
function spareMatchKey({ brand, material, color_hex, color_name }) {
  const hex = normalizeHex(color_hex);
  const colour = hex ? `hex:${hex}` : `name:${String(color_name || '').trim().toLowerCase()}`;
  return `${String(brand || '').trim().toLowerCase()}|${String(material || '').trim().toLowerCase()}|${colour}`;
}

async function findSpareRow(identity) {
  const key = spareMatchKey(identity);
  const rows = (await db.prepare('SELECT * FROM filament_spares').all());
  return rows.find((r) => spareMatchKey(r) === key) || null;
}

// Add sealed refills for a colour (from a parsed receipt or by hand). Each item:
// { brand, material, colorName, color_hex?, code?, unitWeightG?, quantity, isRefill? }
async function addSpares(items) {
  if (!Array.isArray(items)) return 0;
  let added = 0;
  for (const item of items) {
    const qty = Math.max(0, toInt(item.quantity ?? 1) || 0);
    if (qty <= 0) continue;
    const brand = (item.brand || 'Bambu Lab').trim();
    const material = (item.material || 'Filament').trim();
    const color_name = item.colorName || item.color_name || null;
    const color_hex = normalizeHex(item.color_hex) || hexForColorName(material, color_name);
    const filament_code = item.code || item.filament_code || null;
    const unit_weight_g = toInt(item.unitWeightG ?? item.unit_weight_g) ?? 1000;
    const is_refill = item.isRefill === false ? 0 : 1;

    const existing = await findSpareRow({ brand, material, color_hex, color_name });
    if (existing) {
      (await db.prepare(
        'UPDATE filament_spares SET spare_count = spare_count + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(qty, existing.id));
    } else {
      (await db.prepare(`
        INSERT INTO filament_spares
          (brand, material, color_name, color_hex, filament_code, spare_count, unit_weight_g, is_refill)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(brand, material, color_name, color_hex, filament_code, qty, unit_weight_g, is_refill));
    }
    added += qty;
  }
  return added;
}

async function listSpares() {
  return (await db.prepare(
    'SELECT * FROM filament_spares WHERE spare_count > 0 ORDER BY brand, material, color_name'
  ).all());
}

// Apply parsed order lines: "Refill" (no spool) lines become spare counts to be
// loaded later; "Filament with spool" lines are ready rolls, so add them to
// active inventory now (one manual spool each) — the user shouldn't have to load
// them into the AMS first. When such a roll is later loaded, the AMS-adoption
// logic merges it into the manual row instead of duplicating.
async function applyImportedItems(items) {
  if (!Array.isArray(items)) return { spares: 0, spools: 0 };
  const refills = items.filter((i) => i.kind !== 'spool' && i.isRefill !== false);
  const rolls = items.filter((i) => i.kind === 'spool' || i.isRefill === false);

  const spares = await addSpares(refills);
  let spools = 0;
  for (const it of rolls) {
    const qty = Math.max(0, toInt(it.quantity ?? 1) || 0);
    const material = it.material || 'Filament';
    const color_name = it.colorName || it.color_name || null;
    const color_hex = normalizeHex(it.color_hex) || hexForColorName(material, color_name);
    const capacity_g = toInt(it.unitWeightG ?? it.unit_weight_g) ?? 1000;
    for (let n = 0; n < qty; n += 1) {
      await addManualSpool({
        brand: it.brand || 'Bambu Lab',
        material,
        color_name,
        color_hex,
        filament_code: it.code || it.filament_code || null,
        capacity_g,
        remaining_g: capacity_g,
      });
      spools += 1;
    }
  }
  return { spares, spools };
}

// Adjust the spare count for a colour identity (not a row id), creating the row
// on the first +1. Lets the UI manage spares for any colour — even one with no
// spare row yet. Returns the new count.
async function adjustSpareForColor(identity, delta) {
  const d = Number(delta) || 0;
  const existing = await findSpareRow(identity);
  if (existing) {
    const next = Math.max(0, (Number(existing.spare_count) || 0) + d);
    (await db.prepare(
      'UPDATE filament_spares SET spare_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(next, existing.id));
    return next;
  }
  if (d > 0) {
    await addSpares([{
      brand: identity.brand, material: identity.material,
      colorName: identity.color_name, color_hex: identity.color_hex,
      code: identity.filament_code, quantity: d, isRefill: true,
    }]);
    return d;
  }
  return 0;
}

// Adjust a spare row by a delta (e.g. +1 ordered, -1 loaded). Clamps at 0.
async function adjustSpare(id, delta) {
  const row = (await db.prepare('SELECT * FROM filament_spares WHERE id = ?').get(id));
  if (!row) return false;
  const next = Math.max(0, (Number(row.spare_count) || 0) + (Number(delta) || 0));
  (await db.prepare(
    'UPDATE filament_spares SET spare_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(next, id));
  return true;
}

// Edit the identity of a spare (a not-yet-loaded colour): brand/material/colour
// name/hex/code and the per-roll weight. Count is managed separately.
async function patchSpare(id, patch = {}) {
  const row = (await db.prepare('SELECT * FROM filament_spares WHERE id = ?').get(id));
  if (!row) return false;
  const val = (k, fallback) => (patch[k] !== undefined ? (patch[k] || null) : fallback);
  const brand = val('brand', row.brand);
  const material = val('material', row.material);
  const color_name = val('color_name', row.color_name);
  const color_hex = patch.color_hex !== undefined ? normalizeHex(patch.color_hex) : row.color_hex;
  const filament_code = val('filament_code', row.filament_code);
  const unit_weight_g = patch.unit_weight_g !== undefined
    ? (toInt(patch.unit_weight_g) ?? row.unit_weight_g)
    : row.unit_weight_g;
  (await db.prepare(`
    UPDATE filament_spares
    SET brand = ?, material = ?, color_name = ?, color_hex = ?, filament_code = ?,
        unit_weight_g = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(brand, material, color_name, color_hex, filament_code, unit_weight_g, id));
  return true;
}

async function deleteSpare(id) {
  const res = (await db.prepare('DELETE FROM filament_spares WHERE id = ?').run(id));
  return res.changes > 0;
}

// When a genuinely new spool is loaded into the AMS, use up one matching spare.
async function consumeSpareOnLoad(spool) {
  try {
    const match = await findSpareRow(spool);
    if (match && match.spare_count > 0) {
      (await db.prepare(
        'UPDATE filament_spares SET spare_count = spare_count - 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(match.id));
      logger.info(`[Filament] Used one spare of ${spool.brand} ${spool.material} ${spool.color_name || ''} (loaded)`);
    }
  } catch (error) {
    logger.debug('[Filament] Spare consume-on-load failed:', error.message);
  }
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
  const spares = await listSpares();
  const groups = groupInventory(rows);

  // Show spares against the actual spool: attach the count to the matching
  // colour's row so the UI can render a "+N" beside it. A colour you only have
  // sealed spares of (never loaded) gets a lightweight row of its own so it
  // still shows up. Match by hex, else by colour name, within brand+material.
  const colourMatches = (spool, spare) => {
    const sh = normalizeHex(spool.color_hex);
    const ph = normalizeHex(spare.color_hex);
    if (ph && sh) return ph === sh;
    const sn = String(spool.color_name || '').trim().toLowerCase();
    const pn = String(spare.color_name || '').trim().toLowerCase();
    return !!pn && sn === pn;
  };
  const groupByLabel = new Map(groups.map((g) => [g.label, g]));

  for (const spare of spares) {
    const label = `${spare.brand || 'Generic'} ${spare.material || 'Filament'}`.trim();
    let group = groupByLabel.get(label);
    if (!group) {
      group = {
        label, brand: spare.brand || 'Generic', material: spare.material || 'Filament',
        count: 0, totalRemainingG: 0, spools: [], spareCount: 0,
      };
      groups.push(group);
      groupByLabel.set(label, group);
    }
    const target = group.spools.find((s) => colourMatches(s, spare));
    if (target) {
      target.spareCount = (target.spareCount || 0) + spare.spare_count;
      target.spareId = spare.id;
    } else {
      // Spare-only colour — a sealed row so it appears next to loaded rolls.
      group.spools.push({
        id: -spare.id, tray_uuid: null, brand: spare.brand, material: spare.material,
        color_name: spare.color_name, color_hex: spare.color_hex, filament_code: spare.filament_code,
        remain_percent: null, capacity_g: spare.unit_weight_g || 1000, remaining_g: null,
        source: 'spare', last_dev_id: null, is_spare: true,
        spareCount: spare.spare_count, spareId: spare.id,
      });
    }
    group.spareCount = (group.spareCount || 0) + spare.spare_count;
  }

  const totalSpools = rows.length;
  const totalRemainingG = rows.reduce((sum, r) => sum + (Number(r.remaining_g) || 0), 0);
  const totalSpares = spares.reduce((sum, s) => sum + (Number(s.spare_count) || 0), 0);
  return {
    groups,
    archived,
    spares,
    totals: { spools: totalSpools, remainingG: totalRemainingG, spares: totalSpares },
  };
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
  resolveColorName,
  backfillColorNames,
  syncTraysToInventory,
  listInventory,
  addManualSpool,
  updateSpool,
  deleteSpool,
  // spares
  addSpares,
  applyImportedItems,
  listSpares,
  adjustSpare,
  adjustSpareForColor,
  patchSpare,
  deleteSpare,
};

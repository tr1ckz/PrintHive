// Bambu filament colour resolution.
//
// The AMS is inconsistent about what it reports for a spool's colour name
// (`tray_id_name`): genuine RFID reads give a friendly name ("Scarlet Red"),
// but many reads give only a short variant code ("A01-R1", "B00-K0"), and the
// material code (`tray_info_idx`) comes through as "GFA01" rather than a numeric
// id. The one field that is always canonical is the colour hex — Bambu's swatch
// colours are fixed, so #DE4343 is always Scarlet Red.
//
// So we resolve a name in this order (see filamentInventory):
//   1. the printer's own name, IF it's a real name and not a code;
//   2. this hex -> name table (Bambu catalog);
//   3. a name previously learned from any printer for the same hex;
//   4. nothing -> the UI shows just the hex (never a wrong name).

// Canonical Bambu catalog hexes. Cross-verified against live AMS telemetry.
const BAMBU_COLORS_BY_HEX = {
  '#FFFFFF': 'Ivory White',
  '#9B9EA0': 'Ash Grey',
  '#000000': 'Charcoal',
  '#E8AFCF': 'Sakura Pink',
  '#AE96D4': 'Lilac Purple',
  '#DE4343': 'Scarlet Red',
  '#F99963': 'Mandarin Orange',
  '#F7D959': 'Lemon Yellow',
  '#61C680': 'Grass Green',
  '#042F56': 'Dark Blue',
};

// Legacy numeric filament codes some firmware reports as tray_info_idx. Kept as
// a secondary key; the hex table above is the primary source.
const BAMBU_COLORS_BY_CODE = {
  '11100': 'Ivory White',
  '11101': 'Charcoal',
  '11200': 'Scarlet Red',
  '11300': 'Mandarin Orange',
  '11500': 'Grass Green',
  '11602': 'Dark Blue',
  '11700': 'Lilac Purple',
};

// A "colour name" that is actually a machine code, e.g. "A01-R1", "B00-K0", or
// one that echoes the filament/material code ("GFA01"). These aren't real names.
function isPlaceholderColorName(name) {
  if (!name) return true;
  const s = String(name).trim();
  if (!s) return true;
  return /^[A-Z]{1,2}\d{2}-[A-Z0-9]+$/i.test(s) || /^GF[A-Z]\d{2}$/i.test(s);
}

function lookupBambuColorByHex(hex) {
  if (!hex) return null;
  return BAMBU_COLORS_BY_HEX[String(hex).trim().toUpperCase()] || null;
}

function lookupBambuColorName(code) {
  if (code == null) return null;
  return BAMBU_COLORS_BY_CODE[String(code).trim()] || null;
}

module.exports = {
  BAMBU_COLORS_BY_HEX,
  BAMBU_COLORS_BY_CODE,
  isPlaceholderColorName,
  lookupBambuColorByHex,
  lookupBambuColorName,
};

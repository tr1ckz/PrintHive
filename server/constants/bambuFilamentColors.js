// Bambu filament code -> official colour name.
//
// The AMS reports a filament code (`tray_info_idx`, e.g. "11700") for every
// recognised spool, but it does not always report the friendly colour name
// (`tray_id_name`) — third-party spools, manually-set slots, and some firmware
// revisions send only the code + hex. This is a best-effort seed so those still
// resolve to a real name.
//
// Precedence in filamentInventory: the name the *printer* reports always wins;
// then any name we've previously learned from this printer for the same code
// (see resolveLearnedColorName); and only then this static seed. Unknown codes
// fall through to just the hex, so a missing entry is never wrong — it's simply
// no name. Add rows here as you confirm them; keys are strings.
const BAMBU_FILAMENT_COLORS = {
  // Verified from live P1S AMS telemetry (PLA Matte series):
  '11100': 'Ivory White',
  '11101': 'Charcoal',
  '11200': 'Scarlet Red',
  '11300': 'Mandarin Orange',
  '11500': 'Grass Green',
  '11602': 'Dark Blue',
  '11700': 'Lilac Purple',
};

function lookupBambuColorName(code) {
  if (code == null) return null;
  const key = String(code).trim();
  return BAMBU_FILAMENT_COLORS[key] || null;
}

module.exports = { BAMBU_FILAMENT_COLORS, lookupBambuColorName };

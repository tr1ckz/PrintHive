// Bambu filament identity + colour resolution.
//
// Two facts the AMS reports are reliable: the filament code (`tray_info_idx`,
// e.g. "GFA01") and the colour hex. The colour *name* field (`tray_id_name`) is
// not — it's often a machine code ("A01-R1"). So we resolve names ourselves:
//
//   - The filament code maps to a product (GFA01 -> "Bambu PLA Matte"), which
//     gives us brand + material AND the product context needed to name a colour.
//   - The colour hex is only unambiguous *within* a product: #FFFFFF is
//     "Jade White" for PLA Basic but "Ivory White" for PLA Matte, and #000000 is
//     "Black" vs "Charcoal". So we look colours up by (product, hex).
//
// Future-proofing: an unknown code still resolves brand/material to Generic and,
// if the hex is unambiguous across every product, still yields a name; an unknown
// hex simply yields no name (the UI shows the hex) rather than a wrong guess.
// filamentInventory also learns any real name the printer reports and caches it
// by hex, so new colours fill in over time without a code change here.
//
// Data sources (July 2026):
//   - Filament code -> product: greghesp/ha-bambulab pybambu/filaments.json
//   - Product colour hexes: Bambu Lab official hex-code tables via
//     dadequate/bambu-lab-filament-colors

// tray_info_idx (GF code) -> product name.
const FILAMENT_PRODUCTS = {
  GFA00: 'Bambu PLA Basic', GFA01: 'Bambu PLA Matte', GFA02: 'Bambu PLA Metal',
  GFA05: 'Bambu PLA Silk', GFA06: 'Bambu PLA Silk+', GFA07: 'Bambu PLA Marble',
  GFA08: 'Bambu PLA Sparkle', GFA09: 'Bambu PLA Tough', GFA11: 'Bambu PLA Aero',
  GFA12: 'Bambu PLA Glow', GFA13: 'Bambu PLA Dynamic', GFA15: 'Bambu PLA Galaxy',
  GFA16: 'Bambu PLA Wood', GFA50: 'Bambu PLA-CF',
  GFB00: 'Bambu ABS', GFB01: 'Bambu ASA', GFB02: 'Bambu ASA-Aero',
  GFB50: 'Bambu ABS-GF', GFB51: 'Bambu ASA-CF', GFB60: 'PolyLite ABS',
  GFB61: 'PolyLite ASA', GFB98: 'Generic ASA', GFB99: 'Generic ABS',
  GFC00: 'Bambu PC', GFC01: 'Bambu PC FR', GFC99: 'Generic PC',
  GFG00: 'Bambu PETG Basic', GFG01: 'Bambu PETG Translucent', GFG02: 'Bambu PETG HF',
  GFG50: 'Bambu PETG-CF', GFG60: 'PolyLite PETG', GFG96: 'Generic PETG HF',
  GFG97: 'Generic PCTG', GFG98: 'Generic PETG-CF', GFG99: 'Generic PETG',
  GFL00: 'PolyLite PLA', GFL01: 'PolyTerra PLA', GFL03: 'eSUN PLA+',
  GFL04: 'Overture PLA', GFL05: 'Overture Matte PLA', GFL06: 'Fiberon PETG-ESD',
  GFL50: 'Fiberon PA6-CF', GFL51: 'Fiberon PA6-GF', GFL52: 'Fiberon PA12-CF',
  GFL53: 'Fiberon PA612-CF', GFL54: 'Fiberon PET-CF', GFL55: 'Fiberon PETG-rCF',
  GFL95: 'Generic PLA High Speed', GFL96: 'Generic PLA Silk', GFL98: 'Generic PLA-CF',
  GFL99: 'Generic PLA',
  GFN03: 'Bambu PA-CF', GFN04: 'Bambu PAHT-CF', GFN05: 'Bambu PA6-CF',
  GFN06: 'Bambu PPA-CF', GFN08: 'Bambu PA6-GF', GFN96: 'Generic PPA-GF',
  GFN97: 'Generic PPA-CF', GFN98: 'Generic PA-CF', GFN99: 'Generic PA',
  GFP95: 'Generic PP-GF', GFP96: 'Generic PP-CF', GFP97: 'Generic PP',
  GFP98: 'Generic PE-CF', GFP99: 'Generic PE', GFR98: 'Generic PHA', GFR99: 'Generic EVA',
  GFS00: 'Bambu Support W', GFS01: 'Bambu Support G', GFS02: 'Bambu Support For PLA',
  GFS03: 'Bambu Support For PA/PET', GFS04: 'Bambu PVA', GFS05: 'Bambu Support For PLA/PETG',
  GFS06: 'Bambu Support for ABS', GFS97: 'Generic BVOH', GFS98: 'Generic HIPS',
  GFS99: 'Generic PVA',
  GFT01: 'Bambu PET-CF', GFT02: 'Bambu PPS-CF', GFT97: 'Generic PPS', GFT98: 'Generic PPS-CF',
  GFU00: 'Bambu TPU 95A HF', GFU01: 'Bambu TPU 95A', GFU02: 'Bambu TPU for AMS',
  GFU98: 'Generic TPU for AMS', GFU99: 'Generic TPU',
};

// Product material -> { HEX: colour name }. Hexes are only unique within a
// product, so this is keyed by material (the part after the brand).
const COLORS_BY_PRODUCT = {
  'PLA Basic': {
    '#FFFFFF': 'Jade White', '#000000': 'Black', '#C12E1F': 'Red', '#0A2989': 'Blue',
    '#8E9089': 'Gray', '#00AE42': 'Bambu Green', '#3F8E43': 'Mistletoe Green',
    '#0086D6': 'Cyan', '#FEC600': 'Sunflower Yellow', '#482960': 'Indigo Purple',
    '#6F5034': 'Cocoa Brown', '#F5547C': 'Hot Pink', '#FF9016': 'Pumpkin Orange',
  },
  'PLA Matte': {
    '#FFFFFF': 'Ivory White', '#CBC6B8': 'Bone White', '#E8DBB7': 'Desert Tan',
    '#D3B7A7': 'Latte Brown', '#AE835B': 'Caramel', '#B15533': 'Terracotta',
    '#7D6556': 'Dark Brown', '#4D3324': 'Dark Chocolate', '#AE96D4': 'Lilac Purple',
    '#E8AFCF': 'Sakura Pink', '#F99963': 'Mandarin Orange', '#F7D959': 'Lemon Yellow',
    '#950051': 'Plum', '#DE4343': 'Scarlet Red', '#BB3D43': 'Dark Red',
    '#68724D': 'Dark Green', '#61C680': 'Grass Green', '#C2E189': 'Apple Green',
    '#9B9EA0': 'Ash Gray', '#0078BF': 'Marine Blue', '#000000': 'Charcoal',
  },
  'PLA Tough': {
    '#FFFFFF': 'White', '#AFB1AE': 'Gray', '#000000': 'Black', '#959698': 'Silver',
    '#F4D53F': 'Yellow', '#009BD8': 'Cyan', '#DC3A27': 'Orange',
  },
  'PLA Translucent': {
    '#009FA1': 'Teal', '#96D8AF': 'Light Jade', '#0047BB': 'Blue', '#F5DBAB': 'Mellow Yellow',
    '#8344B0': 'Purple', '#F5B6CD': 'Cherry Pink', '#F74E02': 'Orange', '#B8CDE9': 'Ice Blue',
    '#B50011': 'Red', '#B8ACD6': 'Lavender',
  },
  'PLA-CF': {
    '#951E23': 'Burgundy Red', '#69398E': 'Iris Purple', '#5C9748': 'Matcha Green',
    '#6E88BC': 'Jeans Blue', '#2842AD': 'Royal Blue', '#4D5054': 'Lava Gray', '#000000': 'Black',
  },
  'PETG-CF': {
    '#9F332A': 'Brick Red', '#583061': 'Violet Purple', '#324585': 'Indigo Blue',
    '#16B08E': 'Malachite Green', '#000000': 'Black', '#565656': 'Titan Gray',
  },
  ABS: {
    '#FFFFFF': 'White', '#E8DBB7': 'Desert Tan', '#789D4A': 'Olive', '#489FDF': 'Azure',
    '#0C2340': 'Navy Blue', '#0A2CA5': 'Blue', '#FFC72C': 'Tangerine Yellow',
    '#FF6A13': 'Orange', '#D32941': 'Red', '#AF1685': 'Purple', '#87909A': 'Silver',
    '#000000': 'Black', '#00AE42': 'Bambu Green',
  },
  TPU: {
    '#000000': 'Black', '#FFFFEE': 'White', '#D6ABFF': 'Grape Jelly', '#7EB4E1': 'Crystal Blue',
    '#5C4738': 'Cocoa Brown', '#9EA2A2': 'Quicksilver', '#F1AAA8': 'Blaze (Light)',
    '#D21B3C': 'Blaze (Dark)', '#40B6E4': 'Frozen (Blue)',
  },
  'PLA Silk': {
    '#720062': 'Mystic Magenta (Purple)', '#3A913F': 'Mystic Magenta (Green)',
    '#00629B': 'Phantom Blue (Blue)',
  },
  'PLA Wood': {
    '#4F3F24': 'Black Walnut', '#4C241C': 'Rosewood', '#995F11': 'Clay Brown',
    '#918669': 'Classic Birch', '#D6CCA3': 'White Oak', '#C98935': 'Ochre Yellow',
  },
};

// Some product materials share a colour set with a differently-named group above.
const COLOR_GROUP_ALIASES = {
  'PLA Silk+': 'PLA Silk',
  'PLA Tough+': 'PLA Tough',
  'TPU 95A': 'TPU', 'TPU 95A HF': 'TPU', 'TPU for AMS': 'TPU',
};

function normHex(hex) {
  if (!hex) return null;
  const s = String(hex).replace(/^#/, '').trim();
  return /^[0-9a-fA-F]{6}/.test(s) ? `#${s.slice(0, 6).toUpperCase()}` : null;
}

function productForCode(code) {
  if (!code) return null;
  return FILAMENT_PRODUCTS[String(code).trim().toUpperCase()] || null;
}

// "Bambu PLA Matte" -> { brand: 'Bambu Lab', material: 'PLA Matte' }.
function brandMaterialForCode(code) {
  const product = productForCode(code);
  if (!product) return null;
  const m = product.match(/^(Bambu|Generic|PolyLite|PolyTerra|eSUN|Overture|Fiberon)\s+(.+)$/);
  if (!m) return { brand: 'Generic', material: product };
  return { brand: m[1] === 'Bambu' ? 'Bambu Lab' : m[1], material: m[2] };
}

function groupForMaterial(material) {
  if (!material) return null;
  if (COLORS_BY_PRODUCT[material]) return material;
  return COLOR_GROUP_ALIASES[material] || null;
}

// Every distinct name a hex maps to across all products. Used to decide whether
// a hex can be named without knowing the product.
function namesForHex(hex) {
  const H = normHex(hex);
  const names = new Set();
  if (!H) return names;
  for (const group of Object.values(COLORS_BY_PRODUCT)) {
    if (group[H]) names.add(group[H]);
  }
  return names;
}

// Resolve a colour name from (filament code, hex). Precise when the code gives a
// product; otherwise only when the hex is unambiguous across all products.
function lookupBambuColorName(code, hex) {
  const H = normHex(hex);
  if (!H) return null;
  const bm = brandMaterialForCode(code);
  const group = bm ? groupForMaterial(bm.material) : null;
  if (group && COLORS_BY_PRODUCT[group] && COLORS_BY_PRODUCT[group][H]) {
    return COLORS_BY_PRODUCT[group][H];
  }
  const names = namesForHex(H);
  return names.size === 1 ? [...names][0] : null;
}

// Hex-only resolution (no product context) — only returns a name when the hex is
// unambiguous. For callers like the statistics page that have just a colour.
function lookupBambuColorByHex(hex) {
  const names = namesForHex(hex);
  return names.size === 1 ? [...names][0] : null;
}

// Generic fallback palette — basic human colour names for hexes that aren't in
// the Bambu catalog (third-party spools, generic profiles). Picked by nearest
// RGB distance so every spool gets a readable label instead of a bare hex.
const BASIC_COLORS = {
  White: '#FFFFFF', 'Off White': '#F0EEE6', Beige: '#F5F5DC', Tan: '#D2B48C',
  'Light Gray': '#C0C0C0', Gray: '#808080', 'Dark Gray': '#404040', Black: '#000000',
  Red: '#E01B1B', 'Dark Red': '#8B0000', Maroon: '#5B1A18', Orange: '#FF8C1A',
  'Burnt Orange': '#CC5500', Brown: '#7B4B27', Gold: '#D4AF37', Yellow: '#F4E01F',
  'Light Green': '#90EE90', Lime: '#8FD400', Green: '#2E9E44', 'Dark Green': '#1F5C33',
  Teal: '#008080', Cyan: '#3FC5D8', 'Light Blue': '#9FC8E8', 'Sky Blue': '#4FA8E0',
  Blue: '#1F5FD0', Navy: '#0C1F52', Purple: '#7A3FB0', Violet: '#9B59B6',
  Magenta: '#D6249A', Pink: '#F1A7C4', 'Hot Pink': '#F5547C',
};

function nearestBasicColorName(hex) {
  const H = normHex(hex);
  if (!H) return null;
  const r = parseInt(H.slice(1, 3), 16);
  const g = parseInt(H.slice(3, 5), 16);
  const b = parseInt(H.slice(5, 7), 16);
  let best = null;
  let bestDist = Infinity;
  for (const [name, ref] of Object.entries(BASIC_COLORS)) {
    const rr = parseInt(ref.slice(1, 3), 16);
    const rg = parseInt(ref.slice(3, 5), 16);
    const rb = parseInt(ref.slice(5, 7), 16);
    const d = (r - rr) ** 2 + (g - rg) ** 2 + (b - rb) ** 2;
    if (d < bestDist) { bestDist = d; best = name; }
  }
  return best;
}

// Best available colour name for a spool: exact Bambu catalog name when the
// (product, hex) is known, otherwise a nearest generic name so a hex is never
// shown raw. Returns null only when there's no hex at all.
function describeColor(code, hex) {
  return lookupBambuColorName(code, hex) || nearestBasicColorName(hex);
}

// A "colour name" that is actually a machine code, e.g. "A01-R1", "B00-K0", or
// one that echoes the filament/material code ("GFA01"). These aren't real names.
function isPlaceholderColorName(name) {
  if (!name) return true;
  const s = String(name).trim();
  if (!s) return true;
  return /^[A-Z]{1,2}\d{2}-[A-Z0-9]+$/i.test(s) || /^GF[A-Z]\d{2}$/i.test(s);
}

module.exports = {
  FILAMENT_PRODUCTS,
  COLORS_BY_PRODUCT,
  productForCode,
  brandMaterialForCode,
  lookupBambuColorName,
  lookupBambuColorByHex,
  nearestBasicColorName,
  describeColor,
  isPlaceholderColorName,
};

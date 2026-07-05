// Parse a Bambu Lab order confirmation into filament line items so refills can
// be added to inventory in bulk. Works on text pasted from the order email and
// on OCR text from an uploaded screenshot, so it is deliberately tolerant of
// line wrapping and stray whitespace.
//
// A Bambu order line looks like:
//   PETG Basic x 1
//   Yellow(30402) / Refill / 1kg
//   ...price lines...
// or, wrapped in a narrow screenshot:
//   PLA Matte x 1
//   Matte Latte Brown
//   (11800) / Refill / 1kg
//
// The distinctive part is the variant line: "<Colour>(<code>) / <kind> / <w>kg".
// We anchor on that and read the material from the most recent "X x N" header.

const { brandMaterialForCode } = require('../constants/bambuFilamentColors');

// A product header, e.g. "PETG Basic x 1", "PLA Matte x 2". Left side is the
// material; the trailing count is that line item's quantity.
const HEADER_RE = /^(.+?)\s+x\s*(\d+)\s*$/i;

// A variant line: colour name, numeric store code, kind, weight. The colour name
// may be empty here when it wrapped onto the previous line.
const VARIANT_RE = /^(.*?)\((\d{3,7})\)\s*\/\s*(Refill|Filament with spool|Filament)\s*\/\s*([\d.]+)\s*kg/i;

// Materials we recognise, so a stray "Foo x 1" line isn't mistaken for a header.
const MATERIAL_HINT = /\b(PLA|PETG|ABS|ASA|PC|PVA|TPU|PA|PAHT|PPA|PPS|PET|Support|Silk|Wood|Basic|Matte|Tough|CF|GF|HF)\b/i;

function cleanColorName(raw, material) {
  let name = String(raw || '').replace(/\s+/g, ' ').trim();
  // The store prefixes matte colours with "Matte " ("Matte Latte Brown"); the
  // catalog name is just "Latte Brown". Drop it when the material is already Matte.
  if (/matte/i.test(material || '') && /^matte\s+/i.test(name)) {
    name = name.replace(/^matte\s+/i, '');
  }
  return name || null;
}

// "PETG Basic" / "PLA Matte" from the store are Bambu Lab products.
function brandMaterialFromHeader(header) {
  const material = String(header || '').replace(/\s+/g, ' ').trim();
  if (!material) return { brand: 'Bambu Lab', material: 'Filament' };
  return { brand: 'Bambu Lab', material };
}

/**
 * Parse order text into filament line items.
 * @param {string} text - Pasted email text or OCR output
 * @returns {Array<{brand,material,colorName,code,kind,isRefill,unitWeightG,quantity}>}
 */
function parseBambuReceipt(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/ /g, ' ').trim())
    .filter(Boolean);

  const items = [];
  let header = null;   // { brand, material }
  let quantity = 1;
  let pendingName = ''; // a colour name that may have wrapped above its variant line

  for (const line of lines) {
    const headerMatch = line.match(HEADER_RE);
    if (headerMatch && MATERIAL_HINT.test(headerMatch[1])) {
      header = brandMaterialFromHeader(headerMatch[1]);
      quantity = Math.max(1, parseInt(headerMatch[2], 10) || 1);
      pendingName = '';
      continue;
    }

    const variant = line.match(VARIANT_RE);
    if (variant) {
      const colorName = cleanColorName(variant[1] || pendingName, header?.material);
      const code = variant[2];
      const kind = /spool/i.test(variant[3]) ? 'spool' : 'refill';
      const unitWeightG = Math.round(parseFloat(variant[4]) * 1000) || 1000;

      // Prefer a product identity from the numeric/GF code if we know it,
      // otherwise use the material from the header.
      const fromCode = brandMaterialForCode(code);
      const brand = fromCode?.brand || header?.brand || 'Bambu Lab';
      const material = fromCode?.material || header?.material || 'Filament';

      items.push({
        brand,
        material,
        colorName,
        code,
        kind,
        isRefill: kind === 'refill',
        unitWeightG,
        quantity,
      });
      pendingName = '';
      continue;
    }

    // Not a header or variant — remember it as a possible wrapped colour name
    // (short, no price/currency), so the next variant line can use it.
    if (!/[$€£]|\bCAD\b|\bUSD\b|bulk sale|subtotal|total/i.test(line) && line.length <= 40) {
      pendingName = line;
    }
  }

  return items;
}

module.exports = { parseBambuReceipt, cleanColorName };

// Parse a Bambu Lab order (pasted email text or OCR'd screenshot) into filament
// line items. OCR wraps a single item across lines, so we split into blocks —
// each starting at a "<material> x N" header — join each block, and pull the
// variant "<Colour>(<code>) / <kind> / <weight>kg" out of the joined text.

const { brandMaterialForCode } = require('../constants/bambuFilamentColors');

// A product header, e.g. "PETG Basic x 1", "PLA Matte x 2". Tolerant of x/×.
const HEADER_RE = /^(.+?)\s*[x×]\s*(\d+)\s*$/i;

// The variant, found anywhere in a joined block: colour name, numeric store
// code, kind, weight. Longer "Filament with spool" is listed before "Filament".
const VARIANT_RE = /(.*?)\((\d{3,7})\)\s*\/\s*(Refill|Filament with spool|Filament)\s*\/\s*([\d.]+)\s*kg/i;

// Materials we recognise, so a stray "Foo x 1" line isn't mistaken for a header.
const MATERIAL_HINT = /\b(PLA|PETG|ABS|ASA|PC|PVA|TPU|PA|PAHT|PPA|PPS|PET|Support|Silk|Wood|Basic|Matte|Tough|CF|GF|HF)\b/i;

function cleanColorName(raw, material) {
  let name = String(raw || '').replace(/\s+/g, ' ').trim();
  // The store prefixes matte colours with "Matte " ("Matte Latte Brown"); the
  // catalog name is just "Latte Brown". Drop it when the material is Matte.
  if (/matte/i.test(material || '') && /^matte\s+/i.test(name)) {
    name = name.replace(/^matte\s+/i, '');
  }
  // A joined block can leave leftover words before the colour (e.g. a stray
  // price fragment); keep only the trailing colour phrase after the last "/".
  if (name.includes('/')) name = name.split('/').pop().trim();
  return name || null;
}

function parseBambuReceipt(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/ /g, ' ').trim())
    .filter(Boolean);

  // Split into blocks, one per "<material> x N" header.
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const header = line.match(HEADER_RE);
    if (header && MATERIAL_HINT.test(header[1])) {
      current = {
        material: header[1].replace(/\s+/g, ' ').trim(),
        quantity: Math.max(1, parseInt(header[2], 10) || 1),
        buf: [],
      };
      blocks.push(current);
      continue;
    }
    if (current) current.buf.push(line);
  }

  const items = [];
  for (const block of blocks) {
    const joined = block.buf.join(' ').replace(/\s+/g, ' ');
    const variant = joined.match(VARIANT_RE);
    if (!variant) continue;

    const colorName = cleanColorName(variant[1], block.material);
    const code = variant[2];
    const kind = /spool/i.test(variant[3]) ? 'spool' : 'refill';
    const unitWeightG = Math.round(parseFloat(variant[4]) * 1000) || 1000;

    // A known GF code overrides the header material; the numeric store codes
    // aren't GF codes, so those fall back to the header ("PETG Basic").
    const fromCode = brandMaterialForCode(code);
    const brand = fromCode?.brand || 'Bambu Lab';
    const material = fromCode?.material || block.material || 'Filament';

    items.push({
      brand,
      material,
      colorName,
      code,
      kind,
      isRefill: kind === 'refill',
      unitWeightG,
      quantity: block.quantity,
    });
  }

  return items;
}

module.exports = { parseBambuReceipt, cleanColorName };

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseBambuReceipt } = require('../../server/services/bambuReceiptParser');

const RECEIPT = `
PETG Basic x 1
Yellow(30402) / Refill / 1kg
Filament Bulk Sale
-$8.75 CAD
$16.24 CAD
$24.99 CAD
PETG Basic x 1
Green(30502) / Refill / 1kg
$16.24 CAD
PETG Basic x 1
Gray(30107) / Filament with spool / 1kg
$18.84 CAD
PLA Matte x 1
Matte Latte Brown(11800) / Refill / 1kg
$16.89 CAD
`;

describe('parseBambuReceipt', () => {
  it('parses every line item from a Bambu order', () => {
    const items = parseBambuReceipt(RECEIPT);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ material: 'PETG Basic', colorName: 'Yellow', code: '30402', isRefill: true, unitWeightG: 1000, quantity: 1 });
    expect(items[1]).toMatchObject({ colorName: 'Green', code: '30502', isRefill: true });
    // "Filament with spool" is not a refill
    expect(items[2]).toMatchObject({ colorName: 'Gray', code: '30107', kind: 'spool', isRefill: false });
  });

  it('strips the "Matte" prefix so the colour matches the catalog', () => {
    const items = parseBambuReceipt(RECEIPT);
    expect(items[3]).toMatchObject({ material: 'PLA Matte', colorName: 'Latte Brown', code: '11800' });
  });

  it('carries the header quantity onto the item', () => {
    const items = parseBambuReceipt('ABS x 3\nBlack(40100) / Refill / 1kg');
    expect(items[0]).toMatchObject({ material: 'ABS', colorName: 'Black', quantity: 3 });
  });

  it('handles a colour name wrapped above its variant line (screenshot OCR)', () => {
    const items = parseBambuReceipt('PLA Matte x 1\nSakura Pink\n(11202) / Refill / 1kg');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ colorName: 'Sakura Pink', code: '11202' });
  });

  it('returns nothing for unrelated text', () => {
    expect(parseBambuReceipt('Thanks for your order!\nSubtotal $50.00')).toEqual([]);
    expect(parseBambuReceipt('')).toEqual([]);
  });
});

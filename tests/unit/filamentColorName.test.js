import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  lookupBambuColorName,
  lookupBambuColorByHex,
  nearestBasicColorName,
  describeColor,
  brandMaterialForCode,
  isPlaceholderColorName,
} = require('../../server/constants/bambuFilamentColors');
const { buildSpoolFromTray } = require('../../server/services/filamentInventory.js');

describe('brandMaterialForCode', () => {
  it('maps a Bambu filament code to brand + material', () => {
    expect(brandMaterialForCode('GFA01')).toEqual({ brand: 'Bambu Lab', material: 'PLA Matte' });
    expect(brandMaterialForCode('GFA00')).toEqual({ brand: 'Bambu Lab', material: 'PLA Basic' });
    expect(brandMaterialForCode('GFB00')).toEqual({ brand: 'Bambu Lab', material: 'ABS' });
  });
  it('keeps third-party/generic brands', () => {
    expect(brandMaterialForCode('GFL01')).toEqual({ brand: 'PolyTerra', material: 'PLA' });
    expect(brandMaterialForCode('GFL99')).toEqual({ brand: 'Generic', material: 'PLA' });
  });
  it('returns null for an unknown code', () => {
    expect(brandMaterialForCode('ZZZ99')).toBeNull();
    expect(brandMaterialForCode(null)).toBeNull();
  });
});

describe('lookupBambuColorName (product-aware)', () => {
  it('disambiguates the same hex by product', () => {
    expect(lookupBambuColorName('GFA00', '#FFFFFF')).toBe('Jade White');   // PLA Basic
    expect(lookupBambuColorName('GFA01', '#FFFFFF')).toBe('Ivory White');  // PLA Matte
    expect(lookupBambuColorName('GFA00', '#000000')).toBe('Black');        // PLA Basic
    expect(lookupBambuColorName('GFA01', '#000000')).toBe('Charcoal');     // PLA Matte
  });
  it('resolves without a code when the hex is unambiguous', () => {
    expect(lookupBambuColorName(null, '#DE4343')).toBe('Scarlet Red');
    expect(lookupBambuColorName(null, '#F99963')).toBe('Mandarin Orange');
  });
  it('refuses to guess an ambiguous hex with no product context', () => {
    expect(lookupBambuColorName(null, '#FFFFFF')).toBeNull();
    expect(lookupBambuColorName(null, '#000000')).toBeNull();
  });
  it('returns null for an unknown hex', () => {
    expect(lookupBambuColorName('GFA01', '#123456')).toBeNull();
  });
});

describe('lookupBambuColorByHex (hex-only, e.g. stats)', () => {
  it('names an unambiguous hex', () => {
    expect(lookupBambuColorByHex('#AE96D4')).toBe('Lilac Purple');
    expect(lookupBambuColorByHex('#61C680')).toBe('Grass Green');
  });
  it('stays null when the hex is ambiguous across products', () => {
    expect(lookupBambuColorByHex('#FFFFFF')).toBeNull();
    expect(lookupBambuColorByHex('#000000')).toBeNull();
  });
});

describe('isPlaceholderColorName', () => {
  it('flags machine codes reported in the name field', () => {
    expect(isPlaceholderColorName('A01-R1')).toBe(true);
    expect(isPlaceholderColorName('B00-K0')).toBe(true);
    expect(isPlaceholderColorName('GFA01')).toBe(true);
  });
  it('keeps a real colour name', () => {
    expect(isPlaceholderColorName('Scarlet Red')).toBe(false);
  });
});

describe('buildSpoolFromTray', () => {
  it('uses the filament code for brand/material and resolves the colour from code+hex', () => {
    const spool = buildSpoolFromTray('dev1', {
      slot: 0, tray_uuid: 'UUID-A', type: 'PLA', sub_brands: 'Generic PLA Matte',
      tray_id_name: 'A01-R1', tray_info_idx: 'GFA01', color: 'DE4343FF', remain: 80,
    });
    expect(spool.brand).toBe('Bambu Lab');
    expect(spool.material).toBe('PLA Matte');
    expect(spool.color_name).toBe('Scarlet Red');
  });
  it('keeps the printer name when it is a real one', () => {
    const spool = buildSpoolFromTray('dev1', {
      slot: 0, tray_uuid: 'UUID-B', type: 'PLA', tray_id_name: 'Lilac Purple',
      tray_info_idx: 'GFA01', color: 'AE96D4FF', remain: 50,
    });
    expect(spool.color_name).toBe('Lilac Purple');
  });
  it('falls back to a generic colour name for a non-catalog hex', () => {
    const spool = buildSpoolFromTray('dev1', {
      slot: 0, tray_uuid: 'UUID-C', type: 'PLA', tray_id_name: 'A01-Z9',
      tray_info_idx: 'GFA01', color: '1F79E5FF', remain: 50,
    });
    // Not a Bambu catalog hex -> nearest basic name instead of a bare hex.
    expect(spool.color_name).toBe('Blue');
  });
});

describe('nearestBasicColorName / describeColor', () => {
  it('names any hex by nearest basic colour', () => {
    expect(nearestBasicColorName('#1F79E5')).toBe('Blue');
    expect(nearestBasicColorName('#A1FFA0')).toBe('Light Green');
    expect(nearestBasicColorName('#000000')).toBe('Black');
  });
  it('describeColor prefers the exact Bambu name, else generic', () => {
    expect(describeColor('GFA01', '#DE4343')).toBe('Scarlet Red'); // exact
    expect(describeColor('GFG96', '#1F79E5')).toBe('Blue');        // generic
  });
  it('returns null only when there is no hex', () => {
    expect(nearestBasicColorName(null)).toBeNull();
    expect(describeColor('GFA01', null)).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  lookupBambuColorByHex,
  isPlaceholderColorName,
} = require('../../server/constants/bambuFilamentColors');
const { buildSpoolFromTray } = require('../../server/services/filamentInventory.js');

describe('lookupBambuColorByHex', () => {
  it('resolves a canonical Bambu hex to its catalog name', () => {
    expect(lookupBambuColorByHex('#DE4343')).toBe('Scarlet Red');
    expect(lookupBambuColorByHex('#ae96d4')).toBe('Lilac Purple'); // case-insensitive
    expect(lookupBambuColorByHex('#F99963')).toBe('Mandarin Orange');
  });
  it('returns null for an unknown hex (never invents a name)', () => {
    expect(lookupBambuColorByHex('#123456')).toBeNull();
    expect(lookupBambuColorByHex('')).toBeNull();
    expect(lookupBambuColorByHex(null)).toBeNull();
  });
});

describe('isPlaceholderColorName', () => {
  it('flags machine codes the AMS reports in the name field', () => {
    expect(isPlaceholderColorName('A01-R1')).toBe(true);
    expect(isPlaceholderColorName('B00-K0')).toBe(true);
    expect(isPlaceholderColorName('GFA01')).toBe(true);
    expect(isPlaceholderColorName('')).toBe(true);
    expect(isPlaceholderColorName(null)).toBe(true);
  });
  it('keeps a real colour name', () => {
    expect(isPlaceholderColorName('Scarlet Red')).toBe(false);
    expect(isPlaceholderColorName('Lilac Purple')).toBe(false);
  });
});

describe('buildSpoolFromTray colour-name resolution', () => {
  it('resolves the real name from the hex when the printer reports a code', () => {
    const spool = buildSpoolFromTray('dev1', {
      slot: 0, tray_uuid: 'UUID-A', type: 'PLA', sub_brands: 'Generic PLA Matte',
      tray_id_name: 'A01-R1', tray_info_idx: 'GFA01', color: 'DE4343FF', remain: 80,
    });
    expect(spool.color_name).toBe('Scarlet Red');
  });
  it('keeps the printer name when it is a real one', () => {
    const spool = buildSpoolFromTray('dev1', {
      slot: 0, tray_uuid: 'UUID-B', type: 'PLA', tray_id_name: 'Lilac Purple',
      tray_info_idx: 'GFA01', color: 'AE96D4FF', remain: 50,
    });
    expect(spool.color_name).toBe('Lilac Purple');
  });
  it('leaves the name null for an unknown hex + code (no wrong guess)', () => {
    const spool = buildSpoolFromTray('dev1', {
      slot: 0, tray_uuid: 'UUID-C', type: 'PLA', tray_id_name: 'A01-Z9',
      tray_info_idx: 'GFA01', color: '123456FF', remain: 50,
    });
    expect(spool.color_name).toBeNull();
  });
});

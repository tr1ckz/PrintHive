import { describe, it, expect } from 'vitest';
import {
  normalizeTrayUuid,
  normalizeHex,
  deriveBrandMaterial,
  buildSpoolFromTray,
  groupInventory,
} from '../../server/services/filamentInventory.js';

describe('normalizeTrayUuid', () => {
  it('treats empty / all-zero uuids as no identity', () => {
    expect(normalizeTrayUuid(null)).toBeNull();
    expect(normalizeTrayUuid('')).toBeNull();
    expect(normalizeTrayUuid('00000000000000000000000000000000')).toBeNull();
  });
  it('keeps a real uuid', () => {
    expect(normalizeTrayUuid('A1B2C3')).toBe('A1B2C3');
  });
});

describe('normalizeHex', () => {
  it('strips alpha and uppercases to #RRGGBB', () => {
    expect(normalizeHex('ae96d4ff')).toBe('#AE96D4');
    expect(normalizeHex('#61c680')).toBe('#61C680');
  });
  it('returns null for junk', () => {
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex('abc')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe('deriveBrandMaterial', () => {
  it('splits a Bambu sub-brand into brand + material', () => {
    expect(deriveBrandMaterial({ sub_brands: 'Bambu PLA Matte', type: 'PLA' }))
      .toEqual({ brand: 'Bambu Lab', material: 'PLA Matte' });
    expect(deriveBrandMaterial({ sub_brands: 'Bambu Lab ABS', type: 'ABS' }))
      .toEqual({ brand: 'Bambu Lab', material: 'ABS' });
  });
  it('falls back to the raw type when no sub-brand', () => {
    expect(deriveBrandMaterial({ type: 'PETG' })).toEqual({ brand: 'Generic', material: 'PETG' });
  });
  it('keeps a non-Bambu sub-brand as generic', () => {
    expect(deriveBrandMaterial({ sub_brands: 'PolyTerra PLA' }))
      .toEqual({ brand: 'Generic', material: 'PolyTerra PLA' });
  });
});

describe('buildSpoolFromTray', () => {
  it('returns null for an empty/unconfigured slot (no tag, no material)', () => {
    expect(buildSpoolFromTray('dev1', { slot: 0, tray_uuid: '0'.repeat(32), remain: 50 })).toBeNull();
    expect(buildSpoolFromTray('dev1', { color: 'ff0000', type: 'PLA', remain: 50 })).toBeNull(); // no slot
  });

  it('surfaces a tag-less loaded spool via a stable per-slot identity', () => {
    const spool = buildSpoolFromTray('dev1', { slot: 2, color: 'FF0000FF', type: 'PLA', sub_brands: 'Generic PLA' });
    expect(spool).not.toBeNull();
    expect(spool.tray_uuid).toBe('slot:dev1:2');
    expect(spool.material).toBe('Generic PLA');
    // same slot -> same synthetic identity (updates one row, not duplicates)
    expect(buildSpoolFromTray('dev1', { slot: 2, type: 'PLA', color: '00FF00FF' }).tray_uuid).toBe('slot:dev1:2');
  });

  it('derives grams from the remaining percentage on a 1kg spool', () => {
    const spool = buildSpoolFromTray('dev1', {
      tray_uuid: 'UUID-1', color: 'AE96D4FF', type: 'PLA', sub_brands: 'Bambu PLA Matte',
      remain: 54, tray_info_idx: '11700', tray_id_name: 'Lilac Purple',
    });
    expect(spool).toMatchObject({
      tray_uuid: 'UUID-1', brand: 'Bambu Lab', material: 'PLA Matte',
      color_name: 'Lilac Purple', color_hex: '#AE96D4', filament_code: '11700',
      remain_percent: 54, capacity_g: 1000, remaining_g: 540, source: 'ams',
    });
  });

  it('leaves grams null when the AMS reports no remaining %', () => {
    const spool = buildSpoolFromTray('dev1', { tray_uuid: 'UUID-2', color: '000000', type: 'ABS', remain: -1 });
    expect(spool.remain_percent).toBeNull();
    expect(spool.remaining_g).toBeNull();
  });
});

describe('groupInventory', () => {
  it('groups by brand+material with counts and total remaining weight', () => {
    const rows = [
      { id: 1, brand: 'Bambu Lab', material: 'PLA Matte', color_name: 'Red', remaining_g: 500 },
      { id: 2, brand: 'Bambu Lab', material: 'PLA Matte', color_name: 'Blue', remaining_g: 250 },
      { id: 3, brand: 'Bambu Lab', material: 'ABS', color_name: 'Black', remaining_g: 1000 },
    ];
    const groups = groupInventory(rows);
    expect(groups).toHaveLength(2);
    const matte = groups.find((g) => g.label === 'Bambu Lab PLA Matte');
    expect(matte.count).toBe(2);
    expect(matte.totalRemainingG).toBe(750);
    // sorted by color name within a group
    expect(matte.spools.map((s) => s.color_name)).toEqual(['Blue', 'Red']);
    const abs = groups.find((g) => g.label === 'Bambu Lab ABS');
    expect(abs.totalRemainingG).toBe(1000);
  });
});

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { lookupBambuColorName } = require('../../server/constants/bambuFilamentColors');

describe('lookupBambuColorName', () => {
  it('resolves a verified Bambu filament code to its catalog name', () => {
    expect(lookupBambuColorName('11700')).toBe('Lilac Purple');
    expect(lookupBambuColorName('11200')).toBe('Scarlet Red');
    expect(lookupBambuColorName(11101)).toBe('Charcoal'); // numeric code too
  });

  it('returns null for an unknown code (never invents a name)', () => {
    expect(lookupBambuColorName('99999')).toBeNull();
    expect(lookupBambuColorName('')).toBeNull();
    expect(lookupBambuColorName(null)).toBeNull();
  });
});

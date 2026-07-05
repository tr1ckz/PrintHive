import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { liveRemainingGrams } = require('../../server/services/filamentInventory');

// Fresh module state isn't trivially resettable, so use a unique uuid per test.
let n = 0;
const spool = (remaining_g) => ({ tray_uuid: `S${n}`, remaining_g, capacity_g: 1000 });
const ctx = (o) => ({ gcodeState: 'RUNNING', progress: 0, printWeight: 0, ...o });

describe('liveRemainingGrams', () => {
  beforeEach(() => { n += 1; });

  it('returns the AMS grams unchanged when not printing', () => {
    expect(liveRemainingGrams(spool(370), ctx({ gcodeState: 'IDLE', printWeight: 200, progress: 50 }), true)).toBe(370);
  });

  it('returns AMS grams for a tray that is not the active one', () => {
    expect(liveRemainingGrams(spool(370), ctx({ printWeight: 200, progress: 50 }), false)).toBe(370);
  });

  it('uses cloud print_weight as an explicit rate when present', () => {
    const s = spool(370);
    // 200 g job -> 2 g/%. Anchor at progress 4, then at progress 8 => -8 g.
    expect(liveRemainingGrams(s, ctx({ printWeight: 200, progress: 4 }), true)).toBe(370); // anchor
    expect(liveRemainingGrams(s, ctx({ printWeight: 200, progress: 8 }), true)).toBe(362);
  });

  it('self-calibrates from AMS steps when print_weight is absent (P1S local)', () => {
    const s = { tray_uuid: `C${n}`, remaining_g: 370, capacity_g: 1000 };
    // No print_weight at all — only AMS % and progress.
    expect(liveRemainingGrams(s, ctx({ progress: 0 }), true)).toBe(370); // anchor, uncalibrated
    // Before calibration we can't interpolate, so still the AMS reading.
    expect(liveRemainingGrams(s, ctx({ progress: 3 }), true)).toBe(370);
    // AMS drops 10 g over 5% of progress -> 2 g/% learned, re-anchors at 360.
    s.remaining_g = 360;
    expect(liveRemainingGrams(s, ctx({ progress: 5 }), true)).toBe(360);
    // Now interpolate: +3% * 2 g/% = 6 g below 360.
    expect(liveRemainingGrams(s, ctx({ progress: 8 }), true)).toBe(354);
  });

  it('never interpolates past the current 10 g band', () => {
    const s = { tray_uuid: `B${n}`, remaining_g: 370, capacity_g: 1000 };
    liveRemainingGrams(s, ctx({ printWeight: 1000, progress: 0 }), true); // anchor, 10 g/%
    // 10 g/% * 5% = 50 g, but must stay within this band -> clamps at 361.
    expect(liveRemainingGrams(s, ctx({ printWeight: 1000, progress: 5 }), true)).toBe(361);
  });

  it('re-anchors upward on a refill/swap (AMS goes up)', () => {
    const s = { tray_uuid: `R${n}`, remaining_g: 100, capacity_g: 1000 };
    liveRemainingGrams(s, ctx({ printWeight: 200, progress: 10 }), true); // anchor at 100
    s.remaining_g = 1000; // fresh roll loaded
    expect(liveRemainingGrams(s, ctx({ printWeight: 200, progress: 12 }), true)).toBe(1000);
  });
});

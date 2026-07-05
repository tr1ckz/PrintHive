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

  it('interpolates below the AMS 10g step as the print consumes filament', () => {
    const s = spool(370);
    // First reading anchors at the AMS value; then it refines downward as the
    // job progresses (job total 200g).
    expect(liveRemainingGrams(s, ctx({ printWeight: 200, progress: 4 }), true)).toBe(370); // anchor (8g consumed)
    expect(liveRemainingGrams(s, ctx({ printWeight: 200, progress: 8 }), true)).toBe(362); // +8g consumed -> 362
  });

  it('re-anchors down when the AMS %-step ground truth drops', () => {
    const s = { tray_uuid: `R${n}`, remaining_g: 370, capacity_g: 1000 };
    liveRemainingGrams(s, ctx({ printWeight: 200, progress: 2 }), true); // anchor at 370
    s.remaining_g = 360; // AMS stepped down
    expect(liveRemainingGrams(s, ctx({ printWeight: 200, progress: 5 }), true)).toBe(360); // snaps to truth
  });

  it('never goes negative', () => {
    const s = spool(50);
    liveRemainingGrams(s, ctx({ printWeight: 1000, progress: 0 }), true); // anchor at 50
    expect(liveRemainingGrams(s, ctx({ printWeight: 1000, progress: 90 }), true)).toBe(0); // 900g consumed
  });
});

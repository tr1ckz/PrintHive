import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { flattenAmsPayload } = require('../../server/services/mqtt-client');

describe('flattenAmsPayload', () => {
  it('flattens multiple AMS units with global slot numbers', () => {
    const raw = {
      tray_now: '5',
      ams: [
        { id: '0', humidity: '4', tray: [
          { id: '0', tray_type: 'PLA', tray_color: 'FF0000FF', remain: 80, tray_uuid: 'U0' },
          { id: '1', tray_type: 'PLA', tray_color: '00FF00FF', remain: 60, tray_uuid: 'U1' },
        ]},
        { id: '1', humidity: '3', tray: [
          { id: '0', tray_type: 'ABS', tray_color: '000000FF', remain: 100, tray_uuid: 'U4' },
          { id: '3', tray_type: 'PETG', tray_color: '0000FFFF', remain: 20, tray_uuid: 'U7' },
        ]},
      ],
    };
    const out = flattenAmsPayload(raw);
    expect(out.unitCount).toBe(2);
    expect(out.trays).toHaveLength(4);
    expect(out.active_tray).toBe(5);
    // unit 0 keeps slots 0,1; unit 1 is offset into 4..7
    expect(out.trays.map((t) => t.slot)).toEqual([0, 1, 4, 7]);
    expect(out.trays.map((t) => t.ams_unit)).toEqual([0, 0, 1, 1]);
    expect(out.trays[2]).toMatchObject({ type: 'ABS', color: '000000FF', remain: 100, tray_uuid: 'U4' });
  });

  it('handles a single unit nested under ams.tray', () => {
    const out = flattenAmsPayload({ tray: [{ id: '0', tray_type: 'PLA', remain: 50 }], active_tray: 0 });
    expect(out.unitCount).toBe(1);
    expect(out.trays).toHaveLength(1);
    expect(out.trays[0]).toMatchObject({ slot: 0, ams_unit: 0, type: 'PLA', remain: 50 });
  });

  it('handles the legacy ams.trays shape', () => {
    const out = flattenAmsPayload({ trays: [{ id: '0', type: 'PLA' }, { id: '1', type: 'ABS' }] });
    expect(out.trays.map((t) => t.slot)).toEqual([0, 1]);
  });

  it('treats an already-global tray id as-is (no double offset)', () => {
    const raw = { ams: [{ id: '1', tray: [{ id: '4', tray_type: 'PLA' }, { id: '5', tray_type: 'PLA' }] }] };
    const out = flattenAmsPayload(raw);
    expect(out.trays.map((t) => t.slot)).toEqual([4, 5]);
  });

  it('normalizes remain of -1 (unknown) to null', () => {
    const out = flattenAmsPayload({ tray: [{ id: '0', tray_type: 'PLA', remain: -1 }] });
    expect(out.trays[0].remain).toBeNull();
  });

  it('returns null for a missing payload', () => {
    expect(flattenAmsPayload(null)).toBeNull();
  });
});

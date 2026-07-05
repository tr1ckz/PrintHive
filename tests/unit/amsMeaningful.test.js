import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BambuMqttClient = require('../../server/services/mqtt-client');

// Constructing the client does not open a connection, so this is safe.
const client = new BambuMqttClient('1.2.3.4', 'SN', 'code', 'test');

const withAms = (trays, extra = {}) => ({ gcode_state: 'IDLE', progress: 0, ...extra, ams: { trays } });

describe('MQTT hasMeaningfulUpdate — AMS changes', () => {
  it('treats a spool load (AMS appearing) as meaningful even with unchanged print state', () => {
    const before = withAms([]);
    const after = withAms([{ slot: 0, tray_uuid: 'A', type: 'PLA', color: 'FF0000', remain: 100 }]);
    expect(client.hasMeaningfulUpdate(before, after)).toBe(true);
  });

  it('treats a remaining-% drop as meaningful (so the filament manager updates live)', () => {
    const before = withAms([{ slot: 0, tray_uuid: 'A', type: 'PLA', color: 'FF0000', remain: 60 }]);
    const after = withAms([{ slot: 0, tray_uuid: 'A', type: 'PLA', color: 'FF0000', remain: 59 }]);
    expect(client.hasMeaningfulUpdate(before, after)).toBe(true);
  });

  it('treats a spool swap (different tag/colour) as meaningful', () => {
    const before = withAms([{ slot: 0, tray_uuid: 'A', type: 'PLA', color: 'FF0000', remain: 50 }]);
    const after = withAms([{ slot: 0, tray_uuid: 'B', type: 'PLA', color: '00FF00', remain: 100 }]);
    expect(client.hasMeaningfulUpdate(before, after)).toBe(true);
  });

  it('does not fire when the AMS and everything else are unchanged', () => {
    const same = withAms([{ slot: 0, tray_uuid: 'A', type: 'PLA', color: 'FF0000', remain: 50 }]);
    expect(client.hasMeaningfulUpdate(same, { ...same })).toBe(false);
  });
});

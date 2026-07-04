import { describe, it, expect } from 'vitest';
import {
  buildChamberAuthPayload,
  extractChamberFrames,
  looksLikeJpeg,
} from '../../server/services/bambuChamberCamera.js';

// Build a wire frame: 16-byte header (uint32 LE length + 12 pad) + payload.
function wireFrame(payload) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0xff, 0xd9]);

describe('buildChamberAuthPayload', () => {
  it('is exactly 80 bytes with the expected magic + padded credentials', () => {
    const buf = buildChamberAuthPayload('12345678', 'bblp');
    expect(buf.length).toBe(80);
    expect(buf.readUInt32LE(0)).toBe(0x40);
    expect(buf.readUInt32LE(4)).toBe(0x3000);
    expect(buf.readUInt32LE(8)).toBe(0);
    expect(buf.readUInt32LE(12)).toBe(0);
    // username at offset 16, padded to 32 bytes
    expect(buf.subarray(16, 20).toString('ascii')).toBe('bblp');
    expect(buf[20]).toBe(0); // null padding after username
    // access code at offset 48, padded to 32 bytes
    expect(buf.subarray(48, 56).toString('ascii')).toBe('12345678');
    expect(buf[56]).toBe(0);
  });

  it('truncates over-long values to 32 bytes (no overflow)', () => {
    const buf = buildChamberAuthPayload('x'.repeat(40), 'y'.repeat(40));
    expect(buf.length).toBe(80);
  });
});

describe('extractChamberFrames', () => {
  it('extracts a single complete frame and leaves no remainder', () => {
    const { frames, rest, desync } = extractChamberFrames(wireFrame(JPEG));
    expect(frames).toHaveLength(1);
    expect(frames[0].equals(JPEG)).toBe(true);
    expect(rest.length).toBe(0);
    expect(desync).toBe(false);
  });

  it('extracts multiple back-to-back frames', () => {
    const buf = Buffer.concat([wireFrame(JPEG), wireFrame(JPEG), wireFrame(JPEG)]);
    const { frames, rest } = extractChamberFrames(buf);
    expect(frames).toHaveLength(3);
    expect(rest.length).toBe(0);
  });

  it('carries a partial trailing frame forward as remainder', () => {
    const full = wireFrame(JPEG);
    const buf = Buffer.concat([wireFrame(JPEG), full.subarray(0, 10)]); // second frame cut short
    const { frames, rest } = extractChamberFrames(buf);
    expect(frames).toHaveLength(1);
    expect(rest.length).toBe(10); // the partial header waits for more bytes
  });

  it('waits when only a header (no payload yet) has arrived', () => {
    const header = wireFrame(JPEG).subarray(0, 16);
    const { frames, rest } = extractChamberFrames(header);
    expect(frames).toHaveLength(0);
    expect(rest.length).toBe(16);
  });

  it('flags desync on an implausible length header instead of allocating', () => {
    const bad = Buffer.alloc(20);
    bad.writeUInt32LE(0xffffffff, 0); // absurd size
    const { frames, desync } = extractChamberFrames(bad);
    expect(frames).toHaveLength(0);
    expect(desync).toBe(true);
  });
});

describe('looksLikeJpeg', () => {
  it('accepts a real SOI/EOI-bounded buffer and rejects junk', () => {
    expect(looksLikeJpeg(JPEG)).toBe(true);
    expect(looksLikeJpeg(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBe(false);
    expect(looksLikeJpeg(Buffer.alloc(0))).toBe(false);
  });
});

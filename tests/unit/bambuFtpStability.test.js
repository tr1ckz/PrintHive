import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const bambuFtp = require('../../server/services/bambuFtp');
const { BambuFtpService } = bambuFtp;

describe('BambuFtpService.parseContentLength', () => {
  it('extracts the byte size from a curl FTP --head response', () => {
    const head = 'Content-Type: application/octet-stream\r\nContent-Length: 10485760\r\nAccept-ranges: bytes\r\n';
    expect(BambuFtpService.parseContentLength(head)).toBe(10485760);
  });
  it('is case-insensitive and tolerant of extra whitespace', () => {
    expect(BambuFtpService.parseContentLength('content-length:   42')).toBe(42);
  });
  it('returns null when no size header is present', () => {
    expect(BambuFtpService.parseContentLength('200 OK\r\n')).toBeNull();
    expect(BambuFtpService.parseContentLength('')).toBeNull();
    expect(BambuFtpService.parseContentLength(null)).toBeNull();
  });
});

describe('BambuFtpService.isRemoteFileStable', () => {
  const withSizes = (sizes) => {
    const svc = new BambuFtpService();
    let i = 0;
    svc.getRemoteSize = async () => sizes[i++];
    return svc;
  };

  it('is stable when the size is non-zero and unchanged', async () => {
    const svc = withSizes([1000, 1000]);
    expect(await svc.isRemoteFileStable('/timelapse/x.avi', 0)).toBe(true);
  });
  it('is NOT stable when the file is still growing (print in progress)', async () => {
    const svc = withSizes([1000, 2400]);
    expect(await svc.isRemoteFileStable('/timelapse/x.avi', 0)).toBe(false);
  });
  it('is NOT stable when the size is unknown or zero', async () => {
    expect(await withSizes([null, null]).isRemoteFileStable('/x', 0)).toBe(false);
    expect(await withSizes([0, 0]).isRemoteFileStable('/x', 0)).toBe(false);
  });
});

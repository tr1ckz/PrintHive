import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

// curl is replaced by a stand-in on PATH that records how it was invoked.
describe.skipIf(process.platform === 'win32')('BambuFtpService curl invocation', () => {
  let tempDir;
  let originalPath;

  const fakeCurl = (script) => {
    fs.writeFileSync(path.join(tempDir, 'curl'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  };
  const connected = (accessCode = '12345678') => {
    const svc = new BambuFtpService();
    svc.printerIp = '10.0.0.5';
    svc.accessCode = accessCode;
    return svc;
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printhive-curl-'));
    originalPath = process.env.PATH;
    process.env.PATH = `${tempDir}${path.delimiter}${originalPath}`;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('kills curl itself on timeout instead of orphaning it behind a shell', async () => {
    const pidFile = path.join(tempDir, 'curl.pid');
    // `exec` keeps the pid, so the recorded pid is the process doing the "transfer".
    fakeCurl(`echo $$ > "${pidFile}"\nexec sleep 30`);

    const error = await connected().curl(['--list-only', 'ftps://10.0.0.5:990/timelapse/'], { timeout: 300 })
      .then(() => null, (err) => err);

    expect(error).toMatchObject({ killed: true, signal: 'SIGTERM' });
    const curlPid = Number(fs.readFileSync(pidFile, 'utf8'));
    expect(curlPid).toBeGreaterThan(0);
    // Gone entirely: not still running as an orphan, not left as a zombie.
    expect(fs.existsSync(`/proc/${curlPid}`)).toBe(false);
  });

  it('passes each argument to curl verbatim, with no shell interpretation', async () => {
    const argsFile = path.join(tempDir, 'curl.args');
    fakeCurl(`for arg in "$@"; do printf '%s\\n' "$arg"; done > "${argsFile}"`);
    const argv = () => fs.readFileSync(argsFile, 'utf8').trimEnd().split('\n');
    const auth = (code) => ['--user', `bblp:${code}`, '--ssl-reqd', '--insecure'];

    // An access code full of shell metacharacters must arrive as one argument.
    const svc = connected('p@ss; $(id) "x" &');
    const code = svc.accessCode;

    await svc.listTimelapses();
    expect(argv()).toEqual([...auth(code), '--list-only', 'ftps://10.0.0.5:990/timelapse/']);

    await svc.getRemoteSize('/timelapse/a.avi');
    expect(argv()).toEqual([...auth(code), '--silent', '--head', 'ftps://10.0.0.5:990/timelapse/a.avi']);

    const localPath = path.join(tempDir, 'dir with space', 'a.avi');
    await svc.downloadTimelapse('/timelapse/a.avi', localPath);
    expect(argv()).toEqual([...auth(code), '--silent', '--output', localPath, 'ftps://10.0.0.5:990/timelapse/a.avi']);

    await svc.deleteTimelapse('/timelapse/a.avi');
    expect(argv()).toEqual([...auth(code), '--silent', '-Q', 'DELE /timelapse/a.avi', 'ftps://10.0.0.5:990/']);

    await svc.list3mfFiles('/model');
    expect(argv()).toEqual([...auth(code), '--list-only', 'ftps://10.0.0.5:990/model/']);

    await svc.listSdCardFiles();
    expect(argv()).toEqual([...auth(code), 'ftps://10.0.0.5:990/', '-X', 'MLSD']);
  });
});

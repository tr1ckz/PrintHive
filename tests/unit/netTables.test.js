import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { parseProcNetArp, parseProcNetRoute, hexToIpv4, maskHexToPrefix, readProcArpIps, readProcRouteCidrs } from '../../server/services/netTables.js';

const ARP = `IP address       HW type     Flags       HW address            Mask     Device
192.168.99.1     0x1         0x2         aa:bb:cc:dd:ee:01     *        eth0
192.168.99.100   0x1         0x2         aa:bb:cc:dd:ee:64     *        eth0
192.168.99.57    0x1         0x0         00:00:00:00:00:00     *        eth0
192.168.99.100   0x1         0x2         aa:bb:cc:dd:ee:64     *        br0
`;

// Real layout: default route via 192.168.99.1, the LAN, and Docker's bridge.
const ROUTE = `Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
eth0\t00000000\t0163A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0
eth0\t0063A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0
docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0
`;

describe('netTables', () => {
  it('reads complete ARP entries and skips incomplete ones and duplicates', () => {
    expect(parseProcNetArp(ARP)).toEqual(['192.168.99.1', '192.168.99.100']);
  });

  it('decodes /proc/net/route host-order hex into CIDRs and drops the default route', () => {
    expect(parseProcNetRoute(ROUTE)).toEqual(['192.168.99.0/24', '172.17.0.0/16']);
  });

  it('converts hex helpers', () => {
    expect(hexToIpv4('0001A8C0')).toBe('192.168.1.0');
    expect(maskHexToPrefix('00FFFFFF')).toBe(24);
    expect(maskHexToPrefix('FCFFFFFF')).toBe(30);
    expect(hexToIpv4('xyz')).toBeNull();
  });

  it('tolerates empty or malformed input', () => {
    expect(parseProcNetArp('')).toEqual([]);
    expect(parseProcNetRoute('garbage\nmore garbage')).toEqual([]);
  });

  it('returns null when the /proc file is missing so callers can fall back to the CLI tools', () => {
    expect(readProcArpIps('/nonexistent/arp')).toBeNull();
    expect(readProcRouteCidrs('/nonexistent/route')).toBeNull();
  });

  it.runIf(fs.existsSync('/proc/net/route'))('reads this machine\'s real tables', () => {
    expect(Array.isArray(readProcRouteCidrs())).toBe(true);
    expect(Array.isArray(readProcArpIps())).toBe(true);
  });
});

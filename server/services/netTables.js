const fs = require('fs');

// Linux exposes the ARP cache and the IPv4 routing table as text under
// /proc/net, which is all `arp -a` and `ip route` read anyway. Reading them
// directly makes printer discovery work in the Docker image, which ships
// neither tool, without spawning a process. Callers fall back to the CLI
// tools when /proc is unavailable (macOS/Windows dev machines).

const ZERO_MAC = '00:00:00:00:00:00';

// /proc/net/arp:
//   IP address       HW type     Flags       HW address            Mask     Device
//   192.168.1.1      0x1         0x2         aa:bb:cc:dd:ee:ff     *        eth0
// Incomplete entries (no reply yet) have flags 0x0 and an all-zero MAC.
function parseProcNetArp(text) {
  const ips = [];
  String(text || '').split('\n').slice(1).forEach((line) => {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) return;
    const [ip, , flags, mac] = cols;
    if (mac === ZERO_MAC || flags === '0x0') return;
    ips.push(ip);
  });
  return Array.from(new Set(ips));
}

// /proc/net/route stores Destination and Mask as host-order (little-endian on
// every platform Docker images target) 32-bit hex: 0001A8C0 = 192.168.1.0.
function hexToIpv4(hex) {
  if (!/^[0-9A-Fa-f]{8}$/.test(hex)) return null;
  const n = parseInt(hex, 16);
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff].join('.');
}

function maskHexToPrefix(hex) {
  if (!/^[0-9A-Fa-f]{8}$/.test(hex)) return null;
  let n = parseInt(hex, 16) >>> 0;
  let bits = 0;
  while (n) { bits += n & 1; n >>>= 1; }
  return bits;
}

// Returns on-link/network routes as "a.b.c.d/nn" (the same shape `ip -o -4
// route show` prints first on each line), skipping the default route.
function parseProcNetRoute(text) {
  const cidrs = [];
  String(text || '').split('\n').slice(1).forEach((line) => {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 8) return;
    const destination = hexToIpv4(cols[1]);
    const prefix = maskHexToPrefix(cols[7]);
    if (!destination || prefix === null || prefix === 0) return;
    cidrs.push(`${destination}/${prefix}`);
  });
  return Array.from(new Set(cidrs));
}

function readProcFile(path) {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch (_error) {
    return null;
  }
}

/** ARP cache IPs from /proc, or null when /proc/net/arp is not readable. */
function readProcArpIps(path = '/proc/net/arp') {
  const text = readProcFile(path);
  return text === null ? null : parseProcNetArp(text);
}

/** Route CIDRs from /proc, or null when /proc/net/route is not readable. */
function readProcRouteCidrs(path = '/proc/net/route') {
  const text = readProcFile(path);
  return text === null ? null : parseProcNetRoute(text);
}

module.exports = {
  parseProcNetArp,
  parseProcNetRoute,
  hexToIpv4,
  maskHexToPrefix,
  readProcArpIps,
  readProcRouteCidrs,
};

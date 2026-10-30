import { execSync } from 'child_process';
import * as os from 'os';

export const DEFAULT_UNO_PORT = 3847;

export interface LanInterface {
  name: string;
  address: string;
  internal: boolean;
  family: string | number;
}

const VIRTUAL_INTERFACE =
  /vethernet|virtualbox|vmware|vbox|docker|wsl|hyper-?v|bluetooth|loopback|npcap|tunnel/i;

export function isIPv4Family(family: string | number): boolean {
  return family === 'IPv4' || family === 4 || family === '4';
}

function isPrivateIPv4(ip: string): boolean {
  return (
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

function rankAddress(ip: string): number {
  if (ip.startsWith('192.168.')) {
    return 0;
  }
  if (ip.startsWith('10.')) {
    return 1;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) {
    return 2;
  }
  if (isPrivateIPv4(ip)) {
    return 3;
  }
  return 4;
}

function usableLanInterfaces(interfaces: LanInterface[]): LanInterface[] {
  const ipv4 = interfaces.filter((entry) => isIPv4Family(entry.family) && !entry.internal);
  const physical = ipv4.filter((entry) => !VIRTUAL_INTERFACE.test(entry.name));
  const pool = physical.length > 0 ? physical : ipv4;
  const privateOnes = pool.filter((entry) => isPrivateIPv4(entry.address));
  return privateOnes.length > 0 ? privateOnes : pool;
}

/** Every usable private IPv4, best first. `preferredAddress` wins when it is in the list. */
export function listLanIPv4(interfaces: LanInterface[], preferredAddress?: string | null): string[] {
  const ranked = [...usableLanInterfaces(interfaces)].sort(
    (a, b) => rankAddress(a.address) - rankAddress(b.address)
  );
  const unique: string[] = [];
  for (const entry of ranked) {
    if (!unique.includes(entry.address)) {
      unique.push(entry.address);
    }
  }
  if (preferredAddress && unique.includes(preferredAddress)) {
    return [preferredAddress, ...unique.filter((ip) => ip !== preferredAddress)];
  }
  return unique;
}

/** Prefer a physical private IPv4 address. Virtual adapters are used only as a fallback. */
export function pickLanIPv4(interfaces: LanInterface[], preferredAddress?: string | null): string | null {
  return listLanIPv4(interfaces, preferredAddress)[0] ?? null;
}

/** Interface address on the lowest-metric IPv4 default route, if the text has one. */
export function parseDefaultRouteIPv4(routePrint: string): string | null {
  let best: { ip: string; metric: number } | null = null;
  for (const line of routePrint.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4 || parts[0] !== '0.0.0.0' || parts[1] !== '0.0.0.0') {
      continue;
    }
    const ip = parts[3];
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
      continue;
    }
    const metric = Number(parts[4]);
    const rank = Number.isFinite(metric) ? metric : Number.MAX_SAFE_INTEGER;
    if (!best || rank < best.metric) {
      best = { ip, metric: rank };
    }
  }
  return best?.ip ?? null;
}

export function getDefaultRouteIPv4(): string | null {
  if (process.platform !== 'win32') {
    return null;
  }
  try {
    const output = execSync('route print -4', {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
    });
    return parseDefaultRouteIPv4(output);
  } catch {
    return null;
  }
}

function readInterfaces(): LanInterface[] {
  let nets: NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  try {
    nets = os.networkInterfaces();
  } catch {
    return [];
  }
  const candidates: LanInterface[] = [];
  for (const [name, entries] of Object.entries(nets)) {
    if (!entries) {
      continue;
    }
    for (const entry of entries) {
      candidates.push({
        name,
        address: entry.address,
        internal: entry.internal,
        family: entry.family,
      });
    }
  }
  return candidates;
}

/** Prefer a private IPv4 address for LAN join URLs. */
export function getLanIPv4(): string | null {
  return pickLanIPv4(readInterfaces(), getDefaultRouteIPv4());
}

export function getLanIPv4s(): string[] {
  return listLanIPv4(readInterfaces(), getDefaultRouteIPv4());
}

export function formatJoinUrl(port: number, host = getLanIPv4()): string {
  const ip = host ?? '127.0.0.1';
  return `ws://${ip}:${port}`;
}

export function formatJoinUrls(port: number, hosts = getLanIPv4s()): string[] {
  const ips = hosts.length > 0 ? hosts : ['127.0.0.1'];
  return ips.map((ip) => `ws://${ip}:${port}`);
}

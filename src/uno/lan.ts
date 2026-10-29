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

/** Prefer a physical private IPv4 address. Virtual adapters are used only as a fallback. */
export function pickLanIPv4(interfaces: LanInterface[]): string | null {
  const ipv4 = interfaces.filter((entry) => String(entry.family) === 'IPv4' && !entry.internal);
  const physical = ipv4.filter((entry) => !VIRTUAL_INTERFACE.test(entry.name));
  const pool = physical.length > 0 ? physical : ipv4;
  const ranked = [...pool].sort((a, b) => rankAddress(a.address) - rankAddress(b.address));
  return ranked[0]?.address ?? null;
}

/** Prefer a private IPv4 address for LAN join URLs. */
export function getLanIPv4(): string | null {
  let nets: NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  try {
    nets = os.networkInterfaces();
  } catch {
    return null;
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

  return pickLanIPv4(candidates);
}

export function formatJoinUrl(port: number, host = getLanIPv4()): string {
  const ip = host ?? '127.0.0.1';
  return `ws://${ip}:${port}`;
}

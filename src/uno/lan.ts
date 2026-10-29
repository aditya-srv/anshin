import * as os from 'os';

export const DEFAULT_UNO_PORT = 3847;

/** Prefer a private IPv4 address for LAN join URLs. */
export function getLanIPv4(): string | null {
  let nets: NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  try {
    nets = os.networkInterfaces();
  } catch {
    return null;
  }
  const candidates: string[] = [];

  for (const entries of Object.values(nets)) {
    if (!entries) {
      continue;
    }
    for (const entry of entries) {
      if (String(entry.family) !== 'IPv4' || entry.internal) {
        continue;
      }
      candidates.push(entry.address);
    }
  }

  const preferred = candidates.find(
    (ip) =>
      ip.startsWith('192.168.') ||
      ip.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
  return preferred ?? candidates[0] ?? null;
}

export function formatJoinUrl(port: number, host = getLanIPv4()): string {
  const ip = host ?? '127.0.0.1';
  return `ws://${ip}:${port}`;
}

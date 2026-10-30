import { randomBytes, timingSafeEqual } from 'crypto';

const TOKEN_QUERY = 't';

/** Cryptographically random room token (32 hex chars). */
export function generateRoomToken(): string {
  return randomBytes(16).toString('hex');
}

/** Append or replace `?t=` / `&t=` on a ws(s) join URL. */
export function appendRoomToken(url: string, token: string): string {
  const hashIndex = url.indexOf('#');
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  try {
    const parsed = new URL(withoutHash);
    parsed.searchParams.set(TOKEN_QUERY, token);
    return parsed.toString() + hash;
  } catch {
    const q = withoutHash.indexOf('?');
    if (q < 0) {
      return `${withoutHash}?${TOKEN_QUERY}=${encodeURIComponent(token)}${hash}`;
    }
    const base = withoutHash.slice(0, q);
    const params = new URLSearchParams(withoutHash.slice(q + 1));
    params.set(TOKEN_QUERY, token);
    return `${base}?${params.toString()}${hash}`;
  }
}

export function extractRoomTokenFromUrl(urlOrPath: string): string | null {
  try {
    const parsed = urlOrPath.includes('://')
      ? new URL(urlOrPath)
      : new URL(urlOrPath, 'http://localhost');
    const value = parsed.searchParams.get(TOKEN_QUERY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Constant-time compare when lengths match; otherwise false. */
export function tokensEqual(expected: string, provided: string | null): boolean {
  if (provided === null) {
    return false;
  }
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function isIpv4(host: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return false;
  }
  return host.split('.').every((octet) => {
    const n = Number(octet);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

function isHostname(host: string): boolean {
  if (host.length > 253) {
    return false;
  }
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
    host
  );
}

/**
 * Hostname or IPv4 for PUBLIC_HOST.
 * Rejects schemes, paths, spaces, and empty strings.
 */
export function isValidPublicHost(value: string): boolean {
  const host = value.trim();
  if (!host || /\s/.test(host) || host.includes('/') || host.includes(':') || host.includes('?')) {
    return false;
  }
  // Dotted-quad shape must be a real IPv4 (do not accept as a hostname).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return isIpv4(host);
  }
  return isHostname(host);
}

/** Bind address: IPv4 (including 0.0.0.0) or hostname. */
export function isValidBindHost(value: string): boolean {
  const host = value.trim();
  if (!host || /\s/.test(host) || host.includes('/') || host.includes('?')) {
    return false;
  }
  if (host === '0.0.0.0' || host === '::' || host === 'localhost') {
    return true;
  }
  if (host.includes(':')) {
    return false;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return isIpv4(host);
  }
  return isHostname(host);
}

/** ws/wss URL with a non-empty hostname (and optional path/query). */
export function isValidJoinUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!/^wss?:\/\//i.test(trimmed)) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      return false;
    }
    return Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

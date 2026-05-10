import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain']);
const ALLOWED_PORTS = new Set(['', '80', '443']);

export function normalizePublicUrl(rawUrl: string): URL {
  const input = rawUrl.trim();
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs can be scanned');
  }
  if (url.username || url.password) {
    throw new Error('URLs with embedded credentials are not allowed');
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new Error('Only standard web ports 80 and 443 are allowed');
  }

  url.hash = '';
  return url;
}

export async function assertPublicTarget(url: URL): Promise<void> {
  const host = url.hostname.toLowerCase();

  if (BLOCKED_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Private/local URLs are not allowed');
  }

  const directIp = isIP(host);
  if (directIp) {
    if (isPrivateIp(host)) throw new Error('Private/local URLs are not allowed');
    return;
  }

  const records = await lookup(host, { all: true, verbatim: false });
  if (records.length === 0) throw new Error('Could not resolve hostname');

  if (records.some(record => isPrivateIp(record.address))) {
    throw new Error('Private/local network targets are not allowed');
  }
}

function isPrivateIp(address: string): boolean {
  if (address.startsWith('::ffff:')) {
    return isPrivateIp(address.slice(7));
  }

  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:');
  }

  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

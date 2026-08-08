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

  // Query strings frequently contain signed preview tokens, email addresses,
  // and other identifiers. They are not needed for a public provenance scan
  // and must never be persisted or published.
  url.search = '';
  url.hash = '';
  return url;
}

export async function assertPublicTarget(url: URL): Promise<void> {
  // WHATWG URL retains brackets around IPv6 literals in some runtimes; DNS
  // and node:net expect the address itself.
  const hostname = url.hostname.toLowerCase();
  const host = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

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
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('ff') ||
      normalized.startsWith('2001:db8:');
  }

  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b, c] = parts;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

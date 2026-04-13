import { resolveTxt } from 'dns/promises';
import type { VerificationToken } from '@/types/analysis';

// In-memory token store (resets on restart; swap for a DB in production)
const tokenStore = new Map<string, { token: string; createdAt: number }>();

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(18)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function getDomain(url: string): string {
  const normalized = url.startsWith('http') ? url : `https://${url}`;
  return new URL(normalized).hostname;
}

// POST /api/verify — generate a token for a domain
export async function POST(request: Request) {
  let domain: string;
  try {
    const body = await request.json();
    domain = getDomain((body?.domain ?? '').trim());
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!domain) {
    return Response.json({ error: 'Domain is required' }, { status: 400 });
  }

  const existing = tokenStore.get(domain);
  let token: string;

  if (existing && Date.now() - existing.createdAt < 24 * 60 * 60 * 1000) {
    token = existing.token;
  } else {
    token = randomToken();
    tokenStore.set(domain, { token, createdAt: Date.now() });
  }

  const result: VerificationToken = {
    token,
    domain,
    createdAt: new Date().toISOString(),
    methods: {
      dns: `Add TXT record: _vibecoded-verification.${domain} = vibecoded-verification=${token}`,
      metaTag: `<meta name="vibecoded-verification" content="${token}" />`,
      filePath: `https://${domain}/.well-known/vibecoded.txt`,
      fileContent: token,
    },
  };

  return Response.json(result);
}

// GET /api/verify?domain=example.com&token=abc&method=dns|meta|file
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const domain = searchParams.get('domain') ?? '';
  const token = searchParams.get('token') ?? '';
  const method = (searchParams.get('method') ?? 'dns') as 'dns' | 'meta' | 'file';

  if (!domain || !token) {
    return Response.json({ error: 'domain and token are required' }, { status: 400 });
  }

  const stored = tokenStore.get(domain);
  if (!stored || stored.token !== token) {
    return Response.json({ verified: false, error: 'Token not found or expired' });
  }

  if (method === 'dns') {
    try {
      const records = await resolveTxt(`_vibecoded-verification.${domain}`);
      const flat = records.flat().join(' ');
      const verified = flat.includes(`vibecoded-verification=${token}`);
      return Response.json({ verified, method: 'dns' });
    } catch {
      return Response.json({ verified: false, method: 'dns', error: 'DNS record not found' });
    }
  }

  if (method === 'meta') {
    try {
      const res = await fetch(`https://${domain}`, {
        headers: { 'User-Agent': 'VibeCheck-Verifier/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      const html = await res.text();
      const verified = html.includes(`name="vibecoded-verification" content="${token}"`);
      return Response.json({ verified, method: 'meta' });
    } catch {
      return Response.json({ verified: false, method: 'meta', error: 'Could not fetch site' });
    }
  }

  if (method === 'file') {
    try {
      const res = await fetch(`https://${domain}/.well-known/vibecoded.txt`, {
        headers: { 'User-Agent': 'VibeCheck-Verifier/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      const text = (await res.text()).trim();
      const verified = text === token;
      return Response.json({ verified, method: 'file' });
    } catch {
      return Response.json({ verified: false, method: 'file', error: 'Could not fetch verification file' });
    }
  }

  return Response.json({ error: 'Invalid method' }, { status: 400 });
}

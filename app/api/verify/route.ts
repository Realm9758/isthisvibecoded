import { resolveTxt } from 'dns/promises';
import { supabase } from '@/lib/supabase';
import type { VerificationToken } from '@/types/analysis';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

  // Always reuse existing token — only generate once per domain
  const { data: existing } = await supabase
    .from('verification_tokens')
    .select('token, created_at')
    .eq('domain', domain)
    .maybeSingle();

  let token: string;

  if (existing) {
    token = existing.token;
  } else {
    token = randomToken();
    await supabase.from('verification_tokens').insert({
      domain,
      token,
      created_at: Date.now(),
    });
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

// DELETE /api/verify — reset token for a domain
export async function DELETE(request: Request) {
  const { domain } = await request.json();
  if (!domain) return Response.json({ error: 'Domain required' }, { status: 400 });
  await supabase.from('verification_tokens').delete().eq('domain', domain);
  return Response.json({ ok: true });
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

  // Validate token against DB
  const { data: stored } = await supabase
    .from('verification_tokens')
    .select('token, created_at')
    .eq('domain', domain)
    .maybeSingle();

  if (!stored || stored.token !== token) {
    return Response.json({ verified: false, error: 'Token not found. Generate a verification token first.' });
  }

  let verified = false;

  if (method === 'dns') {
    try {
      const records = await resolveTxt(`_vibecoded-verification.${domain}`);
      const flat = records.flat().join(' ');
      verified = flat.includes(`vibecoded-verification=${token}`);
    } catch {
      return Response.json({ verified: false, method: 'dns', error: 'DNS record not found' });
    }
  } else if (method === 'meta') {
    try {
      const res = await fetch(`https://${domain}`, {
        headers: { 'User-Agent': 'VibeScan-Verifier/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      const html = await res.text();
      const metaRegex = new RegExp(
        `<meta[^>]+vibecoded-verification[^>]+${token}|<meta[^>]+${token}[^>]+vibecoded-verification`,
        'i'
      );
      verified = metaRegex.test(html);
    } catch {
      return Response.json({ verified: false, method: 'meta', error: 'Could not fetch site' });
    }
  } else if (method === 'file') {
    try {
      const res = await fetch(`https://${domain}/.well-known/vibecoded.txt`, {
        headers: { 'User-Agent': 'VibeScan-Verifier/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      const text = (await res.text()).trim();
      verified = text === token;
    } catch {
      return Response.json({ verified: false, method: 'file', error: 'Could not fetch verification file' });
    }
  } else {
    return Response.json({ error: 'Invalid method' }, { status: 400 });
  }

  // Mark domain as verified in DB so deep scan can run
  if (verified) {
    await supabase
      .from('verification_tokens')
      .update({ verified: true })
      .eq('domain', domain);
  }

  return Response.json({ verified, method });
}

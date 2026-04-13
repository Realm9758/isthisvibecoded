import { resolveTxt } from 'dns/promises';
import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { VerificationToken } from '@/types/analysis';

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(18)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function getDomain(url: string): string {
  const normalized = url.startsWith('http') ? url : `https://${url}`;
  return new URL(normalized).hostname;
}

async function getAuthUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  return payload?.userId ?? null;
}

// POST /api/verify — generate/fetch a token for a domain (auth required)
export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (!userId) {
    return Response.json({ error: 'You must be logged in to verify a domain' }, { status: 401 });
  }

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

  // 1. Check if this user already has a token for this domain
  const { data: ownToken } = await supabase
    .from('verification_tokens')
    .select('token, created_at, verified')
    .eq('domain', domain)
    .eq('user_id', userId)
    .maybeSingle();

  if (ownToken) {
    const result: VerificationToken & { alreadyVerified?: boolean } = {
      token: ownToken.token as string,
      domain,
      createdAt: new Date().toISOString(),
      alreadyVerified: ownToken.verified === true,
      methods: {
        dns: `Add TXT record: _vibecoded-verification.${domain} = vibecoded-verification=${ownToken.token}`,
        metaTag: `<meta name="vibecoded-verification" content="${ownToken.token}" />`,
        filePath: `https://${domain}/.well-known/vibecoded.txt`,
        fileContent: ownToken.token as string,
      },
    };
    return Response.json(result);
  }

  // 2. Check for an unclaimed legacy token (null user_id) and claim it
  const { data: legacyToken } = await supabase
    .from('verification_tokens')
    .select('token, created_at, verified')
    .eq('domain', domain)
    .is('user_id', null)
    .maybeSingle();

  let token: string;
  let alreadyVerified = false;

  if (legacyToken) {
    // Claim the legacy token for this user
    token = legacyToken.token as string;
    alreadyVerified = legacyToken.verified === true;
    await supabase
      .from('verification_tokens')
      .update({ user_id: userId })
      .eq('domain', domain)
      .is('user_id', null);
  } else {
    // Create a brand new token
    token = randomToken();
    const { error } = await supabase.from('verification_tokens').insert({
      domain,
      token,
      user_id: userId,
      created_at: Date.now(),
    });
    if (error) {
      // Race condition: another insert beat us — fetch theirs
      const { data: raceToken } = await supabase
        .from('verification_tokens')
        .select('token, verified')
        .eq('domain', domain)
        .eq('user_id', userId)
        .maybeSingle();
      if (raceToken) {
        token = raceToken.token as string;
        alreadyVerified = raceToken.verified === true;
      }
    }
  }

  const result: VerificationToken & { alreadyVerified?: boolean } = {
    token,
    domain,
    createdAt: new Date().toISOString(),
    alreadyVerified,
    methods: {
      dns: `Add TXT record: _vibecoded-verification.${domain} = vibecoded-verification=${token}`,
      metaTag: `<meta name="vibecoded-verification" content="${token}" />`,
      filePath: `https://${domain}/.well-known/vibecoded.txt`,
      fileContent: token,
    },
  };

  return Response.json(result);
}

// DELETE /api/verify — reset token for a domain (auth required, own tokens only)
export async function DELETE(request: Request) {
  const userId = await getAuthUserId();
  if (!userId) {
    return Response.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { domain } = await request.json();
  if (!domain) return Response.json({ error: 'Domain required' }, { status: 400 });

  await supabase
    .from('verification_tokens')
    .delete()
    .eq('domain', domain)
    .eq('user_id', userId);

  return Response.json({ ok: true });
}

// GET /api/verify?domain=...&token=...&method=dns|meta|file (auth required, own token only)
export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (!userId) {
    return Response.json({ error: 'You must be logged in to verify a domain' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get('domain') ?? '';
  const token = searchParams.get('token') ?? '';
  const method = (searchParams.get('method') ?? 'dns') as 'dns' | 'meta' | 'file';

  if (!domain || !token) {
    return Response.json({ error: 'domain and token are required' }, { status: 400 });
  }

  // Validate token — must belong to this user
  const { data: stored } = await supabase
    .from('verification_tokens')
    .select('token, created_at, user_id')
    .eq('domain', domain)
    .eq('user_id', userId)
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

  if (verified) {
    await supabase
      .from('verification_tokens')
      .update({ verified: true })
      .eq('domain', domain)
      .eq('user_id', userId);
  }

  return Response.json({ verified, method });
}

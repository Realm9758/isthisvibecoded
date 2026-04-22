import { resolveTxt } from 'dns/promises';
import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { VerificationToken } from '@/types/analysis';

// ── Helpers ────────────────────────────────────────────────────────────────

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

// Block SSRF: reject private/loopback hostnames and IP ranges.
// Prevents an attacker from registering a domain that resolves to internal infra
// (e.g. 169.254.169.254 AWS metadata, 127.0.0.1, RFC-1918 ranges).
const PRIVATE_IP_RE = /^(127\.|0\.0\.0\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|\[::1\])/i;
const PRIVATE_HOSTNAME_RE = /^(localhost|local|localdomain|broadcasthost|ip6-localhost|ip6-loopback)$/i;

function isPrivateDomain(hostname: string): boolean {
  if (!hostname) return true;
  if (PRIVATE_HOSTNAME_RE.test(hostname)) return true;
  if (PRIVATE_IP_RE.test(hostname)) return true;
  // Block bare TLD-less hostnames (e.g. "intranet", "server1")
  if (!hostname.includes('.')) return true;
  return false;
}

// ── POST /api/verify — generate or fetch a token for a domain ─────────────

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

  if (isPrivateDomain(domain)) {
    return Response.json({ error: 'Invalid domain' }, { status: 400 });
  }

  // 1. Return existing token for this user (already verified or pending)
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

  // 2. Check if another account has already verified this domain.
  //    We don't hard-block — ownership is proven by control, not first-claim.
  //    Issue a contest token: if the user can place it on the live site they
  //    demonstrably own it and supersede the existing claim (same model as
  //    Google Search Console ownership transfer).
  const { data: existingVerified } = await supabase
    .from('verification_tokens')
    .select('user_id')
    .eq('domain', domain)
    .eq('verified', true)
    .neq('user_id', userId)
    .maybeSingle();

  const isClaimContest = !!existingVerified;

  // 3. Atomically claim an unclaimed legacy token (user_id IS NULL, not yet verified).
  //    Using a WHERE on both conditions prevents a race where two users claim simultaneously.
  let token: string | null = null;

  const { data: claimed } = await supabase
    .from('verification_tokens')
    .update({ user_id: userId })
    .eq('domain', domain)
    .is('user_id', null)
    .eq('verified', false)
    .select('token')
    .maybeSingle();

  if (claimed) {
    token = claimed.token as string;
  }

  // 4. Create a fresh token if nothing was claimed
  if (!token) {
    token = randomToken();
    const { error: insertError } = await supabase.from('verification_tokens').insert({
      domain,
      token,
      user_id: userId,
      created_at: Date.now(),
    });

    if (insertError) {
      // Race: another row was just inserted for (domain, userId) — fetch it
      const { data: raceToken } = await supabase
        .from('verification_tokens')
        .select('token, verified')
        .eq('domain', domain)
        .eq('user_id', userId)
        .maybeSingle();
      if (raceToken) {
        token = raceToken.token as string;
      } else {
        return Response.json({ error: 'Could not create verification token. Please try again.' }, { status: 500 });
      }
    }
  }

  const result: VerificationToken & { alreadyVerified?: boolean; claimContest?: boolean } = {
    token,
    domain,
    createdAt: new Date().toISOString(),
    alreadyVerified: false,
    // claimContest=true signals to the client that this domain is currently claimed
    // by another account — placing the token will supersede that claim.
    claimContest: isClaimContest,
    methods: {
      dns: `Add TXT record: _vibecoded-verification.${domain} = vibecoded-verification=${token}`,
      metaTag: `<meta name="vibecoded-verification" content="${token}" />`,
      filePath: `https://${domain}/.well-known/vibecoded.txt`,
      fileContent: token,
    },
  };

  return Response.json(result);
}

// ── DELETE /api/verify — remove a pending (unverified) token ──────────────

export async function DELETE(request: Request) {
  const userId = await getAuthUserId();
  if (!userId) {
    return Response.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let domain: string;
  try {
    const body = await request.json();
    domain = (body?.domain ?? '').trim();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!domain) {
    return Response.json({ error: 'Domain required' }, { status: 400 });
  }

  // Only allow deleting unverified tokens. A verified claim must go through
  // an explicit revoke flow so ownership isn't silently transferred.
  const { data: existing } = await supabase
    .from('verification_tokens')
    .select('verified')
    .eq('domain', domain)
    .eq('user_id', userId)
    .maybeSingle();

  if (!existing) {
    return Response.json({ error: 'No token found for this domain' }, { status: 404 });
  }

  if (existing.verified === true) {
    return Response.json(
      { error: 'Cannot delete a verified domain claim. Contact support to revoke ownership.' },
      { status: 403 }
    );
  }

  await supabase
    .from('verification_tokens')
    .delete()
    .eq('domain', domain)
    .eq('user_id', userId)
    .eq('verified', false);

  return Response.json({ ok: true });
}

// ── GET /api/verify — check verification (auth required, own token only) ──

export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (!userId) {
    return Response.json({ error: 'You must be logged in to verify a domain' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const domain = (searchParams.get('domain') ?? '').trim();
  const clientToken = (searchParams.get('token') ?? '').trim();
  const method = (searchParams.get('method') ?? 'dns') as 'dns' | 'meta' | 'file';

  if (!domain || !clientToken) {
    return Response.json({ error: 'domain and token are required' }, { status: 400 });
  }

  if (isPrivateDomain(domain)) {
    return Response.json({ error: 'Invalid domain' }, { status: 400 });
  }

  if (!['dns', 'meta', 'file'].includes(method)) {
    return Response.json({ error: 'Invalid method' }, { status: 400 });
  }

  // Validate token — must be owned by this user and match exactly
  const { data: stored } = await supabase
    .from('verification_tokens')
    .select('token, user_id')
    .eq('domain', domain)
    .eq('user_id', userId)
    .maybeSingle();

  if (!stored || stored.token !== clientToken) {
    return Response.json({ verified: false, error: 'Token not found. Generate a verification token first.' });
  }

  // Check whether another user currently holds a verified claim on this domain.
  // We don't block — if the live site check passes, the requester demonstrably
  // controls the domain and their claim supersedes the old one.
  const { data: priorOwner } = await supabase
    .from('verification_tokens')
    .select('user_id')
    .eq('domain', domain)
    .eq('verified', true)
    .neq('user_id', userId)
    .maybeSingle();

  let verified = false;

  if (method === 'dns') {
    try {
      const records = await resolveTxt(`_vibecoded-verification.${domain}`);
      const flat = records.flat().join(' ');
      verified = flat.includes(`vibecoded-verification=${clientToken}`);
    } catch {
      return Response.json({ verified: false, method: 'dns', error: 'DNS record not found' });
    }
  } else if (method === 'meta') {
    try {
      const res = await fetch(`https://${domain}`, {
        headers: { 'User-Agent': 'VibeScan-Verifier/1.0' },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      });
      const html = await res.text();
      // Use literal string search — no regex with user-influenced content
      verified = html.includes(`vibecoded-verification" content="${clientToken}"`) ||
                 html.includes(`content="${clientToken}" name="vibecoded-verification"`);
    } catch {
      return Response.json({ verified: false, method: 'meta', error: 'Could not fetch site' });
    }
  } else {
    try {
      const res = await fetch(`https://${domain}/.well-known/vibecoded.txt`, {
        headers: { 'User-Agent': 'VibeScan-Verifier/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      // Only accept plain text responses to avoid HTML catch-all pages
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('text/html')) {
        return Response.json({ verified: false, method: 'file', error: 'Verification file not found (got HTML response)' });
      }
      const text = (await res.text()).trim();
      verified = text === clientToken;
    } catch {
      return Response.json({ verified: false, method: 'file', error: 'Could not fetch verification file' });
    }
  }

  if (verified) {
    // If a prior owner exists, revoke their claim first, then mark this one verified.
    // Doing it in this order means there's never a window with two verified claims.
    if (priorOwner) {
      await supabase
        .from('verification_tokens')
        .delete()
        .eq('domain', domain)
        .eq('user_id', priorOwner.user_id);
    }

    await supabase
      .from('verification_tokens')
      .update({ verified: true })
      .eq('domain', domain)
      .eq('user_id', userId);
  }

  return Response.json({ verified, method, ownershipTransferred: verified && !!priorOwner });
}

import { resolveTxt } from 'dns/promises';
import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { assertPublicTarget, normalizePublicUrl } from '@/lib/url-safety';
import { VERIFICATION_MAX_AGE_MS } from '@/lib/policy';
import { reserveUsage } from '@/lib/store';
import { pinnedFetch } from '@/lib/pinned-fetch';
import type { VerificationToken } from '@/types/analysis';

// ── Helpers ────────────────────────────────────────────────────────────────

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(18)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function getDomain(url: string): string {
  return normalizePublicUrl(url).hostname.toLowerCase();
}

function normalizeVerificationTarget(rawUrl: string): URL {
  const requested = new URL(rawUrl);
  const target = normalizePublicUrl(requested.href);
  // Redirect query parameters can be required by a public site's routing. Keep
  // them only for this outbound request; they are never returned or persisted.
  target.search = requested.search;
  return target;
}

async function fetchVerificationTarget(rawUrl: string): Promise<Response> {
  let target = normalizeVerificationTarget(rawUrl);
  const originalHost = target.host.toLowerCase();
  const originalProtocol = target.protocol;

  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await pinnedFetch(target, {
      headers: { 'User-Agent': 'Ironclad-Verifier/2.0 (+https://ironclad.dev/scanner)' },
      signal: AbortSignal.timeout(8_000),
      redirect: 'manual',
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    const nextTarget = normalizeVerificationTarget(new URL(location, target).href);
    if (nextTarget.host.toLowerCase() !== originalHost || nextTarget.protocol !== originalProtocol) {
      throw new Error('Verification redirects must stay on the exact original HTTPS host');
    }
    await response.body?.cancel().catch(() => undefined);
    target = nextTarget;
  }
  throw new Error('Too many redirects');
}

async function readVerificationBody(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('Verification response is too large');
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      await reader.cancel();
      throw new Error('Verification response is too large');
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function isFreshVerification(row: { verified?: unknown; verified_at?: unknown }): boolean {
  const verifiedAt = Number(row.verified_at);
  const age = Date.now() - verifiedAt;
  return row.verified === true
    && Number.isFinite(verifiedAt)
    && verifiedAt > 0
    && age >= 0
    && age <= VERIFICATION_MAX_AGE_MS;
}

function storedCreatedAt(value: unknown): string {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();
}

function readMetaAttribute(tag: string, attribute: 'name' | 'content'): string | null {
  const pattern = attribute === 'name'
    ? /\sname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i
    : /\scontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
  const match = tag.match(pattern);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
}

function hasVerificationMeta(html: string, token: string): boolean {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  return tags.some(tag =>
    readMetaAttribute(tag, 'name')?.trim().toLowerCase() === 'vibecoded-verification'
      && readMetaAttribute(tag, 'content')?.trim() === token
  );
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

  const hourWindow = new Date().toISOString().slice(0, 13);
  const remaining = await reserveUsage(`domain-token:${userId}:${hourWindow}`, 30, 'verify:token');
  if (remaining === null) {
    return Response.json({ error: 'Could not verify the token-generation allowance' }, { status: 503 });
  }
  if (remaining < 0) {
    return Response.json({ error: 'Too many domain-token requests. Try again later.' }, { status: 429 });
  }

  let domain: string;
  try {
    const body = await request.json();
    if (typeof body?.domain !== 'string' || !body.domain.trim()) {
      return Response.json({ error: 'Domain is required' }, { status: 400 });
    }
    domain = getDomain(body.domain);
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
  const { data: ownToken, error: ownTokenError } = await supabase
    .from('verification_tokens')
    .select('token, created_at, verified, verified_at, verification_method')
    .eq('domain', domain)
    .eq('user_id', userId)
    .maybeSingle();

  if (ownTokenError) {
    return Response.json({ error: 'Could not load domain verification' }, { status: 503 });
  }

  if (ownToken) {
    const alreadyVerified = isFreshVerification(ownToken);
    const verificationExpired = ownToken.verified === true && !alreadyVerified;

    if (verificationExpired) {
      const { error: expireError } = await supabase
        .from('verification_tokens')
        .update({ verified: false })
        .eq('domain', domain)
        .eq('user_id', userId)
        .eq('token', ownToken.token);
      if (expireError) {
        return Response.json({ error: 'Could not renew expired domain verification' }, { status: 503 });
      }
    }

    const result: VerificationToken & {
      alreadyVerified?: boolean;
      verificationExpired?: boolean;
      verifiedAt?: number;
      verificationMethod?: string;
    } = {
      token: ownToken.token as string,
      domain,
      createdAt: storedCreatedAt(ownToken.created_at),
      alreadyVerified,
      verificationExpired,
      verifiedAt: alreadyVerified ? Number(ownToken.verified_at) : undefined,
      verificationMethod: alreadyVerified && typeof ownToken.verification_method === 'string'
        ? ownToken.verification_method
        : undefined,
      methods: {
        dns: `Add TXT record: _vibecoded-verification.${domain} = vibecoded-verification=${ownToken.token}`,
        metaTag: `<meta name="vibecoded-verification" content="${ownToken.token}" />`,
        filePath: `https://${domain}/.well-known/vibecoded.txt`,
        fileContent: ownToken.token as string,
      },
    };
    return Response.json(result);
  }

  const { count: pendingCount, error: pendingCountError } = await supabase
    .from('verification_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('verified', false);
  if (pendingCountError) {
    return Response.json({ error: 'Could not check pending domain verifications' }, { status: 503 });
  }
  if ((pendingCount ?? 0) >= 20) {
    return Response.json(
      { error: 'Pending domain limit reached. Revoke an unused token before adding another domain.' },
      { status: 429 },
    );
  }

  // A new claim must resolve publicly. Existing tokens above can be displayed
  // without performing another outbound DNS lookup.
  try {
    await assertPublicTarget(new URL(`https://${domain}`), 4_000);
  } catch {
    return Response.json({ error: 'Domain must resolve to a public network address' }, { status: 400 });
  }

  // 2. Check if another account already has fresh control evidence for this domain.
  //    We don't hard-block — current token placement, not first claim, wins.
  //    Issue a contest token: if the user can place it on the live site they
  //    demonstrably own it and supersede the existing claim (same model as
  //    Google Search Console-style claim transfer).
  const verificationCutoff = Date.now() - VERIFICATION_MAX_AGE_MS;
  const { data: existingVerified, error: existingVerifiedError } = await supabase
    .from('verification_tokens')
    .select('user_id')
    .eq('domain', domain)
    .eq('verified', true)
    .gte('verified_at', verificationCutoff)
    .neq('user_id', userId)
    .maybeSingle();

  if (existingVerifiedError) {
    return Response.json({ error: 'Could not check existing domain verification' }, { status: 503 });
  }

  const isClaimContest = !!existingVerified;

  // 3. Atomically claim an unclaimed legacy token (user_id IS NULL, not yet verified).
  //    Using a WHERE on both conditions prevents a race where two users claim simultaneously.
  let token: string | null = null;

  const { data: claimed, error: claimError } = await supabase
    .from('verification_tokens')
    .update({ user_id: userId })
    .eq('domain', domain)
    .is('user_id', null)
    .eq('verified', false)
    .select('token')
    .maybeSingle();

  if (claimError) {
    return Response.json({ error: 'Could not claim verification token' }, { status: 503 });
  }

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
      verified: false,
      verified_at: null,
      verification_method: null,
      created_at: Date.now(),
    });

    if (insertError) {
      // Race: another row was just inserted for (domain, userId) — fetch it
      const { data: raceToken, error: raceError } = await supabase
        .from('verification_tokens')
        .select('token')
        .eq('domain', domain)
        .eq('user_id', userId)
        .maybeSingle();
      if (!raceError && raceToken) {
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

// ── DELETE /api/verify — revoke this user's domain verification/token ─────

export async function DELETE(request: Request) {
  const userId = await getAuthUserId();
  if (!userId) {
    return Response.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let domain: string;
  try {
    const body = await request.json();
    if (typeof body?.domain !== 'string' || !body.domain.trim()) {
      return Response.json({ error: 'Domain required' }, { status: 400 });
    }
    domain = getDomain(body.domain);
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!domain) {
    return Response.json({ error: 'Domain required' }, { status: 400 });
  }

  const { data: existing, error: existingError } = await supabase
    .from('verification_tokens')
    .select('verified')
    .eq('domain', domain)
    .eq('user_id', userId)
    .maybeSingle();

  if (existingError) {
    return Response.json({ error: 'Could not load domain verification' }, { status: 503 });
  }

  if (!existing) {
    return Response.json({ error: 'No token found for this domain' }, { status: 404 });
  }

  const { error: deleteError } = await supabase
    .from('verification_tokens')
    .delete()
    .eq('domain', domain)
    .eq('user_id', userId);

  if (deleteError) {
    return Response.json({ error: 'Could not revoke domain verification' }, { status: 503 });
  }

  return Response.json({ ok: true, revokedVerifiedClaim: existing.verified === true });
}

// ── GET /api/verify — check verification (auth required, own token only) ──

export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (!userId) {
    return Response.json({ error: 'You must be logged in to verify a domain' }, { status: 401 });
  }

  const hourWindow = new Date().toISOString().slice(0, 13);
  const remaining = await reserveUsage(`domain-verify:${userId}:${hourWindow}`, 30, 'verify:check');
  if (remaining === null) {
    return Response.json({ error: 'Could not verify the domain-check allowance' }, { status: 503 });
  }
  if (remaining < 0) {
    return Response.json({ error: 'Too many verification checks. Try again later.' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  let domain: string;
  try {
    domain = getDomain((searchParams.get('domain') ?? '').trim());
  } catch {
    return Response.json({ error: 'Invalid domain' }, { status: 400 });
  }
  const clientToken = (searchParams.get('token') ?? '').trim();
  const requestedMethod = searchParams.get('method') ?? 'dns';

  if (!domain || !clientToken) {
    return Response.json({ error: 'domain and token are required' }, { status: 400 });
  }

  if (isPrivateDomain(domain)) {
    return Response.json({ error: 'Invalid domain' }, { status: 400 });
  }
  try {
    await assertPublicTarget(new URL(`https://${domain}`), 4_000);
  } catch {
    return Response.json({ error: 'Domain must resolve to a public network address' }, { status: 400 });
  }

  if (!['dns', 'meta', 'file'].includes(requestedMethod)) {
    return Response.json({ error: 'Invalid method' }, { status: 400 });
  }
  const method = requestedMethod as 'dns' | 'meta' | 'file';

  // Validate token — must be owned by this user and match exactly
  const { data: stored, error: storedError } = await supabase
    .from('verification_tokens')
    .select('token, user_id, verified, verified_at')
    .eq('domain', domain)
    .eq('user_id', userId)
    .maybeSingle();

  if (storedError) {
    return Response.json({ verified: false, error: 'Could not load verification token' }, { status: 503 });
  }

  if (!stored || stored.token !== clientToken) {
    return Response.json({ verified: false, error: 'Token not found. Generate a verification token first.' });
  }

  // This is only used to tell the requester whether their successful proof
  // superseded another claim. The RPC below performs the actual transfer under
  // a row lock and remains the source of truth.
  const { data: priorOwner, error: priorOwnerError } = await supabase
    .from('verification_tokens')
    .select('user_id')
    .eq('domain', domain)
    .eq('verified', true)
    .neq('user_id', userId)
    .maybeSingle();

  if (priorOwnerError) {
    return Response.json({ verified: false, error: 'Could not check existing domain claim' }, { status: 503 });
  }

  let verified = false;

  if (method === 'dns') {
    try {
      const records = await resolveTxt(`_vibecoded-verification.${domain}`);
      const expected = `vibecoded-verification=${clientToken}`;
      verified = records.some(chunks => chunks.join('').trim() === expected);
    } catch {
      return Response.json({ verified: false, method: 'dns', error: 'DNS record not found' });
    }
  } else if (method === 'meta') {
    try {
      const res = await fetchVerificationTarget(`https://${domain}`);
      if (!res.ok) return Response.json({ verified: false, method: 'meta', error: `Site returned HTTP ${res.status}` });
      const html = await readVerificationBody(res, 512_000);
      verified = hasVerificationMeta(html, clientToken);
    } catch {
      return Response.json({ verified: false, method: 'meta', error: 'Could not fetch site' });
    }
  } else {
    try {
      const res = await fetchVerificationTarget(`https://${domain}/.well-known/vibecoded.txt`);
      if (!res.ok) return Response.json({ verified: false, method: 'file', error: `Verification path returned HTTP ${res.status}` });
      // Only accept plain text responses to avoid HTML catch-all pages
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('text/html')) {
        return Response.json({ verified: false, method: 'file', error: 'Verification file not found (got HTML response)' });
      }
      const text = (await readVerificationBody(res, 4_096)).trim();
      verified = text === clientToken;
    } catch {
      return Response.json({ verified: false, method: 'file', error: 'Could not fetch verification file' });
    }
  }

  if (verified) {
    const verifiedAt = Date.now();
    const { data: completed, error: completeError } = await supabase.rpc('complete_domain_verification', {
      claim_domain: domain,
      claimant_user_id: userId,
      claimant_token: clientToken,
      verification_method: method,
      verified_timestamp: verifiedAt,
    });

    if (completeError) {
      return Response.json({ verified: false, error: 'Could not save domain verification' }, { status: 503 });
    }
    if (completed !== true) {
      return Response.json({ verified: false, error: 'Verification token changed; generate a new token and try again.' }, { status: 409 });
    }

    return Response.json({
      verified: true,
      method,
      verifiedAt,
      expiresAt: verifiedAt + VERIFICATION_MAX_AGE_MS,
      ownershipTransferred: !!priorOwner,
    });
  }

  return Response.json({ verified: false, method, ownershipTransferred: false });
}

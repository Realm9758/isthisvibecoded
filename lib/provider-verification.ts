import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { pinnedFetch } from '@/lib/pinned-fetch';
import { supabase } from '@/lib/supabase';
import type { HostingProvider } from '@/lib/oauth-state';

const PROVIDER_RESPONSE_LIMIT = 1_000_000;

function encryptionKey(): Buffer {
  const raw = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error('OAUTH_TOKEN_ENCRYPTION_KEY is required for hosting-provider verification');
  return createHash('sha256').update(raw, 'utf8').digest();
}

function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptToken(value: string): string {
  const [version, ivText, tagText, ciphertextText] = value.split('.');
  if (version !== 'v1' || !ivText || !tagText || !ciphertextText) throw new Error('Invalid encrypted provider token');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

async function providerJson(url: URL, token: string): Promise<unknown> {
  const response = await pinnedFetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(8_000),
    maxResponseBytes: PROVIDER_RESPONSE_LIMIT,
  });
  if (!response.ok) throw new Error(`Hosting provider returned HTTP ${response.status}`);
  return await response.json();
}

function hostname(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export async function providerHasDomain(
  provider: HostingProvider,
  accessToken: string,
  domain: string,
  providerAccountId?: string | null,
): Promise<boolean> {
  const target = domain.toLowerCase();
  if (provider === 'netlify') {
    const url = new URL('https://api.netlify.com/api/v1/sites');
    url.searchParams.set('per_page', '100');
    const data = await providerJson(url, accessToken);
    if (!Array.isArray(data)) return false;
    return data.some(site => {
      if (!site || typeof site !== 'object') return false;
      const row = site as Record<string, unknown>;
      // A custom_domain field can exist before routing is proven. The HTTPS
      // site URLs are stronger provider-side evidence that Netlify serves it.
      const candidates = [row.url, row.ssl_url];
      return candidates.some(value => hostname(value) === target);
    });
  }

  const projectsUrl = new URL('https://api.vercel.com/v9/projects');
  projectsUrl.searchParams.set('limit', '25');
  if (providerAccountId) projectsUrl.searchParams.set('teamId', providerAccountId);
  const projectsData = await providerJson(projectsUrl, accessToken) as { projects?: unknown[] };
  const projects = Array.isArray(projectsData.projects) ? projectsData.projects.slice(0, 25) : [];
  for (const project of projects) {
    if (!project || typeof project !== 'object') continue;
    const id = (project as Record<string, unknown>).id;
    if (typeof id !== 'string') continue;
    const domainsUrl = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(id)}/domains`);
    domainsUrl.searchParams.set('limit', '100');
    if (providerAccountId) domainsUrl.searchParams.set('teamId', providerAccountId);
    const domainsData = await providerJson(domainsUrl, accessToken) as { domains?: unknown[] };
    if ((domainsData.domains ?? []).some(item => {
      if (!item || typeof item !== 'object') return false;
      const row = item as Record<string, unknown>;
      return hostname(row.name) === target && row.verified === true;
    })) return true;
  }
  return false;
}

export async function saveProviderVerification(
  userId: string,
  provider: HostingProvider,
  accessToken: string,
  providerAccountId: string | null,
  domain: string,
): Promise<{ verificationId: number; eventId: number }> {
  const encrypted = encryptToken(accessToken);
  const now = Date.now();
  const { error: connectionError } = await supabase
    .from('verification_provider_connections')
    .upsert({
      user_id: userId,
      provider,
      provider_account_id: providerAccountId,
      access_token_encrypted: encrypted,
      updated_at: now,
    }, { onConflict: 'user_id,provider' });
  if (connectionError) throw new Error('Could not save the hosting-provider connection');

  const { data: existingRow, error: rowError } = await supabase
    .from('verification_tokens')
    .select('id, token')
    .eq('domain', domain)
    .eq('user_id', userId)
    .maybeSingle();
  if (rowError) throw new Error('Could not load the domain verification');
  let row = existingRow;
  if (!row) {
    const { data: inserted, error } = await supabase
      .from('verification_tokens')
      .insert({
        domain,
        token: `oauth-${provider}-${crypto.randomUUID()}`,
        user_id: userId,
        verified: false,
        created_at: now,
      })
      .select('id, token')
      .single();
    if (error || !inserted) throw new Error('Could not create the domain verification');
    row = inserted;
  }

  const method = `${provider}-oauth`;
  const { data: eventId, error: completeError } = await supabase.rpc('complete_domain_verification_with_event', {
    claim_domain: domain,
    claimant_user_id: userId,
    claimant_token: row.token,
    verification_method: method,
    verified_timestamp: now,
    proof_subject: providerAccountId ?? provider,
  });
  if (completeError || !Number.isFinite(Number(eventId)) || Number(eventId) <= 0) {
    throw new Error('Could not complete domain verification');
  }
  return { verificationId: Number(row.id), eventId: Number(eventId) };
}

export async function revalidateProviderDomain(
  userId: string,
  provider: HostingProvider,
  domain: string,
): Promise<{ verified: boolean; proofSubject?: string; error?: string }> {
  const { data, error } = await supabase
    .from('verification_provider_connections')
    .select('provider_account_id, access_token_encrypted')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();
  if (error || !data) return { verified: false, error: 'Reconnect the hosting provider.' };
  try {
    const accessToken = decryptToken(String(data.access_token_encrypted));
    const verified = await providerHasDomain(provider, accessToken, domain, data.provider_account_id);
    return {
      verified,
      proofSubject: typeof data.provider_account_id === 'string' ? data.provider_account_id : provider,
      error: verified ? undefined : 'The domain is no longer attached to an accessible hosting project.',
    };
  } catch {
    return { verified: false, error: 'The hosting connection expired or could not be checked. Reconnect it.' };
  }
}

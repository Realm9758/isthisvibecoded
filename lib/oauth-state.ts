import 'server-only';
import { SignJWT, jwtVerify } from 'jose';

export type HostingProvider = 'vercel' | 'netlify';
export const OAUTH_STATE_COOKIE = 'ironclad-host-state';

function secret(): Uint8Array {
  const raw = process.env.OAUTH_STATE_SECRET ?? process.env.JWT_SECRET;
  if (!raw) throw new Error('OAUTH_STATE_SECRET or JWT_SECRET is required');
  return new TextEncoder().encode(raw);
}

export async function createOAuthState(provider: HostingProvider, domain: string, userId: string): Promise<string> {
  return new SignJWT({ provider, domain, userId, nonce: crypto.randomUUID() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .setIssuer('ironclad-host-verification')
    .sign(secret());
}

export async function readOAuthState(token: string): Promise<{
  provider: HostingProvider;
  domain: string;
  userId: string;
} | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: 'ironclad-host-verification' });
    if (
      (payload.provider !== 'vercel' && payload.provider !== 'netlify')
      || typeof payload.domain !== 'string'
      || typeof payload.userId !== 'string'
    ) return null;
    return { provider: payload.provider, domain: payload.domain, userId: payload.userId };
  } catch {
    return null;
  }
}

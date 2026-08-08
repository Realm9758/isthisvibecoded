import 'server-only';
import { createHmac } from 'node:crypto';

/**
 * Returns a pseudonymous, deployment-scoped key. In production Vercel's
 * forwarding header is preferred; self-hosters must terminate traffic at a
 * trusted proxy that overwrites the fallback forwarding headers.
 */
export function getAnonymousRateLimitKey(request: Request): string | null {
  const clientIp = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')?.trim()
    ?? 'anonymous';
  const secret = process.env.RATE_LIMIT_SECRET ?? process.env.JWT_SECRET;
  if (!secret) return null;
  return `anon:${createHmac('sha256', secret).update(clientIp).digest('hex').slice(0, 32)}`;
}


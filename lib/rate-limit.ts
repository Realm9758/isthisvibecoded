import 'server-only';
import { createHmac } from 'node:crypto';

/** Returns a pseudonymous, deployment-scoped abuse-control key. */
export function getAnonymousRateLimitKey(request: Request): string | null {
  // Only trust forwarding headers when the platform overwrites them, or when
  // a self-hoster explicitly opts in after configuring a trusted reverse
  // proxy. Otherwise callers could spoof a fresh address for every request.
  const trustForwardedHeaders = process.env.VERCEL === '1'
    || process.env.TRUST_PROXY_HEADERS === 'true';
  const clientIp = trustForwardedHeaders
    ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip')?.trim()
      ?? 'anonymous'
    : 'anonymous';
  const secret = process.env.RATE_LIMIT_SECRET ?? process.env.JWT_SECRET;
  if (!secret) return null;
  return `anon:${createHmac('sha256', secret).update(clientIp).digest('hex').slice(0, 32)}`;
}

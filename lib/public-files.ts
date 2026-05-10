import type { PublicFile } from '@/types/analysis';

const UA = 'Mozilla/5.0 (compatible; VibeCheck/1.0; +https://github.com/vibecoded)';

// Paths checked with HEAD only — accessible = status 200-399
const HEAD_PATHS: Array<{ path: string; note?: string }> = [
  { path: '/robots.txt',               note: 'Crawler instructions' },
  { path: '/sitemap.xml',              note: 'Site map' },
  { path: '/.well-known/security.txt', note: 'Security contact info' },
  { path: '/.well-known/',             note: 'Well-known directory' },
  { path: '/humans.txt',               note: 'Site credits' },
  { path: '/favicon.ico' },
  { path: '/manifest.json',            note: 'PWA manifest' },
  { path: '/api',                      note: 'API endpoint' },
  { path: '/api/health',               note: 'Health check endpoint' },
  { path: '/auth',                     note: 'Auth endpoint' },
  { path: '/login',                    note: 'Login page' },
];

// Sensitive paths that need content verification — a 200 with HTML is NOT a real hit.
// Many SPAs and Next.js sites return 200 for every URL via catch-all routes.
const SENSITIVE_PATHS: Array<{
  path: string;
  note: string;
  verify: (body: string, contentType: string, finalUrl: string) => { accessible: boolean; evidence?: string };
}> = [
  {
    path: '/.env',
    note: 'Environment file (should NOT be public)',
    verify: (body, ct) => {
      const accessible = !ct.includes('text/html') &&
        // Must contain at least one KEY=VALUE line typical of .env files
        /^[A-Z_][A-Z0-9_]*\s*=/m.test(body);
      return accessible ? { accessible, evidence: 'KEY=VALUE environment syntax detected' } : { accessible };
    },
  },
  {
    path: '/config.json',
    note: 'Config file',
    verify: (body, ct) => {
      if (ct.includes('text/html')) return { accessible: false };
      try {
        JSON.parse(body);
        return { accessible: true, evidence: 'Valid JSON file returned' };
      } catch {
        return { accessible: false };
      }
    },
  },
  {
    path: '/wp-admin',
    note: 'WordPress admin (if applicable)',
    verify: (body, ct) => {
      if (!ct.includes('text/html')) return { accessible: false };
      if (/\/wp-login\.php|\/wp-content\/|\/wp-includes\/|name=["']log["']|id=["']user_login["']|id=["']loginform["']/i.test(body)) {
        return { accessible: true, evidence: 'WordPress admin/login markers detected' };
      }
      return { accessible: false };
    },
  },
  {
    path: '/admin',
    note: 'Admin panel',
    verify: (body, ct, finalUrl) => {
      if (!ct.includes('text/html')) return { accessible: false };
      if (!/\/admin(?:\/|$|\?)/i.test(new URL(finalUrl).pathname)) return { accessible: false };

      const hasAdminSurface =
        /admin\s+(panel|portal|dashboard|console|login)|administrator\s+login|sign\s+in\s+to\s+admin/i.test(body);
      const hasAuthForm =
        /<form[\s\S]{0,2500}(password|username|email|login|sign in)/i.test(body);
      const hasFrameworkCatchAll =
        /__NEXT_DATA__|id="root"|id="__next"/i.test(body) && !hasAdminSurface;

      if (hasFrameworkCatchAll) return { accessible: false };
      if (hasAdminSurface || (hasAuthForm && /admin/i.test(body.slice(0, 5000)))) {
        return { accessible: true, evidence: hasAdminSurface ? 'Admin UI text detected' : 'Admin login form detected on /admin' };
      }

      return { accessible: false };
    },
  },
];

export async function checkPublicFiles(baseUrl: string): Promise<PublicFile[]> {
  const origin = new URL(baseUrl).origin;
  const results: PublicFile[] = [];

  const headChecks = HEAD_PATHS.map(async ({ path }) => {
    try {
      const res = await fetch(`${origin}${path}`, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': UA },
      });
      return { path, accessible: res.status >= 200 && res.status < 400, status: res.status } as PublicFile;
    } catch {
      return { path, accessible: false, status: 0 } as PublicFile;
    }
  });

  const sensitiveChecks = SENSITIVE_PATHS.map(async ({ path, verify }) => {
    try {
      const res = await fetch(`${origin}${path}`, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': UA },
      });

      if (res.status < 200 || res.status >= 300) {
        return { path, accessible: false, status: res.status } as PublicFile;
      }

      const ct = res.headers.get('content-type') ?? '';
      const body = await res.text();
      const verified = verify(body, ct, res.url || `${origin}${path}`);

      return {
        path,
        accessible: verified.accessible,
        status: res.status,
        confidence: verified.accessible ? 'Medium' : undefined,
        evidence: verified.evidence,
      } as PublicFile;
    } catch {
      return { path, accessible: false, status: 0 } as PublicFile;
    }
  });

  const settled = await Promise.allSettled([...headChecks, ...sensitiveChecks]);
  for (const r of settled) {
    if (r.status === 'fulfilled') results.push(r.value);
  }

  return results;
}

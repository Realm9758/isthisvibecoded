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
  { path: '/admin',                    note: 'Admin panel' },
  { path: '/login',                    note: 'Login page' },
  { path: '/wp-admin',                 note: 'WordPress admin (if applicable)' },
];

// Sensitive paths that need content verification — a 200 with HTML is NOT a real hit.
// Many SPAs and Next.js sites return 200 for every URL via catch-all routes.
const SENSITIVE_PATHS: Array<{
  path: string;
  note: string;
  verify: (body: string, contentType: string) => boolean;
}> = [
  {
    path: '/.env',
    note: 'Environment file (should NOT be public)',
    verify: (body, ct) =>
      !ct.includes('text/html') &&
      // Must contain at least one KEY=VALUE line typical of .env files
      /^[A-Z_][A-Z0-9_]*\s*=/m.test(body),
  },
  {
    path: '/config.json',
    note: 'Config file',
    verify: (body, ct) => {
      if (ct.includes('text/html')) return false;
      try { JSON.parse(body); return true; } catch { return false; }
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

      if (res.status < 200 || res.status >= 400) {
        return { path, accessible: false, status: res.status } as PublicFile;
      }

      const ct = res.headers.get('content-type') ?? '';
      const body = await res.text();
      const reallyAccessible = verify(body, ct);

      return { path, accessible: reallyAccessible, status: res.status } as PublicFile;
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

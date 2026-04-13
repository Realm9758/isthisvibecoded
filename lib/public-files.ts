import type { PublicFile } from '@/types/analysis';

const PUBLIC_PATHS: Array<{ path: string; note?: string }> = [
  { path: '/robots.txt', note: 'Crawler instructions' },
  { path: '/sitemap.xml', note: 'Site map' },
  { path: '/.well-known/security.txt', note: 'Security contact info' },
  { path: '/.well-known/', note: 'Well-known directory' },
  { path: '/humans.txt', note: 'Site credits' },
  { path: '/favicon.ico' },
  { path: '/manifest.json', note: 'PWA manifest' },
  { path: '/api', note: 'API endpoint' },
  { path: '/api/health', note: 'Health check endpoint' },
  { path: '/auth', note: 'Auth endpoint' },
  { path: '/admin', note: 'Admin panel' },
  { path: '/login', note: 'Login page' },
  { path: '/wp-admin', note: 'WordPress admin (if applicable)' },
  { path: '/.env', note: 'Environment file (should NOT be public)' },
  { path: '/config.json', note: 'Config file' },
];

export async function checkPublicFiles(baseUrl: string): Promise<PublicFile[]> {
  const origin = new URL(baseUrl).origin;
  const results: PublicFile[] = [];

  const checks = PUBLIC_PATHS.map(async ({ path }) => {
    const url = `${origin}${path}`;
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; VibeCheck/1.0; +https://github.com/vibecoded)',
        },
      });

      return {
        path,
        accessible: res.status >= 200 && res.status < 400,
        status: res.status,
      } as PublicFile;
    } catch {
      return {
        path,
        accessible: false,
        status: 0,
      } as PublicFile;
    }
  });

  const settled = await Promise.allSettled(checks);
  for (const r of settled) {
    if (r.status === 'fulfilled') results.push(r.value);
  }

  return results;
}

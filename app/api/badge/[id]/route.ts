import { store } from '@/lib/store';

export async function GET(_req: Request, ctx: RouteContext<'/api/badge/[id]'>) {
  const { id } = await ctx.params;
  const scan = store.getScan(id);
  if (!scan) return new Response('Not found', { status: 404 });

  const { vibe, security } = scan.result;
  const hostname = (() => { try { return new URL(scan.result.url).hostname; } catch { return scan.result.url; } })();

  const vibeColor = vibe.score >= 70 ? '#8b5cf6' : vibe.score >= 30 ? '#f59e0b' : '#22c55e';
  const secColor = security.score >= 70 ? '#22c55e' : security.score >= 40 ? '#f59e0b' : '#ef4444';
  const label = vibe.score >= 70 ? 'Likely Vibe-Coded' : vibe.score >= 30 ? 'Possibly Vibe-Coded' : 'Hand-Crafted';

  const w = 260;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="72" viewBox="0 0 ${w} 72">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#111118"/>
      <stop offset="100%" stop-color="#0d0d16"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="72" rx="8" fill="url(#bg)" stroke="${vibeColor}" stroke-width="1.5" stroke-opacity="0.6"/>
  <rect x="0" y="0" width="6" height="72" rx="3" fill="${vibeColor}"/>

  <!-- VibeScan label -->
  <text x="18" y="20" font-family="system-ui,-apple-system,sans-serif" font-size="10" fill="${vibeColor}" font-weight="700" letter-spacing="1">VIBESCAN</text>

  <!-- Domain -->
  <text x="18" y="38" font-family="system-ui,-apple-system,sans-serif" font-size="13" fill="#ffffff" font-weight="600">${hostname.slice(0, 28)}${hostname.length > 28 ? '…' : ''}</text>

  <!-- Label -->
  <text x="18" y="55" font-family="system-ui,-apple-system,sans-serif" font-size="11" fill="${vibeColor}">${label}</text>

  <!-- Scores -->
  <text x="${w - 12}" y="30" font-family="system-ui,-apple-system,sans-serif" font-size="11" fill="#ffffff" font-weight="700" text-anchor="end">V: ${vibe.score}</text>
  <text x="${w - 12}" y="48" font-family="system-ui,-apple-system,sans-serif" font-size="11" fill="${secColor}" font-weight="700" text-anchor="end">S: ${security.score}</text>

  <!-- Powered by -->
  <text x="${w - 12}" y="64" font-family="system-ui,-apple-system,sans-serif" font-size="8" fill="#444466" text-anchor="end">vibecoded.dev</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

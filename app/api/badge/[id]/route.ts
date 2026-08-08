import { getPublicScan } from '@/lib/scan-access';
import { getSecurityColor, getVibeColor } from '@/lib/vibe-constants';

function escapeXml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export async function GET(_req: Request, ctx: RouteContext<'/api/badge/[id]'>) {
  const { id } = await ctx.params;
  const scan = await getPublicScan(id);
  if (!scan) return new Response('Not found', { status: 404 });

  const { vibe, security } = scan.result;
  const hostname = (() => { try { return new URL(scan.result.url).hostname; } catch { return scan.result.url; } })();

  const vibeColor = getVibeColor(vibe.score);
  const secColor = getSecurityColor(security.score);
  const label = escapeXml(vibe.label);
  const safeHostname = escapeXml(`${hostname.slice(0, 28)}${hostname.length > 28 ? '…' : ''}`);
  const vibeScore = escapeXml(vibe.score);
  const securityScore = escapeXml(security.score);

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
  <text x="18" y="20" font-family="system-ui,-apple-system,sans-serif" font-size="10" fill="${vibeColor}" font-weight="700" letter-spacing="1">VIBESCAN</text>
  <text x="18" y="38" font-family="system-ui,-apple-system,sans-serif" font-size="13" fill="#ffffff" font-weight="600">${safeHostname}</text>
  <text x="18" y="55" font-family="system-ui,-apple-system,sans-serif" font-size="11" fill="${vibeColor}">${label}</text>
  <text x="${w - 12}" y="30" font-family="system-ui,-apple-system,sans-serif" font-size="11" fill="#ffffff" font-weight="700" text-anchor="end">E: ${vibeScore}</text>
  <text x="${w - 12}" y="48" font-family="system-ui,-apple-system,sans-serif" font-size="11" fill="${secColor}" font-weight="700" text-anchor="end">H: ${securityScore}</text>
  <text x="${w - 12}" y="64" font-family="system-ui,-apple-system,sans-serif" font-size="8" fill="#444466" text-anchor="end">isthisvibecoded.com</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

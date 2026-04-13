import { getScan } from '@/lib/store';

export async function GET(_req: Request, ctx: RouteContext<'/api/sharecard/[id]'>) {
  const { id } = await ctx.params;
  const scan = await getScan(id);
  if (!scan) return new Response('Not found', { status: 404 });

  const { vibe, security, techStack, hosting } = scan.result;
  const hostname = (() => { try { return new URL(scan.result.url).hostname; } catch { return scan.result.url; } })();

  const vibeColor = vibe.score >= 70 ? '#8b5cf6' : vibe.score >= 30 ? '#f59e0b' : '#22c55e';
  const secColor  = security.score >= 70 ? '#22c55e' : security.score >= 40 ? '#f59e0b' : '#ef4444';
  const vibeLabel = vibe.score >= 70 ? 'Heavily Vibe-Coded' : vibe.score >= 30 ? 'Possibly Vibe-Coded' : 'Hand-Crafted';
  const topTech   = techStack.slice(0, 3).map(t => t.name).join('  ·  ');
  const host      = hosting.provider ?? '';

  const W = 600;
  const H = 315;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f0f1c"/>
      <stop offset="100%" stop-color="#0a0a14"/>
    </linearGradient>
    <radialGradient id="glow" cx="85%" cy="15%" r="50%">
      <stop offset="0%" stop-color="${vibeColor}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${vibeColor}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="accentBar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${vibeColor}"/>
      <stop offset="100%" stop-color="${vibeColor}" stop-opacity="0.5"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <!-- Left accent bar -->
  <rect x="0" y="0" width="5" height="${H}" fill="url(#accentBar)"/>

  <!-- Border -->
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="0" fill="none"
    stroke="${vibeColor}" stroke-width="1" stroke-opacity="0.25"/>

  <!-- VibeScan brand -->
  <text x="28" y="46"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="11" font-weight="800" fill="${vibeColor}"
    letter-spacing="3">VIBESCAN</text>

  <!-- Domain -->
  <text x="28" y="92"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="30" font-weight="700" fill="#ffffff">
    ${hostname.length > 30 ? hostname.slice(0, 30) + '…' : hostname}
  </text>

  <!-- Vibe label -->
  <text x="28" y="122"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="13" fill="${vibeColor}" font-weight="500" opacity="0.9">${vibeLabel}</text>

  <!-- Divider -->
  <line x1="28" y1="144" x2="${W - 28}" y2="144" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

  <!-- Vibe score box -->
  <rect x="28" y="162" width="130" height="72" rx="10"
    fill="rgba(255,255,255,0.04)" stroke="${vibeColor}" stroke-width="1" stroke-opacity="0.3"/>
  <text x="93" y="191"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="11" fill="rgba(255,255,255,0.4)" text-anchor="middle" letter-spacing="1">VIBE SCORE</text>
  <text x="93" y="222"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="28" font-weight="800" fill="${vibeColor}" text-anchor="middle">${vibe.score}%</text>

  <!-- Security score box -->
  <rect x="174" y="162" width="130" height="72" rx="10"
    fill="rgba(255,255,255,0.04)" stroke="${secColor}" stroke-width="1" stroke-opacity="0.3"/>
  <text x="239" y="191"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="11" fill="rgba(255,255,255,0.4)" text-anchor="middle" letter-spacing="1">SECURITY</text>
  <text x="239" y="222"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="28" font-weight="800" fill="${secColor}" text-anchor="middle">${security.score}</text>

  <!-- Risk level box -->
  <rect x="320" y="162" width="130" height="72" rx="10"
    fill="rgba(255,255,255,0.04)" stroke="${secColor}" stroke-width="1" stroke-opacity="0.3"/>
  <text x="385" y="191"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="11" fill="rgba(255,255,255,0.4)" text-anchor="middle" letter-spacing="1">RISK LEVEL</text>
  <text x="385" y="222"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="18" font-weight="700" fill="${secColor}" text-anchor="middle"
    text-transform="capitalize">${security.riskLevel.charAt(0).toUpperCase() + security.riskLevel.slice(1)}</text>

  ${topTech ? `<!-- Tech stack -->
  <text x="28" y="266"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="11" fill="rgba(255,255,255,0.3)">
    ${topTech.slice(0, 60)}${topTech.length > 60 ? '…' : ''}
  </text>` : ''}

  ${host ? `<!-- Host -->
  <text x="${W - 28}" y="266"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="11" fill="rgba(255,255,255,0.25)" text-anchor="end">${host}</text>` : ''}

  <!-- URL watermark -->
  <text x="${W - 28}" y="${H - 16}"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="10" fill="rgba(255,255,255,0.15)" text-anchor="end">isthisvibecoded.com</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

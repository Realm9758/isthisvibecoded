import type { PublicKey, KeyRisk } from '@/types/analysis';

interface KeyPattern {
  type: string;
  pattern: RegExp;
  risk: KeyRisk;
  truncate: (match: string) => string;
}

const KEY_PATTERNS: KeyPattern[] = [
  {
    type: 'Supabase URL',
    pattern: /https:\/\/[a-z0-9]{20,}\.supabase\.co/g,
    risk: 'info',
    truncate: (m) => m,
  },
  {
    type: 'JWT / Bearer Token',
    pattern: /eyJ[a-zA-Z0-9_-]{40,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
    risk: 'low',
    truncate: (m) => m.slice(0, 20) + '...' + m.slice(-8),
  },
  {
    type: 'Firebase / Google API Key',
    pattern: /AIza[A-Za-z0-9_\-]{35}/g,
    risk: 'low',
    truncate: (m) => m.slice(0, 8) + '...' + m.slice(-4),
  },
  {
    type: 'Stripe Publishable Key',
    pattern: /pk_(test|live)_[A-Za-z0-9]{24,}/g,
    risk: 'info',
    truncate: (m) => m.slice(0, 12) + '...' + m.slice(-4),
  },
  {
    type: 'Mapbox Token',
    pattern: /pk\.ey[A-Za-z0-9._\-]{30,}/g,
    risk: 'low',
    truncate: (m) => m.slice(0, 16) + '...',
  },
  {
    type: 'NEXT_PUBLIC_ env variable',
    pattern: /NEXT_PUBLIC_[A-Z0-9_]+=["']([^"']{8,})["']/g,
    risk: 'info',
    truncate: (m) => m.slice(0, 30) + (m.length > 30 ? '...' : ''),
  },
  {
    type: 'AWS Access Key ID',
    // Public-facing access key IDs start with AKIA, ASIA, AROA, AIDA
    pattern: /(?:AKIA|ASIA|AROA|AIDA)[A-Z0-9]{16}/g,
    risk: 'high',
    truncate: (m) => m.slice(0, 6) + '...' + m.slice(-4),
  },
  {
    type: 'GitHub Token',
    pattern: /ghp_[A-Za-z0-9]{36,}/g,
    risk: 'high',
    truncate: (m) => m.slice(0, 8) + '...',
  },
  {
    type: 'SendGrid API Key',
    pattern: /SG\.[A-Za-z0-9_\-]{22,}\.[A-Za-z0-9_\-]{22,}/g,
    risk: 'medium',
    truncate: (m) => m.slice(0, 10) + '...',
  },
];

export function scanForPublicKeys(html: string): PublicKey[] {
  const found: PublicKey[] = [];
  const seen = new Set<string>();

  for (const { type, pattern, risk, truncate } of KEY_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(html)) !== null) {
      const raw = match[0];
      const truncated = truncate(raw);
      const key = `${type}:${raw.slice(0, 10)}`;

      if (!seen.has(key)) {
        seen.add(key);

        // Determine if found inside a <script> or HTML
        const position = match.index;
        const precedingHtml = html.slice(Math.max(0, position - 200), position);
        const source = /<script/i.test(precedingHtml) ? 'script' : 'html';

        found.push({ type, value: truncated, source, risk });
      }
    }
  }

  return found;
}

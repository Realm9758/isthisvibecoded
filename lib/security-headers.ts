import type { SecurityHeaderResult, RiskLevel } from '@/types/analysis';

const CHECKED_HEADERS: Array<{
  name: string;
  severity: SecurityHeaderResult['severity'];
  penalty: number;
  recommendation: string;
}> = [
  {
    name: 'Content-Security-Policy',
    severity: 'critical',
    penalty: 25,
    recommendation: "Add a CSP to restrict which resources the browser can load. Start with: default-src 'self'",
  },
  {
    name: 'Strict-Transport-Security',
    severity: 'high',
    penalty: 20,
    recommendation: 'Add HSTS to enforce HTTPS. Use: max-age=31536000; includeSubDomains',
  },
  {
    name: 'X-Frame-Options',
    severity: 'high',
    penalty: 15,
    recommendation: 'Prevent clickjacking with: X-Frame-Options: DENY or SAMEORIGIN',
  },
  {
    name: 'X-Content-Type-Options',
    severity: 'medium',
    penalty: 10,
    recommendation: 'Prevent MIME-type sniffing: X-Content-Type-Options: nosniff',
  },
  {
    name: 'Referrer-Policy',
    severity: 'medium',
    penalty: 10,
    recommendation: 'Control referrer leakage: Referrer-Policy: strict-origin-when-cross-origin',
  },
  {
    name: 'Permissions-Policy',
    severity: 'low',
    penalty: 5,
    recommendation: 'Restrict browser features: Permissions-Policy: camera=(), microphone=(), geolocation=()',
  },
];

export function analyzeSecurityHeaders(
  responseHeaders: Record<string, string>,
  httpsEnabled: boolean,
): { score: number; riskLevel: RiskLevel; headers: SecurityHeaderResult[] } {
  let score = 100;

  if (!httpsEnabled) {
    score -= 30;
  }

  const headers: SecurityHeaderResult[] = CHECKED_HEADERS.map(({ name, severity, penalty, recommendation }) => {
    const normalizedName = name.toLowerCase();
    const value = responseHeaders[normalizedName] ?? responseHeaders[name];
    const present = value !== undefined && value !== '';

    if (!present) {
      score -= penalty;
    }

    return {
      name,
      present,
      value: present ? value : undefined,
      severity,
      recommendation,
    };
  });

  score = Math.max(0, Math.min(100, score));

  let riskLevel: RiskLevel;
  if (score >= 70) riskLevel = 'Low Risk';
  else if (score >= 40) riskLevel = 'Medium Risk';
  else riskLevel = 'High Risk';

  return { score: Math.round(score), riskLevel, headers };
}

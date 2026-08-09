import type { SecurityHeaderResult, RiskLevel } from '@/types/analysis';

export const SECURITY_MODEL_VERSION = '2.1.0-header-hardening';

const CHECKED_HEADERS: Array<{
  name: string;
  severity: SecurityHeaderResult['severity'];
  penalty: number;
  recommendation: string;
}> = [
  {
    name: 'Content-Security-Policy',
    severity: 'medium',
    penalty: 25,
    recommendation: "Add a CSP to restrict which resources the browser can load. Start with: default-src 'self'",
  },
  {
    name: 'Strict-Transport-Security',
    severity: 'low',
    penalty: 20,
    recommendation: 'Add HSTS to enforce HTTPS. Use: max-age=31536000; includeSubDomains',
  },
  {
    name: 'X-Frame-Options',
    severity: 'medium',
    penalty: 5,
    recommendation: "Prevent clickjacking. Modern alternative: add frame-ancestors 'none' to your CSP.",
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

function directiveTokens(policy: string, directiveName: string): string[] | undefined {
  for (const rawDirective of policy.split(';')) {
    const parts = rawDirective.trim().split(/\s+/).filter(Boolean);
    if (parts[0]?.toLowerCase() === directiveName) return parts.slice(1);
  }
  return undefined;
}

function hasRestrictiveFrameAncestors(policy: string): boolean {
  const tokens = directiveTokens(policy, 'frame-ancestors');
  if (!tokens?.length || tokens.includes('*')) return false;
  return tokens.every(token =>
    token === "'none'"
    || token === "'self'"
    || /^(?:https?:\/\/)?(?:\*\.)?[a-z0-9.-]+(?::\d+)?$/i.test(token),
  );
}

function hasScriptNonceOrHash(tokens: string[]): boolean {
  return tokens.some(token =>
    /^'?(?:nonce-[a-z0-9+/_-]+|sha(?:256|384|512)-[a-z0-9+/=_-]+)'?$/i.test(token),
  );
}

function permissionsPolicyQuality(policy: string): { quality: number; details?: string } {
  const directives = policy.split(',').map(value => value.trim()).filter(Boolean);
  if (directives.length === 0) return { quality: 0 };

  let restricted = 0;
  let wildcard = 0;
  for (const directive of directives) {
    const match = /^[a-z][a-z0-9-]*\s*=\s*(\([^)]*\)|\*)$/i.exec(directive);
    if (!match) return { quality: 0 };
    if (match[1] === '*' || /(?:^|\s)\*(?:\s|$)/.test(match[1].slice(1, -1))) wildcard++;
    else restricted++;
  }

  if (restricted === 0) {
    return { quality: 0, details: 'The policy allows every origin for the listed browser features.' };
  }
  if (wildcard > 0) {
    return { quality: 0.5, details: 'Some browser features are restricted, but another directive still allows every origin.' };
  }
  return { quality: 1 };
}

export function analyzeSecurityHeaders(
  responseHeaders: Record<string, string>,
  httpsEnabled: boolean,
): { score: number; riskLevel: RiskLevel; headers: SecurityHeaderResult[]; modelVersion: string } {
  let score = 100;

  if (!httpsEnabled) {
    score -= 30;
  }

  const csp = responseHeaders['content-security-policy'] ?? responseHeaders['Content-Security-Policy'] ?? '';

  const headers: SecurityHeaderResult[] = CHECKED_HEADERS.map(({ name, severity, penalty, recommendation }) => {
    const normalizedName = name.toLowerCase();
    const rawValue = responseHeaders[normalizedName] ?? responseHeaders[name];
    const detected = rawValue !== undefined && rawValue.trim() !== '';
    let present = detected;
    let value = detected ? rawValue.trim() : undefined;
    let quality = detected ? 1 : 0;
    let details = detected ? 'Header value passed the focused validity check.' : 'Header was not detected.';

    if (name === 'Content-Security-Policy' && detected) {
      const scriptSources = directiveTokens(value!, 'script-src') ?? directiveTokens(value!, 'default-src');
      if (!scriptSources?.length) {
        quality = 0;
        details = 'A CSP header exists, but it has no default-src or script-src restriction.';
      } else if (scriptSources.length === 1 && scriptSources[0] === '*') {
        quality = 0;
        details = 'The effective script source is a wildcard and does not restrict where scripts can load from.';
      } else if (scriptSources.includes('*')) {
        quality = 0.25;
        details = 'The effective script source includes a wildcard and provides only minimal restriction.';
      } else if (scriptSources.some(token => /^(?:https?|data):$/i.test(token))) {
        quality = 0.25;
        details = 'The effective script source permits a broad URL scheme, so scripts can load from origins the policy does not enumerate.';
      } else if (scriptSources.some(token => token.toLowerCase() === "'unsafe-eval'")) {
        quality = 0.5;
        details = "The CSP restricts sources but allows 'unsafe-eval', which substantially weakens script protection.";
      } else if (
        scriptSources.some(token => token.toLowerCase() === "'unsafe-inline'")
        && !hasScriptNonceOrHash(scriptSources)
      ) {
        quality = 0.75;
        details = "The CSP restricts sources but permits unscoped 'unsafe-inline' code.";
      }
    }

    if (name === 'Strict-Transport-Security' && detected) {
      const maxAge = /(?:^|;)\s*max-age\s*=\s*(\d+)/i.exec(value!)?.[1];
      const seconds = maxAge ? Number(maxAge) : 0;
      if (!httpsEnabled || seconds <= 0) {
        quality = 0;
        details = !httpsEnabled
          ? 'HSTS is ineffective when the inspected page is not served over HTTPS.'
          : 'HSTS has no positive max-age and is therefore ineffective.';
      } else if (seconds < 15_552_000) {
        quality = 0.5;
        details = 'HSTS is enabled for less than six months; a longer policy provides more durable protection.';
      }
    }

    if (name === 'X-Frame-Options') {
      const coveredByCsp = hasRestrictiveFrameAncestors(csp);
      if (!detected && coveredByCsp) {
        present = true;
        value = 'Covered by CSP frame-ancestors';
        quality = 1;
        details = 'Clickjacking protection is provided by CSP frame-ancestors.';
      } else if (detected && !/^(?:deny|sameorigin)$/i.test(value!)) {
        quality = 0;
        details = 'X-Frame-Options must be DENY or SAMEORIGIN; ALLOW-FROM is obsolete.';
      }
    }

    if (name === 'X-Content-Type-Options' && detected && value!.toLowerCase() !== 'nosniff') {
      quality = 0;
      details = 'Only the nosniff value enables the intended protection.';
    }

    if (name === 'Referrer-Policy' && detected) {
      const effectivePolicy = value!.split(',').at(-1)?.trim().toLowerCase() ?? '';
      const protectivePolicies = new Set([
        'no-referrer',
        'same-origin',
        'origin',
        'strict-origin',
        'origin-when-cross-origin',
        'strict-origin-when-cross-origin',
      ]);
      if (!protectivePolicies.has(effectivePolicy)) {
        quality = 0;
        details = 'The effective referrer policy is missing, obsolete, or permits more URL leakage than this check accepts.';
      }
    }

    if (name === 'Permissions-Policy' && detected) {
      const assessment = permissionsPolicyQuality(value!);
      quality = assessment.quality;
      if (assessment.details) details = assessment.details;
      else if (assessment.quality === 0) details = 'The Permissions-Policy value does not contain a recognised feature allowlist.';
    }

    const penaltyApplied = Math.round(penalty * (1 - quality));
    score -= penaltyApplied;

    return {
      name,
      present,
      value,
      valid: quality === 1,
      details,
      penaltyApplied,
      severity,
      recommendation,
    };
  });

  score = Math.max(0, Math.min(100, score));

  let riskLevel: RiskLevel;
  if (score >= 80) riskLevel = 'Few Header Gaps';
  else if (score >= 50) riskLevel = 'Some Header Gaps';
  else riskLevel = 'Major Header Gaps';

  return { score: Math.round(score), riskLevel, headers, modelVersion: SECURITY_MODEL_VERSION };
}

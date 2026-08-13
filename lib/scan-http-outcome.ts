import type { ScanAccessDiagnostic, ScanProbeClassification } from '@/types/scan-job';

export type ProbeResponseOutcome = 'completed' | 'blocked' | 'failed';

type HeaderReader = Pick<Headers, 'get'>;

export interface ProbeResponseAssessment {
  classification: ScanProbeClassification;
  outcome: ProbeResponseOutcome;
  provider: ScanAccessDiagnostic['provider'];
  retryAfterMs: number | null;
  message: string;
}

function headerValue(headers: HeaderReader, name: string): string {
  return headers.get(name)?.trim() ?? '';
}

export function retryAfterMilliseconds(
  value: string | null,
  now = Date.now(),
  maximumMs = 120_000,
): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(value) - now;
  if (!Number.isFinite(milliseconds)) return null;
  return Math.min(maximumMs, Math.max(0, Math.round(milliseconds)));
}

function challengeProvider(
  status: number,
  headers: HeaderReader,
  bodySample = '',
): ScanAccessDiagnostic['provider'] {
  if (
    headerValue(headers, 'cf-mitigated')
    || headerValue(headers, 'cf-ray') && /cloudflare|challenge-platform|attention required/i.test(bodySample)
  ) return 'cloudflare';
  if (
    headerValue(headers, 'x-vercel-mitigated')
    || headerValue(headers, 'x-vercel-challenge-token')
    || /vercel security checkpoint/i.test(bodySample)
  ) return 'vercel';
  if (headerValue(headers, 'x-sucuri-block') || /sucuri website firewall/i.test(bodySample)) return 'sucuri';
  if (
    headerValue(headers, 'x-bot-protection')
    || headerValue(headers, 'x-captcha')
    || (status === 403 && /captcha|bot challenge|security checkpoint|challenge-platform/i.test(bodySample))
  ) return 'generic';
  return null;
}

/**
 * Produce a semantic assessment instead of flattening every denial into a
 * generic "blocked" counter. Ordinary 401/403/404 responses are useful
 * negative evidence; only a real challenge or temporary throttle is unknown.
 */
export function assessProbeResponse(
  status: number,
  headers: HeaderReader,
  options: {
    forbiddenIsBlocked?: boolean;
    rateLimitIsEvidence?: boolean;
    bodySample?: string;
    now?: number;
  } = {},
): ProbeResponseAssessment {
  const provider = challengeProvider(status, headers, options.bodySample);
  if (provider) {
    return {
      classification: 'bot_challenge',
      outcome: 'blocked',
      provider,
      retryAfterMs: null,
      message: `${provider === 'generic' ? 'A bot filter' : provider[0].toUpperCase() + provider.slice(1)} challenged the automated request before the application response could be evaluated`,
    };
  }
  if (status === 429 && !options.rateLimitIsEvidence) {
    const retryAfterMs = retryAfterMilliseconds(headers.get('retry-after'), options.now);
    return {
      classification: 'rate_limited',
      outcome: 'blocked',
      provider: null,
      retryAfterMs,
      message: retryAfterMs === null
        ? 'The target temporarily rate-limited this request'
        : `The target requested a ${Math.ceil(retryAfterMs / 1_000)} second cool-down`,
    };
  }
  if (status >= 500) {
    return {
      classification: 'upstream_error',
      outcome: 'failed',
      provider: null,
      retryAfterMs: null,
      message: `The upstream returned HTTP ${status}`,
    };
  }
  if (status === 403 && options.forbiddenIsBlocked) {
    return {
      classification: 'protected_denial',
      outcome: 'blocked',
      provider: null,
      retryAfterMs: null,
      message: 'The selected active input was denied before it could be evaluated',
    };
  }
  const protectedDenial = status === 401 || status === 403;
  return {
    classification: protectedDenial ? 'protected_denial' : 'usable',
    outcome: 'completed',
    provider: null,
    retryAfterMs: null,
    message: protectedDenial
      ? `HTTP ${status} denied public access; this is usable protection evidence`
      : `HTTP ${status} returned usable evidence`,
  };
}

/** Backwards-compatible coverage outcome used by existing callers/tests. */
export function classifyProbeResponse(
  status: number,
  headers: HeaderReader,
  options: { forbiddenIsBlocked?: boolean; rateLimitIsEvidence?: boolean } = {},
): ProbeResponseOutcome {
  return assessProbeResponse(status, headers, options).outcome;
}

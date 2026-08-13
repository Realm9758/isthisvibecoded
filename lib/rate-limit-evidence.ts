import type { ApplicationQueryInput } from '@/lib/application-inputs';

const MUTATING_PATH = /\/(?:logout|signout|delete|remove|send|invite|checkout|purchase|payments?|webhooks?|callback|upload|import|reset|password|verify)(?:\/|$)/i;
const RATE_HEADER_NAMES = [
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'retry-after',
] as const;

/**
 * Validate an owner-selected GET path without retaining query values, tokens,
 * credentials, or a state-changing route in the durable job record.
 */
export function normalizeOwnerRateLimitPath(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('The rate-limit endpoint must be a relative public path.');
  const source = value.trim();
  if (!source || source.length > 300 || !source.startsWith('/') || source.startsWith('//')) {
    throw new Error('Enter a relative public path such as /api/search.');
  }
  if (source.includes('?') || source.includes('#')) {
    throw new Error('Remove query values and fragments from the rate-limit endpoint.');
  }
  let url: URL;
  try {
    url = new URL(source, 'https://ironclad.invalid');
  } catch {
    throw new Error('The rate-limit endpoint path is not valid.');
  }
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(url.pathname); } catch { throw new Error('The rate-limit endpoint path has invalid encoding.'); }
  if (!url.pathname.startsWith('/') || MUTATING_PATH.test(decodedPath)) {
    throw new Error('Choose a read-only endpoint. Logout, reset, upload, payment, and other changing actions are not allowed.');
  }
  return url.pathname;
}

/** Selects one same-origin, GET-like API target without inventing a login attempt. */
export function selectRateLimitTarget(
  baseUrl: string,
  queryInputs: readonly ApplicationQueryInput[],
  discoveredRoutes: readonly string[],
  postActions: readonly string[],
): string | null {
  const origin = new URL(baseUrl).origin;
  const posts = new Set(postActions.map(action => {
    try { return new URL(action, origin).pathname; } catch { return ''; }
  }));

  for (const input of queryInputs) {
    try {
      const url = new URL(input.url, origin);
      if (url.origin !== origin || !url.pathname.startsWith('/api/') || MUTATING_PATH.test(url.pathname)) continue;
      url.search = '';
      url.searchParams.set(input.parameter, 'ironclad-rate-control');
      return url.href;
    } catch {
      // Continue to another passively discovered candidate.
    }
  }

  for (const route of discoveredRoutes) {
    try {
      const url = new URL(route, origin);
      if (
        url.origin !== origin
        || !url.pathname.startsWith('/api/')
        || posts.has(url.pathname)
        || MUTATING_PATH.test(url.pathname)
      ) continue;
      url.search = '';
      return url.href;
    } catch {
      // Continue to another passively discovered candidate.
    }
  }
  return null;
}

export type RateLimitEvidence = {
  throttled: boolean;
  headerNames: string[];
};

export function assessRateLimitEvidence(responses: readonly Pick<Response, 'status' | 'headers'>[]): RateLimitEvidence {
  const headers = new Set<string>();
  for (const response of responses) {
    for (const name of RATE_HEADER_NAMES) {
      if (response.headers.get(name)?.trim()) headers.add(name);
    }
  }
  return {
    throttled: responses.some(response => response.status === 429),
    headerNames: [...headers],
  };
}

export function describeRateLimitEvidence(evidence: RateLimitEvidence, requestCount: number): string {
  if (evidence.throttled) {
    return `The selected public API route returned HTTP 429 during a bounded ${requestCount}-request burst. This confirms a low-volume throttle on that route, not its effectiveness against distributed abuse.`;
  }
  if (evidence.headerNames.length > 0) {
    return `The selected public API route advertised rate-limit policy through ${evidence.headerNames.join(', ')}. It did not throttle this bounded ${requestCount}-request burst.`;
  }
  return `No rate-limit status or standard rate-limit header appeared during ${requestCount} safe GET requests to one discovered public API route. This does not cover login attempts, distributed abuse, or thresholds above the safety cap.`;
}

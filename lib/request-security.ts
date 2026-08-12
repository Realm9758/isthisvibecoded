import 'server-only';
import { SITE_ORIGIN } from '@/lib/site';
import { MUTATION_GUARD_HEADER, MUTATION_GUARD_VALUE } from '@/lib/request-security-constants';

export const MAX_JSON_REQUEST_BYTES = 16_384;

/**
 * Reject cross-origin, form-compatible, and unexpectedly large mutation
 * requests before parsing their bodies or performing outbound work.
 */
export function mutationRequestError(
  request: Request,
  maxBytes = MAX_JSON_REQUEST_BYTES,
): string | null {
  const expectedOrigin = new URL(SITE_ORIGIN).origin;
  const origin = request.headers.get('origin');
  if (origin !== expectedOrigin) return 'This request must come from the Ironclad application.';

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') {
    return 'Cross-site mutation requests are not allowed.';
  }

  if (request.headers.get(MUTATION_GUARD_HEADER) !== MUTATION_GUARD_VALUE) {
    return 'Missing request-verification header.';
  }

  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') return 'Content-Type must be application/json.';

  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return 'Request body is too large.';
  }

  return null;
}

/** Read JSON with a hard byte cap even when Content-Length is absent. */
export async function readBoundedJson(
  request: Request,
  maxBytes = MAX_JSON_REQUEST_BYTES,
): Promise<unknown> {
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maxBytes) throw new Error('Request body is too large.');
  return JSON.parse(new TextDecoder().decode(bytes));
}

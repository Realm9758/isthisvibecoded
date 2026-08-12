import 'server-only';
import { resolveTxt } from 'node:dns/promises';
import { pinnedFetch } from '@/lib/pinned-fetch';
import { normalizePublicUrl } from '@/lib/url-safety';
import { SCANNER_INFO_URL } from '@/lib/site';

export type ManualVerificationMethod = 'dns' | 'meta' | 'file';

export type VerificationProofResult = {
  verified: boolean;
  method: ManualVerificationMethod;
  error?: string;
  reasonCode?: string;
  proofSubject?: string;
};

function readMetaAttribute(tag: string, attribute: 'name' | 'content'): string | null {
  const pattern = attribute === 'name'
    ? /\sname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i
    : /\scontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
  const match = tag.match(pattern);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
}

/**
 * Accept only a real-looking meta element in the document head. Comments and
 * raw-text/template regions are removed before tags are inspected, preventing
 * an inert string published in user content from becoming a control proof.
 */
export function hasVerificationMetaInHead(html: string, token: string): boolean {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const headMatch = withoutComments.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i);
  if (!headMatch) return false;

  const head = headMatch[1]
    .replace(/<(?:script|style|template|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|template|noscript)\s*>/gi, '');
  const tags = head.match(/<meta\b[^>]*>/gi) ?? [];
  return tags.some(tag =>
    readMetaAttribute(tag, 'name')?.trim().toLowerCase() === 'vibecoded-verification'
      && readMetaAttribute(tag, 'content')?.trim() === token
  );
}

function isCanonicalAlias(original: string, candidate: string): boolean {
  const left = original.toLowerCase();
  const right = candidate.toLowerCase();
  return left === right || `www.${left}` === right || `www.${right}` === left;
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('Verification response is too large');
  }
  const body = await response.arrayBuffer();
  if (body.byteLength > maxBytes) throw new Error('Verification response is too large');
  return new TextDecoder().decode(body);
}

async function fetchVerificationTarget(rawUrl: string, maxBytes: number): Promise<{
  response: Response;
  finalHostname: string;
}> {
  let target = normalizePublicUrl(rawUrl);
  target.protocol = 'https:';
  const originalHostname = target.hostname.toLowerCase();

  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await pinnedFetch(target, {
      headers: { 'User-Agent': `Ironclad-Verifier/3.0 (+${SCANNER_INFO_URL})` },
      signal: AbortSignal.timeout(8_000),
      redirect: 'manual',
      maxResponseBytes: maxBytes,
    });
    if (response.status < 300 || response.status >= 400) {
      return { response, finalHostname: target.hostname.toLowerCase() };
    }
    const location = response.headers.get('location');
    if (!location) return { response, finalHostname: target.hostname.toLowerCase() };

    const nextTarget = normalizePublicUrl(new URL(location, target).href);
    if (nextTarget.protocol !== 'https:' || !isCanonicalAlias(originalHostname, nextTarget.hostname)) {
      throw new Error('Verification redirects must stay on HTTPS and the apex/www host pair');
    }
    await response.body?.cancel().catch(() => undefined);
    target = nextTarget;
  }
  throw new Error('Too many verification redirects');
}

export async function checkManualVerificationProof(
  domain: string,
  token: string,
  method: ManualVerificationMethod,
): Promise<VerificationProofResult> {
  if (method === 'dns') {
    const hostname = `_vibecoded-verification.${domain}`;
    try {
      const records = await resolveTxt(hostname);
      const expected = `vibecoded-verification=${token}`;
      const verified = records.some(chunks => chunks.join('').trim() === expected);
      return verified
        ? { verified: true, method, proofSubject: hostname }
        : {
            verified: false,
            method,
            reasonCode: 'dns_value_mismatch',
            error: `A TXT record exists at ${hostname}, but its value does not match this token.`,
          };
    } catch {
      return {
        verified: false,
        method,
        reasonCode: 'dns_record_missing',
        error: `No TXT record was found at ${hostname}. DNS changes can take several minutes to appear.`,
      };
    }
  }

  const isMeta = method === 'meta';
  const url = isMeta
    ? `https://${domain}`
    : `https://${domain}/.well-known/vibecoded.txt`;
  try {
    const { response, finalHostname } = await fetchVerificationTarget(url, isMeta ? 512_000 : 4_096);
    if (!response.ok) {
      return {
        verified: false,
        method,
        reasonCode: 'http_status',
        error: `${isMeta ? 'Site' : 'Verification path'} returned HTTP ${response.status}.`,
      };
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (isMeta) {
      if (!contentType.includes('text/html')) {
        return { verified: false, method, reasonCode: 'not_html', error: 'The homepage did not return HTML.' };
      }
      const html = await readBoundedBody(response, 512_000);
      const verified = hasVerificationMetaInHead(html, token);
      return verified
        ? { verified: true, method, proofSubject: finalHostname }
        : {
            verified: false,
            method,
            reasonCode: 'meta_missing_from_head',
            error: 'The exact verification meta tag was not found in the server-rendered document head.',
          };
    }

    if (contentType.includes('text/html')) {
      return {
        verified: false,
        method,
        reasonCode: 'file_html_fallback',
        error: 'The verification path returned an HTML fallback instead of the text file.',
      };
    }
    const text = (await readBoundedBody(response, 4_096)).trim();
    return text === token
      ? { verified: true, method, proofSubject: finalHostname }
      : {
          verified: false,
          method,
          reasonCode: 'file_content_mismatch',
          error: 'The verification file exists, but its contents do not exactly match this token.',
        };
  } catch (error) {
    return {
      verified: false,
      method,
      reasonCode: 'fetch_failed',
      error: error instanceof Error ? error.message : 'Could not fetch the verification proof.',
    };
  }
}

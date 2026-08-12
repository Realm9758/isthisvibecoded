export type SriIssue = 'missing_integrity' | 'invalid_integrity' | 'missing_crossorigin';

export interface SriAssessment {
  url: string;
  issue: SriIssue;
}

function attribute(tag: string, name: string): { present: boolean; value: string } {
  const match = new RegExp(
    `\\b${name}\\b(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+)))?`,
    'i',
  ).exec(tag);
  return {
    present: match !== null,
    value: match ? (match[1] ?? match[2] ?? match[3] ?? '') : '',
  };
}

function validIntegrity(value: string): boolean {
  return value.trim().split(/\s+/).some(token => {
    const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})(?:\?.*)?$/.exec(token);
    if (!match) return false;
    const minimumLength = match[1] === 'sha256' ? 43 : match[1] === 'sha384' ? 64 : 86;
    return match[2].length >= minimumLength;
  });
}

/** Assess an immutable cross-origin script or stylesheet tag. */
export function assessSriTag(tag: string, pageUrl: string): SriAssessment | null {
  const resourceAttribute = attribute(tag, /<script\b/i.test(tag) ? 'src' : 'href');
  if (!resourceAttribute.value) return null;

  let resource: URL;
  let page: URL;
  try {
    resource = new URL(resourceAttribute.value, pageUrl);
    page = new URL(pageUrl);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(resource.protocol) || resource.origin === page.origin) return null;

  const immutable = /(?:@|\/v?)\d+\.\d+(?:\.\d+)?(?:[/?#.-]|$)|[?&](?:v|version)=\d/i.test(resource.href);
  if (!immutable) return null;

  resource.username = '';
  resource.password = '';
  resource.search = '';
  resource.hash = '';

  const integrity = attribute(tag, 'integrity');
  if (!integrity.present) return { url: resource.href, issue: 'missing_integrity' };
  if (!validIntegrity(integrity.value)) return { url: resource.href, issue: 'invalid_integrity' };

  const crossorigin = attribute(tag, 'crossorigin');
  if (!crossorigin.present) return { url: resource.href, issue: 'missing_crossorigin' };
  const value = crossorigin.value.toLowerCase();
  if (value && value !== 'anonymous' && value !== 'use-credentials') {
    return { url: resource.href, issue: 'missing_crossorigin' };
  }
  return null;
}

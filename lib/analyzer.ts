import type { AnalysisResult } from '@/types/analysis';
import { detectVibe } from './vibe-detector';
import { analyzeSecurityHeaders } from './security-headers';
import { detectTechStack } from './tech-detector';
import { detectHosting } from './hosting-detector';
import { scanForPublicKeys } from './key-scanner';
import { checkPublicFiles } from './public-files';
import { normalizePublicUrl } from './url-safety';
import { pinnedFetch } from './pinned-fetch';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MAX_HTML_BYTES = 2_000_000;
// Leave enough of the route's 30-second budget for bounded public-path probes,
// persistence, and (on failure) quota restoration. This is one deadline for the
// complete redirect chain, not a fresh timeout for every hop.
const MAIN_FETCH_BUDGET_MS = 14_000;

function remainingTime(deadlineAt: number): number {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new Error('Analysis timeout while fetching the main page');
  return remaining;
}

async function withinDeadline<T>(operation: Promise<T>, deadlineAt: number): Promise<T> {
  const remaining = remainingTime(deadlineAt);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Analysis timeout while validating the target')),
          remaining,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchWithSafeRedirects(
  startUrl: URL,
  deadlineAt: number,
): Promise<{ response: Response; finalUrl: URL; redirectsFollowed: number }> {
  let currentUrl = startUrl;

  for (let i = 0; i < 6; i++) {
    // Resolve, validate, and pin the socket immediately before each request so
    // a second DNS answer cannot redirect the connection to a private address.
    const response = await withinDeadline(pinnedFetch(currentUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*' },
      signal: AbortSignal.timeout(Math.min(10_000, remainingTime(deadlineAt))),
      redirect: 'manual',
    }), deadlineAt);

    if (response.status < 300 || response.status >= 400) {
      return { response, finalUrl: currentUrl, redirectsFollowed: i };
    }

    const location = response.headers.get('location');
    if (!location) {
      return { response, finalUrl: currentUrl, redirectsFollowed: i };
    }

    const rawNextUrl = new URL(location, currentUrl);
    const nextUrl = normalizePublicUrl(rawNextUrl.href);
    // Redirect query parameters can be required for routing. Use them only for
    // this outbound hop; they are stripped again before persistence.
    nextUrl.search = rawNextUrl.search;
    await response.body?.cancel().catch(() => undefined);
    currentUrl = nextUrl;
  }

  throw new Error('Too many redirects');
}

async function readLimitedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) {
    throw new Error(`HTML response is too large (limit ${MAX_HTML_BYTES / 1_000_000} MB)`);
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error(`HTML response is too large (limit ${MAX_HTML_BYTES / 1_000_000} MB)`);
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function assertUsableHtml(response: Response, html: string): void {
  if (!response.ok) {
    throw new Error(`Website returned HTTP ${response.status}; no reliable page was available to analyse`);
  }

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  const looksLikeHtml = /<!doctype\s+html|<html\b|<head\b|<body\b|<main\b|<div\b/i.test(html);
  if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    throw new Error(`Unsupported content type: ${contentType.split(';')[0]}`);
  }
  if (!looksLikeHtml || html.trim().length < 80) {
    throw new Error('The response did not contain enough HTML for a reliable analysis');
  }

  const challenge = /cf-chl-|challenge-platform|just a moment\.\.\.|checking your browser|captcha|access denied/i;
  if (challenge.test(html.slice(0, 200_000))) {
    throw new Error('The website returned a bot-protection or access-denied page; analysis would be unreliable');
  }
}

export async function analyzeUrl(rawUrl: string): Promise<AnalysisResult> {
  const requestedUrl = normalizePublicUrl(rawUrl);
  const mainFetchDeadline = Date.now() + MAIN_FETCH_BUDGET_MS;

  const { response, finalUrl, redirectsFollowed } = await fetchWithSafeRedirects(
    requestedUrl,
    mainFetchDeadline,
  );

  const html = await readLimitedText(response);
  assertUsableHtml(response, html);
  const publicFinalUrl = normalizePublicUrl(finalUrl.href);

  // Normalize response headers to lowercase keys
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const httpsEnabled = finalUrl.protocol === 'https:';

  // Run all detectors concurrently
  const [vibeRaw, securityResult, techStack, hosting, publicKeys, publicFiles] =
    await Promise.all([
      Promise.resolve(detectVibe(html, headers, publicFinalUrl.href)),
      Promise.resolve(analyzeSecurityHeaders(headers, httpsEnabled)),
      Promise.resolve(detectTechStack(html, headers)),
      Promise.resolve(detectHosting(html, headers, publicFinalUrl.href)),
      Promise.resolve(scanForPublicKeys(html)),
      checkPublicFiles(publicFinalUrl.href),
    ]);

  return {
    url: publicFinalUrl.href,
    scannedAt: new Date().toISOString(),
    // Keep the structured evidence and model metadata intact. Reconstructing the
    // legacy four-field shape here would silently discard the audit trail.
    vibe: vibeRaw,
    security: {
      ...securityResult,
      httpsEnabled,
    },
    techStack,
    hosting,
    publicFiles,
    publicKeys,
    coverage: {
      responseStatus: response.status,
      contentType: response.headers.get('content-type') ?? 'not provided',
      htmlBytes: new TextEncoder().encode(html).byteLength,
      redirectsFollowed,
      publicPathChecks: {
        attempted: publicFiles.length,
        completed: publicFiles.filter(file => file.status !== 0).length,
        failed: publicFiles.filter(file => file.status === 0).length,
      },
      limitations: vibeRaw.limitations,
    },
  };
}

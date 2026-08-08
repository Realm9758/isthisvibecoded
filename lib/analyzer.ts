import type { AnalysisResult } from '@/types/analysis';
import { detectVibe } from './vibe-detector';
import { analyzeSecurityHeaders } from './security-headers';
import { detectTechStack } from './tech-detector';
import { detectHosting } from './hosting-detector';
import { scanForPublicKeys } from './key-scanner';
import { checkPublicFiles } from './public-files';
import { assertPublicTarget, normalizePublicUrl } from './url-safety';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MAX_HTML_BYTES = 2_000_000;

async function fetchWithSafeRedirects(
  startUrl: URL,
): Promise<{ response: Response; finalUrl: URL; redirectsFollowed: number }> {
  let currentUrl = startUrl;

  for (let i = 0; i < 6; i++) {
    // Revalidate immediately before every request and every redirect hop. This
    // narrows (but cannot fully eliminate) DNS rebinding risk; production egress
    // should additionally be restricted at the network layer.
    await assertPublicTarget(currentUrl);
    const response = await fetch(currentUrl.href, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'manual',
    });

    if (response.status < 300 || response.status >= 400) {
      return { response, finalUrl: currentUrl, redirectsFollowed: i };
    }

    const location = response.headers.get('location');
    if (!location) {
      return { response, finalUrl: currentUrl, redirectsFollowed: i };
    }

    const nextUrl = normalizePublicUrl(new URL(location, currentUrl).href);
    await assertPublicTarget(nextUrl);
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

  const { response, finalUrl, redirectsFollowed } = await fetchWithSafeRedirects(requestedUrl);

  const html = await readLimitedText(response);
  assertUsableHtml(response, html);

  // Normalize response headers to lowercase keys
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const httpsEnabled = finalUrl.protocol === 'https:';

  // Run all detectors concurrently
  const [vibeRaw, securityResult, techStack, hosting, publicKeys, publicFiles] =
    await Promise.all([
      Promise.resolve(detectVibe(html, headers, finalUrl.href)),
      Promise.resolve(analyzeSecurityHeaders(headers, httpsEnabled)),
      Promise.resolve(detectTechStack(html, headers)),
      Promise.resolve(detectHosting(html, headers, finalUrl.href)),
      Promise.resolve(scanForPublicKeys(html)),
      checkPublicFiles(finalUrl.href),
    ]);

  return {
    url: finalUrl.href,
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

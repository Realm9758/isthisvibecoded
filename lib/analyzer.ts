import type { AnalysisResult } from '@/types/analysis';
import { detectVibe, getVibeLabel } from './vibe-detector';
import { analyzeSecurityHeaders } from './security-headers';
import { detectTechStack } from './tech-detector';
import { detectHosting } from './hosting-detector';
import { scanForPublicKeys } from './key-scanner';
import { checkPublicFiles } from './public-files';
import { assertPublicTarget, normalizePublicUrl } from './url-safety';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchWithSafeRedirects(startUrl: URL): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = startUrl;

  for (let i = 0; i < 6; i++) {
    const response = await fetch(currentUrl.href, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'manual',
    });

    if (response.status < 300 || response.status >= 400) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get('location');
    if (!location) {
      return { response, finalUrl: currentUrl };
    }

    const nextUrl = normalizePublicUrl(new URL(location, currentUrl).href);
    await assertPublicTarget(nextUrl);
    currentUrl = nextUrl;
  }

  throw new Error('Too many redirects');
}

export async function analyzeUrl(rawUrl: string): Promise<AnalysisResult> {
  const requestedUrl = normalizePublicUrl(rawUrl);

  const { response, finalUrl } = await fetchWithSafeRedirects(requestedUrl);

  const html = await response.text();

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

  const vibeLabel = getVibeLabel(vibeRaw.score);

  return {
    url: finalUrl.href,
    scannedAt: new Date().toISOString(),
    vibe: {
      score: vibeRaw.score,
      label: vibeLabel,
      confidence: vibeRaw.confidence,
      reasons: vibeRaw.reasons,
    },
    security: {
      ...securityResult,
      httpsEnabled,
    },
    techStack,
    hosting,
    publicFiles,
    publicKeys,
  };
}

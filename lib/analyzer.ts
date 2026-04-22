import type { AnalysisResult } from '@/types/analysis';
import { detectVibe, getVibeLabel } from './vibe-detector';
import { analyzeSecurityHeaders } from './security-headers';
import { detectTechStack } from './tech-detector';
import { detectHosting } from './hosting-detector';
import { scanForPublicKeys } from './key-scanner';
import { checkPublicFiles } from './public-files';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export async function analyzeUrl(rawUrl: string): Promise<AnalysisResult> {
  // Normalize URL
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
  const parsedUrl = new URL(url);
  const httpsEnabled = parsedUrl.protocol === 'https:';

  // Fetch the page (10s timeout)
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*' },
    signal: AbortSignal.timeout(10_000),
    redirect: 'follow',
  });

  const html = await response.text();

  // Normalize response headers to lowercase keys
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  // Run all detectors concurrently
  const [vibeRaw, securityResult, techStack, hosting, publicKeys, publicFiles] =
    await Promise.all([
      Promise.resolve(detectVibe(html, headers, parsedUrl.href)),
      Promise.resolve(analyzeSecurityHeaders(headers, httpsEnabled)),
      Promise.resolve(detectTechStack(html, headers)),
      Promise.resolve(detectHosting(html, headers, parsedUrl.href)),
      Promise.resolve(scanForPublicKeys(html)),
      checkPublicFiles(url),
    ]);

  const vibeLabel = getVibeLabel(vibeRaw.score);

  return {
    url: parsedUrl.href,
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

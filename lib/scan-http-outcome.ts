export type ProbeResponseOutcome = 'completed' | 'blocked' | 'failed';

type HeaderReader = Pick<Headers, 'get'>;

/**
 * Classify whether an HTTP response was usable evidence for a bounded probe.
 * Ordinary negative responses such as 401, 403 and 404 are valid evidence.
 * Explicit rate limits, bot challenges and upstream/server failures are gaps
 * in coverage, even though an HTTP transport response arrived successfully.
 */
export function classifyProbeResponse(
  status: number,
  headers: HeaderReader,
  options: { forbiddenIsBlocked?: boolean } = {},
): ProbeResponseOutcome {
  const challenge = [
    headers.get('cf-mitigated'),
    headers.get('x-vercel-mitigated'),
    headers.get('x-sucuri-block'),
    headers.get('x-bot-protection'),
    headers.get('x-captcha'),
  ].some(value => value !== null && value.trim() !== '');

  if (status === 429 || challenge || (status === 403 && options.forbiddenIsBlocked)) return 'blocked';
  if (status >= 500) return 'failed';
  return 'completed';
}

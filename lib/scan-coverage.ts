import type { CheckCoverage } from '@/types/deep-scan';

/**
 * Coverage rules for a scan.
 *
 * The scanner used to discard an entire scan if any single probe failed or was
 * blocked. That is right for a verified domain, where clean access is expected
 * and a partial answer would be misleading. It is fatal for a public landing
 * page: point it at anything behind a firewall and every scan returns an error
 * instead of a report.
 *
 * A blocked probe is now a gap in one check, not a failed scan. The report
 * renders, the affected check says so, and only the grade is withheld, and
 * only when the missing check was one that could have lowered it.
 */

/**
 * Checks whose findings carry a deduction in calculateDeepScore. If one of
 * these could not run, the resulting number would be flattering rather than
 * merely incomplete, so it is withheld. Checks outside this set are
 * informational, and a gap in one leaves the grade meaningful.
 */
export const SCORED_PHASE_IDS: ReadonlySet<string> = new Set([
  'vibe', 'files', 'cors', 'headers', 'cookies', 'ssl', 'serverstatus',
  'dirlist', 'sourcemaps', 'sqli', 'nosql', 'traversal', 'ssrf',
  'crlf', 'hostheader', 'redirect', 'errors', 'admin', 'forced',
  'supabase', 'firebase', 'storage', 'nextauth',
]);

/**
 * Why a check could not be completed, in words a site owner can act on. The
 * reader does not need the status code; they need to know that the scanner
 * could not evaluate the response. A block may come from the site, a safety
 * boundary, or a provider quota, so the fallback must not guess which one.
 */
export function describeCoverageFailure(counts: { blocked: number; failed: number }): string | null {
  if (counts.blocked > 0) return 'One or more requests were blocked before they could be evaluated';
  if (counts.failed > 0) return 'The request failed or timed out';
  return null;
}

export function scoreIsWithheld(checks: readonly CheckCoverage[]): boolean {
  return checks.some(check => {
    if (check.applicable === false || check.complete || !SCORED_PHASE_IDS.has(check.phaseId)) return false;
    if (check.requestsAttempted <= 0) return true;
    const unusable = Math.min(
      check.requestsAttempted,
      check.requestsFailed + check.requestsBlocked,
    );
    const usable = Math.max(0, check.requestsCompleted - unusable);
    // One denied path in a broad 20-path inventory should remain visible, but
    // it should not erase an otherwise useful grade. A scored phase with no
    // usable evidence, or with more than a quarter of its probes unknown, is
    // materially incomplete and still withholds the number.
    return usable === 0 || unusable / check.requestsAttempted > 0.25;
  });
}

/** Checks that produced no answer, for the report's coverage banner. */
export function incompleteChecks(checks: readonly CheckCoverage[]): CheckCoverage[] {
  return checks.filter(check => !check.complete);
}

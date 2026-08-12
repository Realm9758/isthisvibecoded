import { describeCoverageFailure } from '@/lib/scan-coverage';
import type { ScanPhaseProgress } from '@/types/deep-scan';

export type ScanPhaseRequestCoverage = NonNullable<ScanPhaseProgress['coverage']>;

export type ScanPhaseOutcome = Required<
  Pick<ScanPhaseProgress, 'coverage' | 'reason'>
> & {
  status: Exclude<ScanPhaseProgress['status'], 'start' | 'progress'>;
};

export interface ResolveScanPhaseOutcomeInput {
  /** False means the check had nothing relevant to inspect for this target. */
  applicable?: boolean;
  coverage: ScanPhaseRequestCoverage;
  /** A more specific explanation supplied by the check, when available. */
  reason?: string | null;
}

/**
 * Turns a check's applicability and request accounting into its terminal live
 * progress event. Keeping this rule pure prevents a failed or blocked probe
 * from being streamed as a successful check merely because its function
 * returned normally.
 */
export function resolveScanPhaseOutcome({
  applicable = true,
  coverage,
  reason,
}: ResolveScanPhaseOutcomeInput): ScanPhaseOutcome {
  const explicitReason = reason?.trim() || null;

  // Applicability is independent of transport success. It takes precedence so
  // a provider-specific check is visibly skipped rather than called broken.
  if (!applicable) {
    return {
      status: 'not_applicable',
      coverage,
      reason: explicitReason ?? 'Not applicable',
    };
  }

  const coverageReason = describeCoverageFailure({
    blocked: coverage.requestsBlocked,
    failed: coverage.requestsFailed,
  });
  const didNotCompleteEveryAttempt = coverage.requestsAttempted > coverage.requestsCompleted;

  if (explicitReason || coverageReason || didNotCompleteEveryAttempt) {
    return {
      status: 'incomplete',
      coverage,
      reason: explicitReason
        ?? coverageReason
        ?? 'Not every attempted request completed',
    };
  }

  return { status: 'complete', coverage, reason: null };
}

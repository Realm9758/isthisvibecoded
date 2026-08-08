import type { DeepFinding, DeepFindingSeverity } from '@/types/deep-scan';

export const DEEP_SCORING_VERSION = '2.0.0-heuristic';

// Policy deductions for a bounded heuristic grade. They are neither
// probabilities nor empirically calibrated loss estimates. The guardrails
// below align severe findings with the UI's A/B/C/D/F boundaries.
const DEDUCTION: Record<DeepFindingSeverity, number> = {
  critical: 42,
  high: 28,
  medium: 14,
  low: 4,
  info: 0,
};

function correlationFamily(finding: DeepFinding): string {
  // Repeated cookie names often reflect one site-wide missing attribute. Keep
  // only the strongest instance of each attribute so cookie count cannot
  // dominate the grade. Other stable rule IDs represent independent checks.
  const cookieFamily = finding.id.match(/^cookie-(httponly|secure|samesite)-/);
  return cookieFamily ? `cookie-${cookieFamily[1]}` : finding.id;
}

/**
 * Calculate a bounded heuristic safety grade. Equivalent evidence from one
 * rule family contributes once; independent findings continue to accumulate.
 */
export function calculateDeepScore(findings: DeepFinding[]): number {
  const worstPerFamily = new Map<string, number>();
  for (const finding of findings) {
    const deduction = DEDUCTION[finding.severity];
    const family = correlationFamily(finding);
    worstPerFamily.set(family, Math.max(worstPerFamily.get(family) ?? 0, deduction));
  }

  const totalDeduction = [...worstPerFamily.values()].reduce((sum, value) => sum + value, 0);
  let score = Math.max(0, 100 - totalDeduction);

  // Grade-aligned ceilings: critical -> F, high -> D, medium -> C, low -> B.
  if (findings.some(finding => finding.severity === 'critical')) score = Math.min(score, 24);
  else if (findings.some(finding => finding.severity === 'high')) score = Math.min(score, 49);
  else if (findings.some(finding => finding.severity === 'medium')) score = Math.min(score, 74);
  else if (findings.some(finding => finding.severity === 'low')) score = Math.min(score, 89);

  return score;
}

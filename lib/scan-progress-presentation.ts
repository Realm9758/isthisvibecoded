import type { ScanPhaseProgress } from '@/types/deep-scan';

type TerminalPhaseStatus = Extract<
  ScanPhaseProgress['status'],
  'complete' | 'incomplete' | 'not_applicable'
>;

interface TerminalPhaseLogInput {
  label: string;
  status: TerminalPhaseStatus;
  findingCount: number;
  findingSeverities?: readonly unknown[];
  reason?: string | null;
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;

export function formatFindingCount(count: number): string {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `${safeCount} finding${safeCount === 1 ? '' : 's'}`;
}

function findingSummary(count: number, rawSeverities: readonly unknown[]): string {
  const total = formatFindingCount(count);
  const severityCounts = new Map<string, number>();

  for (const value of rawSeverities) {
    if (typeof value !== 'string') continue;
    const severity = value.trim().toLowerCase();
    if (!SEVERITY_ORDER.includes(severity as (typeof SEVERITY_ORDER)[number])) continue;
    severityCounts.set(severity, (severityCounts.get(severity) ?? 0) + 1);
  }

  const breakdown = SEVERITY_ORDER
    .flatMap(severity => {
      const severityCount = severityCounts.get(severity) ?? 0;
      return severityCount > 0 ? [`${severityCount} ${severity}`] : [];
    })
    .join(', ');

  return breakdown ? `${total} (${breakdown})` : total;
}

/**
 * Formats one terminal phase event without confusing completed coverage with
 * a clean security result. Findings and coverage are deliberately represented
 * as separate facts, including when a phase is inconclusive.
 */
export function formatTerminalPhaseLog({
  label,
  status,
  findingCount,
  findingSeverities = [],
  reason,
}: TerminalPhaseLogInput): string {
  const hasFindings = Number.isFinite(findingCount) && findingCount > 0;
  const findings = findingSummary(findingCount, findingSeverities);
  const explanation = reason?.trim() || null;

  if (status === 'complete') {
    return hasFindings
      ? `[!] ${label}: check complete with ${findings}`
      : `[✓] ${label}: check complete, no matching findings`;
  }

  if (status === 'incomplete') {
    return hasFindings
      ? `[!] ${label}: ${findings} reported; coverage also inconclusive${explanation ? `, ${explanation}` : ''}`
      : `[?] ${label}: coverage inconclusive${explanation ? `, ${explanation}` : ''}`;
  }

  // A non-applicable phase should not carry findings, but do not hide them if
  // a malformed or future server event ever contains both.
  return hasFindings
    ? `[!] ${label}: ${findings} reported; phase also marked not applicable${explanation ? `, ${explanation}` : ''}`
    : `[-] ${label}: not applicable${explanation ? `, ${explanation}` : ''}`;
}

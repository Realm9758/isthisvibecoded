import type { DeepScanResult, DeepFinding } from '@/types/deep-scan';

export interface ScanDiff {
  resolved: DeepFinding[];
  added: DeepFinding[];
  stillOpen: DeepFinding[];
  /** False when there is no prior scan, or the scans used different instruments. */
  comparable: boolean;
}

const EMPTY: ScanDiff = { resolved: [], added: [], stillOpen: [], comparable: false };

/** One rule firing at two URLs is two findings, so the URL is part of identity. */
const key = (finding: DeepFinding) => `${finding.id}::${finding.url ?? ''}`;

/**
 * Compare a rescan against the previous scan of the same domain.
 *
 * Lanes are never compared. A surface grade and a deep grade are different
 * measurements taken with different instruments, so diffing across them would
 * report a lane's additional findings as newly appeared the first time
 * somebody verifies their domain, and as all resolved the first time they
 * scan without it.
 */
export function diffScans(previous: DeepScanResult | null, current: DeepScanResult): ScanDiff {
  if (!previous) return EMPTY;
  // Legacy rows carry no lane and are deep scans by definition.
  if ((previous.lane ?? 'deep') !== (current.lane ?? 'deep')) return EMPTY;
  // Rule, scoring, or coverage changes can make a finding appear or disappear
  // without the site changing. Do not call that movement resolved/new.
  const beforeVersions = previous.versions;
  const afterVersions = current.versions;
  if (!beforeVersions || !afterVersions) return EMPTY;
  if (
    beforeVersions.scanner !== afterVersions.scanner
    || beforeVersions.scoring !== afterVersions.scoring
    || beforeVersions.coverage !== afterVersions.coverage
  ) return EMPTY;

  const before = new Map(previous.findings.map(finding => [key(finding), finding]));
  const after = new Map(current.findings.map(finding => [key(finding), finding]));

  return {
    resolved: [...before].filter(([id]) => !after.has(id)).map(([, finding]) => finding),
    added: [...after].filter(([id]) => !before.has(id)).map(([, finding]) => finding),
    stillOpen: [...after].filter(([id]) => before.has(id)).map(([, finding]) => finding),
    comparable: true,
  };
}

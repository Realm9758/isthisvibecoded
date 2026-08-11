import type { ScanLane } from '@/lib/scan-lanes';

export type DeepFindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type DeepFindingCategory =
  | 'exposed-files'
  | 'cors'
  | 'headers'
  | 'cookies'
  | 'http-methods'
  | 'info-disclosure'
  | 'ssl'
  | 'authentication'
  | 'injection';

export interface DeepFinding {
  id: string;
  category: DeepFindingCategory;
  severity: DeepFindingSeverity;
  title: string;
  description: string;
  evidence?: string;
  remediation: string;
  url?: string;
}

export interface CheckedItem {
  id: string;
  label: string;
  description: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  detail: string;
}

/** What one check managed to observe, and why it fell short if it did. */
export interface CheckCoverage {
  /** Scanner phase id, matching SCAN_PHASES. */
  phaseId: string;
  requestsAttempted: number;
  requestsCompleted: number;
  requestsFailed: number;
  requestsBlocked: number;
  /** False when a probe failed or was blocked, so this check is inconclusive. */
  complete: boolean;
  /** Plain-language reason shown to the reader. Null when the check completed. */
  reason: string | null;
}

/** Public builder provenance. Context for the report, never a finding. */
export interface ScanProvenance {
  builder: string | null;
  evidence: string[];
}

export interface DeepScanResult {
  domain: string;
  /** Missing on legacy rows written before the lane split; those are deep. */
  lane?: ScanLane;
  scannedAt: string;
  duration: number;
  /** Missing on legacy rows created before scanner/scoring versioning. */
  versions?: {
    scanner: string;
    scoring: string;
    coverage: string;
    lane?: ScanLane;
  };
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    /** Null when a check that carries deductions could not run. */
    score: number | null;
  };
  coverage?: {
    requestsAttempted: number;
    requestsCompleted: number;
    requestsFailed: number;
    requestsBlocked: number;
    complete: boolean;
    /** Per-check attribution. Absent on rows written before this existed. */
    checks?: CheckCoverage[];
  };
  provenance?: ScanProvenance;
  findings: DeepFinding[];
  checked: CheckedItem[];
}

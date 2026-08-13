import type { ScanLane } from '@/lib/scan-lanes';
import type { ScanAccessDiagnostic, ScanPass } from '@/types/scan-job';

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
  | 'injection'
  | 'cloud-data';

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
  status: 'pass' | 'warn' | 'fail' | 'skip' | 'observe';
  detail: string;
  /** Plain-language report structure. Optional for legacy stored scans. */
  whatTested?: string;
  observation?: string;
  meaning?: string;
  notTested?: string;
  nextAction?: string;
}

/** What one check managed to observe, and why it fell short if it did. */
export interface CheckCoverage {
  /** Scanner phase id, matching SCAN_PHASES. */
  phaseId: string;
  requestsAttempted: number;
  requestsCompleted: number;
  requestsFailed: number;
  requestsBlocked: number;
  /** Server-measured wall time spent in this module. Missing on legacy scans. */
  durationMs?: number;
  /** False when a provider or framework-specific check did not apply. */
  applicable?: boolean;
  /** False when a probe failed or was blocked, so this check is inconclusive. */
  complete: boolean;
  /** Plain-language reason shown to the reader. Null when the check completed. */
  reason: string | null;
}

/** Live, server-reported outcome for one streamed scanner phase. */
export interface ScanPhaseProgress {
  status: 'start' | 'progress' | 'complete' | 'incomplete' | 'not_applicable';
  coverage?: Pick<
    CheckCoverage,
    'requestsAttempted' | 'requestsCompleted' | 'requestsFailed' | 'requestsBlocked'
  >;
  /** Measured on the server for this phase. */
  durationMs?: number;
  /** Explains an incomplete or non-applicable phase. */
  reason?: string | null;
  /** Real request work discovered for this module. Null while discovery is still open-ended. */
  plannedProbes?: number | null;
  /** Logical probes that reached a terminal response/evaluation state. */
  completedProbes?: number;
}

export interface ScanExecutionModuleReceipt {
  phaseId: string;
  status: 'complete' | 'incomplete' | 'not_applicable';
  findingCount: number;
  requestsAttempted: number;
  requestsCompleted: number;
  requestsFailed: number;
  requestsBlocked: number;
  durationMs: number;
  reason: string | null;
}

/** Private worker checkpoint for a terminal module; never streamed verbatim. */
export interface ScanPhaseCheckpoint {
  phaseId: string;
  findings: DeepFinding[];
  coverage: CheckCoverage;
  transportAttempts: number;
  retries: number;
}

export interface ScanExecutionReceipt {
  pass: ScanPass;
  scannerUserAgent: string;
  scannerEgressIps: string[];
  selectedPhaseIds: string[];
  /** Logical module probes. Retries do not increase this number. */
  requestsAttempted: number;
  /** Actual outbound request starts, including retries and redirect hops. */
  transportAttempts?: number;
  requestsCompleted: number;
  requestsFailed: number;
  requestsBlocked: number;
  retries: number;
  durationMs: number;
  modules: ScanExecutionModuleReceipt[];
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
  /** Exact module scope selected for this run. Missing on legacy scans. */
  scope?: {
    phaseIds: string[];
    /** False for a deliberately scoped scan; partial scopes never receive an overall grade. */
    fullInventory: boolean;
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
  /** What application inputs were passively discovered before active checks. */
  application?: {
    pageUrl: string;
    formsDiscovered: number;
    loginFormsDiscovered: number;
    publicGetParametersDiscovered: number;
    applicationRoutesDiscovered: number;
    testedParameterNames: string[];
  };
  /** Public-edge behaviour measured before an owner-controlled WAF exception. */
  perimeter?: {
    completedAt: string;
    diagnostics: ScanAccessDiagnostic[];
    accessReady: boolean;
  };
  /** Bounded, redacted execution evidence. Missing on legacy scans. */
  execution?: ScanExecutionReceipt;
  findings: DeepFinding[];
  checked: CheckedItem[];
}

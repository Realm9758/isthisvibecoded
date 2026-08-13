import type { DeepScanModuleId } from '@/lib/deep-scan-scope';

export const SCAN_JOB_STATES = [
  'queued',
  'perimeter_running',
  'waiting_for_access',
  'application_running',
  'retry_wait',
  'finalizing',
  'complete',
  'failed',
  'cancelled',
] as const;

export type ScanJobStatus = typeof SCAN_JOB_STATES[number];
export type ScanPass = 'perimeter' | 'application';

export type ScanProbeClassification =
  | 'usable'
  | 'protected_denial'
  | 'rate_limited'
  | 'bot_challenge'
  | 'upstream_error'
  | 'transport_error';

export interface ScanAccessDiagnostic {
  classification: ScanProbeClassification;
  provider: 'cloudflare' | 'vercel' | 'sucuri' | 'generic' | null;
  method: string;
  path: string;
  status: number | null;
  retryAfterMs: number | null;
  durationMs: number;
  message: string;
}

export type ScanProbeStage =
  | 'queued'
  | 'requesting'
  | 'retry_wait'
  | 'response'
  | 'evaluating'
  | 'complete';

export interface ScanProbeEvent {
  sequence?: number;
  pass: ScanPass;
  phaseId: string;
  moduleIndex: number;
  moduleCount: number;
  probeIndex: number;
  plannedProbes: number | null;
  stage: ScanProbeStage;
  method: string;
  path: string;
  parameter?: string;
  payloadClass?: string;
  attempt: number;
  maxAttempts: number;
  durationMs?: number;
  status?: number;
  classification?: ScanProbeClassification;
  provider?: ScanAccessDiagnostic['provider'];
  retryAfterMs?: number | null;
  message: string;
}

export interface DeepScanJob {
  id: string;
  userId: string;
  domain: string;
  startUrl: string;
  status: ScanJobStatus;
  selectedPhaseIds: DeepScanModuleId[];
  /** Optional owner-selected public GET path for the final rate-limit sample. */
  rateLimitPath: string | null;
  currentPass: ScanPass | null;
  currentPhaseId: string | null;
  checkpoint: number;
  accessDiagnostic: ScanAccessDiagnostic | null;
  eventsUrl: string;
  resultScanId: string | null;
  createdAt: number;
  updatedAt: number;
  waitingExpiresAt: number | null;
  failureMessage: string | null;
}

export type ScanJobEventType =
  | 'manifest'
  | 'job_state'
  | 'perimeter'
  | 'phase'
  | 'probe'
  | 'result'
  | 'error';

export interface ScanJobEvent {
  sequence: number;
  jobId: string;
  type: ScanJobEventType;
  createdAt: number;
  payload: unknown;
}

import 'server-only';
import { supabase } from '@/lib/supabase';
import type {
  DeepScanJob,
  ScanAccessDiagnostic,
  ScanJobEvent,
  ScanJobEventType,
  ScanJobStatus,
  ScanPass,
} from '@/types/scan-job';
import type { DeepScanModuleId } from '@/lib/deep-scan-scope';

const EVENT_PAYLOAD_LIMIT_BYTES = 1_000_000;
const EVENT_RETENTION_MS = 24 * 60 * 60_000;
export const ACCESS_WAIT_MS = 24 * 60 * 60_000;
export const JOB_LEASE_MS = 30_000;

interface JobRow {
  id: string;
  user_id: string;
  domain: string;
  start_url: string;
  status: ScanJobStatus;
  selected_phase_ids: unknown;
  rate_limit_path?: string | null;
  current_pass: ScanPass | null;
  current_phase_id: string | null;
  checkpoint: number;
  checkpoint_data?: string | null;
  access_diagnostic: unknown;
  result_scan_id: string | null;
  created_at: number;
  updated_at: number;
  waiting_expires_at: number | null;
  lease_owner?: string | null;
  lease_expires_at?: number | null;
  quota_key?: string | null;
  quota_state?: 'pending' | 'committed' | 'refunded';
  authorization_terms_version?: string;
  authorization_accepted_at?: number;
  verification_snapshot?: unknown;
  cancel_requested?: boolean;
  error?: string | null;
}

export interface WorkerScanJob extends DeepScanJob {
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  quotaKey: string | null;
  quotaState: 'pending' | 'committed' | 'refunded';
  authorizationTermsVersion: string;
  authorizationAcceptedAt: number;
  verificationSnapshot: unknown;
  cancelRequested: boolean;
  error: string | null;
  checkpointData: string | null;
}

export function publicScanJob(job: WorkerScanJob): DeepScanJob {
  return {
    id: job.id,
    userId: job.userId,
    domain: job.domain,
    startUrl: job.startUrl,
    status: job.status,
    selectedPhaseIds: job.selectedPhaseIds,
    rateLimitPath: job.rateLimitPath,
    currentPass: job.currentPass,
    currentPhaseId: job.currentPhaseId,
    checkpoint: job.checkpoint,
    accessDiagnostic: job.accessDiagnostic,
    eventsUrl: job.eventsUrl,
    resultScanId: job.resultScanId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    waitingExpiresAt: job.waitingExpiresAt,
    failureMessage: job.failureMessage,
  };
}

function asDiagnostic(value: unknown): ScanAccessDiagnostic | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ScanAccessDiagnostic>;
  if (typeof candidate.classification !== 'string' || typeof candidate.path !== 'string') return null;
  return candidate as ScanAccessDiagnostic;
}

function rowToJob(row: JobRow): WorkerScanJob {
  return {
    id: row.id,
    userId: row.user_id,
    domain: row.domain,
    startUrl: row.start_url,
    status: row.status,
    selectedPhaseIds: Array.isArray(row.selected_phase_ids)
      ? row.selected_phase_ids.filter((value): value is DeepScanModuleId => typeof value === 'string')
      : [],
    rateLimitPath: row.rate_limit_path ?? null,
    currentPass: row.current_pass,
    currentPhaseId: row.current_phase_id,
    checkpoint: Number(row.checkpoint),
    accessDiagnostic: asDiagnostic(row.access_diagnostic),
    eventsUrl: `/api/deep-scan/jobs/${row.id}/events`,
    resultScanId: row.result_scan_id,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    waitingExpiresAt: row.waiting_expires_at === null ? null : Number(row.waiting_expires_at),
    failureMessage: row.error ?? null,
    leaseOwner: row.lease_owner ?? null,
    leaseExpiresAt: row.lease_expires_at == null ? null : Number(row.lease_expires_at),
    quotaKey: row.quota_key ?? null,
    quotaState: row.quota_state ?? 'pending',
    authorizationTermsVersion: row.authorization_terms_version ?? '',
    authorizationAcceptedAt: Number(row.authorization_accepted_at ?? 0),
    verificationSnapshot: row.verification_snapshot ?? null,
    cancelRequested: row.cancel_requested === true,
    error: row.error ?? null,
    checkpointData: row.checkpoint_data ?? null,
  };
}

export async function createScanJob(input: {
  userId: string;
  domain: string;
  startUrl: string;
  selectedPhaseIds: readonly DeepScanModuleId[];
  rateLimitPath?: string | null;
  authorizationTermsVersion: string;
  authorizationAcceptedAt: number;
  verificationSnapshot: unknown;
}): Promise<WorkerScanJob> {
  const now = Date.now();
  const row = {
    id: crypto.randomUUID(),
    user_id: input.userId,
    domain: input.domain,
    start_url: input.startUrl,
    status: 'queued' satisfies ScanJobStatus,
    selected_phase_ids: input.selectedPhaseIds,
    rate_limit_path: input.rateLimitPath ?? null,
    authorization_terms_version: input.authorizationTermsVersion,
    authorization_accepted_at: input.authorizationAcceptedAt,
    verification_snapshot: input.verificationSnapshot,
    quota_state: 'pending',
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from('deep_scan_jobs').insert(row).select('*').single();
  if (error || !data) {
    if (error?.code === '23505') throw new Error('A scan for this domain is already active. Open it from your dashboard instead of starting another.');
    throw new Error('The scan job could not be created.');
  }
  return rowToJob(data as JobRow);
}

export async function getOwnedScanJob(jobId: string, userId: string): Promise<WorkerScanJob | null> {
  const { data, error } = await supabase
    .from('deep_scan_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToJob(data as JobRow);
}

export async function getActiveOwnedScanJob(userId: string): Promise<WorkerScanJob | null> {
  const { data, error } = await supabase
    .from('deep_scan_jobs')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['queued', 'perimeter_running', 'waiting_for_access', 'application_running', 'retry_wait', 'finalizing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return rowToJob(data as JobRow);
}

export async function claimScanJob(workerId: string): Promise<WorkerScanJob | null> {
  const now = Date.now();
  const { data, error } = await supabase.rpc('claim_deep_scan_job', {
    claimant_worker_id: workerId,
    lease_timestamp: now,
    lease_expiry: now + JOB_LEASE_MS,
  });
  if (error) throw new Error(`Could not claim a scan job: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? rowToJob(row as JobRow) : null;
}

/**
 * Claims one known job for the temporary serverless executor. PostgREST turns
 * the filters and update into one statement, so two function invocations
 * cannot both acquire the same unleased row.
 */
export async function claimScanJobById(jobId: string, workerId: string): Promise<WorkerScanJob | null> {
  const now = Date.now();
  const { data, error } = await supabase
    .from('deep_scan_jobs')
    .update({
      lease_owner: workerId,
      lease_expires_at: now + JOB_LEASE_MS,
      updated_at: now,
    })
    .eq('id', jobId)
    .eq('cancel_requested', false)
    .in('status', ['queued', 'perimeter_running', 'application_running', 'retry_wait', 'finalizing'])
    .or(`lease_expires_at.is.null,lease_expires_at.lt.${now}`)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Could not claim the temporary scan job: ${error.message}`);
  return data ? rowToJob(data as JobRow) : null;
}

export async function renewScanJobLease(jobId: string, workerId: string): Promise<boolean> {
  const now = Date.now();
  const { data, error } = await supabase.rpc('renew_deep_scan_job_lease', {
    claim_job_id: jobId,
    claimant_worker_id: workerId,
    lease_timestamp: now,
    lease_expiry: now + JOB_LEASE_MS,
  });
  return !error && data === true;
}

export async function updateScanJob(
  jobId: string,
  workerId: string | null,
  patch: Partial<{
    status: ScanJobStatus;
    currentPass: ScanPass | null;
    currentPhaseId: string | null;
    checkpoint: number;
    checkpointData: string | null;
    accessDiagnostic: ScanAccessDiagnostic | null;
    resultScanId: string | null;
    quotaKey: string | null;
    quotaState: 'pending' | 'committed' | 'refunded';
    waitingExpiresAt: number | null;
    cancelRequested: boolean;
    error: string | null;
    clearLease: boolean;
  }>,
): Promise<void> {
  const updates: Record<string, unknown> = { updated_at: Date.now() };
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.currentPass !== undefined) updates.current_pass = patch.currentPass;
  if (patch.currentPhaseId !== undefined) updates.current_phase_id = patch.currentPhaseId;
  if (patch.checkpoint !== undefined) updates.checkpoint = patch.checkpoint;
  if (patch.checkpointData !== undefined) updates.checkpoint_data = patch.checkpointData;
  if (patch.accessDiagnostic !== undefined) updates.access_diagnostic = patch.accessDiagnostic;
  if (patch.resultScanId !== undefined) updates.result_scan_id = patch.resultScanId;
  if (patch.quotaKey !== undefined) updates.quota_key = patch.quotaKey;
  if (patch.quotaState !== undefined) updates.quota_state = patch.quotaState;
  if (patch.waitingExpiresAt !== undefined) updates.waiting_expires_at = patch.waitingExpiresAt;
  if (patch.cancelRequested !== undefined) updates.cancel_requested = patch.cancelRequested;
  if (patch.error !== undefined) updates.error = patch.error;
  if (patch.clearLease) {
    updates.lease_owner = null;
    updates.lease_expires_at = null;
  }
  let query = supabase.from('deep_scan_jobs').update(updates).eq('id', jobId);
  if (workerId) query = query.eq('lease_owner', workerId);
  const { error } = await query;
  if (error) throw new Error(`Could not update the scan job: ${error.message}`);
}

function boundedPayload(payload: unknown): unknown {
  const source = JSON.stringify(payload);
  if (Buffer.byteLength(source, 'utf8') > EVENT_PAYLOAD_LIMIT_BYTES) {
    throw new Error('The redacted scan event exceeded its storage limit.');
  }
  return JSON.parse(source) as unknown;
}

export async function appendScanJobEvent(
  jobId: string,
  type: ScanJobEventType,
  payload: unknown,
): Promise<ScanJobEvent> {
  const createdAt = Date.now();
  const { data, error } = await supabase.from('deep_scan_events').insert({
    job_id: jobId,
    event_type: type,
    payload: boundedPayload(payload),
    created_at: createdAt,
  }).select('sequence').single();
  if (error || !data) throw new Error('Could not save scan progress.');
  return { sequence: Number(data.sequence), jobId, type, createdAt, payload };
}

export async function listScanJobEvents(
  jobId: string,
  afterSequence = 0,
  limit = 250,
): Promise<ScanJobEvent[]> {
  const { data, error } = await supabase
    .from('deep_scan_events')
    .select('sequence, job_id, event_type, payload, created_at')
    .eq('job_id', jobId)
    .gt('sequence', afterSequence)
    .order('sequence', { ascending: true })
    .limit(limit);
  if (error || !data) throw new Error('Could not read scan progress.');
  return data.map(row => ({
    sequence: Number(row.sequence),
    jobId: String(row.job_id),
    type: row.event_type as ScanJobEventType,
    payload: row.payload,
    createdAt: Number(row.created_at),
  }));
}

export async function cleanupExpiredScanEvents(): Promise<number> {
  const { data, error } = await supabase.rpc('cleanup_deep_scan_events', {
    expiry_timestamp: Date.now() - EVENT_RETENTION_MS,
  });
  if (error) throw new Error('Could not clean expired scan events.');
  return Number(data ?? 0);
}

export async function expireAccessWaitJobs(): Promise<number> {
  const { data, error } = await supabase.rpc('expire_deep_scan_access_waits', {
    current_timestamp_ms: Date.now(),
  });
  if (error) throw new Error('Could not expire old firewall access waits.');
  return Number(data ?? 0);
}

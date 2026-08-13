import 'server-only';
import { deepScanDomain, SCAN_PHASES } from '@/lib/deep-scanner';
import { runPerimeterPreflight, accessGuide } from '@/lib/scan-perimeter';
import { DEEP_SCANNER_USER_AGENT, durableDeepScanEnabled, scannerEgressIps } from '@/lib/scan-identity';
import {
  ACCESS_WAIT_MS,
  appendScanJobEvent,
  claimScanJob,
  cleanupExpiredScanEvents,
  expireAccessWaitJobs,
  renewScanJobLease,
  updateScanJob,
  type WorkerScanJob,
} from '@/lib/scan-job-store';
import { supabase } from '@/lib/supabase';
import { reserveUsageBatch, type UsageReservation } from '@/lib/scan-reservation';
import {
  FREE_LIFETIME_LIMIT,
  TARGET_HOURLY_LIMIT,
  USER_BURST_LIMIT,
  freeLifetimeKey,
  targetHourlyKey,
  userBurstKey,
} from '@/lib/scan-quota';
import { sanitizeFindings, sanitizeScanResult } from '@/lib/evidence-redaction';
import { encodeScanResultForStorage } from '@/lib/scan-result-storage';
import { decodeScanCheckpoints, encodeScanCheckpoints } from '@/lib/scan-checkpoint';
import type { DeepScanResult, ScanExecutionReceipt, ScanPhaseCheckpoint } from '@/types/deep-scan';
import type { ScanAccessDiagnostic, ScanJobStatus, ScanProbeEvent } from '@/types/scan-job';

const LEASE_RENEW_MS = 10_000;

async function setState(
  job: WorkerScanJob,
  workerId: string,
  state: ScanJobStatus,
  message: string,
  extra: Parameters<typeof updateScanJob>[2] = {},
): Promise<void> {
  await updateScanJob(job.id, workerId, { status: state, ...extra });
  await appendScanJobEvent(job.id, 'job_state', { state, message });
}

async function reserveApplicationQuota(job: WorkerScanJob, workerId: string): Promise<WorkerScanJob> {
  if (job.quotaState === 'committed') return job;
  const { data: user, error } = await supabase.from('users').select('plan').eq('id', job.userId).maybeSingle();
  if (error || !user) throw new Error('Ironclad could not confirm the account plan before starting the application pass.');
  const now = new Date();
  const reservations: UsageReservation[] = [
    { key: userBurstKey(job.userId, now), limit: USER_BURST_LIMIT },
    { key: targetHourlyKey(job.domain, now), limit: TARGET_HOURLY_LIMIT },
  ];
  const quotaKey = user.plan === 'free' ? freeLifetimeKey(job.userId) : null;
  if (quotaKey) reservations.push({ key: quotaKey, limit: FREE_LIFETIME_LIMIT });
  const reservation = await reserveUsageBatch(reservations);
  if (reservation.error) throw new Error('Ironclad could not reserve the scan allowance. Try again shortly.');
  if (!reservation.allowed) {
    if (quotaKey && reservation.deniedKey === quotaKey) {
      throw new Error(`All ${FREE_LIFETIME_LIMIT} free scans have been used. Upgrade to start another full assessment.`);
    }
    throw new Error('The account or domain has reached its active-scan safety limit. Wait before trying again.');
  }
  await updateScanJob(job.id, workerId, { quotaKey, quotaState: 'committed' });
  return { ...job, quotaKey, quotaState: 'committed' };
}

function diagnosticFromProbe(event: ScanProbeEvent): ScanAccessDiagnostic | null {
  if (!event.classification || !['bot_challenge', 'rate_limited'].includes(event.classification)) return null;
  return {
    classification: event.classification,
    provider: event.provider ?? null,
    method: event.method,
    path: event.path,
    status: event.status ?? null,
    retryAfterMs: event.retryAfterMs ?? null,
    durationMs: event.durationMs ?? 0,
    message: event.message,
  };
}

function executionReceipt(
  result: DeepScanResult,
  retries: number,
  transportAttempts: number,
  findingCounts: ReadonlyMap<string, number>,
): ScanExecutionReceipt {
  const checks = result.coverage?.checks ?? [];
  return {
    pass: 'application',
    scannerUserAgent: DEEP_SCANNER_USER_AGENT,
    scannerEgressIps: scannerEgressIps(),
    selectedPhaseIds: result.scope?.phaseIds ?? checks.map(check => check.phaseId),
    requestsAttempted: result.coverage?.requestsAttempted ?? 0,
    transportAttempts,
    requestsCompleted: result.coverage?.requestsCompleted ?? 0,
    requestsFailed: result.coverage?.requestsFailed ?? 0,
    requestsBlocked: result.coverage?.requestsBlocked ?? 0,
    retries,
    durationMs: result.duration,
    modules: checks.map(check => ({
      phaseId: check.phaseId,
      status: check.applicable === false ? 'not_applicable' : check.complete ? 'complete' : 'incomplete',
      findingCount: findingCounts.get(check.phaseId) ?? 0,
      requestsAttempted: check.requestsAttempted,
      requestsCompleted: check.requestsCompleted,
      requestsFailed: check.requestsFailed,
      requestsBlocked: check.requestsBlocked,
      durationMs: check.durationMs ?? 0,
      reason: check.reason,
    })),
  };
}

async function pauseForAccess(
  job: WorkerScanJob,
  workerId: string,
  diagnostic: ScanAccessDiagnostic,
): Promise<void> {
  const guide = accessGuide(diagnostic, job.domain);
  await updateScanJob(job.id, workerId, {
    status: 'waiting_for_access',
    currentPass: null,
    currentPhaseId: null,
    accessDiagnostic: diagnostic,
    waitingExpiresAt: Date.now() + ACCESS_WAIT_MS,
    clearLease: true,
  });
  await appendScanJobEvent(job.id, 'job_state', {
    state: 'waiting_for_access',
    message: `${diagnostic.message}. Your scan is saved and no further target requests will be sent until you recheck access.`,
    diagnostic,
    guide,
    creditUsed: job.quotaState === 'committed',
  });
}

export async function processScanJob(job: WorkerScanJob, workerId: string): Promise<void> {
  if (process.env.NODE_ENV === 'production' && scannerEgressIps().length === 0) {
    throw new Error('IRONCLAD_SCANNER_EGRESS_IPS must publish the dedicated worker identity in production.');
  }

  const abortController = new AbortController();
  const renew = setInterval(() => {
    void renewScanJobLease(job.id, workerId).then(active => {
      if (!active) abortController.abort(new Error('The worker lease ended.'));
    }).catch(() => abortController.abort(new Error('The worker lease could not be renewed.')));
  }, LEASE_RENEW_MS);

  let currentJob = job;
  let lastAccessDiagnostic: ScanAccessDiagnostic | null = null;
  const checkpointRecords = new Map<string, ScanPhaseCheckpoint>(
    decodeScanCheckpoints(job.checkpointData).map(item => [item.phaseId, item]),
  );
  let retryCount = [...checkpointRecords.values()].reduce((sum, item) => sum + item.retries, 0);
  let transportAttempts = [...checkpointRecords.values()].reduce((sum, item) => sum + item.transportAttempts, 0);
  let inRetryWait = false;
  const findingCounts = new Map<string, number>(
    [...checkpointRecords.values()].map(item => [item.phaseId, item.findings.length]),
  );
  const currentPhaseAttempts = new Map<string, number>();
  const currentPhaseRetries = new Map<string, number>();
  let eventTail: Promise<unknown> = Promise.resolve();
  const queueEvent = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = eventTail.then(operation, operation);
    eventTail = next.catch(() => undefined);
    return next;
  };

  try {
    await setState(job, workerId, 'perimeter_running', 'Checking whether the public firewall lets Ironclad reach four safe paths.', {
      currentPass: 'perimeter', currentPhaseId: 'access',
    });
    const perimeter = await runPerimeterPreflight(
      { hostname: job.domain, startUrl: job.startUrl },
      {
        signal: abortController.signal,
        onProbe: async event => { await queueEvent(() => appendScanJobEvent(job.id, 'probe', event)); },
      },
    );
    await eventTail;
    await appendScanJobEvent(job.id, 'perimeter', perimeter);
    const blocked = perimeter.accessReady ? null : (
      perimeter.diagnostics.find(item => !['usable', 'protected_denial'].includes(item.classification))
      ?? perimeter.diagnostics[0]
    );
    if (blocked) {
      await pauseForAccess(currentJob, workerId, blocked);
      return;
    }

    currentJob = await reserveApplicationQuota(currentJob, workerId);
    if (checkpointRecords.size > 0) {
      await appendScanJobEvent(job.id, 'job_state', {
        state: 'application_running',
        message: `The worker recovered ${checkpointRecords.size} completed module outcome${checkpointRecords.size === 1 ? '' : 's'}. It will restart only the interrupted module, while repeating browser discovery when later checks depend on it.`,
      });
    }
    await setState(job, workerId, 'application_running', 'Firewall access is ready. Starting the selected application modules one at a time.', {
      currentPass: 'application', currentPhaseId: 'init', accessDiagnostic: null, waitingExpiresAt: null,
    });

    const rawResult = await deepScanDomain(
      { hostname: job.domain, startUrl: job.startUrl },
      'deep',
      (phase, findings, progress) => {
        if (['complete', 'incomplete', 'not_applicable'].includes(progress.status)) {
          findingCounts.set(phase.id, findings.length);
        }
        void queueEvent(async () => {
          const terminal = ['complete', 'incomplete', 'not_applicable'].includes(progress.status);
          const phaseIndex = job.selectedPhaseIds.findIndex(id => id === phase.id);
          if (terminal && phaseIndex >= 0 && progress.coverage) {
            const previousCheckpoint = checkpointRecords.get(phase.id);
            checkpointRecords.set(phase.id, {
              phaseId: phase.id,
              findings: sanitizeFindings(findings),
              coverage: {
                phaseId: phase.id,
                ...progress.coverage,
                durationMs: progress.durationMs ?? 0,
                applicable: progress.status !== 'not_applicable',
                complete: progress.status !== 'incomplete',
                reason: progress.reason ?? null,
              },
              // Browser discovery and an interrupted module can be repeated
              // after a lease recovery. Preserve the attempts already made so
              // the final receipt still reconciles with the durable ledger.
              transportAttempts: (previousCheckpoint?.transportAttempts ?? 0)
                + (currentPhaseAttempts.get(phase.id) ?? 0),
              retries: (previousCheckpoint?.retries ?? 0)
                + (currentPhaseRetries.get(phase.id) ?? 0),
            });
          }
          await updateScanJob(job.id, workerId, {
            currentPhaseId: phase.id,
            ...(terminal && phaseIndex >= 0 ? { checkpoint: phaseIndex + 1 } : {}),
            ...(terminal && phaseIndex >= 0 ? { checkpointData: encodeScanCheckpoints([...checkpointRecords.values()]) } : {}),
          });
          await appendScanJobEvent(job.id, 'phase', {
            ...phase,
            findings: findings.map(finding => ({
              id: finding.id,
              category: finding.category,
              severity: finding.severity,
              title: finding.title,
            })),
            ...progress,
          });
        });
      },
      {
        deferDoneCompletion: true,
        selectedPhaseIds: job.selectedPhaseIds,
        jobId: job.id,
        pass: 'application',
        signal: abortController.signal,
        rateLimitPath: job.rateLimitPath,
        resumePhases: [...checkpointRecords.values()],
        onProbe: event => {
          if (event.stage === 'requesting') {
            transportAttempts += 1;
            currentPhaseAttempts.set(event.phaseId, (currentPhaseAttempts.get(event.phaseId) ?? 0) + 1);
          }
          if (event.stage === 'retry_wait') {
            retryCount += 1;
            currentPhaseRetries.set(event.phaseId, (currentPhaseRetries.get(event.phaseId) ?? 0) + 1);
          }
          const diagnostic = diagnosticFromProbe(event);
          if (diagnostic) lastAccessDiagnostic = diagnostic;
          if (
            event.stage === 'complete'
            && (event.classification === 'usable' || event.classification === 'protected_denial')
          ) lastAccessDiagnostic = null;
          return queueEvent(async () => {
            if (event.stage === 'retry_wait' && !inRetryWait) {
              inRetryWait = true;
              await updateScanJob(job.id, workerId, { status: 'retry_wait' });
              await appendScanJobEvent(job.id, 'job_state', {
                state: 'retry_wait',
                message: event.message,
                retryAfterMs: event.retryAfterMs ?? null,
              });
            } else if (event.stage === 'requesting' && inRetryWait) {
              inRetryWait = false;
              await updateScanJob(job.id, workerId, { status: 'application_running' });
              await appendScanJobEvent(job.id, 'job_state', {
                state: 'application_running',
                message: 'The cool-down finished. Retrying the same request before moving on.',
              });
            }
            await appendScanJobEvent(job.id, 'probe', event);
          });
        },
      },
    );
    await eventTail;
    await setState(job, workerId, 'finalizing', 'All selected modules reported. Building and saving the plain-language report.', {
      currentPhaseId: 'done',
    });

    const result = sanitizeScanResult({
      ...rawResult,
      perimeter,
      execution: executionReceipt(rawResult, retryCount, transportAttempts, findingCounts),
    });
    const scanId = crypto.randomUUID();
    const { error: insertError } = await supabase.from('deep_scans').insert({
      id: scanId,
      domain: job.domain,
      user_id: job.userId,
      lane: 'deep',
      authorization_terms_version: job.authorizationTermsVersion,
      authorization_accepted_at: job.authorizationAcceptedAt,
      verification_snapshot: job.verificationSnapshot,
      result: encodeScanResultForStorage(result),
      created_at: Date.now(),
    });
    if (insertError) throw new Error('The completed report could not be saved.');

    const done = SCAN_PHASES[SCAN_PHASES.length - 1];
    await appendScanJobEvent(job.id, 'phase', {
      ...done, findings: [], status: 'complete', durationMs: 0, reason: null,
      plannedProbes: 0, completedProbes: 0,
    });
    await updateScanJob(job.id, workerId, {
      status: 'complete', currentPass: null, currentPhaseId: null,
      resultScanId: scanId, checkpoint: job.selectedPhaseIds.length, checkpointData: null, clearLease: true,
    });
    await appendScanJobEvent(job.id, 'result', {
      scanId,
      resultUrl: `/api/deep-scan/jobs/${job.id}/result`,
      message: 'The complete report is saved and ready to open.',
    });
  } catch (error) {
    await eventTail;
    const refreshed = await supabase.from('deep_scan_jobs')
      .select('status, cancel_requested')
      .eq('id', job.id)
      .maybeSingle();
    if (refreshed.data?.status === 'cancelled' || refreshed.data?.cancel_requested === true) return;
    if (lastAccessDiagnostic) {
      await pauseForAccess(currentJob, workerId, lastAccessDiagnostic);
      return;
    }
    const message = error instanceof Error ? error.message : 'The dedicated scanner stopped unexpectedly.';
    if (currentJob.quotaState === 'committed' && currentJob.quotaKey) {
      const { error: refundError } = await supabase.rpc('refund_usage', { usage_key: currentJob.quotaKey });
      if (!refundError) {
        await updateScanJob(job.id, workerId, { quotaState: 'refunded' });
      }
    }
    await updateScanJob(job.id, workerId, {
      status: 'failed', currentPass: null, currentPhaseId: null,
      error: message, clearLease: true,
    });
    await appendScanJobEvent(job.id, 'error', {
      error: message,
      message: 'Ironclad stopped safely. Any reserved free scan credit was restored when possible.',
    });
  } finally {
    clearInterval(renew);
  }
}

export async function runWorkerOnce(workerId: string): Promise<boolean> {
  if (!durableDeepScanEnabled()) return false;
  const job = await claimScanJob(workerId);
  if (!job) return false;
  await processScanJob(job, workerId);
  return true;
}

export async function maintainScanWorker(): Promise<void> {
  await expireAccessWaitJobs();
  await cleanupExpiredScanEvents();
}

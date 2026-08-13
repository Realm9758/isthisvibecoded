import { after } from 'next/server';
import { currentScanJobUserId } from '@/lib/scan-job-auth';
import { appendScanJobEvent, getOwnedScanJob, updateScanJob } from '@/lib/scan-job-store';
import { mutationRequestError } from '@/lib/request-security';
import { durableDeepScanEnabled } from '@/lib/scan-identity';

export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const requestError = mutationRequestError(request);
  if (requestError) return Response.json({ error: requestError }, { status: 403 });
  const userId = await currentScanJobUserId();
  if (!userId) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const { jobId } = await context.params;
  const job = await getOwnedScanJob(jobId, userId);
  if (!job) return Response.json({ error: 'Scan job not found' }, { status: 404 });
  if (job.status !== 'waiting_for_access') {
    return Response.json({ error: 'This scan is not waiting for a firewall access recheck.' }, { status: 409 });
  }
  if (job.waitingExpiresAt !== null && job.waitingExpiresAt < Date.now()) {
    await updateScanJob(jobId, null, { status: 'failed', error: 'The 24-hour access setup window expired.', clearLease: true });
    return Response.json({ error: 'The 24-hour access setup window expired. Start a new scan.' }, { status: 410 });
  }
  await updateScanJob(jobId, null, {
    status: 'queued', currentPass: 'perimeter', accessDiagnostic: null, clearLease: true,
  });
  await appendScanJobEvent(jobId, 'job_state', {
    state: 'queued',
    message: 'Access recheck queued. Ironclad will repeat the four safe firewall checks before resuming.',
  });
  if (!durableDeepScanEnabled()) {
    after(async () => {
      const { runServerlessScanJob } = await import('@/lib/scan-worker');
      await runServerlessScanJob(jobId);
    });
  }
  return Response.json({ state: 'queued' }, { status: 202 });
}

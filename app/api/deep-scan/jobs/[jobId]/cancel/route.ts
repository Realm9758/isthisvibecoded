import { currentScanJobUserId } from '@/lib/scan-job-auth';
import { appendScanJobEvent, getOwnedScanJob, updateScanJob } from '@/lib/scan-job-store';
import { mutationRequestError } from '@/lib/request-security';

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const requestError = mutationRequestError(request);
  if (requestError) return Response.json({ error: requestError }, { status: 403 });
  const userId = await currentScanJobUserId();
  if (!userId) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const { jobId } = await context.params;
  const job = await getOwnedScanJob(jobId, userId);
  if (!job) return Response.json({ error: 'Scan job not found' }, { status: 404 });
  if (['complete', 'failed', 'cancelled'].includes(job.status)) return Response.json({ state: job.status });
  await updateScanJob(jobId, null, {
    cancelRequested: true, status: 'cancelled', currentPass: null, currentPhaseId: null, clearLease: true,
  });
  await appendScanJobEvent(jobId, 'job_state', {
    state: 'cancelled', message: 'The scan was cancelled. No further requests will be sent.',
  });
  return Response.json({ state: 'cancelled' });
}

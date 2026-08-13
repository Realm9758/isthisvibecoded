import { after } from 'next/server';
import { currentScanJobUserId } from '@/lib/scan-job-auth';
import { getOwnedScanJob, publicScanJob } from '@/lib/scan-job-store';
import { durableDeepScanEnabled } from '@/lib/scan-identity';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SERVERLESS_RECOVERABLE = new Set([
  'queued', 'perimeter_running', 'application_running', 'retry_wait', 'finalizing',
]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const userId = await currentScanJobUserId();
  if (!userId) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const { jobId } = await context.params;
  const job = await getOwnedScanJob(jobId, userId);
  if (!job) return Response.json({ error: 'Scan job not found' }, { status: 404 });
  // Reopening the live terminal also revives a temporary invocation whose
  // lease expired. The atomic claim prevents duplicate executors.
  if (!durableDeepScanEnabled() && SERVERLESS_RECOVERABLE.has(job.status)) {
    after(async () => {
      const { runServerlessScanJob } = await import('@/lib/scan-worker');
      await runServerlessScanJob(job.id);
    });
  }
  return Response.json(publicScanJob(job), { headers: { 'Cache-Control': 'no-store' } });
}

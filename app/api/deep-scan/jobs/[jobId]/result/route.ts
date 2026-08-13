import { currentScanJobUserId } from '@/lib/scan-job-auth';
import { getOwnedScanJob } from '@/lib/scan-job-store';
import { getDeepScanById } from '@/lib/store';

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const userId = await currentScanJobUserId();
  if (!userId) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const { jobId } = await context.params;
  const job = await getOwnedScanJob(jobId, userId);
  if (!job) return Response.json({ error: 'Scan job not found' }, { status: 404 });
  if (job.status !== 'complete' || !job.resultScanId) {
    return Response.json({ error: 'The scan report is not ready yet.' }, { status: 409 });
  }
  const row = await getDeepScanById(job.resultScanId, userId);
  if (!row?.result) return Response.json({ error: 'The saved scan report could not be read.' }, { status: 500 });
  return Response.json({ ...row.result, scanId: job.resultScanId }, { headers: { 'Cache-Control': 'no-store' } });
}

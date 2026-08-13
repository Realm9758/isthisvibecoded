import { currentScanJobUserId } from '@/lib/scan-job-auth';
import { getOwnedScanJob, publicScanJob } from '@/lib/scan-job-store';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const userId = await currentScanJobUserId();
  if (!userId) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const { jobId } = await context.params;
  const job = await getOwnedScanJob(jobId, userId);
  if (!job) return Response.json({ error: 'Scan job not found' }, { status: 404 });
  return Response.json(publicScanJob(job), { headers: { 'Cache-Control': 'no-store' } });
}

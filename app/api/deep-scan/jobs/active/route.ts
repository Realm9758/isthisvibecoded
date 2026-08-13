import { currentScanJobUserId } from '@/lib/scan-job-auth';
import { getActiveOwnedScanJob, publicScanJob } from '@/lib/scan-job-store';

export const runtime = 'nodejs';

export async function GET() {
  const userId = await currentScanJobUserId();
  if (!userId) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const job = await getActiveOwnedScanJob(userId);
  return Response.json({ job: job ? publicScanJob(job) : null }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

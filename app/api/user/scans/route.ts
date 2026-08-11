import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { listScansForUser } from '@/lib/scan-store';

export const runtime = 'nodejs';

/**
 * The calling account's scans, both lanes, newest first.
 *
 * Only counts and grades are returned. The full report lives behind
 * /result/[id], which renders server-side for the owner alone, so a listing
 * never becomes a second route to finding detail.
 */
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const scans = await listScansForUser(payload.userId);

  return Response.json(scans.map(scan => ({
    id: scan.id,
    domain: scan.domain,
    lane: scan.lane,
    createdAt: scan.createdAt,
    score: scan.result.summary.score,
    critical: scan.result.summary.critical,
    high: scan.result.summary.high,
    medium: scan.result.summary.medium,
    low: scan.result.summary.low,
    info: scan.result.summary.info,
    coverageComplete: scan.result.coverage?.complete ?? true,
  })));
}

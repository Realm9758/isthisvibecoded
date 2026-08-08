import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { getScansByUser, usesCurrentScoring } from '@/lib/store';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;

  if (!payload) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let scans: Awaited<ReturnType<typeof getScansByUser>>;
  try {
    scans = (await getScansByUser(payload.userId)).map(scan => ({
      ...scan,
      // Historical rows were auto-published without the current consent/model
      // contract. Keep them visible to their owner, but represent them as private.
      isPublic: scan.isPublic && usesCurrentScoring(scan),
    }));
  } catch {
    return Response.json({ error: 'Could not load scan history' }, { status: 503 });
  }

  return Response.json(scans);
}

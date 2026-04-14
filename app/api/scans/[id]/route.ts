import { getScan, updateScan } from '@/lib/store';
import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';

async function getAuthUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  return payload?.userId ?? null;
}

export async function GET(_req: Request, ctx: RouteContext<'/api/scans/[id]'>) {
  const { id } = await ctx.params;
  const scan = await getScan(id);
  if (!scan) {
    return Response.json({ error: 'Scan not found' }, { status: 404 });
  }

  if (!scan.isPublic) {
    const userId = await getAuthUserId();
    if (!userId || scan.userId !== userId) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
  }

  return Response.json(scan);
}

export async function PATCH(request: Request, ctx: RouteContext<'/api/scans/[id]'>) {
  const userId = await getAuthUserId();
  if (!userId) return Response.json({ error: 'Unauthorised' }, { status: 401 });

  const { id } = await ctx.params;
  const scan = await getScan(id);
  if (!scan) return Response.json({ error: 'Not found' }, { status: 404 });

  if (scan.userId !== userId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { isPublic } = await request.json().catch(() => ({}));
  if (typeof isPublic === 'boolean') {
    await updateScan(id, { isPublic });
  }

  return Response.json({ ok: true });
}

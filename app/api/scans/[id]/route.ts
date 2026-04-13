import { store } from '@/lib/store';

export async function GET(_req: Request, ctx: RouteContext<'/api/scans/[id]'>) {
  const { id } = await ctx.params;
  const scan = store.getScan(id);
  if (!scan) {
    return Response.json({ error: 'Scan not found' }, { status: 404 });
  }
  return Response.json(scan);
}

export async function PATCH(request: Request, ctx: RouteContext<'/api/scans/[id]'>) {
  const { id } = await ctx.params;
  const scan = store.getScan(id);
  if (!scan) return Response.json({ error: 'Not found' }, { status: 404 });

  const { isPublic } = await request.json().catch(() => ({}));
  if (typeof isPublic === 'boolean') {
    const updated = store.scans.get(id);
    if (updated) {
      updated.isPublic = isPublic;
      store.scans.set(id, updated);
    }
  }

  return Response.json({ ok: true });
}

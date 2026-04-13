import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { markNotificationRead } from '@/lib/notifications';

async function getAuthUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  return payload?.userId ?? null;
}

// PATCH /api/notifications/[id] — mark a single notification as read
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthUserId();
  if (!userId) return Response.json({ error: 'Unauthorised' }, { status: 401 });

  const { id } = await params;
  await markNotificationRead(id, userId);
  return Response.json({ ok: true });
}

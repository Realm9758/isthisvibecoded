import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { getUserNotifications, markAllNotificationsRead } from '@/lib/notifications';

async function getAuthUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  return payload?.userId ?? null;
}

// GET /api/notifications — fetch all notifications for the current user
export async function GET() {
  const userId = await getAuthUserId();
  if (!userId) return Response.json({ error: 'Unauthorised' }, { status: 401 });

  const notifications = await getUserNotifications(userId);
  return Response.json(notifications);
}

// PATCH /api/notifications — mark all notifications as read
export async function PATCH() {
  const userId = await getAuthUserId();
  if (!userId) return Response.json({ error: 'Unauthorised' }, { status: 401 });

  await markAllNotificationsRead(userId);
  return Response.json({ ok: true });
}

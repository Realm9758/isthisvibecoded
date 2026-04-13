import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { getUserById, getRemainingScans } from '@/lib/store';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  if (!token) return Response.json(null);

  const payload = await verifyToken(token);
  if (!payload) return Response.json(null);

  const user = await getUserById(payload.userId);
  if (!user) return Response.json(null);

  const remaining = await getRemainingScans(user.id, user.plan);

  return Response.json({
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    avatarColor: user.avatarColor ?? null,
    notifEmail: user.notifEmail,
    notifInApp: user.notifInApp,
    scansRemaining: remaining,
  });
}

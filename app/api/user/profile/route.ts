import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { updateUser, type User } from '@/lib/store';

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) return Response.json({ error: 'Unauthorised' }, { status: 401 });

  let name: string | undefined;
  let avatarColor: string | undefined;
  let bio: string | undefined;
  let notifEmail: boolean | undefined;
  let notifInApp: boolean | undefined;

  try {
    const body = await request.json();
    if (typeof body.name === 'string') name = body.name.trim();
    if (typeof body.avatarColor === 'string') avatarColor = body.avatarColor.trim();
    if (typeof body.bio === 'string') bio = body.bio.trim().slice(0, 200);
    if (typeof body.notifEmail === 'boolean') notifEmail = body.notifEmail;
    if (typeof body.notifInApp === 'boolean') notifInApp = body.notifInApp;
  } catch {
    return Response.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (name !== undefined && (name.length < 1 || name.length > 40)) {
    return Response.json({ error: 'Name must be 1–40 characters' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name;
  if (avatarColor !== undefined) patch.avatarColor = avatarColor;
  if (bio !== undefined) patch.bio = bio;
  if (notifEmail !== undefined) patch.notifEmail = notifEmail;
  if (notifInApp !== undefined) patch.notifInApp = notifInApp;

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const updated = await updateUser(payload.userId, patch as Partial<User>);
  if (!updated) return Response.json({ error: 'User not found' }, { status: 404 });

  return Response.json({
    ok: true,
    name: updated.name,
    avatarColor: updated.avatarColor,
    notifEmail: updated.notifEmail,
    notifInApp: updated.notifInApp,
  });
}

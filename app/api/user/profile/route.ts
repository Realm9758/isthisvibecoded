import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { StoreError, updateUser, type User } from '@/lib/store';
import { isValidDisplayHandle } from '@/lib/policy';

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

  if (name !== undefined && !isValidDisplayHandle(name)) {
    return Response.json(
      { error: 'Handle must use 1–40 letters, numbers, dots, underscores, or hyphens and start with a letter or number' },
      { status: 400 },
    );
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

  let updated;
  try {
    updated = await updateUser(payload.userId, patch as Partial<User>);
  } catch (error) {
    if (error instanceof StoreError && error.code === '23505') {
      return Response.json({ error: 'That public handle is already in use' }, { status: 409 });
    }
    return Response.json({ error: 'Could not update profile' }, { status: 503 });
  }
  if (!updated) return Response.json({ error: 'User not found' }, { status: 404 });

  return Response.json({
    ok: true,
    name: updated.name,
    avatarColor: updated.avatarColor,
    notifEmail: updated.notifEmail,
    notifInApp: updated.notifInApp,
  });
}

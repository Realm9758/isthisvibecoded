import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { updateUser } from '@/lib/store';

const MAX_BYTES = 600_000; // 600 KB base64 limit

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) return Response.json({ error: 'Unauthorised' }, { status: 401 });

  let avatarUrl: string;
  try {
    const body = await request.json();
    avatarUrl = body?.avatarUrl ?? '';
  } catch {
    return Response.json({ error: 'Invalid body' }, { status: 400 });
  }

  // Must be a data URL (base64 image)
  if (!avatarUrl.startsWith('data:image/')) {
    return Response.json({ error: 'Invalid image format' }, { status: 400 });
  }

  // Enforce size limit
  if (avatarUrl.length > MAX_BYTES) {
    return Response.json({ error: 'Image too large (max ~450 KB)' }, { status: 400 });
  }

  const updated = await updateUser(payload.userId, { avatarUrl });
  if (!updated) return Response.json({ error: 'User not found' }, { status: 404 });

  return Response.json({ ok: true, avatarUrl: updated.avatarUrl });
}

// DELETE — remove avatar (revert to colour initial)
export async function DELETE() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) return Response.json({ error: 'Unauthorised' }, { status: 401 });

  const updated = await updateUser(payload.userId, { avatarUrl: undefined });
  return Response.json({ ok: true });
}

import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

async function getCurrentUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  return payload?.userId ?? null;
}

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/comments/[id] — edit own comment
export async function PATCH(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const currentUserId = await getCurrentUserId();
  if (!currentUserId) return Response.json({ error: 'Unauthorised' }, { status: 401 });

  const { data: comment } = await supabase
    .from('comments')
    .select('user_id')
    .eq('id', id)
    .maybeSingle();

  if (!comment) return Response.json({ error: 'Not found' }, { status: 404 });
  if (comment.user_id !== currentUserId) return Response.json({ error: 'Forbidden' }, { status: 403 });

  let body: string;
  try {
    const json = await request.json();
    body = (json.body ?? '').trim();
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (!body) return Response.json({ error: 'Body cannot be empty' }, { status: 400 });
  if (body.length > 500) return Response.json({ error: 'Too long' }, { status: 400 });

  const editedAt = Date.now();
  const { error } = await supabase
    .from('comments')
    .update({ body, edited_at: editedAt })
    .eq('id', id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ id, body, edited_at: editedAt });
}

// DELETE /api/comments/[id] — delete own comment
export async function DELETE(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const currentUserId = await getCurrentUserId();
  if (!currentUserId) return Response.json({ error: 'Unauthorised' }, { status: 401 });

  const { data: comment } = await supabase
    .from('comments')
    .select('user_id')
    .eq('id', id)
    .maybeSingle();

  if (!comment) return Response.json({ error: 'Not found' }, { status: 404 });
  if (comment.user_id !== currentUserId) return Response.json({ error: 'Forbidden' }, { status: 403 });

  await supabase.from('comments').delete().eq('id', id);
  return Response.json({ ok: true });
}

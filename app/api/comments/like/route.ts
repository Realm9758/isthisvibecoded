import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

async function getCurrentUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  return payload?.userId ?? null;
}

// POST /api/comments/like — toggle like on a comment
export async function POST(request: Request) {
  const currentUserId = await getCurrentUserId();
  if (!currentUserId) return Response.json({ error: 'Sign in to like' }, { status: 401 });

  let commentId: string;
  try {
    const json = await request.json();
    commentId = (json.commentId ?? '').trim();
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (!commentId) return Response.json({ error: 'commentId required' }, { status: 400 });

  // Check if already liked
  const { data: existing } = await supabase
    .from('comment_likes')
    .select('comment_id')
    .eq('comment_id', commentId)
    .eq('user_id', currentUserId)
    .maybeSingle();

  if (existing) {
    await supabase.from('comment_likes').delete()
      .eq('comment_id', commentId).eq('user_id', currentUserId);
    const { count } = await supabase.from('comment_likes').select('*', { count: 'exact', head: true }).eq('comment_id', commentId);
    return Response.json({ liked: false, count: count ?? 0 });
  } else {
    await supabase.from('comment_likes').insert({ comment_id: commentId, user_id: currentUserId });
    const { count } = await supabase.from('comment_likes').select('*', { count: 'exact', head: true }).eq('comment_id', commentId);
    return Response.json({ liked: true, count: count ?? 0 });
  }
}

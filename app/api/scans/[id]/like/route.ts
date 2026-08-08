import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getVisibleScan } from '@/lib/scan-access';

type RouteContext = { params: Promise<{ id: string }> };

async function getCurrentUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  return payload?.userId ?? null;
}

// GET /api/scans/[id]/like — get like count + whether current user liked
export async function GET(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const currentUserId = await getCurrentUserId();
  if (!await getVisibleScan(id)) return Response.json({ error: 'Not found' }, { status: 404 });

  const { count, error: countError } = await supabase
    .from('scan_likes')
    .select('*', { count: 'exact', head: true })
    .eq('scan_id', id);
  if (countError) return Response.json({ error: 'Could not load likes' }, { status: 503 });

  let likedByMe = false;
  if (currentUserId) {
    const { data } = await supabase
      .from('scan_likes')
      .select('scan_id')
      .eq('scan_id', id)
      .eq('user_id', currentUserId)
      .maybeSingle();
    likedByMe = !!data;
  }

  return Response.json({ count: count ?? 0, likedByMe });
}

// POST /api/scans/[id]/like — toggle like
export async function POST(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const currentUserId = await getCurrentUserId();
  if (!currentUserId) return Response.json({ error: 'Sign in to like' }, { status: 401 });
  if (!await getVisibleScan(id)) return Response.json({ error: 'Not found' }, { status: 404 });

  const { data: existing } = await supabase
    .from('scan_likes')
    .select('scan_id')
    .eq('scan_id', id)
    .eq('user_id', currentUserId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from('scan_likes').delete().eq('scan_id', id).eq('user_id', currentUserId);
    if (error) return Response.json({ error: 'Could not update like' }, { status: 503 });
    const { count } = await supabase.from('scan_likes').select('*', { count: 'exact', head: true }).eq('scan_id', id);
    return Response.json({ liked: false, count: count ?? 0 });
  } else {
    const { error } = await supabase.from('scan_likes').insert({ scan_id: id, user_id: currentUserId });
    if (error && error.code !== '23505') return Response.json({ error: 'Could not update like' }, { status: 503 });
    const { count } = await supabase.from('scan_likes').select('*', { count: 'exact', head: true }).eq('scan_id', id);
    return Response.json({ liked: true, count: count ?? 0 });
  }
}

import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { randomBytes } from 'crypto';

function genId() {
  return randomBytes(8).toString('base64url');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const scanId = searchParams.get('scanId');
  if (!scanId) return Response.json({ error: 'scanId required' }, { status: 400 });

  const { data, error } = await supabase
    .from('comments')
    .select('id, user_name, body, created_at')
    .eq('scan_id', scanId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data ?? []);
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) return Response.json({ error: 'Sign in to post a comment' }, { status: 401 });

  let scanId: string, body: string;
  try {
    const json = await request.json();
    scanId = (json.scanId ?? '').trim();
    body = (json.body ?? '').trim();
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (!scanId) return Response.json({ error: 'scanId required' }, { status: 400 });
  if (!body || body.length < 1) return Response.json({ error: 'Comment cannot be empty' }, { status: 400 });
  if (body.length > 500) return Response.json({ error: 'Comment too long (max 500 chars)' }, { status: 400 });

  // Get user name
  const { data: user } = await supabase.from('users').select('name').eq('id', payload.userId).maybeSingle();
  const userName = user?.name ?? 'Anonymous';

  const comment = {
    id: genId(),
    scan_id: scanId,
    user_id: payload.userId,
    user_name: userName,
    body,
    created_at: Date.now(),
  };

  const { error } = await supabase.from('comments').insert(comment);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ id: comment.id, user_name: userName, body, created_at: comment.created_at });
}

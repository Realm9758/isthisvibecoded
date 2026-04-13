import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) return Response.json({ error: 'Not authenticated' }, { status: 401 });

  const { data, error } = await supabase
    .from('deep_scans')
    .select('id, domain, result, created_at')
    .eq('user_id', payload.userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data ?? []);
}

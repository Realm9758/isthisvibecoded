import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { StoredScan } from '@/lib/store';
import type { AnalysisResult } from '@/types/analysis';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;

  if (!payload) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('scans')
    .select('*')
    .eq('user_id', payload.userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const scans = (data ?? []).map((row) => ({
    id: row.id as string,
    result: row.result as AnalysisResult,
    userId: row.user_id as string,
    isPublic: row.is_public as boolean,
    roasts: row.roasts as string[],
    createdAt: row.created_at as number,
  }));

  return Response.json(scans);
}

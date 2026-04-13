import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) return Response.json({ error: 'Unauthorised' }, { status: 401 });

  const uid = payload.userId;

  // Recent published scans (public)
  const { data: scanRows } = await supabase
    .from('scans')
    .select('id, result, created_at, is_public')
    .eq('user_id', uid)
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(5);

  // Recent comments (with scan domain via join isn't possible without FK, fetch separately)
  const { data: commentRows } = await supabase
    .from('comments')
    .select('id, body, created_at, scan_id')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(5);

  // Fetch scan domains for comments
  const scanIds = [...new Set((commentRows ?? []).map(c => c.scan_id as string))];
  const scanDomainMap = new Map<string, string>();

  if (scanIds.length > 0) {
    const { data: scanData } = await supabase
      .from('scans')
      .select('id, result')
      .in('id', scanIds);

    for (const s of scanData ?? []) {
      try {
        const url = (s.result as { url?: string })?.url ?? '';
        const domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
        scanDomainMap.set(s.id as string, domain);
      } catch {
        scanDomainMap.set(s.id as string, s.id as string);
      }
    }
  }

  const posts = (scanRows ?? []).map(s => {
    let domain = '';
    let vibeScore = 0;
    let securityScore = 0;
    try {
      const r = s.result as { url?: string; vibe?: { score: number }; security?: { score: number } };
      domain = new URL((r.url ?? '').startsWith('http') ? (r.url ?? '') : `https://${r.url}`).hostname;
      vibeScore = r.vibe?.score ?? 0;
      securityScore = r.security?.score ?? 0;
    } catch { /* ignore */ }
    return {
      id: s.id as string,
      domain,
      vibeScore,
      securityScore,
      createdAt: s.created_at as number,
    };
  });

  const comments = (commentRows ?? []).map(c => ({
    id: c.id as string,
    body: c.body as string,
    scanId: c.scan_id as string,
    scanDomain: scanDomainMap.get(c.scan_id as string) ?? '',
    createdAt: c.created_at as number,
  }));

  return Response.json({ posts, comments });
}

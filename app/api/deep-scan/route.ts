import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { deepScanDomain } from '@/lib/deep-scanner';

export const runtime = 'nodejs';
export const maxDuration = 55;

function getDomain(url: string): string {
  const normalized = url.startsWith('http') ? url : `https://${url}`;
  return new URL(normalized).hostname;
}

export async function POST(request: Request) {
  // Auth required
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  let domain: string;
  try {
    const body = await request.json();
    domain = getDomain((body?.domain ?? '').trim());
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!domain) {
    return Response.json({ error: 'Domain is required' }, { status: 400 });
  }

  // Block private/local addresses
  if (
    domain === 'localhost' ||
    domain === '127.0.0.1' ||
    domain.startsWith('192.168.') ||
    domain.startsWith('10.') ||
    domain.endsWith('.local')
  ) {
    return Response.json({ error: 'Private/local domains are not allowed' }, { status: 400 });
  }

  // Verify ownership — must have a verified token in the DB
  const { data: verif } = await supabase
    .from('verification_tokens')
    .select('token, verified')
    .eq('domain', domain)
    .maybeSingle();

  if (!verif || !verif.verified) {
    return Response.json(
      { error: 'Domain ownership not verified. Complete verification in your dashboard first.' },
      { status: 403 }
    );
  }

  try {
    const result = await deepScanDomain(domain);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scan failed';
    return Response.json({ error: message }, { status: 500 });
  }
}

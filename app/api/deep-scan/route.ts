import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { deepScanDomain, SCAN_PHASES } from '@/lib/deep-scanner';
import type { DeepFinding } from '@/types/deep-scan';

export const runtime = 'nodejs';
export const maxDuration = 55;

function getDomain(url: string): string {
  const normalized = url.startsWith('http') ? url : `https://${url}`;
  return new URL(normalized).hostname;
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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

  if (!domain) return Response.json({ error: 'Domain is required' }, { status: 400 });

  if (
    domain === 'localhost' || domain === '127.0.0.1' ||
    domain.startsWith('192.168.') || domain.startsWith('10.') || domain.endsWith('.local')
  ) {
    return Response.json({ error: 'Private/local domains are not allowed' }, { status: 400 });
  }

  // Deep scan limit for free users
  const { data: userRow } = await supabase.from('users').select('plan').eq('id', payload.userId).maybeSingle();
  if (!userRow || userRow.plan === 'free') {
    const { count } = await supabase
      .from('deep_scans')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', payload.userId);
    if ((count ?? 0) >= 2) {
      return Response.json(
        { error: 'Free plan limit reached. Upgrade to Pro for unlimited deep scans.' },
        { status: 403 }
      );
    }
  }

  // Ownership check — must be verified by THIS user
  const { data: verif } = await supabase
    .from('verification_tokens')
    .select('token, verified')
    .eq('domain', domain)
    .eq('user_id', payload.userId)
    .maybeSingle();

  if (!verif || !verif.verified) {
    return Response.json(
      { error: 'Domain ownership not verified. Complete verification in your dashboard first.' },
      { status: 403 }
    );
  }

  // Stream SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: string, data: unknown) {
        controller.enqueue(encoder.encode(sse(event, data)));
      }

      try {
        emit('phases', SCAN_PHASES);

        const result = await deepScanDomain(domain, (phase, findings: DeepFinding[]) => {
          emit('phase', { id: phase.id, label: phase.label, detail: phase.detail, findings });
        });

        // Persist to DB
        const scanId = crypto.randomUUID();
        await supabase.from('deep_scans').insert({
          id: scanId,
          domain,
          user_id: payload.userId,
          result,
          created_at: Date.now(),
        });

        emit('result', { ...result, scanId });
      } catch (err) {
        emit('error', { error: err instanceof Error ? err.message : 'Scan failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

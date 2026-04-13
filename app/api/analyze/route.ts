import { cookies } from 'next/headers';
import { analyzeUrl } from '@/lib/analyzer';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { store } from '@/lib/store';
import { generateRoasts } from '@/lib/roast';

export const runtime = 'nodejs';
export const maxDuration = 30;

function getClientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'anonymous';
}

export async function POST(request: Request) {
  let url: string;
  try {
    const body = await request.json();
    url = (body?.url ?? '').trim();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!url) return Response.json({ error: 'URL is required' }, { status: 400 });

  // Validate URL and block private IPs
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    const h = parsed.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.') || h.startsWith('10.') || h.endsWith('.local')) {
      return Response.json({ error: 'Private/local URLs are not allowed' }, { status: 400 });
    }
  } catch {
    return Response.json({ error: 'Invalid URL format' }, { status: 400 });
  }

  // Auth check (optional — anonymous users get free tier limits)
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;

  // Rate limiting
  const limitKey = payload ? payload.userId : getClientIp(request);
  const plan = payload ? (store.getUserById(payload.userId)?.plan ?? 'free') : 'free';

  if (plan === 'free') {
    const used = store.getDailyCount(limitKey);
    if (used >= 5) {
      return Response.json({
        error: 'Daily scan limit reached (5/day on free tier). Upgrade to Pro for unlimited scans.',
        limitReached: true,
        scansUsed: used,
        scansLimit: 5,
      }, { status: 429 });
    }
  }

  store.incrementUsage(limitKey);

  try {
    const result = await analyzeUrl(url);
    const roasts = generateRoasts(result);

    const scan = store.saveScan({
      result,
      userId: payload?.userId,
      isPublic: true,
      roasts,
    });

    const remaining = plan === 'free' ? store.getRemainingScans(limitKey, 'free') : null;

    return Response.json({
      ...result,
      scanId: scan.id,
      roasts,
      scansRemaining: remaining,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('ENOTFOUND') || message.includes('fetch')) {
      return Response.json({ error: `Could not reach the website: ${message}` }, { status: 422 });
    }
    if (message.includes('timeout') || message.includes('AbortError')) {
      return Response.json({ error: 'Website took too long to respond (>10s)' }, { status: 408 });
    }
    return Response.json({ error: `Analysis failed: ${message}` }, { status: 500 });
  }
}

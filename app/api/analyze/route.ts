import { cookies } from 'next/headers';
import { analyzeUrl } from '@/lib/analyzer';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { getUserById, getDailyCount, incrementUsage, saveScan, getRemainingScans } from '@/lib/store';
import { generateRoasts } from '@/lib/roast';
import { assertPublicTarget, normalizePublicUrl } from '@/lib/url-safety';

export const runtime = 'nodejs';
export const maxDuration = 30;

function getClientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'anonymous';
}

export async function POST(request: Request) {
  let url: string;
  let authorized = false;
  try {
    const body = await request.json();
    url = (body?.url ?? '').trim();
    authorized = body?.authorized === true;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!url) return Response.json({ error: 'URL is required' }, { status: 400 });
  if (!authorized) {
    return Response.json({ error: 'Confirm you own this site or have permission to scan it.' }, { status: 403 });
  }

  let parsed: URL;
  try {
    parsed = normalizePublicUrl(url);
    await assertPublicTarget(parsed);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Invalid URL format' }, { status: 400 });
  }

  // Auth check (optional — anonymous users get free tier limits)
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;

  // Rate limiting
  const limitKey = payload ? payload.userId : getClientIp(request);
  const user = payload ? await getUserById(payload.userId) : null;
  const plan = user?.plan ?? 'free';

  if (plan === 'free') {
    const used = await getDailyCount(limitKey);
    if (used >= 5) {
      return Response.json({
        error: 'Daily scan limit reached (5/day on free tier). Upgrade to Pro for unlimited scans.',
        limitReached: true,
        scansUsed: used,
        scansLimit: 5,
      }, { status: 429 });
    }
  }

  await incrementUsage(limitKey);

  try {
    const result = await analyzeUrl(parsed.href);
    const roasts = generateRoasts(result);

    const scan = await saveScan({
      result,
      userId: payload?.userId,
      isPublic: true,
      roasts,
    });

    const remaining = plan === 'free' ? await getRemainingScans(limitKey, 'free') : null;

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

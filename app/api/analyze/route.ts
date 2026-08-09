import { cookies } from 'next/headers';
import { analyzeUrl } from '@/lib/analyzer';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { getDailyCount, getUserById, refundUsage, reserveUsage, saveScan } from '@/lib/store';
import { generateRoasts } from '@/lib/roast';
import { assertPublicTarget, normalizePublicUrl } from '@/lib/url-safety';
import { getAnonymousRateLimitKey } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  let url: string;
  try {
    const body = await request.json();
    url = (body?.url ?? '').trim();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!url) return Response.json({ error: 'URL is required' }, { status: 400 });

  let parsed: URL;
  try {
    parsed = normalizePublicUrl(url);
    await assertPublicTarget(parsed, 4_000);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid URL format';
    return Response.json({ error: message }, { status: message.includes('timed out') ? 408 : 400 });
  }

  // Auth check (optional — anonymous users get free tier limits)
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;

  // Rate limiting
  const limitKey = payload ? `user:${payload.userId}` : getAnonymousRateLimitKey(request);
  if (!limitKey) {
    return Response.json(
      { error: 'Anonymous scanning is unavailable until the server rate-limit secret is configured.' },
      { status: 503 },
    );
  }
  const user = payload ? await getUserById(payload.userId) : null;
  const plan = user?.plan ?? 'free';
  const minuteWindow = new Date().toISOString().slice(0, 16);
  const burstRemaining = await reserveUsage(
    `passive-burst:${limitKey}:${minuteWindow}`,
    plan === 'free' ? 3 : 10,
    'analyze',
  );
  if (burstRemaining === null) {
    return Response.json({ error: 'Could not reserve the scan-rate allowance' }, { status: 503 });
  }
  if (burstRemaining < 0) {
    return Response.json({ error: 'Too many scans started at once. Try again in a minute.' }, { status: 429 });
  }
  let quotaReserved = false;
  let scansRemaining: number | null = null;

  if (plan === 'free') {
    scansRemaining = await reserveUsage(limitKey, 5, 'analyze:daily');
    if (scansRemaining === null) {
      return Response.json({ error: 'Could not reserve the scan-rate allowance' }, { status: 503 });
    }
    if (scansRemaining < 0) {
      const used = await getDailyCount(limitKey);
      return Response.json({
        error: 'Daily scan limit reached (5/day on free tier). Pro removes the daily quota; operational rate limits still apply.',
        limitReached: true,
        scansUsed: used,
        scansLimit: 5,
      }, { status: 429 });
    }
    quotaReserved = true;
  }

  try {
    const result = await analyzeUrl(parsed.href);
    const roasts = generateRoasts(result);

    // Anonymous scans are returned to the browser but are not persisted. Signed-in
    // scans are private until their owner explicitly publishes them.
    const scan = payload ? await saveScan({
      result,
      userId: payload.userId,
      isPublic: false,
      roasts,
    }) : null;

    return Response.json({
      ...result,
      scanId: scan?.id,
      isPublic: false,
      canPublish: !!scan,
      roasts,
      scansRemaining,
    });
  } catch (err) {
    let refundFailed = false;
    if (quotaReserved) {
      try {
        await refundUsage(limitKey);
      } catch {
        refundFailed = true;
      }
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    const errorName = err instanceof Error ? err.name : '';
    const errorCode = typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
    let status = 500;
    let error = `Analysis failed: ${message}`;
    if (message.includes('ENOTFOUND') || message.includes('fetch')) {
      status = 422;
      error = `Could not reach the website: ${message}`;
    } else if (
      /timeout|timed out|operation was aborted/i.test(message)
      || errorName === 'AbortError'
      || errorName === 'TimeoutError'
      || errorCode === 'ABORT_ERR'
    ) {
      status = 408;
      error = 'Website took too long to respond within the bounded scan window';
    } else if (
      message.includes('returned HTTP')
      || message.includes('Unsupported content type')
      || message.includes('enough HTML')
      || message.includes('bot-protection')
      || message.includes('too large')
    ) {
      status = 422;
      error = message;
    }
    if (refundFailed) {
      status = 503;
      error += ' The reserved scan allowance could not be restored automatically; contact the operator before retrying repeatedly.';
    }
    return Response.json({ error }, { status });
  }
}

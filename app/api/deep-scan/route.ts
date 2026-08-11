import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { deepScanDomain, SCAN_PHASES } from '@/lib/deep-scanner';
import { assertPublicTarget, normalizePublicUrl } from '@/lib/url-safety';
import { DEEP_SCAN_TERMS_VERSION, VERIFICATION_MAX_AGE_MS } from '@/lib/policy';
import {
  FREE_LIFETIME_LIMIT, USER_BURST_LIMIT, TARGET_HOURLY_LIMIT,
  freeLifetimeKey, userBurstKey, targetHourlyKey,
} from '@/lib/scan-quota';
import type { DeepFinding } from '@/types/deep-scan';

export const runtime = 'nodejs';
export const maxDuration = 55;

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
  let authorizationAcceptedAt: number;
  try {
    const body = await request.json();
    if (typeof body?.domain !== 'string' || !body.domain.trim()) {
      return Response.json({ error: 'Domain is required' }, { status: 400 });
    }
    if (body.authorizationAccepted !== true) {
      return Response.json(
        { error: 'Explicit authorisation confirmation is required before active testing.' },
        { status: 403 },
      );
    }
    if (body.termsVersion !== DEEP_SCAN_TERMS_VERSION) {
      return Response.json(
        {
          error: 'The active-scan terms have changed. Review and accept the current terms before continuing.',
          currentTermsVersion: DEEP_SCAN_TERMS_VERSION,
        },
        { status: 409 },
      );
    }
    authorizationAcceptedAt = Date.now();
    const target = normalizePublicUrl(body.domain);
    await assertPublicTarget(target, 4_000);
    domain = target.hostname.toLowerCase();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request body';
    return Response.json({ error: message }, { status: message.includes('timed out') ? 408 : 400 });
  }

  // Deep scan limit for free users
  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('plan')
    .eq('id', payload.userId)
    .maybeSingle();
  if (userError) {
    return Response.json({ error: 'Could not verify account plan' }, { status: 503 });
  }
  // Fresh domain-control check: it must belong to this authenticated user.
  const { data: verif, error: verificationError } = await supabase
    .from('verification_tokens')
    .select('verified, verified_at')
    .eq('domain', domain)
    .eq('user_id', payload.userId)
    .maybeSingle();

  if (verificationError) {
    return Response.json({ error: 'Could not verify domain control' }, { status: 503 });
  }

  const verifiedAt = Number(verif?.verified_at);
  const verificationAge = Date.now() - verifiedAt;
  const verificationIsCurrent = verif?.verified === true
    && Number.isFinite(verifiedAt)
    && verifiedAt > 0
    && verificationAge >= 0
    && verificationAge <= VERIFICATION_MAX_AGE_MS;

  if (!verificationIsCurrent) {
    return Response.json(
      {
        error: verif?.verified
          ? 'Domain verification has expired. Renew the control proof before running another active scan.'
          : 'Domain control is not verified. Complete verification in your dashboard first.',
        verificationExpired: verif?.verified === true,
      },
      { status: 403 }
    );
  }

  // Plan entitlement controls the daily/lifetime quota, not operational
  // safety. Every account and target remains burst-limited so a paid account
  // cannot launch an unbounded number of outbound active scans.
  const now = new Date();
  const [{ data: userBurst, error: userBurstError }, { data: targetBurst, error: targetBurstError }] = await Promise.all([
    supabase.rpc('consume_usage', {
      usage_key: userBurstKey(payload.userId, now),
      usage_limit: USER_BURST_LIMIT,
    }),
    supabase.rpc('consume_usage', {
      usage_key: targetHourlyKey(domain, now),
      usage_limit: TARGET_HOURLY_LIMIT,
    }),
  ]);
  if (userBurstError || targetBurstError) {
    console.error('Usage reservation failed', {
      tag: 'deep-scan:burst',
      reason: (userBurstError ?? targetBurstError)?.message,
    });
    return Response.json({ error: 'Could not reserve the active-scan rate allowance' }, { status: 503 });
  }
  if (Number(userBurst) < 0 || Number(targetBurst) < 0) {
    return Response.json(
      { error: 'Active-scan burst limit reached. Wait before starting another scan.' },
      { status: 429 },
    );
  }

  let deepQuotaKey: string | null = null;
  if (!userRow || userRow.plan === 'free') {
    deepQuotaKey = freeLifetimeKey(payload.userId);
    const { data: remaining, error: countError } = await supabase.rpc('consume_usage', {
      usage_key: deepQuotaKey,
      usage_limit: FREE_LIFETIME_LIMIT,
    });
    if (countError) {
      console.error('Usage reservation failed', {
        tag: 'deep-scan:lifetime',
        reason: countError.message,
      });
      return Response.json({ error: 'Could not reserve deep scan allowance' }, { status: 503 });
    }
    if (Number(remaining) < 0) {
      return Response.json(
        {
          error: `You have used all ${FREE_LIFETIME_LIMIT} free scans. Pro removes the limit; operational rate limits still apply.`,
          upgradeRequired: true,
        },
        { status: 403 },
      );
    }
  }

  // Stream SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let persisted = false;
      function emit(event: string, data: unknown) {
        controller.enqueue(encoder.encode(sse(event, data)));
      }

      try {
        emit('phases', SCAN_PHASES);

        const result = await deepScanDomain(domain, 'deep', (phase, findings: DeepFinding[], status) => {
          emit('phase', { id: phase.id, label: phase.label, detail: phase.detail, findings, status });
        });

        // Persist to DB
        const scanId = crypto.randomUUID();
        const { error: insertError } = await supabase.from('deep_scans').insert({
          id: scanId,
          domain,
          user_id: payload.userId,
          lane: 'deep',
          authorization_terms_version: DEEP_SCAN_TERMS_VERSION,
          authorization_accepted_at: authorizationAcceptedAt,
          result,
          created_at: Date.now(),
        });
        if (insertError) {
          throw new Error('Scan completed but the result could not be saved. Please try again.');
        }
        persisted = true;

        emit('result', { ...result, scanId });
      } catch (err) {
        let errorMessage = err instanceof Error ? err.message : 'Scan failed';
        if (deepQuotaKey && !persisted) {
          try {
            const { error: refundError } = await supabase.rpc('refund_usage', { usage_key: deepQuotaKey });
            if (refundError) {
              errorMessage += ' The reserved scan allowance could not be restored; please contact support.';
            }
          } catch {
            errorMessage += ' The reserved scan allowance could not be restored; please contact support.';
          }
        }
        try {
          emit('error', { error: errorMessage });
        } catch {
          // The client may have disconnected after the result was persisted.
        }
      } finally {
        try { controller.close(); } catch { /* already cancelled */ }
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

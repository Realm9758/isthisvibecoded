import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { deepScanDomain } from '@/lib/deep-scanner';
import { SCAN_PHASES } from '@/lib/scan-phases';
import { phasesForLane } from '@/lib/scan-lanes';
import { redactForAnonymous } from '@/lib/scan-redaction';
import { assertPublicTarget, normalizePublicUrl } from '@/lib/url-safety';
import { getAnonymousRateLimitKey } from '@/lib/rate-limit';
import {
  ANONYMOUS_DAILY_LIMIT, FREE_LIFETIME_LIMIT, USER_BURST_LIMIT, TARGET_HOURLY_LIMIT,
  anonymousDailyKey, freeLifetimeKey, userBurstKey, targetHourlyKey,
} from '@/lib/scan-quota';
import type { DeepFinding } from '@/types/deep-scan';

export const runtime = 'nodejs';
export const maxDuration = 55;

/**
 * The surface lane: fifteen read-only checks, open to any URL, no account.
 *
 * No domain-control evidence is required because nothing here sends a payload
 * or touches an application entry point. Every request is of the class a
 * browser or a search crawler already makes. The thirteen checks that do send
 * payloads live behind /api/deep-scan and its verification gate, and no
 * amount of money moves them.
 */

const CLAIM_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  const userId = payload?.userId ?? null;

  let domain: string;
  try {
    const body = await request.json();
    if (typeof body?.url !== 'string' || !body.url.trim()) {
      return Response.json({ error: 'A URL is required' }, { status: 400 });
    }
    const target = normalizePublicUrl(body.url);
    await assertPublicTarget(target, 4_000);
    domain = target.hostname.toLowerCase();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request body';
    return Response.json({ error: message }, { status: message.includes('timed out') ? 408 : 400 });
  }

  const now = new Date();

  // Reserved before anything else, and for every caller. This is the control
  // that stops Ironclad being pointed at one victim over and over, so it is
  // not a billing limit and paying does not relax it.
  const { data: targetBurst, error: targetError } = await supabase.rpc('consume_usage', {
    usage_key: targetHourlyKey(domain, now),
    usage_limit: TARGET_HOURLY_LIMIT,
  });
  if (targetError) {
    console.error('Usage reservation failed', { tag: 'scan:target', reason: targetError.message });
    return Response.json({ error: 'Could not reserve the scan rate allowance' }, { status: 503 });
  }
  if (Number(targetBurst) < 0) {
    return Response.json(
      { error: 'This domain has been scanned too many times in the past hour. Try again later.' },
      { status: 429 },
    );
  }

  // The one key refunded if the scan fails. The per-target cap is not
  // refunded: the target absorbed the traffic either way.
  let quotaKey: string | null = null;

  if (!userId) {
    const rateLimitKey = getAnonymousRateLimitKey(request);
    if (!rateLimitKey) {
      return Response.json({ error: 'Anonymous scanning is unavailable' }, { status: 503 });
    }
    quotaKey = anonymousDailyKey(rateLimitKey, now);
    const { data: remaining, error } = await supabase.rpc('consume_usage', {
      usage_key: quotaKey,
      usage_limit: ANONYMOUS_DAILY_LIMIT,
    });
    if (error) {
      console.error('Usage reservation failed', { tag: 'scan:anonymous', reason: error.message });
      return Response.json({ error: 'Could not reserve the scan allowance' }, { status: 503 });
    }
    if (Number(remaining) < 0) {
      return Response.json(
        {
          error: `You have used your free scan for today. Create an account for ${FREE_LIFETIME_LIMIT} full scans.`,
          signupRequired: true,
        },
        { status: 429 },
      );
    }
  } else {
    const { data: burst, error: burstError } = await supabase.rpc('consume_usage', {
      usage_key: userBurstKey(userId, now),
      usage_limit: USER_BURST_LIMIT,
    });
    if (burstError) {
      console.error('Usage reservation failed', { tag: 'scan:burst', reason: burstError.message });
      return Response.json({ error: 'Could not reserve the scan rate allowance' }, { status: 503 });
    }
    if (Number(burst) < 0) {
      return Response.json({ error: 'Wait a moment before starting another scan.' }, { status: 429 });
    }

    const { data: userRow, error: userError } = await supabase
      .from('users')
      .select('plan')
      .eq('id', userId)
      .maybeSingle();
    if (userError) {
      return Response.json({ error: 'Could not verify account plan' }, { status: 503 });
    }

    if (!userRow || userRow.plan === 'free') {
      quotaKey = freeLifetimeKey(userId);
      const { data: remaining, error } = await supabase.rpc('consume_usage', {
        usage_key: quotaKey,
        usage_limit: FREE_LIFETIME_LIMIT,
      });
      if (error) {
        console.error('Usage reservation failed', { tag: 'scan:lifetime', reason: error.message });
        return Response.json({ error: 'Could not reserve the scan allowance' }, { status: 503 });
      }
      if (Number(remaining) < 0) {
        return Response.json(
          {
            error: `You have used all ${FREE_LIFETIME_LIMIT} free scans. Pro removes the limit.`,
            upgradeRequired: true,
          },
          { status: 403 },
        );
      }
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let persisted = false;
      const emit = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(sse(event, data)));

      try {
        emit('phases', phasesForLane(SCAN_PHASES, 'surface'));

        const result = await deepScanDomain(domain, 'surface', (phase, findings: DeepFinding[], status) => {
          emit('phase', { id: phase.id, label: phase.label, detail: phase.detail, findings, status });
        });

        const scanId = crypto.randomUUID();
        const claimToken = userId ? null : crypto.randomUUID().replace(/-/g, '');

        const { error: insertError } = await supabase.from('deep_scans').insert({
          id: scanId,
          domain,
          user_id: userId,
          lane: 'surface',
          result,
          claim_token: claimToken,
          claim_expires_at: claimToken ? Date.now() + CLAIM_WINDOW_MS : null,
          created_at: Date.now(),
        });
        if (insertError) {
          throw new Error('Scan completed but the result could not be saved. Please try again.');
        }
        persisted = true;

        // Opportunistic purge, so no scheduled job is needed. An unclaimed
        // anonymous row describes somebody else's site and is not kept past
        // the claim window.
        void supabase
          .from('deep_scans')
          .delete()
          .is('user_id', null)
          .lt('claim_expires_at', Date.now())
          .then(undefined, () => undefined);

        emit('result', userId
          ? { ...result, scanId }
          : { ...redactForAnonymous(result), scanId, claimToken });
      } catch (err) {
        let errorMessage = err instanceof Error ? err.message : 'Scan failed';
        if (quotaKey && !persisted) {
          try {
            const { error: refundError } = await supabase.rpc('refund_usage', { usage_key: quotaKey });
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

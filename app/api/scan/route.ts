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
  SURFACE_TARGET_HOURLY_LIMIT, anonymousDailyKey, freeLifetimeKey, userBurstKey,
  targetHourlyKey, surfaceTargetHourlyKey,
} from '@/lib/scan-quota';
import { reserveUsageBatch, type UsageReservation } from '@/lib/scan-reservation';
import { mutationRequestError, readBoundedJson } from '@/lib/request-security';
import { sanitizeFindings, sanitizeScanResult } from '@/lib/evidence-redaction';
import type { DeepFinding } from '@/types/deep-scan';

export const runtime = 'nodejs';
export const maxDuration = 55;

/**
 * The surface lane contains only bounded read-only checks and is open to any
 * public URL without domain verification.
 *
 * No domain-control evidence is required because nothing here sends a payload
 * or touches an application entry point. Every request is of the class a
 * browser or a search crawler already makes. Payload and application-entry
 * checks live behind /api/deep-scan and its verification gate, and no amount
 * of money moves them.
 */

const CLAIM_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const requestError = mutationRequestError(request);
  if (requestError) return Response.json({ error: requestError }, { status: 403 });

  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  const userId = payload?.userId ?? null;

  let domain: string;
  try {
    const body = await readBoundedJson(request) as Record<string, unknown>;
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

  let quotaKey: string | null = null;
  const reservations: UsageReservation[] = [
    { key: targetHourlyKey(domain, now), limit: TARGET_HOURLY_LIMIT },
    { key: surfaceTargetHourlyKey(domain, now), limit: SURFACE_TARGET_HOURLY_LIMIT },
  ];
  if (!userId) {
    const rateLimitKey = getAnonymousRateLimitKey(request);
    if (!rateLimitKey) {
      return Response.json({ error: 'Anonymous scanning is unavailable' }, { status: 503 });
    }
    quotaKey = anonymousDailyKey(rateLimitKey, now);
    reservations.push({ key: quotaKey, limit: ANONYMOUS_DAILY_LIMIT });
  } else {
    const { data: userRow, error: userError } = await supabase
      .from('users')
      .select('plan')
      .eq('id', userId)
      .maybeSingle();
    if (userError) {
      return Response.json({ error: 'Could not verify account plan' }, { status: 503 });
    }
    reservations.push({ key: userBurstKey(userId, now), limit: USER_BURST_LIMIT });
    if (!userRow || userRow.plan === 'free') {
      quotaKey = freeLifetimeKey(userId);
      reservations.push({ key: quotaKey, limit: FREE_LIFETIME_LIMIT });
    }
  }

  const reservation = await reserveUsageBatch(reservations);
  if (reservation.error) {
    console.error('Usage reservation failed', { tag: 'scan:batch', reason: reservation.error });
    return Response.json({ error: 'Could not reserve the scan allowance' }, { status: 503 });
  }
  if (!reservation.allowed) {
    if (quotaKey && reservation.deniedKey === quotaKey) {
      return Response.json(
        userId
          ? { error: `You have used all ${FREE_LIFETIME_LIMIT} free scans. Pro removes the limit.`, upgradeRequired: true }
          : { error: `You have used your free scan for today. Create an account for ${FREE_LIFETIME_LIMIT} full scans.`, signupRequired: true },
        { status: userId ? 403 : 429 },
      );
    }
    if (reservation.deniedKey?.startsWith('scan-burst:')) {
      return Response.json({ error: 'Wait a moment before starting another scan.' }, { status: 429 });
    }
    return Response.json(
      { error: 'This domain has reached its safe Surface scan allowance for the hour. Try again later.' },
      { status: 429 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let persisted = false;
      const emit = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(sse(event, data)));

      try {
        emit('phases', phasesForLane(SCAN_PHASES, 'surface'));

        const rawResult = await deepScanDomain(domain, 'surface', (phase, findings: DeepFinding[], status) => {
          emit('phase', { id: phase.id, label: phase.label, detail: phase.detail, findings: sanitizeFindings(findings), status });
        });
        const result = sanitizeScanResult(rawResult);

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

        // A storage failure must not destroy a scan that already ran. The
        // work is done and the findings are real, so they are returned with
        // the allowance refunded and the caller told it was not saved. They
        // lose the history entry, not the answer.
        if (insertError) {
          console.error('Scan result could not be saved', {
            tag: 'scan:persist',
            reason: insertError.message,
          });
          if (quotaKey) {
            try {
              await supabase.rpc('refund_usage', { usage_key: quotaKey });
            } catch {
              // A failed refund costs the caller an allowance, not the report.
            }
          }
          emit('result', {
            ...(userId ? result : redactForAnonymous(result)),
            notSaved: 'This result could not be saved to your history, so it will disappear when you leave this page.',
          });
          return;
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

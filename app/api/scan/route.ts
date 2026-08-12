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
import { encodeScanResultForStorage, summarizeScanStorageError } from '@/lib/scan-result-storage';
import type { DeepFinding, ScanPhaseProgress } from '@/types/deep-scan';

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
const SSE_HEARTBEAT_MS = 15_000;
const SSE_RESPONSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

function sse(event: string, data: unknown): string {
  if (!/^[a-z][a-z0-9_-]*$/i.test(event)) throw new Error('Invalid SSE event name');
  const json = JSON.stringify(data, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
  if (json === undefined) throw new Error('SSE event data is not serializable');
  return `event: ${event}\ndata: ${json.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}\n\n`;
}

export async function POST(request: Request) {
  const requestError = mutationRequestError(request);
  if (requestError) return Response.json({ error: requestError }, { status: 403 });

  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  const userId = payload?.userId ?? null;

  let domain: string;
  let startUrl: string;
  try {
    const body = await readBoundedJson(request) as Record<string, unknown>;
    if (typeof body?.url !== 'string' || !body.url.trim()) {
      return Response.json({ error: 'A URL is required' }, { status: 400 });
    }
    const target = normalizePublicUrl(body.url);
    await assertPublicTarget(target, 4_000);
    domain = target.hostname.toLowerCase();
    startUrl = target.href;
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
  let streamOpen = true;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let persisted = false;
      let doneStartedAt: number | null = null;
      let doneTerminalEmitted = false;
      function enqueue(frame: string): boolean {
        if (!streamOpen) return false;
        try {
          controller.enqueue(encoder.encode(frame));
          return true;
        } catch {
          streamOpen = false;
          return false;
        }
      }
      function emit(event: string, data: unknown): boolean {
        try {
          return enqueue(sse(event, data));
        } catch (error) {
          console.error('Surface scan stream event could not be serialized', {
            tag: 'scan:sse',
            event,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
          throw new Error('The scan stream could not serialize an event.');
        }
      }
      function emitDone(status: 'complete' | 'incomplete', reason: string | null): void {
        if (doneTerminalEmitted) return;
        const phase = SCAN_PHASES[SCAN_PHASES.length - 1];
        emit('phase', {
          id: phase.id,
          label: phase.label,
          detail: phase.detail,
          findings: [],
          status,
          durationMs: doneStartedAt === null ? 0 : Date.now() - doneStartedAt,
          reason,
        });
        doneTerminalEmitted = true;
      }
      enqueue(': connected\n\n');
      heartbeat = setInterval(() => enqueue(': keepalive\n\n'), SSE_HEARTBEAT_MS);

      try {
        emit('phases', phasesForLane(SCAN_PHASES, 'surface'));

        const rawResult = await deepScanDomain({ hostname: domain, startUrl }, 'surface', (
          phase,
          findings: DeepFinding[],
          progress: ScanPhaseProgress,
        ) => {
          if (phase.id === 'done' && progress.status === 'start') doneStartedAt = Date.now();
          try {
            emit('phase', {
              id: phase.id,
              label: phase.label,
              detail: phase.detail,
              findings: sanitizeFindings(Array.isArray(findings) ? findings : []),
              status: progress.status,
              coverage: progress.coverage,
              durationMs: progress.durationMs,
              reason: progress.reason,
            });
          } catch (error) {
            console.error('Surface scan phase event could not be prepared', {
              tag: 'scan:sse-phase',
              phaseId: phase.id,
              errorName: error instanceof Error ? error.name : 'UnknownError',
            });
          }
        }, { deferDoneCompletion: true });
        const result = sanitizeScanResult(rawResult);

        const scanId = crypto.randomUUID();
        const claimToken = userId ? null : crypto.randomUUID().replace(/-/g, '');

        const { error: insertError } = await supabase.from('deep_scans').insert({
          id: scanId,
          domain,
          user_id: userId,
          lane: 'surface',
          result: encodeScanResultForStorage(result),
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
            ...summarizeScanStorageError(insertError),
          });
          if (quotaKey) {
            try {
              await supabase.rpc('refund_usage', { usage_key: quotaKey });
            } catch {
              // A failed refund costs the caller an allowance, not the report.
            }
          }
          emitDone('incomplete', 'The report was generated but could not be saved to scan history');
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

        emitDone('complete', null);
        emit('result', userId
          ? { ...result, scanId }
          : { ...redactForAnonymous(result), scanId, claimToken });
      } catch (err) {
        let errorMessage = err instanceof Error ? err.message : 'Scan failed';
        if (doneStartedAt !== null && !doneTerminalEmitted) {
          try {
            emitDone('incomplete', 'The report could not be finalized or delivered');
          } catch {
            // The client may already be disconnected.
          }
        }
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
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        streamOpen = false;
        try { controller.close(); } catch { /* already cancelled */ }
      }
    },
    cancel() {
      streamOpen = false;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    },
  });

  return new Response(stream, {
    headers: SSE_RESPONSE_HEADERS,
  });
}

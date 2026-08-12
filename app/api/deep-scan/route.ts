import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { deepScanDomain, SCAN_PHASES } from '@/lib/deep-scanner';
import { assertPublicTarget, normalizePublicUrl } from '@/lib/url-safety';
import { DEEP_SCAN_TERMS_VERSION, VERIFICATION_MAX_AGE_MS } from '@/lib/policy';
import { mutationRequestError, readBoundedJson } from '@/lib/request-security';
import { checkManualVerificationProof, type ManualVerificationMethod } from '@/lib/verification-proof';
import { reserveUsage } from '@/lib/store';
import {
  FREE_LIFETIME_LIMIT, USER_BURST_LIMIT, TARGET_HOURLY_LIMIT,
  freeLifetimeKey, userBurstKey, targetHourlyKey,
} from '@/lib/scan-quota';
import { reserveUsageBatch, type UsageReservation } from '@/lib/scan-reservation';
import { revalidateProviderDomain } from '@/lib/provider-verification';
import { sanitizeFindings, sanitizeScanResult } from '@/lib/evidence-redaction';
import { encodeScanResultForStorage, summarizeScanStorageError } from '@/lib/scan-result-storage';
import type { DeepFinding, ScanPhaseProgress } from '@/types/deep-scan';
import {
  parseRequestedDeepScanScope,
  phasesForDeepScanScope,
  type DeepScanModuleId,
} from '@/lib/deep-scan-scope';

export const runtime = 'nodejs';
export const maxDuration = 55;

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

  // Auth required
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  // This cheap account gate runs before JSON parsing, DNS, and ownership
  // lookups. Invalid or unverified random domains cannot create unbounded
  // resolver and database work without ever reaching a scan quota.
  const ingressMinute = new Date().toISOString().slice(0, 16);
  const ingressRemaining = await reserveUsage(
    `deep-ingress:${payload.userId}:${ingressMinute}`,
    12,
    'deep-scan:ingress',
  );
  if (ingressRemaining === null) {
    return Response.json({ error: 'Could not reserve the request allowance' }, { status: 503 });
  }
  if (ingressRemaining < 0) {
    return Response.json({ error: 'Too many deep-scan requests. Wait before trying again.' }, { status: 429 });
  }

  let domain: string;
  let startUrl: string;
  let authorizationAcceptedAt: number;
  let selectedPhaseIds: DeepScanModuleId[];
  try {
    const body = await readBoundedJson(request) as Record<string, unknown>;
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
    selectedPhaseIds = parseRequestedDeepScanScope(body.selectedPhaseIds);
    authorizationAcceptedAt = Date.now();
    const target = normalizePublicUrl(body.domain);
    domain = target.hostname.toLowerCase();
    startUrl = target.href;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request body';
    return Response.json({ error: message }, { status: message.includes('timed out') ? 408 : 400 });
  }

  // Deep scan limit for free users
  const [userQuery, verificationQuery] = await Promise.all([
    supabase.from('users').select('plan').eq('id', payload.userId).maybeSingle(),
    supabase
      .from('verification_tokens')
      .select('id, token, verified, verified_at, verification_method')
      .eq('domain', domain)
      .eq('user_id', payload.userId)
      .maybeSingle(),
  ]);
  const { data: userRow, error: userError } = userQuery;
  if (userError) {
    return Response.json({ error: 'Could not verify account plan' }, { status: 503 });
  }
  // Fresh domain-control check: it must belong to this authenticated user.
  const { data: verif, error: verificationError } = verificationQuery;

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

  const verificationMethod = verif?.verification_method;
  const isManualMethod = ['dns', 'meta', 'file'].includes(verificationMethod ?? '');
  const provider = verificationMethod === 'vercel-oauth'
    ? 'vercel'
    : verificationMethod === 'netlify-oauth'
      ? 'netlify'
      : null;
  if (!isManualMethod && !provider) {
    return Response.json(
      { error: 'This verification method cannot be revalidated. Reconnect or renew domain control.' },
      { status: 403 },
    );
  }
  const liveProof = provider
    ? await revalidateProviderDomain(payload.userId, provider, domain)
    : await checkManualVerificationProof(
        domain,
        String(verif?.token ?? ''),
        verificationMethod as ManualVerificationMethod,
      );
  if (!liveProof.verified) {
    await supabase
      .from('verification_tokens')
      .update({ verified: false, verified_at: null })
      .eq('id', verif?.id)
      .eq('user_id', payload.userId);
    return Response.json(
      {
        error: `Domain control could not be revalidated. ${liveProof.error ?? 'Renew the proof and try again.'}`,
        verificationExpired: true,
        reasonCode: 'reasonCode' in liveProof ? liveProof.reasonCode : 'provider_revalidation_failed',
      },
      { status: 403 },
    );
  }

  try {
    await assertPublicTarget(new URL(`https://${domain}`), 4_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Domain is no longer a public target';
    return Response.json({ error: message }, { status: message.includes('timed out') ? 408 : 400 });
  }

  // Record the exact live proof that gates this scan. This also closes a race
  // where the token or current claim changes after the initial row read.
  const { data: revalidationEventId, error: revalidationEventError } = await supabase.rpc(
    'complete_domain_verification_with_event',
    {
      claim_domain: domain,
      claimant_user_id: payload.userId,
      claimant_token: String(verif?.token ?? ''),
      verification_method: verificationMethod,
      verified_timestamp: authorizationAcceptedAt,
      proof_subject: liveProof.proofSubject ?? domain,
    },
  );
  if (
    revalidationEventError
    || !Number.isFinite(Number(revalidationEventId))
    || Number(revalidationEventId) <= 0
  ) {
    return Response.json(
      { error: 'The domain claim changed while it was being revalidated. Verify it again.' },
      { status: 409 },
    );
  }

  // Plan entitlement controls the daily/lifetime quota, not operational
  // safety. Every account and target remains burst-limited so a paid account
  // cannot launch an unbounded number of outbound active scans.
  const now = new Date();
  let deepQuotaKey: string | null = null;
  const reservations: UsageReservation[] = [
    { key: userBurstKey(payload.userId, now), limit: USER_BURST_LIMIT },
    { key: targetHourlyKey(domain, now), limit: TARGET_HOURLY_LIMIT },
  ];
  if (!userRow || userRow.plan === 'free') {
    deepQuotaKey = freeLifetimeKey(payload.userId);
    reservations.push({ key: deepQuotaKey, limit: FREE_LIFETIME_LIMIT });
  }
  const reservation = await reserveUsageBatch(reservations);
  if (reservation.error) {
    console.error('Usage reservation failed', { tag: 'deep-scan:batch', reason: reservation.error });
    return Response.json({ error: 'Could not reserve the active-scan allowance' }, { status: 503 });
  }
  if (!reservation.allowed) {
    if (deepQuotaKey && reservation.deniedKey === deepQuotaKey) {
      return Response.json(
        {
          error: `You have used all ${FREE_LIFETIME_LIMIT} free scans. Pro removes the limit; operational rate limits still apply.`,
          upgradeRequired: true,
        },
        { status: 403 },
      );
    }
    return Response.json(
      { error: 'Active-scan burst limit reached. Wait before starting another scan.' },
      { status: 429 },
    );
  }

  // Stream SSE
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
          console.error('Deep scan stream event could not be serialized', {
            tag: 'deep-scan:sse',
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
        emit('phases', phasesForDeepScanScope(selectedPhaseIds));

        const rawResult = await deepScanDomain({ hostname: domain, startUrl }, 'deep', (
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
            console.error('Deep scan phase event could not be prepared', {
              tag: 'deep-scan:sse-phase',
              phaseId: phase.id,
              errorName: error instanceof Error ? error.name : 'UnknownError',
            });
          }
        }, { deferDoneCompletion: true, selectedPhaseIds });
        const result = sanitizeScanResult(rawResult);

        // Persist to DB
        const scanId = crypto.randomUUID();
        const { error: insertError } = await supabase.from('deep_scans').insert({
          id: scanId,
          domain,
          user_id: payload.userId,
          lane: 'deep',
          authorization_terms_version: DEEP_SCAN_TERMS_VERSION,
          authorization_accepted_at: authorizationAcceptedAt,
          verification_snapshot: {
            verificationId: verif?.id,
            verificationEventId: Number(revalidationEventId),
            method: verificationMethod,
            verifiedAt: authorizationAcceptedAt,
            previousVerifiedAt: verifiedAt,
            revalidatedAt: authorizationAcceptedAt,
            proofSubject: liveProof.proofSubject ?? domain,
          },
          result: encodeScanResultForStorage(result),
          created_at: Date.now(),
        });
        if (insertError) {
          // The generic message below is all the caller sees, so the specific
          // failure has to reach the logs or the save path is undiagnosable.
          console.error('Deep scan result could not be saved', {
            tag: 'deep-scan:persist',
            ...summarizeScanStorageError(insertError),
            details: insertError.details,
            hint: insertError.hint,
            resultBytes: JSON.stringify(result).length,
          });
          throw new Error('Scan completed but the result could not be saved. Please try again.');
        }
        persisted = true;

        emitDone('complete', null);
        emit('result', { ...result, scanId });
      } catch (err) {
        let errorMessage = err instanceof Error ? err.message : 'Scan failed';
        if (doneStartedAt !== null && !doneTerminalEmitted) {
          try {
            emitDone('incomplete', 'The report could not be finalized or saved');
          } catch {
            // The client may already be disconnected.
          }
        }
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

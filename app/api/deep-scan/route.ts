import { cookies } from 'next/headers';
import { verifyToken, AUTH_COOKIE } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { assertPublicTarget, normalizePublicUrl } from '@/lib/url-safety';
import { DEEP_SCAN_TERMS_VERSION, VERIFICATION_MAX_AGE_MS } from '@/lib/policy';
import { mutationRequestError, readBoundedJson } from '@/lib/request-security';
import { checkManualVerificationProof, type ManualVerificationMethod } from '@/lib/verification-proof';
import { reserveUsage } from '@/lib/store';
import { revalidateProviderDomain } from '@/lib/provider-verification';
import {
  parseRequestedDeepScanScope,
  phasesForDeepScanScope,
  resolveDeepScanScope,
  type DeepScanModuleId,
} from '@/lib/deep-scan-scope';
import { createScanJob, appendScanJobEvent } from '@/lib/scan-job-store';
import { normalizeOwnerRateLimitPath } from '@/lib/rate-limit-evidence';
import { durableDeepScanEnabled } from '@/lib/scan-identity';

export const runtime = 'nodejs';

/**
 * Creates a durable scan job. No active payload is sent from this request;
 * the fixed-egress worker owns perimeter access checks and application probes.
 */
export async function POST(request: Request) {
  if (!durableDeepScanEnabled()) {
    return Response.json({
      error: 'Deep scanning is temporarily unavailable while the dedicated scanner is being prepared.',
    }, { status: 503 });
  }
  const requestError = mutationRequestError(request);
  if (requestError) return Response.json({ error: requestError }, { status: 403 });

  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) return Response.json({ error: 'Authentication required' }, { status: 401 });

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
    return Response.json({ error: 'Too many scan setup attempts. Wait a minute and try again.' }, { status: 429 });
  }

  let domain: string;
  let startUrl: string;
  let selectedPhaseIds: DeepScanModuleId[];
  let rateLimitPath: string | null;
  const authorizationAcceptedAt = Date.now();
  try {
    const body = await readBoundedJson(request) as Record<string, unknown>;
    if (typeof body.domain !== 'string' || !body.domain.trim()) {
      return Response.json({ error: 'Enter the domain you want to scan.' }, { status: 400 });
    }
    if (body.authorizationAccepted !== true) {
      return Response.json({ error: 'Confirm that you are authorised to test this site.' }, { status: 403 });
    }
    if (body.termsVersion !== DEEP_SCAN_TERMS_VERSION) {
      return Response.json({
        error: 'The active-scan terms changed. Review and accept the current version before continuing.',
        currentTermsVersion: DEEP_SCAN_TERMS_VERSION,
      }, { status: 409 });
    }
    selectedPhaseIds = resolveDeepScanScope(parseRequestedDeepScanScope(body.selectedPhaseIds));
    rateLimitPath = selectedPhaseIds.includes('ratelimit')
      ? normalizeOwnerRateLimitPath(body.rateLimitPath)
      : null;
    const target = normalizePublicUrl(body.domain);
    domain = target.hostname.toLowerCase();
    startUrl = target.href;
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : 'The scan setup was not valid.',
    }, { status: 400 });
  }

  const { data: verif, error: verificationError } = await supabase
    .from('verification_tokens')
    .select('id, token, verified, verified_at, verification_method')
    .eq('domain', domain)
    .eq('user_id', payload.userId)
    .maybeSingle();
  if (verificationError) return Response.json({ error: 'Could not verify domain control.' }, { status: 503 });

  const verifiedAt = Number(verif?.verified_at);
  const verificationAge = Date.now() - verifiedAt;
  const verificationIsCurrent = verif?.verified === true
    && Number.isFinite(verifiedAt)
    && verifiedAt > 0
    && verificationAge >= 0
    && verificationAge <= VERIFICATION_MAX_AGE_MS;
  if (!verificationIsCurrent) {
    return Response.json({
      error: verif?.verified
        ? 'Your domain-control proof expired. Renew it before starting an active scan.'
        : 'Verify control of this domain before starting an active scan.',
      verificationExpired: verif?.verified === true,
    }, { status: 403 });
  }

  const verificationMethod = verif?.verification_method;
  const provider = verificationMethod === 'vercel-oauth'
    ? 'vercel'
    : verificationMethod === 'netlify-oauth'
      ? 'netlify'
      : null;
  const manual = ['dns', 'meta', 'file'].includes(verificationMethod ?? '');
  if (!provider && !manual) {
    return Response.json({ error: 'Reconnect or renew this domain-control proof.' }, { status: 403 });
  }
  const liveProof = provider
    ? await revalidateProviderDomain(payload.userId, provider, domain)
    : await checkManualVerificationProof(
        domain,
        String(verif?.token ?? ''),
        verificationMethod as ManualVerificationMethod,
      );
  if (!liveProof.verified) {
    await supabase.from('verification_tokens')
      .update({ verified: false, verified_at: null })
      .eq('id', verif?.id)
      .eq('user_id', payload.userId);
    return Response.json({
      error: `Ironclad could not confirm current control of the domain. ${liveProof.error ?? 'Renew the proof and try again.'}`,
      verificationExpired: true,
    }, { status: 403 });
  }

  try {
    await assertPublicTarget(new URL(`https://${domain}`), 4_000);
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : 'The domain is no longer a public target.',
    }, { status: 400 });
  }

  const { data: revalidationEventId, error: revalidationError } = await supabase.rpc(
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
  if (revalidationError || Number(revalidationEventId) <= 0) {
    return Response.json({ error: 'The domain claim changed. Verify it again.' }, { status: 409 });
  }

  try {
    const job = await createScanJob({
      userId: payload.userId,
      domain,
      startUrl,
      selectedPhaseIds,
      rateLimitPath,
      authorizationTermsVersion: DEEP_SCAN_TERMS_VERSION,
      authorizationAcceptedAt,
      verificationSnapshot: {
        verificationId: verif?.id,
        verificationEventId: Number(revalidationEventId),
        method: verificationMethod,
        verifiedAt: authorizationAcceptedAt,
        previousVerifiedAt: verifiedAt,
        proofSubject: liveProof.proofSubject ?? domain,
      },
    });
    await appendScanJobEvent(job.id, 'manifest', {
      phases: phasesForDeepScanScope(selectedPhaseIds),
      moduleCount: selectedPhaseIds.length,
      explanation: 'Ironclad first checks the public firewall, then runs one selected module and one target request at a time.',
    });
    await appendScanJobEvent(job.id, 'job_state', {
      state: 'queued',
      message: 'Your scan is queued for the dedicated scanner. No scan credit has been used yet.',
    });
    return Response.json({
      jobId: job.id,
      state: job.status,
      eventsUrl: job.eventsUrl,
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The scan job could not be created.';
    return Response.json({ error: message }, { status: message.includes('already active') ? 409 : 503 });
  }
}

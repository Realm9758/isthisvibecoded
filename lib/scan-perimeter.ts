import 'server-only';
import { pinnedFetch } from '@/lib/pinned-fetch';
import { assessProbeResponse } from '@/lib/scan-http-outcome';
import { ScanRequestScheduler } from '@/lib/scan-request-scheduler';
import { DEEP_REQUEST_INTERVAL_MS } from '@/lib/deep-scanner';
import {
  DEEP_SCANNER_ID_HEADER,
  DEEP_SCANNER_ID_VALUE,
  DEEP_SCANNER_USER_AGENT,
  scannerEgressIps,
} from '@/lib/scan-identity';
import type { ScanAccessDiagnostic, ScanProbeEvent } from '@/types/scan-job';

export interface PerimeterResult {
  completedAt: string;
  diagnostics: ScanAccessDiagnostic[];
  accessReady: boolean;
}

export interface ScannerAccessGuide {
  title: string;
  steps: string[];
}

export function accessGuide(
  diagnostic: ScanAccessDiagnostic,
  hostname: string,
  stableEgressAvailable = true,
): ScannerAccessGuide {
  if (!stableEgressAvailable) {
    return {
      title: 'The temporary scanner met a browser challenge',
      steps: [
        `Ironclad stopped at ${hostname} instead of sending the remaining modules into the same challenge page.`,
        'A changing Vercel address cannot be safely allowlisted. You can choose Recheck access later in case the challenge was temporary.',
        'No insecure proxy rotation or automated challenge solving will be used. Reliable firewall bypass instructions will return with the fixed-IP scanner.',
      ],
    };
  }
  const ips = scannerEgressIps();
  const identity = ips.length > 0 ? ips.join(', ') : 'the fixed scanner IPs shown in Ironclad';
  if (diagnostic.provider === 'cloudflare') {
    return {
      title: 'Let Ironclad reach the application through Cloudflare',
      steps: [
        `Create a Cloudflare WAF Skip rule for ${hostname} and source IP ${identity}.`,
        'Skip the managed rules, rate limiting, and bot rules that challenged the preflight. Keep the rule limited to this hostname.',
        'Return here and choose Recheck access. Remove or disable the rule after the application pass finishes.',
      ],
    };
  }
  if (diagnostic.provider === 'vercel') {
    return {
      title: 'Let Ironclad reach the application through Vercel',
      steps: [
        `Add ${identity} to a System Bypass Rule for ${hostname}; use a custom Bypass rule too if your own WAF rule caused the challenge.`,
        'Publish the firewall change and confirm it applies only to this domain.',
        'Return here and choose Recheck access. Remove the temporary bypass after the application pass finishes.',
      ],
    };
  }
  return {
    title: 'Temporarily trust the Ironclad scanner',
    steps: [
      `Allow source IP ${identity} for the exact host ${hostname}.`,
      `Match Ironclad’s ${DEEP_SCANNER_ID_HEADER}: ${DEEP_SCANNER_ID_VALUE} header as an additional identity signal, but do not trust the header without the fixed IP.`,
      'Choose Recheck access, then remove the temporary exception after the scan.',
    ],
  };
}

export async function runPerimeterPreflight(
  target: { hostname: string; startUrl: string },
  options: {
    transport?: typeof pinnedFetch;
    intervalMs?: number;
    onProbe?: (event: ScanProbeEvent) => void | Promise<void>;
    signal?: AbortSignal;
    /** Deterministic fixture hook; production uses an abortable timer. */
    retrySleep?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<PerimeterResult> {
  const start = new URL(target.startUrl);
  if (start.hostname.toLowerCase() !== target.hostname.toLowerCase()) {
    throw new Error('The preflight URL does not match the verified hostname.');
  }
  const origin = start.origin;
  const nonce = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
  const canaries = [
    { label: 'submitted page', url: start.href },
    { label: 'safe missing page', url: `${origin}/.well-known/ironclad-missing-${nonce}` },
    { label: 'representative protected file', url: `${origin}/.env` },
    { label: 'representative API route', url: `${origin}/api/ironclad-access-check-${nonce}` },
  ];
  const scheduler = new ScanRequestScheduler({
    intervalMs: options.intervalMs ?? (options.transport ? 0 : DEEP_REQUEST_INTERVAL_MS),
  });
  const diagnostics: ScanAccessDiagnostic[] = [];
  const headers = {
    'User-Agent': DEEP_SCANNER_USER_AGENT,
    [DEEP_SCANNER_ID_HEADER]: DEEP_SCANNER_ID_VALUE,
    Accept: 'text/html, application/json;q=0.8, */*;q=0.1',
  };

  const pauseBeforeRetry = async (milliseconds: number) => {
    if (options.retrySleep) return options.retrySleep(milliseconds);
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Aborted', 'AbortError');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, milliseconds);
      const abort = () => {
        clearTimeout(timer);
        reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      options.signal?.addEventListener('abort', abort, { once: true });
    });
  };

  for (let index = 0; index < canaries.length; index++) {
    const canary = canaries[index];
    const url = new URL(canary.url);
    let diagnostic: ScanAccessDiagnostic | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const startedAt = Date.now();
      await options.onProbe?.({
        pass: 'perimeter', phaseId: 'access', moduleIndex: 0, moduleCount: 0,
        probeIndex: index + 1, plannedProbes: canaries.length, stage: 'requesting',
        method: 'GET', path: url.pathname, attempt, maxAttempts: 2,
        message: `Checking whether Ironclad can reach the ${canary.label}`,
      });
      try {
        const timeoutSignal = AbortSignal.timeout(8_000);
        const signal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal;
        const response = await scheduler.run(() => (options.transport ?? pinnedFetch)(url, {
          redirect: 'manual', headers, signal, maxResponseBytes: 16_000,
        }));
        const bodySample = response.status === 403
          ? (await response.clone().text().catch(() => '')).slice(0, 4_096)
          : '';
        const assessment = assessProbeResponse(response.status, response.headers, { bodySample });
        const durationMs = Date.now() - startedAt;
        await options.onProbe?.({
          pass: 'perimeter', phaseId: 'access', moduleIndex: 0, moduleCount: 0,
          probeIndex: index + 1, plannedProbes: canaries.length, stage: 'response',
          method: 'GET', path: url.pathname, attempt, maxAttempts: 2,
          durationMs, status: response.status, classification: assessment.classification,
          provider: assessment.provider, retryAfterMs: assessment.retryAfterMs,
          message: assessment.message,
        });
        const retryable = assessment.classification === 'rate_limited'
          || assessment.classification === 'upstream_error';
        if (retryable && attempt === 1) {
          const retryAfterMs = assessment.retryAfterMs ?? 750;
          await options.onProbe?.({
            pass: 'perimeter', phaseId: 'access', moduleIndex: 0, moduleCount: 0,
            probeIndex: index + 1, plannedProbes: canaries.length, stage: 'retry_wait',
            method: 'GET', path: url.pathname, attempt, maxAttempts: 2,
            durationMs, status: response.status, classification: assessment.classification,
            provider: assessment.provider, retryAfterMs,
            message: `${assessment.message}; Ironclad will retry this access check once`,
          });
          await response.body?.cancel().catch(() => undefined);
          await pauseBeforeRetry(retryAfterMs);
          continue;
        }
        diagnostic = {
          classification: assessment.classification, provider: assessment.provider,
          method: 'GET', path: url.pathname, status: response.status,
          retryAfterMs: assessment.retryAfterMs, durationMs, message: assessment.message,
        };
        await response.body?.cancel().catch(() => undefined);
      } catch (error) {
        if (options.signal?.aborted) throw error;
        const durationMs = Date.now() - startedAt;
        if (attempt === 1) {
          await options.onProbe?.({
            pass: 'perimeter', phaseId: 'access', moduleIndex: 0, moduleCount: 0,
            probeIndex: index + 1, plannedProbes: canaries.length, stage: 'retry_wait',
            method: 'GET', path: url.pathname, attempt, maxAttempts: 2,
            durationMs, classification: 'transport_error', retryAfterMs: 500,
            message: 'The connection failed; Ironclad will retry this access check once',
          });
          await pauseBeforeRetry(500);
          continue;
        }
        diagnostic = {
          classification: 'transport_error', provider: null, method: 'GET', path: url.pathname,
          status: null, retryAfterMs: null, durationMs,
          message: 'Ironclad could not establish a reliable connection after one retry',
        };
      }
      if (diagnostic) {
        diagnostics.push(diagnostic);
        await options.onProbe?.({
          pass: 'perimeter', phaseId: 'access', moduleIndex: 0, moduleCount: 0,
          probeIndex: index + 1, plannedProbes: canaries.length, stage: 'complete',
          method: 'GET', path: url.pathname, attempt, maxAttempts: 2,
          durationMs: diagnostic.durationMs, status: diagnostic.status ?? undefined,
          classification: diagnostic.classification, provider: diagnostic.provider,
          retryAfterMs: diagnostic.retryAfterMs, message: diagnostic.message,
        });
        break;
      }
    }
    // Do not spray the remaining canaries into a known challenge or throttle.
    if (diagnostic?.classification === 'bot_challenge' || diagnostic?.classification === 'rate_limited') break;
  }

  const submittedPage = diagnostics[0];
  const submittedPageUsable = submittedPage?.classification === 'usable'
    && submittedPage.status !== null
    && submittedPage.status >= 200
    && submittedPage.status < 400;
  return {
    completedAt: new Date().toISOString(),
    diagnostics,
    accessReady: diagnostics.length === canaries.length && submittedPageUsable && diagnostics.every(item =>
      item.classification === 'usable' || item.classification === 'protected_denial'
    ),
  };
}

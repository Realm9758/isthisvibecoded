import type { CheckCoverage, DeepFinding, DeepScanResult, ScanPhaseProgress } from '@/types/deep-scan';
import { SCAN_PHASES, type ScanPhase } from '@/lib/scan-phases';
import { phaseRunsInLane, phasesForLane, type ScanLane } from '@/lib/scan-lanes';
import { scoreIsWithheld } from '@/lib/scan-coverage';
import { resolveScanPhaseOutcome, type ScanPhaseRequestCoverage } from '@/lib/scan-progress';
import { classifyProbeResponse } from '@/lib/scan-http-outcome';
import { detectVibe } from '@/lib/vibe-detector';
import { scanForPublicKeys } from '@/lib/key-scanner';
import type { ScanProvenance } from '@/types/deep-scan';
import { analyzeSecurityHeaders } from '@/lib/security-headers';
import { calculateDeepScore } from '@/lib/deep-score';
import {
  findGenericClientKeyEvidence,
  findStripeSecretEvidence,
  validateSensitiveFileEvidence,
} from '@/lib/deep-evidence';
import { DEEP_COVERAGE_VERSION, DEEP_SCANNER_VERSION, DEEP_SCORING_VERSION } from '@/lib/deep-versions';
import { pinnedFetch } from '@/lib/pinned-fetch';
import { SCANNER_INFO_URL } from '@/lib/site';
import { AsyncLocalStorage } from 'node:async_hooks';
import { supabase } from '@/lib/supabase';
import { providerTargetHourlyKey } from '@/lib/scan-quota';
import {
  extractNextBuildId,
  extractNextManifestRoutes,
  extractSameOriginScriptUrls,
  extractClientArtifactsFromSources,
  type ClientArtifacts,
} from '@/lib/client-artifacts';
import {
  classifyArrayList,
  classifyFirebaseStorageList,
  classifyS3List,
  extractPostgrestTableCandidates,
  providerQuotaIdentity,
  sensitiveMaterialFields,
  type ProviderListState,
} from '@/lib/provider-evidence';
import { assessSetCookie } from '@/lib/cookie-security';
import {
  hasDifferentialHtmlReflection,
  hasDifferentialSignature,
  hasUnixPasswdEvidence,
} from '@/lib/differential-evidence';
import {
  assessSourceMap,
  hasSourceMapDisclosure,
  sourceMapUrlCandidates,
  type SourceMapAssessment,
} from '@/lib/source-map-evidence';
import { assessSriTag } from '@/lib/subresource-integrity';

const TIMEOUT = 8000;
const SCAN_BUDGET_MS = 42_000;
const MAX_REDIRECTS = 5;
const MAX_PROBE_BODY_BYTES = 512_000;
const DEFAULT_TRANSPORT_BODY_BYTES = 512_000;
const DIFFERENTIAL_BODY_BYTES = 128_000;
/**
 * One user agent per lane. The surface lane runs against sites that never
 * asked to be scanned, so it must not claim an authorisation it does not
 * have, and it carries a URL a site owner can follow to identify and block
 * it. The previous single string claimed every request was an authorised
 * domain-control scan, which would have been a false statement on any
 * unverified target.
 */
const LANE_USER_AGENTS: Record<ScanLane, string> = {
  surface: `Ironclad-Surface/2.0 (+${SCANNER_INFO_URL})`,
  deep: `Ironclad-Deep/2.0 (authorized domain-control scan; +${SCANNER_INFO_URL})`,
};
export { DEEP_COVERAGE_VERSION, DEEP_SCANNER_VERSION } from '@/lib/deep-versions';

export interface DeepScanTarget {
  hostname: string;
  /** Normalized page URL used for the initial HTML, header, and bundle read. */
  startUrl: string;
}

export interface DeepScanOptions {
  /** Injectable only for deterministic scanner fixtures. Production omits it. */
  transport?: typeof pinnedFetch;
  /** Lets an API route include result persistence in the final streamed step. */
  deferDoneCompletion?: boolean;
}

type RequestCoverage = {
  requestsAttempted: number;
  requestsCompleted: number;
  requestsFailed: number;
  requestsBlocked: number;
};

type ActivePhase = {
  phase: ScanPhase;
  startedAt: number;
  baseline: RequestCoverage;
  reason: string | null;
  emit: (progress: ScanPhaseProgress) => void;
};

type ScanRequestContext = {
  authorizedHostnames: Set<string>;
  lane: ScanLane;
  coverage: RequestCoverage;
  deadlineAt: number;
  deadlineExceeded: boolean;
  providerQuotaTargets: Set<string>;
  transport: typeof pinnedFetch;
  activePhase?: ActivePhase;
};

const scanRequestContext = new AsyncLocalStorage<ScanRequestContext>();

type SafeFetchOptions = RequestInit & {
  /** Hard cap applied before the response is buffered in memory. */
  maxResponseBytes?: number;
  /** Main-navigation GETs may follow only the apex/www canonical pair. */
  allowCanonicalRedirect?: boolean;
  /** An active payload denied before evaluation is an unknown, not a pass. */
  forbiddenIsBlocked?: boolean;
};

const finalResponseUrls = new WeakMap<Response, string>();

function snapshotCoverage(coverage: RequestCoverage): RequestCoverage {
  return { ...coverage };
}

function coverageSince(
  coverage: RequestCoverage,
  baseline: RequestCoverage,
): ScanPhaseRequestCoverage {
  return {
    requestsAttempted: coverage.requestsAttempted - baseline.requestsAttempted,
    requestsCompleted: coverage.requestsCompleted - baseline.requestsCompleted,
    requestsFailed: coverage.requestsFailed - baseline.requestsFailed,
    requestsBlocked: coverage.requestsBlocked - baseline.requestsBlocked,
  };
}

function notifyActivePhase(context: ScanRequestContext | undefined): void {
  const active = context?.activePhase;
  if (!context || !active) return;
  active.emit({
    status: 'progress',
    coverage: coverageSince(context.coverage, active.baseline),
    durationMs: Date.now() - active.startedAt,
    reason: active.reason,
  });
}

function incrementCoverage(
  context: ScanRequestContext | undefined,
  key: keyof RequestCoverage,
): void {
  if (!context) return;
  context.coverage[key]++;
  notifyActivePhase(context);
}

function markCurrentPhaseIncomplete(reason: string): void {
  const context = scanRequestContext.getStore();
  const active = context?.activePhase;
  if (!context || !active) return;
  active.reason ??= reason;
  notifyActivePhase(context);
}

function isCanonicalHostPair(left: string, right: string): boolean {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a === b || `www.${a}` === b || `www.${b}` === a;
}

function parseScanUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS scan targets are allowed');
  }
  if (url.username || url.password) {
    throw new Error('Scan targets cannot contain embedded credentials');
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new Error('Only standard web ports 80 and 443 are allowed');
  }
  return url;
}

async function safeFetch(url: string, options?: SafeFetchOptions): Promise<Response | null> {
  const context = scanRequestContext.getStore();
  try {
    const {
      maxResponseBytes = DEFAULT_TRANSPORT_BODY_BYTES,
      allowCanonicalRedirect = false,
      forbiddenIsBlocked = false,
      ...requestOptions
    } = options ?? {};
    const requestedRedirectMode = requestOptions.redirect ?? 'follow';
    let currentUrl = parseScanUrl(url);
    const initialHostname = currentUrl.hostname.toLowerCase();
    const authorizedHostnames = context?.authorizedHostnames ?? new Set([initialHostname]);
    if (!authorizedHostnames.has(initialHostname)) {
      incrementCoverage(context, 'requestsBlocked');
      return null;
    }
    let method = requestOptions.method?.toUpperCase() ?? 'GET';
    let body = requestOptions.body;

    const headers = new Headers(requestOptions.headers);
    // Defaulting to the surface string when there is no scan context is
    // deliberate: an unattributed request must never claim authorisation.
    if (!headers.has('user-agent')) {
      headers.set('user-agent', LANE_USER_AGENTS[context?.lane ?? 'surface']);
    }

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      if (context && Date.now() >= context.deadlineAt) {
        context.deadlineExceeded = true;
        incrementCoverage(context, 'requestsFailed');
        return null;
      }
      // Resolve, validate, and pin every socket immediately before the request,
      // including redirects, so DNS rebinding cannot swap in a private address.
      incrementCoverage(context, 'requestsAttempted');

      const remainingBudget = context ? Math.max(1, context.deadlineAt - Date.now()) : TIMEOUT;
      const res = await (context?.transport ?? pinnedFetch)(currentUrl, {
        ...requestOptions,
        method,
        body,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.min(TIMEOUT, remainingBudget)),
        maxResponseBytes,
      });
      finalResponseUrls.set(res, currentUrl.href);
      // Completed transport and usable security evidence are different. A
      // rate-limit, explicit bot challenge or server failure must remain a
      // visible coverage gap instead of becoming a clean check.
      incrementCoverage(context, 'requestsCompleted');
      const responseOutcome = classifyProbeResponse(res.status, res.headers, { forbiddenIsBlocked });
      if (responseOutcome === 'blocked') incrementCoverage(context, 'requestsBlocked');
      if (responseOutcome === 'failed') incrementCoverage(context, 'requestsFailed');

      const isRedirect = res.status >= 300 && res.status < 400;
      const location = res.headers.get('location');
      if (responseOutcome === 'blocked') {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      if (!isRedirect || !location || requestedRedirectMode === 'manual') return res;
      if (requestedRedirectMode === 'error') {
        incrementCoverage(context, 'requestsFailed');
        return null;
      }
      if (redirectCount === MAX_REDIRECTS) {
        incrementCoverage(context, 'requestsFailed');
        return null;
      }

      const redirectUrl = parseScanUrl(new URL(location, currentUrl).href);
      // Domain-control verification applies to one exact host. Never forward
      // active payloads to a different host merely because the verified site
      // redirects there.
      if (currentUrl.protocol === 'https:' && redirectUrl.protocol !== 'https:') {
        incrementCoverage(context, 'requestsBlocked');
        return null;
      }
      const redirectHostname = redirectUrl.hostname.toLowerCase();
      if (!authorizedHostnames.has(redirectHostname)) {
        const canAdoptCanonical = allowCanonicalRedirect
          && method === 'GET'
          && body === undefined
          && isCanonicalHostPair(initialHostname, redirectHostname);
        if (!canAdoptCanonical) {
          incrementCoverage(context, 'requestsBlocked');
          return null;
        }
        authorizedHostnames.add(redirectHostname);
      }
      await res.body?.cancel().catch(() => undefined);
      currentUrl = redirectUrl;

      // Match fetch redirect semantics for POST responses. The deep scanner
      // never sends replay-safe streaming bodies, so clearing the body here is
      // both compatible and avoids forwarding it unexpectedly.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
        headers.delete('content-length');
        headers.delete('content-type');
      }
    }

    return null;
  } catch {
    if (context) {
      if (Date.now() >= context.deadlineAt) context.deadlineExceeded = true;
      incrementCoverage(context, 'requestsFailed');
    }
    return null;
  }
}

function recordProbeBodyFailure(): void {
  const context = scanRequestContext.getStore();
  incrementCoverage(context, 'requestsFailed');
}

async function readBoundedProbeText(response: Response, maxBytes: number): Promise<string | null> {
  try {
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      recordProbeBodyFailure();
      return null;
    }
    if (!response.body) return '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let value = '';
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        recordProbeBodyFailure();
        return null;
      }
      value += decoder.decode(chunk, { stream: true });
    }
    return value + decoder.decode();
  } catch {
    recordProbeBodyFailure();
    return null;
  }
}

async function readProbeText(response: Response): Promise<string> {
  return await readBoundedProbeText(response, MAX_PROBE_BODY_BYTES) ?? '';
}

/**
 * A differential finding is meaningful only when its benign control produced
 * a usable, bounded response. Transport failures, challenges and server
 * errors make that one probe family inconclusive; they must never be treated
 * as an empty control body.
 */
async function readDifferentialControl(
  response: Response | null,
  checkLabel: string,
  maxBytes = DIFFERENTIAL_BODY_BYTES,
): Promise<string | null> {
  if (!response || classifyProbeResponse(response.status, response.headers) !== 'completed') {
    markCurrentPhaseIncomplete(`${checkLabel} control request did not return a usable response`);
    return null;
  }

  const body = await readBoundedProbeText(response, maxBytes);
  if (body === null) {
    markCurrentPhaseIncomplete(`${checkLabel} control response could not be read within the safety limit`);
    return null;
  }
  return body;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  worker: (value: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(values.length);
  let next = 0;
  async function runWorker() {
    while (next < values.length) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await worker(values[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, runWorker));
  return results;
}

// ── Sensitive file exposure ────────────────────────────────────────────────

const SENSITIVE_FILES: {
  path: string;
  title: string;
  severity: DeepFinding['severity'];
  description: string;
  remediation: string;
}[] = [
  {
    path: '/.env',
    title: 'Environment File Exposed',
    severity: 'critical',
    description: 'The .env file is publicly accessible and may contain API keys, database credentials, and secrets.',
    remediation: 'Block access to .env files in your server/CDN config. Never commit secrets to version control.',
  },
  {
    path: '/.env.local',
    title: 'Local Environment File Exposed',
    severity: 'critical',
    description: '.env.local is accessible and likely contains local development secrets.',
    remediation: 'Block access to all .env* files in your server configuration.',
  },
  {
    path: '/.env.production',
    title: 'Production Environment File Exposed',
    severity: 'critical',
    description: '.env.production is publicly accessible and likely contains production credentials.',
    remediation: 'Block access to all .env* files. Rotate any exposed credentials immediately.',
  },
  {
    path: '/.git/config',
    title: 'Git Configuration Publicly Readable',
    severity: 'high',
    description: 'Git repository config is accessible. This can expose remote URLs and potentially embedded credentials.',
    remediation: 'Block access to the .git directory entirely in your server configuration.',
  },
  {
    path: '/.git/HEAD',
    title: 'Git HEAD Reference Publicly Readable',
    severity: 'high',
    description: 'Git repository data is accessible, which may allow partial source code reconstruction.',
    remediation: 'Block the entire .git directory. Add a server rule to deny all /.git/* requests.',
  },
  {
    path: '/wp-config.php',
    title: 'WordPress Config Exposed',
    severity: 'critical',
    description: 'WordPress configuration file is accessible, exposing database credentials and secret keys.',
    remediation: 'Move wp-config.php above the webroot, or block access via server configuration.',
  },
  {
    path: '/phpinfo.php',
    title: 'PHP Info Page Exposed',
    severity: 'high',
    description: 'phpinfo() exposes server configuration, PHP version, loaded modules, and environment variables.',
    remediation: 'Remove phpinfo.php from the webroot immediately.',
  },
  {
    path: '/info.php',
    title: 'PHP Info Page Exposed',
    severity: 'high',
    description: 'A PHP info page is publicly accessible.',
    remediation: 'Remove info.php from the webroot.',
  },
  // /server-status is checked separately with content verification, because a 200
  // that doesn't contain actual Apache mod_status output is not a finding.
  {
    path: '/backup.sql',
    title: 'Database Backup Exposed',
    severity: 'critical',
    description: 'A database backup file is publicly accessible. This gives attackers full database access.',
    remediation: 'Never store database backups in web-accessible directories. Move them immediately.',
  },
  {
    path: '/dump.sql',
    title: 'Database Dump Exposed',
    severity: 'critical',
    description: 'A database dump is publicly accessible.',
    remediation: 'Remove this file from the webroot and rotate all exposed credentials.',
  },
  {
    path: '/database.sql',
    title: 'Database File Exposed',
    severity: 'critical',
    description: 'A database file is publicly accessible.',
    remediation: 'Never store database files in web-accessible directories.',
  },
  {
    path: '/.htaccess',
    title: 'Apache .htaccess Exposed',
    severity: 'medium',
    description: '.htaccess is accessible, revealing server configuration, URL rewrite rules, and access controls.',
    remediation: 'Configure Apache to block access to .htaccess files.',
  },
  {
    path: '/config.json',
    title: 'Config JSON Exposed',
    severity: 'high',
    description: 'A JSON configuration file is accessible and may contain sensitive settings.',
    remediation: 'Move config files outside the webroot or restrict access.',
  },
  {
    path: '/.DS_Store',
    title: 'macOS .DS_Store Exposed',
    severity: 'low',
    description: '.DS_Store reveals directory structure metadata and filenames.',
    remediation: 'Add .DS_Store to .gitignore and block access via server config.',
  },
  // crossdomain.xml is checked separately with content analysis, not via the static list
  // because a restrictive policy file is not a vulnerability.
  {
    path: '/.npmrc',
    title: 'npm Config File Exposed',
    severity: 'critical',
    description: '.npmrc is accessible and may contain npm authentication tokens used to publish packages or access private registries.',
    remediation: 'Block access to .npmrc in your server config. Rotate any exposed npm tokens immediately.',
  },
  {
    path: '/docker-compose.yml',
    title: 'Docker Compose File Exposed',
    severity: 'high',
    description: 'docker-compose.yml is publicly accessible and may reveal internal service names, ports, credentials, and infrastructure layout.',
    remediation: 'Block access to docker-compose.yml and all infrastructure config files.',
  },
  {
    path: '/Dockerfile',
    title: 'Dockerfile Exposed',
    severity: 'medium',
    description: 'The Dockerfile is publicly accessible. This reveals base image, build steps, installed packages, and potentially hardcoded values.',
    remediation: 'Block access to Dockerfile and infrastructure files. Never bake secrets into image layers.',
  },
  {
    path: '/.travis.yml',
    title: 'CI Config Exposed',
    severity: 'medium',
    description: '.travis.yml is accessible and may expose deployment scripts, environment variable names, or CI/CD pipeline structure.',
    remediation: 'Block access to CI configuration files. Store secrets in encrypted environment variables, not in config files.',
  },
  {
    path: '/config/database.yml',
    title: 'Rails Database Config Exposed',
    severity: 'critical',
    description: 'Rails database.yml is publicly accessible and may contain database connection strings, credentials, and hostnames.',
    remediation: 'Block access to the config directory. Use environment variables for credentials rather than hardcoding in database.yml.',
  },
  {
    path: '/storage.json',
    title: 'Storage Config Exposed',
    severity: 'high',
    description: 'A storage configuration file is accessible and may contain project credentials or service account keys.',
    remediation: 'Block access to all JSON config files not intended for public consumption.',
  },
];

const MAX_SENSITIVE_FILE_BYTES = 128_000;

async function readBoundedBody(response: Response): Promise<string | null> {
  return readBoundedProbeText(response, MAX_SENSITIVE_FILE_BYTES);
}

async function checkSensitiveFiles(baseUrl: string): Promise<DeepFinding[]> {
  const results = await mapWithConcurrency(
    SENSITIVE_FILES,
    4,
    async (file) => {
      const url = `${baseUrl}${file.path}`;
      const res = await safeFetch(url, {
        redirect: 'follow',
        maxResponseBytes: MAX_SENSITIVE_FILE_BYTES,
      });
      return { file, res, url };
    },
  );

  const findings: DeepFinding[] = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { file, res, url } = r.value;
    if (res?.status === 200) {
      const body = await readBoundedBody(res);
      if (body === null) continue;
      const validation = validateSensitiveFileEvidence(file.path, body, res.headers.get('content-type') ?? '');
      if (!validation) continue;
      findings.push({
        id: `exposed-${file.path}`,
        category: 'exposed-files',
        severity: validation.severity ?? file.severity,
        title: file.title,
        description: validation.description ?? file.description,
        evidence: `GET ${url} → HTTP 200; ${validation.evidence}`,
        remediation: file.remediation,
        url,
      });
    }
  }
  return findings;
}

// ── CORS misconfiguration ─────────────────────────────────────────────────

async function checkCORS(baseUrl: string): Promise<DeepFinding[]> {
  const findings: DeepFinding[] = [];

  // Test null origin
  const nullRes = await safeFetch(baseUrl, { headers: { Origin: 'null' } });
  if (nullRes) {
    const acao = nullRes.headers.get('access-control-allow-origin');
    const acac = nullRes.headers.get('access-control-allow-credentials');
    if (acao === 'null' && acac === 'true') {
      findings.push({
        id: 'cors-null-origin',
        category: 'cors',
        severity: 'info',
        title: 'Credentialed Null-Origin CORS Policy Observed',
        description: 'The server allows the null origin together with credentials. This policy is risky, but this root-page response did not demonstrate exposure of authenticated or sensitive data.',
        evidence: 'Access-Control-Allow-Origin: null\nAccess-Control-Allow-Credentials: true',
        remediation: 'Do not allow credentialed null origins. Use an exact allowlist of trusted HTTPS origins.',
      });
    }
    // Wildcard on the HTML page itself is only a real issue if credentials are also allowed
    // Don't flag it on regular pages, only on API routes
  }

  // Test CORS on API endpoints, where a wildcard is actually dangerous
  const apiPaths = ['/api', '/api/user', '/api/me', '/api/auth', '/api/data'];
  for (const path of apiPaths) {
    const apiRes = await safeFetch(`${baseUrl}${path}`, {
      headers: { Origin: 'https://evil-attacker.com' },
    });
    if (!apiRes) continue;
    const acao = apiRes.headers.get('access-control-allow-origin');
    const acac = apiRes.headers.get('access-control-allow-credentials');

    if (acao === '*' && acac === 'true') {
      findings.push({
        id: 'cors-wildcard-credentials',
        category: 'cors',
        severity: 'info',
        title: 'API CORS Has an Ineffective Wildcard/Credentials Combination',
        description: `${path} returns Access-Control-Allow-Origin: * with Allow-Credentials: true. Browsers reject credentialed CORS with a wildcard origin, so this does not enable authenticated cross-origin reads; it is still a contradictory policy worth correcting.`,
        evidence: `GET ${baseUrl}${path}\nAccess-Control-Allow-Origin: *\nAccess-Control-Allow-Credentials: true`,
        remediation: 'Remove Allow-Credentials if the resource is intentionally public, or replace * with a strict allowlist when credentialed cross-origin access is required.',
        url: `${baseUrl}${path}`,
      });
      break;
    }

    if (apiRes.ok && acao === 'https://evil-attacker.com' && acac === 'true') {
      const contentType = apiRes.headers.get('content-type')?.toLowerCase() ?? '';
      const body = await readBoundedProbeText(apiRes, 64_000) ?? '';
      const sensitiveResponse = contentType.includes('application/json')
        && /"(?:email|phone|address|access[_-]?token|refresh[_-]?token|payment|billing|ssn|password)"\s*:/i.test(body);
      findings.push({
        id: 'cors-reflect-credentials',
        category: 'cors',
        severity: sensitiveResponse ? 'high' : 'info',
        title: sensitiveResponse
          ? 'Credentialed Cross-Origin Sensitive Response Observed'
          : 'Credentialed Origin Reflection Needs Review',
        description: sensitiveResponse
          ? `${path} reflected an untrusted Origin, allowed credentials, and returned sensitive-looking JSON fields.`
          : `${path} reflected an untrusted Origin and allowed credentials, but this unauthenticated response did not establish that authenticated or sensitive data is exposed.`,
        evidence: `GET ${baseUrl}${path}\nOrigin: https://evil-attacker.com\n→ Access-Control-Allow-Origin: https://evil-attacker.com\n→ Access-Control-Allow-Credentials: true`,
        remediation: 'Use a strict origin allowlist. Never combine Allow-Credentials: true with dynamic origin reflection.',
        url: `${baseUrl}${path}`,
      });
      break;
    }
  }

  return findings;
}

// ── Security headers ──────────────────────────────────────────────────────

async function checkSecurityHeaders(res: Response | null): Promise<DeepFinding[]> {
  if (!res) return [];

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    responseHeaders[name.toLowerCase()] = value;
  });
  const assessment = analyzeSecurityHeaders(responseHeaders, true);
  function headerSeverity(name: string, penalty: number): DeepFinding['severity'] {
    if (name === 'Content-Security-Policy') return penalty >= 20 ? 'medium' : 'low';
    if (
      name === 'Strict-Transport-Security'
      || name === 'X-Frame-Options'
      || name === 'X-Content-Type-Options'
    ) return 'low';
    return 'info';
  }

  return assessment.headers
    .filter(header => (header.penaltyApplied ?? 0) > 0)
    .map(header => ({
      id: `header-${header.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      category: 'headers',
      severity: headerSeverity(header.name, header.penaltyApplied ?? 0),
      title: `${header.present ? 'Weak or Invalid' : 'Missing'} ${header.name}`,
      description: `${header.details ?? 'The intended browser hardening control was not observed.'} This is a defence-in-depth observation, not proof of an exploitable vulnerability.`,
      evidence: header.value ? `${header.name}: ${header.value.slice(0, 240)}` : undefined,
      remediation: header.recommendation,
    }));
}

// ── Cookie security ───────────────────────────────────────────────────────

function setCookieHeaders(res: Response | null): string[] {
  if (!res) return [];
  const cookieHeaders: string[] = [];
  try {
    const all = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.();
    if (all?.length) cookieHeaders.push(...all);
  } catch { /* fall through to the single-header API */ }
  if (!cookieHeaders.length) {
    const raw = res.headers.get('set-cookie');
    if (raw) cookieHeaders.push(raw);
  }
  return cookieHeaders;
}

async function checkCookies(res: Response | null): Promise<DeepFinding[]> {
  const cookieHeaders = setCookieHeaders(res);
  if (!cookieHeaders.length) return [];

  const findings: DeepFinding[] = [];

  for (const cookie of cookieHeaders) {
    const assessment = assessSetCookie(cookie);
    if (!assessment) continue;
    const { name, attributes, isAuth, issues } = assessment;

    if (issues.includes('missing_httponly')) {
      findings.push({
        id: `cookie-httponly-${name}`,
        category: 'cookies',
        severity: 'high',
        title: `Auth Cookie Missing HttpOnly: ${name}`,
        description: `"${name}" appears to be a session/auth cookie but lacks HttpOnly, so JavaScript can steal it during an XSS attack.`,
        evidence: `Set-Cookie: ${name}=<redacted>; ${attributes.join('; ') || 'no security attributes'}`,
        remediation: 'Add the HttpOnly flag to all session and authentication cookies.',
      });
    }

    if (issues.includes('missing_secure') && !issues.includes('samesite_none_without_secure')) {
      findings.push({
        id: `cookie-secure-${name}`,
        category: 'cookies',
        severity: isAuth ? 'medium' : 'info',
        title: `Cookie Missing Secure Flag: ${name}`,
        description: isAuth
          ? `"${name}" appears authentication-related and lacks the Secure flag, so it can be transmitted if the site is reached over plain HTTP.`
          : `"${name}" lacks the Secure flag. Its impact depends on whether the cookie carries sensitive or security-relevant state.`,
        evidence: `Set-Cookie: ${name}=<redacted>; ${attributes.join('; ') || 'no security attributes'}`,
        remediation: 'Add the Secure flag to all cookies with sensitive data.',
      });
    }

    if (issues.includes('missing_samesite')) {
      findings.push({
        id: `cookie-samesite-${name}`,
        category: 'cookies',
        severity: isAuth ? 'low' : 'info',
        title: `Cookie Missing SameSite: ${name}`,
        description: `"${name}" has no explicit SameSite attribute. Modern browsers commonly apply a Lax default, but an explicit setting makes intended cross-site behavior auditable; this observation alone does not prove CSRF exposure.`,
        evidence: `Set-Cookie: ${name}=<redacted>; ${attributes.join('; ') || 'no security attributes'}`,
        remediation: 'Add SameSite=Lax (or Strict) to cookies. Use SameSite=None only with Secure for cross-site cookies.',
      });
    }

    if (issues.includes('invalid_samesite') || issues.includes('samesite_none_without_secure')) {
      findings.push({
        id: `cookie-samesite-${name}`,
        category: 'cookies',
        severity: isAuth ? 'medium' : 'low',
        title: issues.includes('samesite_none_without_secure')
          ? `SameSite=None Cookie Missing Secure: ${name}`
          : `Cookie Has Invalid SameSite Value: ${name}`,
        description: issues.includes('samesite_none_without_secure')
          ? `"${name}" uses SameSite=None without Secure, a combination modern browsers reject. The cookie may be dropped instead of providing the intended cross-site behavior.`
          : `"${name}" has a SameSite attribute whose value is not Lax, Strict, or None, so its cross-site behavior is not expressed correctly.`,
        evidence: `Set-Cookie: ${name}=<redacted>; ${attributes.join('; ') || 'no security attributes'}`,
        remediation: 'Use SameSite=Lax or Strict where possible. If cross-site use requires SameSite=None, also set Secure.',
      });
    }

    if (issues.includes('invalid_host_prefix') || issues.includes('invalid_secure_prefix')) {
      findings.push({
        id: `cookie-prefix-${name}`,
        category: 'cookies',
        severity: isAuth ? 'medium' : 'low',
        title: `Cookie Prefix Contract Is Invalid: ${name}`,
        description: name.toLowerCase().startsWith('__host-')
          ? 'A __Host- cookie must use Secure and Path=/ and must not set Domain. The observed attributes do not meet that browser-enforced contract.'
          : 'A __Secure- cookie must use Secure. The observed attributes do not meet that browser-enforced contract.',
        evidence: `Set-Cookie: ${name}=<redacted>; ${attributes.join('; ') || 'no security attributes'}`,
        remediation: name.toLowerCase().startsWith('__host-')
          ? 'Set Secure and Path=/, remove Domain, or remove the __Host- prefix.'
          : 'Set Secure or remove the __Secure- prefix.',
      });
    }
  }

  return findings;
}

// ── Information disclosure ────────────────────────────────────────────────

async function checkInfoDisclosure(res: Response | null): Promise<DeepFinding[]> {
  const findings: DeepFinding[] = [];
  if (!res) return findings;

  const server = res.headers.get('server');
  const xpb = res.headers.get('x-powered-by');
  const aspnet = res.headers.get('x-aspnet-version');

  if (server && /\d/.test(server)) {
    findings.push({
      id: 'info-server-version',
      category: 'info-disclosure',
      severity: 'info',
      title: 'Server Version Disclosed',
      description: `The Server header advertises a version-like value: "${server}". This is reconnaissance context, not evidence that a vulnerable component or code path is present.`,
      evidence: `Server: ${server}`,
      remediation: 'Suppress or genericize the Server header in your web server config.',
    });
  }

  if (xpb) {
    findings.push({
      id: 'info-x-powered-by',
      category: 'info-disclosure',
      severity: 'info',
      title: 'Technology Disclosed via X-Powered-By',
      description: `X-Powered-By advertises the technology stack: "${xpb}". This is reconnaissance context and does not establish an exploitable condition.`,
      evidence: `X-Powered-By: ${xpb}`,
      remediation: 'Remove the X-Powered-By header.',
    });
  }

  if (aspnet) {
    findings.push({
      id: 'info-aspnet-version',
      category: 'info-disclosure',
      severity: 'info',
      title: 'ASP.NET Version Disclosed',
      description: `X-AspNet-Version advertises a .NET version: "${aspnet}". Confirm the deployed runtime and patch status separately; the header alone is not vulnerability evidence.`,
      evidence: `X-AspNet-Version: ${aspnet}`,
      remediation: 'Disable via web.config: <httpRuntime enableVersionHeader="false"/>',
    });
  }

  return findings;
}

// ── SSL / HTTPS enforcement ───────────────────────────────────────────────

async function checkSSL(domain: string): Promise<DeepFinding[]> {
  const findings: DeepFinding[] = [];

  const httpRes = await safeFetch(`http://${domain}`, {
    redirect: 'follow',
    allowCanonicalRedirect: true,
    maxResponseBytes: 64_000,
  });
  if (httpRes) {
    const finalUrl = new URL(finalResponseUrls.get(httpRes) ?? `http://${domain}`);
    if (finalUrl.protocol === 'http:' && httpRes.ok) {
      findings.push({
        id: 'ssl-http-accessible',
        category: 'ssl',
        severity: 'high',
        title: 'Site Accessible over HTTP',
        description: 'The site responds to plain HTTP without redirecting to HTTPS. Traffic can be intercepted.',
        evidence: `http://${domain} remained on plain HTTP and returned ${httpRes.status}`,
        remediation: 'Add a 301 redirect from HTTP to HTTPS for all requests.',
      });
    } else if (finalUrl.protocol === 'http:') {
      findings.push({
        id: 'ssl-http-not-redirected',
        category: 'ssl',
        severity: 'info',
        title: 'Plain HTTP Did Not Redirect to HTTPS',
        description: `The bounded redirect chain ended on plain HTTP with status ${httpRes.status}. The response may be intentionally blocked and this does not prove content is exposed, but a blanket HTTPS upgrade gives clients a clearer path.`,
        evidence: `http://${domain} ended at ${finalUrl.origin} with HTTP ${httpRes.status}`,
        remediation: 'Prefer redirecting every plain-HTTP request to the equivalent HTTPS URL, or document and test an intentional hard rejection policy.',
      });
    }
  }

  return findings;
}

// ── robots.txt sensitive path leak ────────────────────────────────────────

async function checkRobotsTxt(baseUrl: string): Promise<DeepFinding[]> {
  const res = await safeFetch(`${baseUrl}/robots.txt`);
  if (!res || res.status !== 200) return [];

  const text = await readProbeText(res);
  // Report only non-obvious paths as context; their access controls determine
  // whether anything is actually exposed.
  // /admin, /login, /dashboard are universally guessed, so listing them adds no signal
  // and Disallow: /admin is actually best practice. Focus on specific, unusual paths.
  const sensitiveRe = /\/backup|\/database|\/private|\/secret|\/internal|\/staging|\/\.git|\/config\/|\/api\/internal|\/dev\//i;

  const disallowed = text
    .split('\n')
    .filter(l => l.trim().toLowerCase().startsWith('disallow:'))
    .map(l => l.replace(/disallow:/i, '').trim())
    .filter(p => sensitiveRe.test(p));

  if (!disallowed.length) return [];

  return [
    {
      id: 'robots-sensitive-paths',
      category: 'info-disclosure',
      severity: 'info',
      title: 'robots.txt Reveals Non-Obvious Sensitive Paths',
      description: `robots.txt lists potentially internal paths: ${disallowed.join(', ')}. These paths are reconnaissance context; they may already be guessable and are not exposures unless their own access controls fail.`,
      evidence: disallowed.map(p => `Disallow: ${p}`).join('\n'),
      remediation: 'Remove non-obvious internal paths from robots.txt. Security should not depend on obscurity; protect these endpoints with authentication instead.',
    },
  ];
}

// crossdomain.xml: content-aware check

async function checkCrossdomain(baseUrl: string): Promise<DeepFinding[]> {
  const res = await safeFetch(`${baseUrl}/crossdomain.xml`);
  if (!res || res.status !== 200) return [];
  const text = await readProbeText(res);
  // Only flag if the policy actually allows broad cross-domain access
  const isPermissive = /allow-access-from\s+domain=["']\*["']/i.test(text)
    || /allow-http-request-headers-from\s+domain=["']\*["']/i.test(text);
  if (!isPermissive) return [];
  return [{
    id: 'crossdomain-permissive',
    category: 'cors',
    severity: 'info',
    title: 'Permissive Legacy crossdomain.xml Policy',
    description: 'crossdomain.xml allows all domains (`domain="*"`). This is a legacy client policy, not a browser CORS result; remove or restrict it if any supported client still honours the file.',
    evidence: `GET ${baseUrl}/crossdomain.xml returned a wildcard allow-access policy. Response content was not retained.`,
    remediation: 'Replace `domain="*"` with a specific allowlist of trusted domains. If Flash/Silverlight is not used, remove the file entirely.',
    url: `${baseUrl}/crossdomain.xml`,
  }];
}

// Apache server-status: content-aware check

async function checkServerStatus(baseUrl: string): Promise<DeepFinding[]> {
  const res = await safeFetch(`${baseUrl}/server-status`);
  if (!res || res.status !== 200) return [];
  const text = await readProbeText(res);
  // Confirm this is actual Apache mod_status output, not just a 200 page
  const isRealStatus = /Apache\s+Server\s+Status|Current\s+Time.*Server\s+uptime|requests\s+currently\s+being\s+processed/i.test(text);
  if (!isRealStatus) return [];
  return [{
    id: 'server-status-exposed',
    category: 'info-disclosure',
    severity: 'high',
    title: 'Apache Server Status Page Exposed',
    description: 'Apache mod_status is publicly accessible, exposing real-time server info: active connections, request URIs, worker states, and client IPs, all useful for targeted attacks.',
    evidence: `GET ${baseUrl}/server-status → 200 (Apache mod_status content confirmed)`,
    remediation: 'Restrict /server-status to localhost or trusted IPs: `Require ip 127.0.0.1`',
    url: `${baseUrl}/server-status`,
  }];
}

// ── Admin path discovery ──────────────────────────────────────────────────

// Only paths that are unambiguously admin or management software, not generic app routes
// like /dashboard (user dashboards) or /portal (marketing pages), /root, /manager
const ADMIN_PATHS = [
  '/admin', '/admin/', '/administrator', '/administrator/',
  '/wp-admin', '/wp-admin/',
  '/cpanel', '/phpmyadmin', '/phpmyadmin/', '/pma', '/pma/',
  '/admin/login', '/adminpanel', '/controlpanel', '/superadmin',
  '/manager/html', '/manager/text',  // Tomcat manager, specific path
  '/cms', '/cms/',
];

// Patterns that confirm the page is actually an admin panel with live content
const ADMIN_CONTENT_INDICATORS = [
  /phpMyAdmin/i,
  /cPanel/i,
  /Plesk\b/,
  /WHM\b/,
  /Webmin/i,
  /id=["']wpadminbar["']/i,
  /id=["']wpwrap["']/i,
];

const ADMIN_PRIVILEGED_INDICATORS = [
  /href=["'][^"']*(?:logout|signout)/i,
  /(?:create|delete|disable|suspend)\s+(?:user|account|database|site)/i,
  /(?:drop|truncate|alter)\s+(?:table|database)/i,
  /name=["'](?:delete|remove|role|permissions?)["']/i,
  /id=["'](?:database|user|site)[-_](?:list|management|actions?)["']/i,
];

// Patterns that indicate the page is merely a login gate (admin IS protected)
const LOGIN_GATE_PATTERNS = [
  /type=["']password["']/i,
  /<form\b[^>]*(?:action=["'][^"']*(?:login|signin)|id=["'](?:login|signin))/i,
];

async function checkAdminPaths(baseUrl: string): Promise<DeepFinding[]> {
  const results = await Promise.allSettled(
    ADMIN_PATHS.map(async (path) => {
      const res = await safeFetch(`${baseUrl}${path}`, { redirect: 'follow' });
      if (!res || res.status !== 200) return { path, exposed: false };

      // A reachable login form is not an exposure. Require body evidence of
      // actual management functionality for every path, including well-known
      // WordPress, cPanel, phpMyAdmin, and Tomcat locations.
      const text = await readProbeText(res);
      const isLoginGate = LOGIN_GATE_PATTERNS.some(re => re.test(text));
      if (isLoginGate) return { path, exposed: false };

      const hasAdminContent = ADMIN_CONTENT_INDICATORS.some(re => re.test(text))
        && ADMIN_PRIVILEGED_INDICATORS.some(re => re.test(text));
      return { path, exposed: hasAdminContent };
    })
  );

  const exposed = results
    .filter(r => r.status === 'fulfilled' && r.value.exposed)
    .map(r => (r as PromiseFulfilledResult<{ path: string; exposed: boolean }>).value.path);

  if (!exposed.length) return [];

  return [{
    id: 'admin-paths-exposed',
    category: 'exposed-files',
    severity: 'high',
    title: `Apparent Unauthenticated Admin Content: ${exposed.slice(0, 3).join(', ')}${exposed.length > 3 ? '…' : ''}`,
    description: `${exposed.length} admin path${exposed.length > 1 ? 's' : ''} returned HTTP 200 with management-interface markers and no visible login gate. Validate in an authorised browser session that functional privileged content is actually available before assigning impact.`,
    evidence: exposed.map(p => `GET ${baseUrl}${p} → 200 OK (admin content confirmed)`).join('\n'),
    remediation: 'Restrict admin paths to specific IP ranges, require authentication, or move them to a non-public subdomain.',
  }];
}

// ── SQL injection error detection ─────────────────────────────────────────

const SQL_PAYLOADS = ["'", "1'", `"`, `1 OR 1=1`, `' OR '1'='1`];
const SQL_ERROR_PATTERNS = [
  /sql syntax/i, /mysql_fetch/i, /ORA-\d{5}/i, /pg_query/i,
  /sqlite_/i, /SQLSTATE/i, /syntax error.*near/i, /unclosed quotation/i,
  /Microsoft.*ODBC.*SQL/i, /Warning.*mysql/i, /valid MySQL result/i,
];

async function checkSQLInjection(baseUrl: string): Promise<DeepFinding[]> {
  // Look for forms or query parameters in common endpoints
  const testPaths = ['/?id=', '/search?q=', '/product?id=', '/user?id=', '/page?id=', '/item?id='];

  for (const path of testPaths) {
    const controlUrl = `${baseUrl}${path}${encodeURIComponent('ironclad-control-value')}`;
    const controlRes = await safeFetch(controlUrl, {
      maxResponseBytes: DIFFERENTIAL_BODY_BYTES,
      forbiddenIsBlocked: true,
    });
    const controlText = await readDifferentialControl(controlRes, 'SQL injection');
    if (controlText === null) continue;
    for (const payload of SQL_PAYLOADS) {
      const url = `${baseUrl}${path}${encodeURIComponent(payload)}`;
      const res = await safeFetch(url, {
        maxResponseBytes: DIFFERENTIAL_BODY_BYTES,
        forbiddenIsBlocked: true,
      });
      if (!res) continue;
      const text = await readBoundedProbeText(res, DIFFERENTIAL_BODY_BYTES);
      if (text === null) continue;
      if (hasDifferentialSignature(text, controlText, SQL_ERROR_PATTERNS)) {
        return [{
          id: 'sqli-error-based',
          category: 'info-disclosure',
          severity: 'medium',
          title: 'Database Error Disclosed After Crafted Input',
          description: 'A SQL-shaped error string appeared after crafted input. This may expose implementation details, but one error response does not prove injectable query execution or database compromise without a differential control and exploit confirmation.',
          evidence: `GET ${url}\nA SQL error signature appeared only after crafted input. Response content was not retained.`,
          remediation: 'Use parameterised queries / prepared statements. Never concatenate user input into SQL strings. Enable generic error pages in production.',
          url,
        }];
      }
    }
  }
  return [];
}

// ── Error verbosity / stack trace disclosure ──────────────────────────────

async function checkErrorVerbosity(baseUrl: string): Promise<DeepFinding[]> {
  const testUrls = [
    `${baseUrl}/this-page-does-not-exist-xyz123`,
    `${baseUrl}/api/nonexistent`,
    `${baseUrl}/?debug=true`,
  ];

  const STACK_PATTERNS = [
    /at \w+\.?\w* \(.+:\d+:\d+\)/,        // JS stack trace
    /Traceback \(most recent call last\)/i, // Python
    /Exception in thread/i,                 // Java
    /System\.Exception/i,                   // .NET
    /Fatal error:/i,                         // PHP
    /undefined method/i,                    // Ruby
    /stack trace:/i,
    /at line \d+ in/i,
  ];

  for (const url of testUrls) {
    const res = await safeFetch(url);
    if (!res) continue;
    const text = await readProbeText(res);
    const match = STACK_PATTERNS.find(re => re.test(text));
    if (match) {
      return [{
        id: 'error-stack-trace',
        category: 'info-disclosure',
        severity: 'medium',
        title: 'Stack Trace / Verbose Error Disclosed',
        description: 'The server returns detailed error messages or stack traces to the public. These reveal internal file paths, library versions, and code structure.',
        evidence: `GET ${url}\nA stack-trace signature was observed. Response content and internal paths were not retained.`,
        remediation: 'Set production error handling to return generic messages. Log detailed errors server-side only.',
        url,
      }];
    }
  }
  return [];
}

// ── Open redirect ─────────────────────────────────────────────────────────

async function checkOpenRedirect(baseUrl: string): Promise<DeepFinding[]> {
  const REDIRECT_PARAMS = ['?redirect=', '?url=', '?next=', '?return=', '?returnUrl=', '?goto=', '?continue='];
  const TARGET = 'https://evil-attacker-test.com';

  for (const param of REDIRECT_PARAMS) {
    const url = `${baseUrl}${param}${encodeURIComponent(TARGET)}`;
    const res = await safeFetch(url, { redirect: 'manual' });
    if (!res) continue;
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') ?? '';
      let redirectsToTestHost = false;
      try {
        redirectsToTestHost = new URL(loc, url).hostname.toLowerCase() === 'evil-attacker-test.com';
      } catch {
        redirectsToTestHost = false;
      }
      if (redirectsToTestHost) {
        return [{
          id: 'open-redirect',
          category: 'authentication',
          severity: 'medium',
          title: 'Open Redirect Vulnerability',
          description: `The ${param.replace('?','').replace('=','')} parameter is not validated and redirects to arbitrary external URLs. Attackers use this for phishing by sending links that appear to originate from your domain.`,
          evidence: `GET ${url}\n→ ${res.status} Location: ${loc}`,
          remediation: 'Validate redirect URLs against an allowlist of trusted destinations. Reject any URL pointing outside your domain.',
          url,
        }];
      }
    }
  }
  return [];
}

// ── Directory listing ─────────────────────────────────────────────────────

async function checkDirectoryListing(baseUrl: string): Promise<DeepFinding[]> {
  const paths = ['/uploads/', '/static/', '/assets/', '/files/', '/images/', '/media/', '/backup/', '/logs/'];
  const DIR_PATTERNS = [/Index of\s+\//i, /\[To Parent Directory\]/i, /Parent Directory<\/a>/i, /<title>Index of/i];

  for (const path of paths) {
    const res = await safeFetch(`${baseUrl}${path}`);
    if (!res || res.status !== 200) continue;
    const text = await readProbeText(res);
    if (DIR_PATTERNS.some(re => re.test(text))) {
      return [{
        id: 'directory-listing',
        category: 'info-disclosure',
        severity: 'medium',
        title: `Directory Listing Enabled: ${path}`,
        description: `Directory listing is enabled at ${path}. Attackers can browse all files in this directory, potentially finding backups, configs, or sensitive data.`,
        evidence: `GET ${baseUrl}${path} → 200 with directory listing HTML`,
        remediation: 'Disable directory listing in your web server config (e.g., `Options -Indexes` in Apache, `autoindex off` in Nginx).',
        url: `${baseUrl}${path}`,
      }];
    }
  }
  return [];
}

// ── Vibe-code specific checks ─────────────────────────────────────────────

async function checkVibeCodePatterns(baseUrl: string, html: string): Promise<DeepFinding[]> {
  const findings: DeepFinding[] = [];
  if (!html) return findings;

  const modernSupabaseSecret = html.match(/sb_secret_[A-Za-z0-9_-]{20,}/)?.[0];
  if (modernSupabaseSecret) {
    findings.push({
      id: 'vibe-supabase-modern-secret',
      category: 'exposed-files',
      severity: 'critical',
      title: 'Supabase Secret Key Exposed in Client Code',
      description: 'A modern Supabase secret key is embedded in code delivered to the browser. Secret keys are server-only credentials and may authorize privileged project operations.',
      evidence: 'A value beginning with sb_secret_ was found in browser-delivered code. The value was not retained.',
      remediation: 'Rotate the secret key in Supabase immediately. Remove it from browser bundles and source maps, then move privileged Supabase calls into authenticated server-only code.',
    });
  }

  // Exposed Supabase URL plus a legacy public or service-role JWT.
  const supabaseUrl = html.match(/https:\/\/[a-z0-9]+\.supabase\.co/);
  const legacyRoles = (html.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? [])
    .map(value => {
      try {
        return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')).role as unknown;
      } catch {
        return null;
      }
    });
  const legacyRole = legacyRoles.includes('service_role')
    ? 'service_role'
    : legacyRoles.includes('anon')
      ? 'anon'
      : null;
  if (supabaseUrl && legacyRole) {
    const isServiceRole = legacyRole === 'service_role';

    if (isServiceRole) {
      findings.push({
        id: 'vibe-supabase-service-role',
        category: 'exposed-files',
        severity: 'critical',
        title: 'Supabase Service Role Key Exposed in Client Code',
        description: 'A Supabase service-role key is embedded in code delivered to the browser. This server-only key bypasses Row Level Security and can authorize privileged database operations.',
        evidence: `Supabase URL: ${supabaseUrl[0]}\nA service-role JWT was found in browser-delivered code. The value was not retained.`,
        remediation: '1. Rotate the key immediately in Supabase → Project Settings → API.\n2. Never use the service_role key client-side; only use the anon key in the browser.\n3. Move service_role to server-side only (API routes, server components).',
      });
    } else {
      findings.push({
        id: 'vibe-supabase-anon-key',
        category: 'info-disclosure',
        severity: 'info',
        title: 'Supabase Anon Key Visible in Client Code',
        description: 'The Supabase anon key is embedded in code delivered to the browser. This is expected for client-side Supabase usage; security depends on Row Level Security policies.',
        evidence: `Supabase project: ${supabaseUrl[0]}`,
        remediation: 'Verify your Supabase tables have RLS enabled with appropriate policies. The anon key is safe to expose, but RLS must be configured correctly.',
      });
    }
  }

  // Exposed Firebase config
  const firebaseConfig = html.match(/["']?apiKey["']?\s*:\s*["']AIza[A-Za-z0-9_-]{35}["']/);
  if (firebaseConfig) {
    findings.push({
      id: 'vibe-firebase-config',
      category: 'info-disclosure',
      severity: 'info',
      title: 'Firebase Config Visible in Client Code',
      description: 'Firebase configuration is embedded in code delivered to the browser. Firebase API keys are designed to be public, so security depends on Firebase Security Rules rather than key secrecy.',
      evidence: 'Firebase client configuration with a public API-key identifier was found',
      remediation: 'Verify your Firestore and Storage security rules are configured correctly. Firebase API keys are public by design; rules are your security layer.',
    });
  }

  // Exposed Stripe publishable key (fine) vs secret key (not fine)
  const stripeSecret = findStripeSecretEvidence(html);
  if (stripeSecret) {
    findings.push({
      id: 'vibe-stripe-secret',
      category: 'exposed-files',
      severity: stripeSecret.severity,
      title: stripeSecret.title,
      description: stripeSecret.description,
      evidence: `${stripeSecret.redacted} found in page source`,
      remediation: '1. Rotate the key immediately at dashboard.stripe.com → Developers → API Keys.\n2. Move all Stripe secret key usage to server-side API routes only.\n3. The publishable key (pk_...) is safe for client use.',
    });
  }

  // Generic API key patterns in HTML
  const genericApiKey = findGenericClientKeyEvidence(html);
  if (genericApiKey) {
    findings.push({
      id: 'vibe-api-key-html',
      category: 'info-disclosure',
      severity: 'info',
      title: 'Client-Visible API-Key-Shaped Value Needs Review',
      description: 'A generic key-shaped value appears in the page HTML. Public client keys, documentation examples, and placeholders can match this pattern, so it is not treated as a leaked secret without a provider-specific secret signature.',
      evidence: `Key-shaped value ${genericApiKey.redacted} found in client code`,
      remediation: 'Identify the provider and intended scope. Rotate and move the value server-side only if its documentation classifies it as a secret; otherwise apply the provider-recommended origin, API, and quota restrictions.',
    });
  }

  // Missing RLS warning for Supabase sites with no auth headers
  // Credential formats the checks above do not cover: AWS key identifiers,
  // GitHub tokens, SendGrid and Mapbox keys, and inline NEXT_PUBLIC_
  // assignments. Kept as a separate detector because its patterns are tested
  // independently and it is the kind of list that grows.
  for (const key of scanForPublicKeys(html)) {
    if (key.risk === 'info' || key.risk === 'low') continue;
    if (
      key.type === 'Supabase Secret Key'
      && findings.some(finding => finding.id === 'vibe-supabase-service-role')
    ) continue;
    findings.push({
      id: `vibe-key-${key.type.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      category: 'info-disclosure',
      severity: key.risk === 'high' ? 'high' : 'medium',
      title: `${key.type} Visible in Client Code`,
      description: `A ${key.type} was found in code the browser receives. Anything served to a browser is readable by anyone who visits, so a credential here is a public credential.`,
      evidence: `${key.value} (in page ${key.source})`,
      remediation: `Rotate this ${key.type} now, since it must be treated as compromised. Move the call that uses it to your server so the credential is never sent to the browser.`,
      url: baseUrl,
    });
  }

  return findings;
}

// ── HTML reflection review ────────────────────────────────────────────────

async function checkXSS(baseUrl: string): Promise<DeepFinding[]> {
  const testPaths = ['/?q=', '/search?q=', '/?s=', '/?name=', '/?message='];

  for (const path of testPaths) {
    const marker = `ironclad-${crypto.randomUUID()}`;
    const markup = `<ironclad-probe data-id="${marker}"></ironclad-probe>`;
    const controlUrl = `${baseUrl}${path}${encodeURIComponent(`control-${marker}`)}`;
    const controlRes = await safeFetch(controlUrl, {
      maxResponseBytes: DIFFERENTIAL_BODY_BYTES,
      forbiddenIsBlocked: true,
    });
    const controlText = await readDifferentialControl(controlRes, 'HTML reflection');
    if (controlText === null) continue;

    const url = `${baseUrl}${path}${encodeURIComponent(markup)}`;
    const res = await safeFetch(url, {
      maxResponseBytes: DIFFERENTIAL_BODY_BYTES,
      forbiddenIsBlocked: true,
    });
    if (!res) continue;
    const contentType = res.headers.get('content-type')?.toLowerCase() ?? '';
    const text = await readBoundedProbeText(res, DIFFERENTIAL_BODY_BYTES);
    if (text === null) continue;

    // The inert, per-request element rules out static documentation and JSON
    // echoes. It still does not prove JavaScript execution, so this remains a
    // review finding rather than an XSS claim.
    if (hasDifferentialHtmlReflection(text, controlText, markup, contentType)) {
      return [{
        id: 'xss-reflected',
        category: 'injection',
        severity: 'info',
        title: 'Unencoded HTML Element Reflection Needs Context Review',
        description: `A unique inert HTML element sent to ${path} reappeared unencoded in an HTML response and was absent from a benign control. This confirms markup reflection, not script execution. Review the browser parsing context before classifying it as XSS.`,
        evidence: `GET ${url}\nResponse contained the unique inert element only after the crafted request`,
        remediation: 'Apply context-appropriate output encoding to untrusted values. Keep a restrictive Content-Security-Policy as defence in depth, and validate the browser context before assigning exploit impact.',
        url,
      }];
    }
  }
  return [];
}

// ── Subresource Integrity ─────────────────────────────────────────────────

async function checkSRI(baseUrl: string, html: string): Promise<DeepFinding[]> {
  if (!html) return [];

  const tags = [
    ...(html.match(/<script\b[^>]*>/gi) ?? []),
    ...(html.match(/<link\b[^>]*>/gi) ?? []).filter(tag => /\brel\s*=\s*["']?stylesheet/i.test(tag)),
  ];
  const issues = tags.flatMap(tag => {
    const assessment = assessSriTag(tag, baseUrl);
    return assessment ? [assessment] : [];
  }).slice(0, 5);

  if (!issues.length) return [];
  const invalid = issues.filter(issue => issue.issue === 'invalid_integrity').length;
  const missingCrossorigin = issues.filter(issue => issue.issue === 'missing_crossorigin').length;
  const missing = issues.length - invalid - missingCrossorigin;
  const details = [
    missing > 0 ? `${missing} missing integrity` : '',
    invalid > 0 ? `${invalid} invalid integrity` : '',
    missingCrossorigin > 0 ? `${missingCrossorigin} missing or invalid crossorigin` : '',
  ].filter(Boolean).join(', ');

  return [{
    id: 'sri-missing',
    category: 'headers',
    severity: 'info',
    title: `${issues.length} External Resource${issues.length > 1 ? 's' : ''} Need SRI Configuration Review`,
    description: `Immutable third-party resources have incomplete SRI configuration (${details}). SRI can add supply-chain defence, but its absence is not an exploit by itself.`,
    evidence: issues.map(issue => `${issue.issue}: ${issue.url.substring(0, 160)}`).join('\n'),
    remediation: 'For immutable third-party assets, pin the exact version, use a valid sha256/sha384/sha512 integrity value, and configure crossorigin so the browser can verify the response.',
  }];
}

// ── Forced browsing / unauthenticated API access (A01) ───────────────────

function classifyUnauthenticatedJson(body: string): 'high' | 'medium' | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length <= 4 && keys.some(key => /^(?:error|message|status|code)$/i.test(key))) return null;
  }

  let severity: 'high' | 'medium' | null = null;
  const accountSignals = new Set<string>();
  const ignoredValue = /^(?:required|missing|invalid|unauthori[sz]ed|forbidden|redacted|null|none|false|true|\*+)$/i;
  function visit(value: unknown, depth: number): void {
    if (depth > 3 || value === null || typeof value !== 'object') return;
    const entries = Array.isArray(value)
      ? value.slice(0, 20).map((item, index) => [String(index), item] as const)
      : Object.entries(value as Record<string, unknown>).slice(0, 50);
    for (const [key, child] of entries) {
      const hasMaterialValue = typeof child === 'string'
        ? child.trim().length > 0 && !ignoredValue.test(child.trim())
        : typeof child === 'number'
          || (Array.isArray(child) && child.length > 0)
          || (child !== null && typeof child === 'object' && Object.keys(child).length > 0);
      if (hasMaterialValue && /(?:password|passwd|secret|private[_-]?key|access[_-]?token|service[_-]?role)/i.test(key)) {
        severity = 'high';
      } else if (hasMaterialValue && /^(?:email|phone|address|full_?name|user_?id|users)$/i.test(key)) {
        accountSignals.add(key.toLowerCase().replace(/_/g, ''));
      }
      visit(child, depth + 1);
    }
  }
  visit(parsed, 0);
  if (severity !== 'high' && accountSignals.size >= 2) severity = 'medium';
  return severity;
}

async function checkForcedBrowsing(baseUrl: string, discoveredRoutes: string[] = []): Promise<DeepFinding[]> {
  const defaultPaths = [
    '/api/admin', '/api/users', '/api/user/list', '/api/orders',
    '/api/config', '/api/settings', '/api/keys', '/api/secrets',
    '/api/dashboard', '/api/internal', '/api/billing', '/api/payments',
    '/admin/api', '/api/v1/users', '/api/v2/users',
  ];
  const discoveredPaths = discoveredRoutes
    .filter(path => /^\/api\/[A-Za-z0-9_./-]{1,120}$/.test(path) && !path.includes('..'))
    .slice(0, 5);
  const protectedPaths = [...new Set([...defaultPaths, ...discoveredPaths])];

  const results = await Promise.allSettled(
    protectedPaths.map(async (path) => {
      const res = await safeFetch(`${baseUrl}${path}`, { headers: { Accept: 'application/json' } });
      return { path, res };
    })
  );

  const exposed: Array<{ path: string; severity: 'high' | 'medium' }> = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { path, res } = r.value;
    if (!res || res.status !== 200) continue;
    const text = await readProbeText(res);
    const severity = classifyUnauthenticatedJson(text);
    if (severity) exposed.push({ path, severity });
  }

  if (!exposed.length) return [];

  return [{
    id: 'auth-unprotected-api',
    category: 'authentication',
    severity: exposed.some(item => item.severity === 'high') ? 'high' : 'medium',
    title: `Unauthenticated JSON Response${exposed.length > 1 ? 's' : ''} Need Review: ${exposed.slice(0, 3).map(item => item.path).join(', ')}${exposed.length > 3 ? '…' : ''}`,
    description: `${exposed.length} selected API path${exposed.length > 1 ? 's' : ''} returned non-empty sensitive-looking JSON fields without authentication. Public profile/configuration data can be intentional, so confirm field sensitivity and access expectations before classifying this as broken access control.`,
    evidence: exposed.map(item => `GET ${baseUrl}${item.path} → 200 JSON with non-empty ${item.severity === 'high' ? 'secret-shaped' : 'account/configuration'} fields`).join('\n'),
    remediation: 'Add authentication middleware to all API routes. Return 401 for unauthenticated requests. Never rely on obscurity; assume all endpoint paths are known to attackers.',
  }];
}

// IDOR: insecure direct object reference (A01)

async function checkIDOR(baseUrl: string): Promise<DeepFinding[]> {
  const ID_PATHS = [
    '/api/users/', '/api/user/', '/api/orders/', '/api/order/',
    '/api/posts/', '/api/items/', '/api/records/',
  ];

  for (const path of ID_PATHS) {
    const [res1, res2] = await Promise.all([
      safeFetch(`${baseUrl}${path}1`, { headers: { Accept: 'application/json' } }),
      safeFetch(`${baseUrl}${path}2`, { headers: { Accept: 'application/json' } }),
    ]);
    if (!res1 || !res2 || res1.status !== 200 || res2.status !== 200) continue;
    const [t1, t2] = await Promise.all([readProbeText(res1), readProbeText(res2)]);
    const hasData = (t: string) =>
      (t.includes('"id"') || t.includes('"email"') || t.includes('"name"')) &&
      (t.trimStart().startsWith('{') || t.trimStart().startsWith('['));
    if (!hasData(t1) || !hasData(t2)) continue;

    return [{
      id: 'idor-sequential-ids',
      category: 'authentication',
      severity: 'info',
      title: `Sequential Public Object Responses Need Authorization Review: ${path}{id}`,
      description: `${path}1 and ${path}2 both return object-like data without authentication. This can be intentional public data and does not establish IDOR without authenticated users and ownership expectations; review whether either record should be access-controlled.`,
      evidence: `GET ${baseUrl}${path}1 → 200 JSON\nGET ${baseUrl}${path}2 → 200 JSON\nBoth return objects with id/email/name fields`,
      remediation: 'Check ownership on every resource request, verifying the authenticated user owns the record before returning it. Return 403 for resources belonging to other users. Use non-sequential UUIDs as identifiers.',
      url: `${baseUrl}${path}1`,
    }];
  }

  return [];
}

// SSRF: server-side request forgery (A10)

async function checkSSRF(baseUrl: string): Promise<DeepFinding[]> {
  const SSRF_PARAMS = ['?url=', '?webhook=', '?callback=', '?proxy=', '?fetch=', '?link=', '?image=', '?src='];
  const METADATA_TARGET = 'http://169.254.169.254/latest/meta-data/';
  const METADATA_SIGNATURES = [/ami-id|instance-id|security-credentials|iam\//i];

  for (const param of SSRF_PARAMS) {
    // Cloud metadata probe
    const metaUrl = `${baseUrl}${param}${encodeURIComponent(METADATA_TARGET)}`;
    const metaRes = await safeFetch(metaUrl, {
      maxResponseBytes: DIFFERENTIAL_BODY_BYTES,
      forbiddenIsBlocked: true,
    });
    if (metaRes?.status === 200) {
      const text = await readBoundedProbeText(metaRes, DIFFERENTIAL_BODY_BYTES);
      if (text && METADATA_SIGNATURES.some(signature => signature.test(text))) {
        const controlUrl = `${baseUrl}${param}${encodeURIComponent('ironclad-control-value')}`;
        const controlRes = await safeFetch(controlUrl, {
          maxResponseBytes: DIFFERENTIAL_BODY_BYTES,
          forbiddenIsBlocked: true,
        });
        const controlText = await readDifferentialControl(controlRes, 'SSRF');
        if (controlText === null) continue;
        if (!hasDifferentialSignature(text, controlText, METADATA_SIGNATURES)) continue;
        return [{
          id: 'ssrf-metadata',
          category: 'authentication',
          severity: 'high',
          title: 'Differential Cloud-Metadata-Like Response',
          description: `The ${param.replace('?', '').replace('=', '')} parameter produced cloud-metadata markers that were absent from a control request. This is strong SSRF evidence, but confirm server-side egress and returned data in logs or a consented out-of-band test before treating credential access as proven.`,
          evidence: `GET ${metaUrl}\n→ Response contains metadata-like markers absent from the control response`,
          remediation: 'Validate and allowlist outbound URLs, resolve and pin approved public addresses, block private/link-local destinations at the egress layer, and require IMDSv2 for AWS workloads.',
          url: metaUrl,
        }];
      }
    }

    // A generic HTML/JSON response to a localhost value cannot distinguish a
    // real server-side fetch from an application that simply ignored or echoed
    // the query parameter. Keep this check to the metadata signature above
    // until a consented out-of-band callback fixture can confirm egress.
  }

  return [];
}

// ── Path traversal (A01 / A05) ────────────────────────────────────────────

async function checkPathTraversal(baseUrl: string): Promise<DeepFinding[]> {
  const FILE_PARAMS = ['?file=', '?path=', '?page=', '?template=', '?include=', '?doc=', '?read=', '?view='];
  const PAYLOADS = ['../../../etc/passwd', '..%2F..%2F..%2Fetc%2Fpasswd', '....//....//....//etc/passwd'];

  for (const param of FILE_PARAMS) {
    const controlUrl = `${baseUrl}${param}${encodeURIComponent('ironclad-control-file')}`;
    const controlRes = await safeFetch(controlUrl, {
      maxResponseBytes: DIFFERENTIAL_BODY_BYTES,
      forbiddenIsBlocked: true,
    });
    const controlText = await readDifferentialControl(controlRes, 'Path traversal');
    if (controlText === null) continue;
    for (const payload of PAYLOADS) {
      const url = `${baseUrl}${param}${encodeURIComponent(payload)}`;
      const res = await safeFetch(url, {
        maxResponseBytes: DIFFERENTIAL_BODY_BYTES,
        forbiddenIsBlocked: true,
      });
      if (!res || res.status !== 200) continue;
      const text = await readBoundedProbeText(res, DIFFERENTIAL_BODY_BYTES);
      if (text === null) continue;
      const strongSignature = hasUnixPasswdEvidence(text);
      const absentFromControl = !hasUnixPasswdEvidence(controlText);
      // Some misconfigured file-serving endpoints label every response as
      // text/html. Two passwd-record signatures plus a clean control are much
      // stronger evidence than that unreliable MIME label.
      if (strongSignature && absentFromControl) {
        return [{
          id: 'path-traversal',
          category: 'exposed-files',
          severity: 'critical',
          title: 'Path Traversal: /etc/passwd Read Successfully',
          description: `The ${param.replace('?', '').replace('=', '')} parameter returned Unix account-file records only for a traversal-shaped input. This confirms that the selected local file was read; it does not by itself establish access to every file on the host.`,
          evidence: `GET ${url}\n→ Response contains /etc/passwd (root:x:0:0 matched)`,
          remediation: 'Never construct file paths from user input. Validate against an allowlist of permitted files. Use realpath() and confirm the result is within the expected directory.',
          url,
        }];
      }
    }
  }

  return [];
}

// ── Outdated / vulnerable libraries (A06) ────────────────────────────────

async function checkOutdatedLibraries(html: string): Promise<DeepFinding[]> {
  if (!html) return [];
  const findings: DeepFinding[] = [];

  const CHECKS: Array<{
    re: RegExp;
    name: string;
    versionLabel: string;
    severity: DeepFinding['severity'];
    cve?: string;
    remediation: string;
  }> = [
    {
      re: /jquery[/\-v]([12]\.\d+\.\d+)/i,
      name: 'jQuery',
      versionLabel: '< 3.0 (EOL)',
      severity: 'medium',
      cve: 'CVE-2019-11358, CVE-2020-11022',
      remediation: 'Upgrade to jQuery 3.7+. Versions 1.x and 2.x have prototype pollution and XSS vulnerabilities.',
    },
    {
      re: /jquery[/\-v](3\.[0-4]\.\d+)/i,
      name: 'jQuery',
      versionLabel: '3.x < 3.5',
    severity: 'info',
      cve: 'CVE-2020-11022',
      remediation: 'Upgrade to jQuery 3.7+. Versions before 3.5 are vulnerable to XSS via HTML parsing.',
    },
    {
      re: /bootstrap[/\-v]([23]\.\d+\.\d+)/i,
      name: 'Bootstrap',
      versionLabel: '< 4.0',
      severity: 'low',
      remediation: 'Upgrade to Bootstrap 5+. Older versions have known XSS vulnerabilities in data attributes.',
    },
    {
      re: /angular(?:js)?[/\-v](1\.[0-6]\.\d+)/i,
      name: 'AngularJS',
      versionLabel: '1.x (EOL Dec 2021)',
      severity: 'medium',
      remediation: 'AngularJS reached end-of-life in December 2021 and no longer receives security patches. Migrate to Angular 17+ or another supported framework.',
    },
    {
      re: /lodash[/\-v]((?:[0-3]\.\d+\.\d+|4\.[0-9]\.\d+|4\.1[0-6]\.\d+))/i,
      name: 'Lodash',
      versionLabel: '< 4.17.21',
      severity: 'medium',
      cve: 'CVE-2021-23337, CVE-2020-8203',
      remediation: 'Upgrade to Lodash 4.17.21+. Earlier versions are vulnerable to prototype pollution and command injection.',
    },
    {
      re: /moment[/\-v](2\.[0-9]\.\d+|2\.1\d\.\d+|2\.2[0-8]\.\d+)/i,
      name: 'Moment.js',
      versionLabel: '< 2.29.4',
      severity: 'low',
      cve: 'CVE-2022-24785',
      remediation: 'Update to Moment.js 2.29.4+ or migrate to date-fns/dayjs which are smaller and actively maintained.',
    },
  ];

  for (const lib of CHECKS) {
    const match = html.match(lib.re);
    if (!match) continue;
    findings.push({
      id: `outdated-${lib.name.toLowerCase().replace(/\W/g, '')}`,
      category: 'headers',
      severity: 'info',
      title: `Client Library Version String Needs Review: ${lib.name} ${match[1]}`,
      description: `${lib.name} version ${match[1]} was detected in the page source.${lib.cve ? ` This version is associated with: ${lib.cve}.` : ''} A version string does not prove the affected code path is loaded or exploitable; confirm the shipped dependency and feature usage before assigning impact.`,
      evidence: `Detected "${match[0]}" in page HTML`,
      remediation: lib.remediation,
    });
  }

  return findings;
}

// ── Source map exposure ────────────────────────────────────────────────────

type ClientBundleSource = {
  url: string;
  source: string;
};

type ExposedSourceMap = {
  url: string;
  assessment: SourceMapAssessment;
};

async function checkSourceMaps(
  baseUrl: string,
  bundles: readonly ClientBundleSource[],
): Promise<DeepFinding[]> {
  if (!bundles.length) return [];

  const allowedOrigin = new URL(baseUrl).origin;

  const results = await mapWithConcurrency(
    bundles.slice(0, 8),
    3,
    async (bundle): Promise<ExposedSourceMap | null> => {
      const candidates = sourceMapUrlCandidates(bundle.url, bundle.source, allowedOrigin);
      for (const mapUrl of candidates) {
        const response = await safeFetch(mapUrl, { maxResponseBytes: MAX_PROBE_BODY_BYTES });
        if (!response || response.status !== 200) continue;

        const body = await readBoundedProbeText(response, MAX_PROBE_BODY_BYTES);
        if (body === null) continue;
        const assessment = assessSourceMap(body);
        if (!assessment || !hasSourceMapDisclosure(assessment)) continue;

        const displayUrl = new URL(finalResponseUrls.get(response) ?? mapUrl);
        displayUrl.search = '';
        displayUrl.hash = '';
        return { url: displayUrl.href, assessment };
      }

      return null;
    },
  );

  const exposed = results
    .flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);

  if (!exposed.length) return [];

  const embedded = exposed.filter(item => item.assessment.embeddedSourceCount > 0);
  const metadataOnly = exposed.length - embedded.length;
  const embeddedSourceCount = embedded.reduce(
    (count, item) => count + item.assessment.embeddedSourceCount,
    0,
  );
  const hasEmbeddedSource = embedded.length > 0;

  const evidence = exposed.slice(0, 3).map(item => {
    const assessment = item.assessment;
    const shape = `${assessment.format} v3 source map`;
    if (assessment.embeddedSourceCount > 0) {
      return `GET ${item.url} → 200 (${shape}; ${assessment.embeddedSourceCount}/${assessment.sourceCount} non-empty source file${assessment.sourceCount === 1 ? '' : 's'} embedded via sourcesContent)`;
    }
    const references = assessment.referencedSectionCount > 0
      ? `; ${assessment.referencedSectionCount} referenced map section${assessment.referencedSectionCount === 1 ? '' : 's'}`
      : '';
    return `GET ${item.url} → 200 (${shape}; ${assessment.sourceCount} source path${assessment.sourceCount === 1 ? '' : 's'}, ${assessment.mappingCharacters} mapping characters${references}; no non-empty sourcesContent)`;
  }).join('\n');

  return [{
    id: 'source-maps-exposed',
    category: 'info-disclosure',
    severity: hasEmbeddedSource ? 'medium' : 'low',
    title: hasEmbeddedSource
      ? `Public Source Maps Embed Original Source (${embedded.length} file${embedded.length === 1 ? '' : 's'})`
      : `Public Source Map Metadata Is Accessible (${exposed.length} file${exposed.length === 1 ? '' : 's'})`,
    description: hasEmbeddedSource
      ? `${embedded.length} publicly readable source map${embedded.length === 1 ? '' : 's'} include ${embeddedSourceCount} non-empty sourcesContent entr${embeddedSourceCount === 1 ? 'y' : 'ies'}, making that original source text directly retrievable.${metadataOnly > 0 ? ` ${metadataOnly} additional map${metadataOnly === 1 ? '' : 's'} exposed mapping or path metadata without embedded source text.` : ''}`
      : 'Valid version-3 source maps are publicly readable and expose source paths, mapping metadata, and/or referenced map locations. No non-empty sourcesContent was observed, so this scan did not confirm that original source text is embedded in these files.',
    evidence,
    remediation: hasEmbeddedSource
      ? 'Do not publish source maps containing sourcesContent. Keep production maps as private build artifacts for your error-monitoring service, or disable public production source maps entirely.'
      : 'If public source maps are not intentional, remove or block them and upload maps privately to your error-monitoring service. If they are intentional, review the exposed source paths and build metadata.',
  }];
}

const PROVIDER_MAX_RESPONSE_BYTES = 64_000;
const PROVIDER_SCHEMA_MAX_RESPONSE_BYTES = 512_000;

type ProviderJsonResult =
  | { ok: true; value: unknown; source: string }
  | { ok: false };

async function readProviderJson(
  response: Response,
  label: string,
  maxBytes = PROVIDER_MAX_RESPONSE_BYTES,
): Promise<ProviderJsonResult> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('json')) {
    markCurrentPhaseIncomplete(`${label} returned a successful non-JSON response`);
    return { ok: false };
  }

  const source = await readBoundedProbeText(response, maxBytes);
  if (source === null) {
    markCurrentPhaseIncomplete(`${label} response could not be read within the safety limit`);
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(source) as unknown, source };
  } catch {
    markCurrentPhaseIncomplete(`${label} returned malformed JSON`);
    return { ok: false };
  }
}

function strongestListState(
  current: ProviderListState | null,
  next: ProviderListState,
): ProviderListState {
  return current === 'nonempty' || next === 'nonempty' ? 'nonempty' : 'empty';
}

function supabaseRequestHeaders(config: NonNullable<ClientArtifacts['supabase']>): Record<string, string> {
  return {
    apikey: config.key,
    ...(config.keyKind === 'legacy-anon' ? { Authorization: `Bearer ${config.key}` } : {}),
    Accept: 'application/json',
  };
}

async function providerFetch(
  rawUrl: string,
  allowedHostname: string,
  allowedPath: RegExp,
  options: RequestInit = {},
  allowedMethods: readonly string[] = ['GET'],
  maxResponseBytes = PROVIDER_MAX_RESPONSE_BYTES,
): Promise<Response | null> {
  try {
    const url = parseScanUrl(rawUrl);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== allowedHostname.toLowerCase()) return null;
    if (!allowedPath.test(url.pathname)) return null;
    const method = options.method?.toUpperCase() ?? 'GET';
    if (!allowedMethods.includes(method)) return null;
    const context = scanRequestContext.getStore();
    if (context?.lane !== 'deep') return null;
    if (context && Date.now() >= context.deadlineAt) {
      context.deadlineExceeded = true;
      incrementCoverage(context, 'requestsFailed');
      return null;
    }
    const quotaIdentity = providerQuotaIdentity(url);
    if (!quotaIdentity) {
      markCurrentPhaseIncomplete('The provider project or bucket identity could not be validated');
      incrementCoverage(context, 'requestsBlocked');
      return null;
    }
    if (context && !context.providerQuotaTargets.has(quotaIdentity)) {
      const quotaBudget = Math.max(1, Math.min(TIMEOUT, context.deadlineAt - Date.now()));
      const { data, error } = await supabase
        .rpc('consume_usage', {
          usage_key: providerTargetHourlyKey(quotaIdentity, new Date()),
          usage_limit: 50,
        })
        .abortSignal(AbortSignal.timeout(quotaBudget));
      const remaining = Number(data);
      if (error || !Number.isFinite(remaining) || remaining < 0) {
        markCurrentPhaseIncomplete('The provider safety quota was unavailable or exhausted');
        incrementCoverage(context, 'requestsBlocked');
        return null;
      }
      context.providerQuotaTargets.add(quotaIdentity);
    }
    if (context && Date.now() >= context.deadlineAt) {
      context.deadlineExceeded = true;
      incrementCoverage(context, 'requestsFailed');
      return null;
    }
    incrementCoverage(context, 'requestsAttempted');
    const remainingBudget = context ? Math.max(1, context.deadlineAt - Date.now()) : TIMEOUT;
    const response = await (context?.transport ?? pinnedFetch)(url, {
      ...options,
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(Math.min(TIMEOUT, remainingBudget)),
      maxResponseBytes,
      headers: {
        'User-Agent': LANE_USER_AGENTS.deep,
        ...Object.fromEntries(new Headers(options.headers).entries()),
      },
    });
    incrementCoverage(context, 'requestsCompleted');
    const responseOutcome = classifyProbeResponse(response.status, response.headers);
    if (responseOutcome === 'blocked') incrementCoverage(context, 'requestsBlocked');
    if (responseOutcome === 'failed') incrementCoverage(context, 'requestsFailed');
    if (responseOutcome === 'blocked') {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    return response;
  } catch {
    const context = scanRequestContext.getStore();
    if (context && Date.now() >= context.deadlineAt) context.deadlineExceeded = true;
    incrementCoverage(context, 'requestsFailed');
    return null;
  }
}

async function checkSupabaseStorage(artifacts: ClientArtifacts): Promise<DeepFinding[]> {
  const config = artifacts.supabase;
  if (!config) return [];
  const projectUrl = new URL(config.url);
  const headers = supabaseRequestHeaders(config);
  const bucketNames = new Set(config.storageBuckets.slice(0, 3));
  let listingState: ProviderListState | null = null;

  const bucketResponse = await providerFetch(
    new URL('/storage/v1/bucket', projectUrl).href,
    projectUrl.hostname,
    /^\/storage\/v1\/bucket$/,
    { headers },
  );
  if (bucketResponse?.ok) {
    const parsed = await readProviderJson(bucketResponse, 'Supabase Storage bucket list');
    if (parsed.ok) {
      const state = classifyArrayList(parsed.value);
      if (!state) {
        markCurrentPhaseIncomplete('Supabase Storage bucket list returned an unexpected JSON shape');
      } else {
        listingState = strongestListState(listingState, state);
        for (const row of parsed.value as unknown[]) {
          if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
          const id = (row as Record<string, unknown>).id;
          if (typeof id === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(id)) bucketNames.add(id);
          if (bucketNames.size >= 3) break;
        }
      }
    }
  }

  for (const bucket of [...bucketNames].slice(0, 3)) {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(bucket)) continue;
    const endpoint = new URL(`/storage/v1/object/list/${encodeURIComponent(bucket)}`, projectUrl);
    const response = await providerFetch(
      endpoint.href,
      projectUrl.hostname,
      /^\/storage\/v1\/object\/list\/[A-Za-z0-9_.%~-]{1,300}$/,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 1, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
      },
      ['POST'],
    );
    if (!response?.ok) continue;
    const parsed = await readProviderJson(response, 'Supabase Storage object list');
    if (!parsed.ok) continue;
    const state = classifyArrayList(parsed.value);
    if (!state) {
      markCurrentPhaseIncomplete('Supabase Storage object list returned an unexpected JSON shape');
      continue;
    }
    listingState = strongestListState(listingState, state);
  }

  if (listingState) {
    const nonempty = listingState === 'nonempty';
    return [{
      id: 'storage-supabase-listing',
      category: 'cloud-data',
      severity: nonempty ? 'medium' : 'info',
      title: nonempty
        ? 'Anonymous Supabase Storage Listing Returned Inventory'
        : 'Anonymous Supabase Storage Listing Is Allowed',
      description: nonempty
        ? 'A bounded anonymous list request returned storage inventory. Public listing can be intentional, but it exposes bucket or object inventory independently of public downloads.'
        : 'A bounded anonymous list request succeeded but returned no current inventory. This confirms list permission, which may be intentional and should be reviewed separately from object downloads.',
      evidence: nonempty
        ? 'Supabase Storage returned at least one bucket or object to a bounded anonymous listing. Names were not retained.'
        : 'Supabase Storage accepted a bounded anonymous listing and returned an empty list.',
      remediation: 'Review Storage policies for the anon role. Permit listing only where anonymous inventory discovery is an explicit product requirement.',
      url: projectUrl.origin,
    }];
  }
  return [];
}

async function checkSupabaseExposure(artifacts: ClientArtifacts): Promise<DeepFinding[]> {
  const config = artifacts.supabase;
  if (!config) return [];
  const projectUrl = new URL(config.url);
  const findings: DeepFinding[] = [];
  const tableCandidates = new Set(config.tables);

  // Older and self-hosted PostgREST deployments can expose an OpenAPI schema
  // at the root. Supabase Cloud commonly denies this now, so it is a bounded
  // best-effort discovery source rather than a prerequisite.
  const schemaResponse = await providerFetch(
    new URL('/rest/v1/', projectUrl).href,
    projectUrl.hostname,
    /^\/rest\/v1\/$/,
    { headers: supabaseRequestHeaders(config) },
    ['GET'],
    PROVIDER_SCHEMA_MAX_RESPONSE_BYTES,
  );
  if (schemaResponse?.ok) {
    const parsed = await readProviderJson(
      schemaResponse,
      'Supabase PostgREST schema discovery',
      PROVIDER_SCHEMA_MAX_RESPONSE_BYTES,
    );
    if (parsed.ok) {
      for (const table of extractPostgrestTableCandidates(parsed.source, 5)) tableCandidates.add(table);
    }
  }

  if (tableCandidates.size === 0) {
    markCurrentPhaseIncomplete('Supabase was discovered, but no bounded table target could be identified');
    return [];
  }
  for (const table of [...tableCandidates].slice(0, 3)) {
    const url = new URL(`/rest/v1/${encodeURIComponent(table)}`, projectUrl);
    url.searchParams.set('select', '*');
    url.searchParams.set('limit', '1');
    const response = await providerFetch(
      url.href,
      projectUrl.hostname,
      /^\/rest\/v1\/[A-Za-z_][A-Za-z0-9_]{0,62}$/,
      { headers: supabaseRequestHeaders(config) },
    );
    if (!response?.ok) continue;
    const parsed = await readProviderJson(response, 'Supabase anonymous row read');
    if (!parsed.ok) continue;
    if (!Array.isArray(parsed.value)) {
      markCurrentPhaseIncomplete('Supabase anonymous row read returned an unexpected JSON shape');
      continue;
    }
    if (parsed.value.length === 0) continue;
    const row = parsed.value[0];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      markCurrentPhaseIncomplete('Supabase anonymous row read returned a malformed row');
      continue;
    }
    const fields = Object.keys(row as Record<string, unknown>);
    const materialSensitiveFields = sensitiveMaterialFields(row);
    findings.push({
      id: `supabase-anon-read-${table}`,
      category: 'cloud-data',
      severity: materialSensitiveFields.length ? 'high' : 'info',
      title: materialSensitiveFields.length
        ? `Anonymous Supabase Read Returned Material Sensitive Data: ${table}`
        : `Anonymous Supabase Read Returned a Row: ${table}`,
      description: materialSensitiveFields.length
        ? `The public project key returned a row with material values in sensitive-looking fields: ${materialSensitiveFields.join(', ')}. This proves anonymous SELECT access, but not whether the policy is unintended.`
        : 'The public project key returned one row. Anonymous access may be an intentional public policy, so review the table policy and data classification.',
      evidence: `GET ${projectUrl.origin}/rest/v1/${table}?select=*&limit=1 returned one row. Field names: ${fields.slice(0, 12).join(', ')}`,
      remediation: 'Review the table RLS state and anon policies in Supabase. Remove anonymous SELECT policies for private data and test policies with signed-out and signed-in roles.',
      url: `${projectUrl.origin}/rest/v1/${table}`,
    });
  }
  return findings;
}

async function checkFirebaseExposure(artifacts: ClientArtifacts): Promise<DeepFinding[]> {
  const config = artifacts.firebase;
  if (!config) return [];
  const findings: DeepFinding[] = [];

  if (config.databaseUrl) {
    try {
      const databaseUrl = new URL(config.databaseUrl);
      if (!/(?:^|\.)(?:firebaseio\.com|firebasedatabase\.app)$/i.test(databaseUrl.hostname)) {
        throw new Error('Not a Firebase Realtime Database host');
      }
      databaseUrl.pathname = '/.json';
      databaseUrl.search = '?shallow=true';
      const response = await providerFetch(
        databaseUrl.href,
        databaseUrl.hostname,
        /^\/\.json$/,
        { headers: { Accept: 'application/json' } },
      );
      if (response?.ok) {
        const rootResult = await readProviderJson(response, 'Firebase database root read');
        const root = rootResult.ok ? rootResult.value : null;
        if (root && typeof root === 'object' && !Array.isArray(root) && Object.keys(root).length > 0) {
          const firstChild = Object.keys(root)[0];
          let sensitiveFieldCount = 0;
          const validFirebaseKey = (value: string) => value.length <= 200 && !/[.#$\[\]\/]/.test(value);
          const pathSegments = firstChild && validFirebaseKey(firstChild) ? [firstChild] : [];
          for (let depth = 0; depth < 2 && pathSegments.length > 0 && sensitiveFieldCount === 0; depth++) {
            const childPath = `/${pathSegments.map(encodeURIComponent).join('/')}.json`;
            const childUrl = new URL(childPath, databaseUrl.origin);
            childUrl.search = '?shallow=true';
            const childResponse = await providerFetch(
              childUrl.href,
              databaseUrl.hostname,
              /^\/(?:[A-Za-z0-9_.%~-]{1,300}\/){0,2}[A-Za-z0-9_.%~-]{1,300}\.json$/,
              { headers: { Accept: 'application/json' } },
            );
            if (!childResponse?.ok) break;
            const childResult = await readProviderJson(childResponse, 'Firebase database child read');
            if (!childResult.ok) break;
            const child = childResult.value;
            if (!child || typeof child !== 'object' || Array.isArray(child)) break;
            const childKeys = Object.keys(child);
            sensitiveFieldCount = childKeys.filter(field =>
              /^(?:email|phone|address|full_?name|user_?id|date_of_birth|dob|ssn|password|secret|access_token|refresh_token|payment|billing)$/i.test(field)
            ).length;
            const nextChild = childKeys[0];
            if (!nextChild || !validFirebaseKey(nextChild)) break;
            pathSegments.push(nextChild);
          }
          findings.push({
            id: 'firebase-rtdb-shallow-read',
            category: 'cloud-data',
            severity: 'info',
            title: sensitiveFieldCount > 0
              ? 'Anonymous Firebase Read Revealed Sensitive-Looking Field Names'
              : 'Anonymous Firebase Database Keys Are Visible',
            description: sensitiveFieldCount > 0
              ? 'Bounded shallow reads revealed a data branch with sensitive-looking field names. Values were not requested, so this is structural review context rather than proof that sensitive records are anonymously readable.'
              : 'A shallow anonymous root read returned child keys. This does not reveal record values and can be intentional, but it confirms anonymous visibility that should be checked against the rules.',
            evidence: sensitiveFieldCount > 0
              ? `Shallow anonymous reads returned ${sensitiveFieldCount} sensitive-looking field name(s). Branch and field names were not retained.`
              : `GET ${databaseUrl.origin}/.json?shallow=true returned ${Object.keys(root).length} top-level key name(s). Names were not retained.`,
            remediation: 'Review Realtime Database rules and allow anonymous reads only for data intended to be public. Test rules in the Firebase emulator before deployment.',
            url: databaseUrl.origin,
          });
        }
      }
    } catch {
      markCurrentPhaseIncomplete('Firebase database configuration could not be validated');
    }
  }

  if (config.storageBucket) {
    const bucket = config.storageBucket.toLowerCase();
    if (/^[a-z0-9][a-z0-9._-]{1,220}\.(?:appspot\.com|firebasestorage\.app)$/.test(bucket)) {
      const endpoint = new URL(`https://firebasestorage.googleapis.com/v0/b/${bucket}/o`);
      endpoint.searchParams.set('maxResults', '1');
      const response = await providerFetch(
        endpoint.href,
        endpoint.hostname,
        /^\/v0\/b\/[a-z0-9._-]+\/(?:o)$/,
        { headers: { Accept: 'application/json' } },
      );
      if (response?.ok) {
        const parsed = await readProviderJson(response, 'Firebase Storage object list');
        if (!parsed.ok) return findings;
        const state = classifyFirebaseStorageList(parsed.value);
        if (!state) {
          markCurrentPhaseIncomplete('Firebase Storage object list returned an unexpected JSON shape');
          return findings;
        }
        const nonempty = state === 'nonempty';
        findings.push({
          id: 'firebase-storage-listing',
          category: 'cloud-data',
          severity: nonempty ? 'medium' : 'info',
          title: nonempty
            ? 'Anonymous Firebase Storage Listing Returned Inventory'
            : 'Anonymous Firebase Storage Listing Is Allowed',
          description: nonempty
            ? 'An unauthenticated one-item listing returned object inventory. Public listing may be intentional, but it exposes inventory independently of public downloads.'
            : 'An unauthenticated one-item listing succeeded but returned no current objects. This confirms list permission and should be reviewed separately from download access.',
          evidence: nonempty
            ? 'Firebase Storage returned at least one object to a one-item anonymous listing. Object names were not retained.'
            : 'Firebase Storage accepted a one-item anonymous listing and returned an empty result.',
          remediation: 'Restrict list permission in Firebase Storage rules unless anonymous enumeration is explicitly required.',
          url: endpoint.origin,
        });
      }
    }
  }
  return findings;
}

async function checkS3Listings(artifacts: ClientArtifacts): Promise<DeepFinding[]> {
  let listingState: ProviderListState | null = null;
  let listingHostname: string | null = null;
  for (const hostname of artifacts.s3Hosts.slice(0, 2)) {
    const url = new URL(`https://${hostname}/`);
    url.search = '?list-type=2&max-keys=1&encoding-type=url';
    const response = await providerFetch(url.href, hostname, /^\/$/, { headers: { Accept: 'application/xml' } });
    if (!response?.ok) continue;
    const body = await readBoundedProbeText(response, PROVIDER_MAX_RESPONSE_BYTES);
    if (body === null) {
      markCurrentPhaseIncomplete('S3 bucket list response could not be read within the safety limit');
      continue;
    }
    const state = classifyS3List(body);
    if (!state) {
      markCurrentPhaseIncomplete('S3 bucket list returned malformed or unexpected XML');
      continue;
    }
    listingState = strongestListState(listingState, state);
    listingHostname ??= hostname;
    if (state === 'nonempty') listingHostname = hostname;
  }

  if (listingState && listingHostname) {
    const nonempty = listingState === 'nonempty';
    return [{
      id: 'storage-s3-listing',
      category: 'cloud-data',
      severity: nonempty ? 'medium' : 'info',
      title: nonempty
        ? 'Anonymous S3 Bucket Listing Returned Inventory'
        : 'Anonymous S3 Bucket Listing Is Allowed',
      description: nonempty
        ? 'A one-item anonymous ListObjectsV2 request returned bucket inventory. Public listing can be intentional, but it exposes inventory independently of individual public objects.'
        : 'A one-item anonymous ListObjectsV2 request succeeded but returned no current objects. This confirms list permission and should be reviewed separately from object-read access.',
      evidence: nonempty
        ? `GET https://${listingHostname}/?list-type=2&max-keys=1 returned a ListBucketResult containing an object. Object names were not retained.`
        : `GET https://${listingHostname}/?list-type=2&max-keys=1 returned a valid empty ListBucketResult.`,
      remediation: 'Disable public s3:ListBucket unless anonymous enumeration is explicitly required. Keep object-read and bucket-list permissions separate.',
      url: `https://${listingHostname}/`,
    }];
  }
  return [];
}

async function checkNextMiddlewareBypass(baseUrl: string, html: string): Promise<DeepFinding[]> {
  const buildId = extractNextBuildId(html);
  if (!buildId) return [];
  const manifestUrl = new URL(`/_next/static/${encodeURIComponent(buildId)}/_buildManifest.js`, baseUrl);
  const manifestResponse = await safeFetch(manifestUrl.href, {
    redirect: 'follow',
    maxResponseBytes: 128_000,
    headers: { Accept: 'text/javascript, application/javascript, */*;q=0.1' },
  });
  if (!manifestResponse?.ok) return [];
  const manifest = await readBoundedProbeText(manifestResponse, 128_000);
  if (!manifest) return [];
  const candidates = extractNextManifestRoutes(manifest)
    .filter(route => /^\/(?:admin|dashboard|account|settings|profile|billing|portal)(?:\/|$)/i.test(route))
    .slice(0, 3);

  for (const route of candidates) {
    const url = new URL(route, baseUrl);
    const control = await safeFetch(url.href, { redirect: 'manual', maxResponseBytes: 64_000 });
    const location = control?.headers.get('location');
    if (!control || !location || control.status < 300 || control.status >= 400) continue;
    let loginRedirect = false;
    try {
      const destination = new URL(location, url);
      loginRedirect = destination.origin === url.origin
        && /\/(?:login|signin|sign-in|auth)(?:\/|$|\?)/i.test(destination.pathname + destination.search);
    } catch {
      continue;
    }
    if (!loginRedirect) continue;

    const bypass = await safeFetch(url.href, {
      redirect: 'manual',
      maxResponseBytes: 128_000,
      headers: { 'x-middleware-subrequest': 'middleware:middleware:middleware:middleware:middleware' },
    });
    if (!bypass || bypass.status !== 200 || bypass.headers.get('location')) continue;
    const contentType = bypass.headers.get('content-type')?.toLowerCase() ?? '';
    if (!/(?:text\/html|application\/json)/.test(contentType)) continue;
    const body = await readBoundedProbeText(bypass, 128_000) ?? '';
    if (body.length < 128 || /<form\b[^>]*>[\s\S]{0,4000}(?:type=["']password|name=["']password)/i.test(body)) continue;

    const jsonExposure = contentType.includes('application/json')
      ? classifyUnauthenticatedJson(body)
      : null;
    const hasSignOut = /\b(?:log\s*out|sign\s*out)\b/i.test(body);
    const accountSignals = [
      /\baccount settings\b/i,
      /\bbilling (?:portal|settings|history)\b/i,
      /\bmanage users\b/i,
      /\bsecurity settings\b/i,
      /\bemail\s*[:=]/i,
    ].filter(pattern => pattern.test(body)).length;
    const confirmedContent = jsonExposure === 'high' || (hasSignOut && accountSignals > 0);

    return [{
      id: confirmedContent ? 'next-middleware-bypass' : 'next-middleware-response-change',
      category: 'authentication',
      severity: confirmedContent ? 'high' : 'info',
      title: confirmedContent
        ? 'Next.js Middleware Authorization Bypass Returned Protected-Looking Content'
        : 'Next.js Middleware Header Changed a Protected Route Response',
      description: confirmedContent
        ? `The unauthenticated control request to ${route} redirected to sign-in, while the known middleware subrequest header returned a 200 response with protected-looking content. This differential is strong bypass evidence, but the affected data and actions still need manual confirmation.`
        : `The unauthenticated control request to ${route} redirected to sign-in, while the known middleware subrequest header returned a 200 response. No sensitive content was confirmed, so this is retained as review-only evidence.`,
      evidence: `GET ${route} redirected to sign-in. The same GET with x-middleware-subrequest returned HTTP 200. Response content was not retained.`,
      remediation: 'Upgrade Next.js to a release that fixes CVE-2025-29927. Enforce authorization again in route handlers and data access code rather than relying only on middleware.',
      url: url.href,
    }];
  }
  return [];
}

// ── GraphQL introspection ─────────────────────────────────────────────────

async function checkGraphQL(baseUrl: string): Promise<DeepFinding[]> {
  const endpoints = ['/graphql', '/api/graphql', '/gql', '/query'];

  for (const path of endpoints) {
    const res = await safeFetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{__schema{queryType{name}}}' }),
    });
    if (!res || res.status !== 200) continue;
    const text = await readProbeText(res);
    let confirmed = false;
    try {
      const parsed = JSON.parse(text) as { data?: { __schema?: { queryType?: unknown } } };
      confirmed = parsed?.data?.__schema?.queryType !== undefined;
    } catch {
      // A catch-all HTML page or unrelated JSON is not GraphQL evidence.
    }
    if (confirmed) {
      return [{
        id: 'graphql-introspection',
        category: 'info-disclosure',
        severity: 'info',
        title: 'Public GraphQL Introspection Detected',
        description: `GraphQL introspection is enabled at ${path}. Public introspection can be intentional and is not a vulnerability by itself; review whether exposing the schema matches the API's threat model and documentation policy.`,
        evidence: `POST ${baseUrl}${path} with {__schema query}\n→ Introspection data returned`,
        remediation: 'Disable introspection in production. In Apollo Server: introspection: false. In graphql-yoga: disable introspection via plugins. Keep it enabled only in development environments.',
        url: `${baseUrl}${path}`,
      }];
    }
  }
  return [];
}

// ── Exposed API documentation ─────────────────────────────────────────────

const API_DOC_PATHS = [
  { path: '/swagger', title: 'Swagger UI' },
  { path: '/swagger-ui', title: 'Swagger UI' },
  { path: '/swagger.json', title: 'OpenAPI JSON' },
  { path: '/swagger.yaml', title: 'OpenAPI YAML' },
  { path: '/openapi.json', title: 'OpenAPI JSON' },
  { path: '/openapi.yaml', title: 'OpenAPI YAML' },
  { path: '/api-docs', title: 'API Docs' },
  { path: '/api/docs', title: 'API Docs' },
  { path: '/redoc', title: 'ReDoc UI' },
  { path: '/docs', title: 'Docs' },
];

function isApiDocumentationBody(body: string): boolean {
  if (/\bswagger-ui\b|id=["']swagger-ui["']|\bredoc(?:\.standalone)?\b/i.test(body)) return true;
  try {
    const parsed = JSON.parse(body) as { openapi?: unknown; swagger?: unknown; paths?: unknown };
    const versioned = typeof parsed?.openapi === 'string' || typeof parsed?.swagger === 'string';
    return versioned && typeof parsed.paths === 'object' && parsed.paths !== null;
  } catch {
    return /^(?:openapi|swagger):\s*["']?[23](?:\.\d+){0,2}["']?\s*$/im.test(body)
      && /^paths:\s*$/im.test(body);
  }
}

async function checkAPIDocumentation(baseUrl: string): Promise<DeepFinding[]> {
  const results = await Promise.allSettled(
    API_DOC_PATHS.map(async ({ path, title }) => {
      const res = await safeFetch(`${baseUrl}${path}`, { redirect: 'follow' });
      if (!res || res.status !== 200) return { path, title, exposed: false };
      const body = await readProbeText(res);
      return { path, title, exposed: isApiDocumentationBody(body) };
    })
  );

  const exposed = results
    .filter(r => r.status === 'fulfilled' && r.value.exposed)
    .map(r => (r as PromiseFulfilledResult<{ path: string; title: string; exposed: boolean }>).value);

  if (!exposed.length) return [];

  return [{
    id: 'api-docs-exposed',
    category: 'info-disclosure',
    severity: 'info',
    title: `Public API Documentation Detected: ${exposed[0].title}`,
    description: `Content signatures confirm API documentation at ${exposed.map(e => e.path).join(', ')}. Public documentation can be intentional and is not a vulnerability by itself; review whether it exposes internal-only operations or schemas.`,
    evidence: exposed.map(e => `GET ${baseUrl}${e.path} → 200 with API-documentation markers`).join('\n'),
    remediation: 'Keep intended public documentation accurate and free of secrets. Require authentication or move it to an internal environment only when the schema is not meant for public consumers.',
    url: `${baseUrl}${exposed[0].path}`,
  }];
}

// ── NoSQL injection ───────────────────────────────────────────────────────

const NOSQL_PAYLOADS = ['[$gt]=', '[$ne]=invalid', '[$regex]=.*'];

const NOSQL_ERROR_PATTERNS = [
  /MongoError/i,
  /CastError/i,
  /BSONError/i,
  /MongoServerError/i,
  /\$gt.*is not/i,
];

async function checkNoSQLInjection(baseUrl: string): Promise<DeepFinding[]> {
  const testPaths = ['/api/user', '/api/login', '/api/data', '/api/search', '/api/users'];

  for (const path of testPaths) {
    const controlUrl = `${baseUrl}${path}?id=ironclad-control-value`;
    const controlRes = await safeFetch(controlUrl, {
      maxResponseBytes: DIFFERENTIAL_BODY_BYTES,
      forbiddenIsBlocked: true,
    });
    const controlText = await readDifferentialControl(controlRes, 'NoSQL injection');
    if (controlText === null) continue;
    for (const payload of NOSQL_PAYLOADS) {
      const url = `${baseUrl}${path}?id${payload}`;
      const res = await safeFetch(url, {
        maxResponseBytes: DIFFERENTIAL_BODY_BYTES,
        forbiddenIsBlocked: true,
      });
      if (!res) continue;
      const text = await readBoundedProbeText(res, DIFFERENTIAL_BODY_BYTES);
      if (text === null) continue;
      if (hasDifferentialSignature(text, controlText, NOSQL_ERROR_PATTERNS)) {
        return [{
          id: 'nosql-injection',
          category: 'info-disclosure',
          severity: 'medium',
          title: 'Database Error Disclosed After NoSQL-Shaped Input',
          description: 'A MongoDB/Mongoose-shaped error string appeared after crafted input. This is useful error-disclosure evidence, but it does not prove operator injection, authentication bypass, or data extraction without a differential exploit.',
          evidence: `GET ${url}\nA MongoDB error signature appeared only after crafted input. Response content was not retained.`,
          remediation: 'Sanitise all user input before using it in database queries. Reject keys starting with $. Use Mongoose with strict schemas and validate input shapes before querying.',
          url,
        }];
      }
    }
  }
  return [];
}

// ── Host header injection ─────────────────────────────────────────────────

async function checkHostHeaderInjection(baseUrl: string): Promise<DeepFinding[]> {
  const INJECTED_HOST = 'evil-attacker-test.com';

  const res = await safeFetch(baseUrl, {
    headers: { Host: INJECTED_HOST },
    redirect: 'manual',
    forbiddenIsBlocked: true,
  });
  if (!res) return [];

  const text = await readProbeText(res);
  const location = res.headers.get('location') ?? '';

  let redirectsToInjectedHost = false;
  try {
    redirectsToInjectedHost = res.status >= 300
      && res.status < 400
      && new URL(location, baseUrl).hostname.toLowerCase() === INJECTED_HOST;
  } catch {
    redirectsToInjectedHost = false;
  }
  const reflectsInSuccessfulBody = res.ok && text.includes(INJECTED_HOST);
  if (redirectsToInjectedHost || reflectsInSuccessfulBody) {
    const source = redirectsToInjectedHost ? `Location: ${location}` : 'Successful response body contains injected Host value';
    return [{
      id: 'host-header-injection',
      category: 'injection',
      severity: redirectsToInjectedHost ? 'high' : 'info',
      title: redirectsToInjectedHost ? 'Host Header Controls an External Redirect' : 'Host Header Value Reflected in Response',
      description: redirectsToInjectedHost
        ? 'The attacker-controlled Host value appeared in a redirect destination. Confirm whether the same host derivation reaches password-reset links or shared caches before assigning broader impact.'
        : 'The attacker-controlled Host value appeared in a successful response body. Reflection alone is not password-reset or cache poisoning; inspect the sink and cache behavior before treating it as exploitable.',
      evidence: `GET ${baseUrl} with Host: ${INJECTED_HOST}\n→ ${source}`,
      remediation: 'Validate the Host header against a strict allowlist of your own domains. Never use the Host header to construct URLs in emails, redirects, or links; use a hardcoded base URL from environment config.',
    }];
  }

  return [];
}

// ── CRLF injection ────────────────────────────────────────────────────────

async function checkCRLFInjection(baseUrl: string): Promise<DeepFinding[]> {
  const CRLF_PAYLOAD = 'test%0d%0aX-Injected%3A%20malicious';
  const testPaths = ['/?q=', '/?name=', '/?search=', '/?redirect='];

  for (const path of testPaths) {
    const url = `${baseUrl}${path}${CRLF_PAYLOAD}`;
    const res = await safeFetch(url, { redirect: 'manual', forbiddenIsBlocked: true });
    if (!res) continue;

    if (res.headers.get('x-injected')) {
      return [{
        id: 'crlf-injection',
        category: 'injection',
        severity: 'high',
        title: 'CRLF Injection: Header Injection Confirmed',
        description: `A CRLF sequence in the ${path} parameter was reflected into HTTP response headers. Attackers can inject arbitrary headers, set cookies, or split the HTTP response to perform session fixation, cache poisoning, or XSS.`,
        evidence: `GET ${url}\n→ X-Injected header appeared in response headers`,
        remediation: 'Strip or reject \\r and \\n characters from any user input reflected into HTTP headers or Location values. Modern frameworks handle this automatically; ensure you are not constructing raw header strings from user input.',
        url,
      }];
    }

    // Also check if CRLF payload was reflected unencoded in body
    const text = await readProbeText(res);
    if (text.includes('X-Injected: malicious')) {
      return [{
        id: 'crlf-body-reflection',
        category: 'injection',
        severity: 'info',
        title: 'Decoded Newline Reflected in Response Body',
        description: `The decoded test string appeared in the response body at ${path}. Body reflection does not establish response-header injection or HTTP response splitting; retain this only as input-handling context.`,
        evidence: `GET ${url}\n→ Decoded newline text reflected in response body`,
        remediation: 'Apply output encoding appropriate to the body context. Separately reject carriage returns/newlines in values used for response headers.',
        url,
      }];
    }
  }
  return [];
}

// ── Score calculation ─────────────────────────────────────────────────────

// ── Build checked[] summary ───────────────────────────────────────────────

function buildChecked(
  findings: DeepFinding[],
  mainRes: Response | null,
  checkCoverage: readonly CheckCoverage[],
  lane: ScanLane,
): import('@/types/deep-scan').CheckedItem[] {
  const coverageByPhase = new Map(checkCoverage.map(entry => [entry.phaseId, entry]));

  function findingsFor(...ids: string[]) {
    return findings.filter(f => ids.some(id => f.id.startsWith(id)));
  }

  function item(
    id: string, label: string, description: string,
    relevant: DeepFinding[],
    passDetail: string,
    phaseId: string,
  ): import('@/types/deep-scan').CheckedItem {
    // Retain the call-site description for now, but do not present it as proof
    // that a broad vulnerability class is absent. These are bounded probes.
    void passDetail;

    // A check the lane never ran is the upsell, so it is shown rather than
    // hidden: this is what verifying your domain would additionally buy.
    if (!phaseRunsInLane(phaseId, lane)) {
      return {
        id, label, description, status: 'skip',
        detail: 'Not run. This check requires domain verification.',
      };
    }

    // One blocked probe used to mark every finding-free check inconclusive.
    // Now only the check that was actually blocked says so.
    if (relevant.length) {
      const worst = relevant.reduce((a, b) => {
        const order = ['critical','high','medium','low','info'];
        return order.indexOf(a.severity) < order.indexOf(b.severity) ? a : b;
      });
      const status = worst.severity === 'low' || worst.severity === 'info' ? 'warn' : 'fail';
      return { id, label, description, status, detail: relevant.map(f => f.title).join(' · ') };
    }

    const cover = coverageByPhase.get(phaseId);
    if (cover?.applicable === false) {
      return {
        id, label, description, status: 'skip',
        detail: `Not applicable. ${cover.reason ?? 'The check had no relevant target to inspect'}.`,
      };
    }
    if (cover && !cover.complete) {
      return {
        id, label, description, status: 'skip',
        detail: `Inconclusive. ${cover.reason}.`,
      };
    }

    if (!relevant.length) {
      return {
        id,
        label,
        description,
        status: 'pass',
        detail: 'No matching evidence was observed in the selected probes. This does not prove the condition is absent.',
      };
    }
    throw new Error('unreachable checked-item state');
  }

  return [
    item('ssl',        'HTTPS / TLS',                  'Valid HTTPS reachability and bounded plain-HTTP redirect enforcement',    findingsFor('ssl-'), mainRes ? 'HTTPS was reachable and the HTTP redirect probe completed' : 'HTTPS could not be reached', 'ssl'),
    item('headers',    'Security Headers',             'CSP, HSTS, X-Frame-Options, XCTO, Referrer-Policy',                     findingsFor('header-'), 'All critical security headers present and correctly configured', 'headers'),
    item('cors',       'CORS Policy',                  'No wildcard+credentials or arbitrary origin reflection on API routes',   findingsFor('cors-', 'crossdomain-'), 'CORS policy is correctly restricted, with no dangerous origin reflection found', 'cors'),
    item('cookies',    'Cookie Security Flags',        'HttpOnly, Secure, SameSite on session/auth cookies',                    findingsFor('cookie-'), 'All cookies have correct HttpOnly, Secure, and SameSite flags', 'cookies'),
    item('sqli',       'SQL Error Differential',       'SQL-shaped inputs on selected parameters, compared with benign controls', findingsFor('sqli-'), 'No differential SQL error signatures were observed', 'sqli'),
    item('xss',        'HTML Reflection Review',       'Unique markup-shaped input on selected search/query parameters',         findingsFor('xss-'), 'No unencoded markup-shaped reflection was observed', 'xss'),
    item('vibe',       'Exposed Secrets in Client Code', 'Supabase secret keys, Stripe secrets, and API credentials in browser-delivered HTML or bundles', findingsFor('vibe-'), 'No exposed secrets or dangerous keys found in browser-delivered code', 'vibe'),
    item('files',      'Sensitive File Exposure',      '.env, .git, wp-config.php, phpinfo.php, backup.sql, .htaccess',         findingsFor('exposed-'), 'No sensitive files or paths accessible publicly', 'files'),
    item('admin',      'Admin Panel Exposure',         '/wp-admin, /phpmyadmin, /cpanel, /adminpanel and other software panels', findingsFor('admin-'), 'No unauthenticated admin panels found at tested paths', 'admin'),
    item('dirlist',    'Directory Listing',            '/uploads, /static, /assets, /files, /backup, checking for open indexes',            findingsFor('directory-'), 'No open directory listings detected', 'dirlist'),
    item('redirect',   'Open Redirect',                '?redirect=, ?url=, ?next=, ?return=, ?goto= hijacking',                 findingsFor('open-redirect'), 'No open redirect vectors found; redirect params are absent or validated', 'redirect'),
    item('errors',     'Error Verbosity',              'Stack traces, file paths, framework versions in error pages',            findingsFor('error-'), 'Error responses use generic messages, disclosing no internals', 'errors'),
    item('info',       'Technology Disclosure',        'Server version, X-Powered-By, X-AspNet-Version in headers',             findingsFor('info-'), 'No detailed server/framework version info disclosed in response headers', 'info'),
    item('serverstatus', 'Apache Server Status',        'Confirmed mod_status content at /server-status', findingsFor('server-status-'), 'No Apache mod_status response was observed', 'serverstatus'),
    item('sri',        'Subresource Integrity',        'Integrity hashes and crossorigin settings on immutable external scripts and stylesheets', findingsFor('sri-'), 'No missing or invalid integrity evidence was observed on selected immutable external resources', 'sri'),
    item('robots',      'robots.txt Path Disclosure',    'Sensitive admin/backup/config paths in Disallow entries',              findingsFor('robots-'),    'robots.txt does not reveal sensitive internal paths', 'robots'),
    item('forced',      'Forced Browsing',               'Unauthenticated access to selected common and passively discovered internal API routes', findingsFor('auth-unprotected'), 'No unauthenticated data-exposure evidence was observed on selected routes', 'forced'),
    item('idor',        'Sequential Object Exposure',    'Reviewing unauthenticated sequential objects on selected API paths',     findingsFor('idor-'),           'No reviewable sequential public object responses were observed', 'idor'),
    item('ssrf',        'Server-Side Request Forgery',   '?url=, ?webhook=, ?proxy= probed with a cloud-metadata target',           findingsFor('ssrf-'),           'No cloud-metadata SSRF indicators found in the bounded probes', 'ssrf'),
    // Described in prose rather than as a literal traversal sequence: this
    // string is stored with every result, and the WAF in front of the database
    // rejects a request body carrying a recognisable exploit payload.
    item('traversal',   'Path Traversal',                'Directory traversal sequences in selected file-like parameters with benign controls', findingsFor('path-traversal'), 'No differential local-file signature was observed', 'traversal'),
    item('components',  'Library Version Review',        'Reviewable jQuery, AngularJS, Lodash, and Moment.js version strings in HTML or bundles', findingsFor('outdated-'), 'No reviewable legacy client-library version strings detected', 'components'),
    item('sourcemaps',  'Source Map Exposure',           'Source map files that may expose source paths, mappings, or embedded sources', findingsFor('source-maps-'), 'No readable source-map evidence was observed for selected scripts', 'sourcemaps'),
    item('supabase',    'Supabase Anonymous Access',     'Bounded reads against passively discovered table names',                 findingsFor('supabase-'),       'No anonymous rows returned from the selected discovered tables', 'supabase'),
    item('firebase',    'Firebase Rules',                'Shallow database and one-item storage reads against exact discovered endpoints', findingsFor('firebase-'), 'No anonymous Firebase listing evidence was observed', 'firebase'),
    item('storage',     'Cloud Storage Listing',         'One-item Supabase Storage and S3 listing requests against discovered projects', findingsFor('storage-'), 'No anonymous bucket listings were observed', 'storage'),
    item('nextauth',    'Next.js Middleware Auth',       'Differential middleware-bypass testing on routes from the public build manifest', findingsFor('next-middleware-'), 'No protected-route bypass response was observed', 'nextauth'),
    item('graphql',     'GraphQL Introspection',         '{__schema} query on /graphql, /api/graphql, /gql, /query',               findingsFor('graphql-'),        'GraphQL introspection disabled or no GraphQL endpoint found', 'graphql'),
    item('apidocs',     'API Documentation Exposure',    '/swagger, /openapi.json, /api-docs, /redoc, checking for public schema exposure',    findingsFor('api-docs-'),       'No public API documentation found at tested paths', 'apidocs'),
    item('nosql',       'NoSQL Error Differential',      'MongoDB-shaped operator inputs compared with benign controls',            findingsFor('nosql-'),          'No differential MongoDB error signatures were observed', 'nosql'),
    item('hostheader',  'Host Header Handling',          'Forged Host value reflected in a successful body or external Location header', findingsFor('host-header-'), 'No forged Host reflection or external redirect was observed', 'hostheader'),
    item('crlf',        'CRLF Injection',                '%0d%0a in query params reflected into response headers',                 findingsFor('crlf-'),           'No CRLF injection; newline sequences are stripped or encoded correctly', 'crlf'),
  ];
}

// ── Check phases (for streaming progress) ────────────────────────────────
// Phase metadata lives in lib/scan-phases.ts so routes, the client, and the
// test suite can read it without loading this module.

export { SCAN_PHASES } from '@/lib/scan-phases';
export type { ScanPhase } from '@/lib/scan-phases';


/** Public builder evidence from the page already fetched. Adds no requests. */
function readProvenance(html: string, res: Response | null, url: string): ScanProvenance {
  const headers: Record<string, string> = {};
  res?.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });

  try {
    const detected = detectVibe(html, headers, url);
    return {
      builder: detected.declaredGenerator ?? null,
      evidence: detected.signals
        .filter(signal => signal.direction === 'supports')
        .map(signal => signal.description),
    };
  } catch {
    // Provenance is decoration. It must never take a security report down.
    return { builder: null, evidence: [] };
  }
}

// ── Main export (with progress callback) ───────────────────────

export async function deepScanDomain(
  target: string | DeepScanTarget,
  lane: ScanLane,
  onPhase?: (phase: ScanPhase, findings: DeepFinding[], progress: ScanPhaseProgress) => void,
  options: DeepScanOptions = {},
): Promise<DeepScanResult> {
  const domain = typeof target === 'string' ? target : target.hostname;
  const startUrl = typeof target === 'string' ? `https://${target}` : target.startUrl;
  const parsedStartUrl = parseScanUrl(startUrl);
  if (parsedStartUrl.hostname.toLowerCase() !== domain.toLowerCase()) {
    throw new Error('The scan page URL does not match the authorized hostname.');
  }
  const requestCoverage: RequestCoverage = {
    requestsAttempted: 0,
    requestsCompleted: 0,
    requestsFailed: 0,
    requestsBlocked: 0,
  };
  const requestContext: ScanRequestContext = {
    authorizedHostnames: new Set([domain.toLowerCase()]),
    lane,
    coverage: requestCoverage,
    deadlineAt: Date.now() + SCAN_BUDGET_MS,
    deadlineExceeded: false,
    providerQuotaTargets: new Set<string>(),
    transport: options.transport ?? pinnedFetch,
  };

  return scanRequestContext.run(requestContext, async () => {
  const start = Date.now();
  let baseUrl = parsedStartUrl.href;
  const allFindings: DeepFinding[] = [];

  const checkCoverage: CheckCoverage[] = [];

  function emitPhase(
    phase: ScanPhase,
    findings: DeepFinding[],
    progress: ScanPhaseProgress,
  ): void {
    try {
      onPhase?.(phase, findings, progress);
    } catch {
      // Progress streaming is observational. A disconnected client must not
      // alter scan coverage or turn a completed probe into a failure.
    }
  }

  async function run<T extends DeepFinding[]>(
    phaseId: string,
    fn: () => Promise<T>,
    applicable = true,
    notApplicableReason = 'No matching provider or framework configuration was discovered',
    initialIncompleteReason: string | null = null,
  ): Promise<T> {
    const phase = SCAN_PHASES.find(p => p.id === phaseId)!;
    // Permission, not payment, decides this. A surface scan never reaches a
    // deep-lane check even if the caller is paying.
    if (!phaseRunsInLane(phaseId, lane)) return [] as unknown as T;

    if (!applicable) {
      const coverage: ScanPhaseRequestCoverage = {
        requestsAttempted: 0,
        requestsCompleted: 0,
        requestsFailed: 0,
        requestsBlocked: 0,
      };
      const outcome = resolveScanPhaseOutcome({
        applicable: false,
        coverage,
        reason: notApplicableReason,
      });
      emitPhase(phase, [], { status: 'start', coverage, durationMs: 0, reason: null });
      checkCoverage.push({
        phaseId,
        ...coverage,
        applicable: false,
        complete: true,
        reason: outcome.reason,
      });
      emitPhase(phase, [], { ...outcome, durationMs: 0 });
      return [] as unknown as T;
    }

    const baseline = snapshotCoverage(requestCoverage);
    const phaseStartedAt = Date.now();
    requestContext.activePhase = {
      phase,
      startedAt: phaseStartedAt,
      baseline,
      reason: initialIncompleteReason,
      emit: progress => emitPhase(phase, [], progress),
    };
    emitPhase(phase, [], {
      status: 'start',
      coverage: coverageSince(requestCoverage, baseline),
      durationMs: 0,
      reason: initialIncompleteReason,
    });

    let results: T;
    try {
      results = await fn();
    } catch (error) {
      // A check that throws is a gap in coverage, never a failed scan.
      results = [] as unknown as T;
      incrementCoverage(requestContext, 'requestsFailed');
      requestContext.activePhase.reason ??= 'The check could not finish safely';
      console.error('Deep scan phase failed', {
        tag: 'deep-scan:phase',
        phaseId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }

    const coverage = coverageSince(requestCoverage, baseline);
    const outcome = resolveScanPhaseOutcome({
      coverage,
      reason: requestContext.activePhase.reason,
    });

    checkCoverage.push({
      phaseId,
      ...coverage,
      applicable: true,
      complete: outcome.status === 'complete',
      reason: outcome.reason,
    });

    // The budget is the one condition that still aborts. Past the deadline
    // every remaining check would be attributed a spurious timeout it never
    // actually suffered.
    if (requestContext.deadlineExceeded) {
      requestContext.activePhase = undefined;
      throw new Error('The scan exceeded its safe execution budget; no result was saved and the allowance will be restored.');
    }

    emitPhase(phase, results, {
      ...outcome,
      durationMs: Date.now() - phaseStartedAt,
    });
    requestContext.activePhase = undefined;
    allFindings.push(...results);
    return results;
  }

  const initStartedAt = Date.now();
  emitPhase(SCAN_PHASES[0], [], { status: 'start', durationMs: 0, reason: null });
  const mainRes = await safeFetch(baseUrl, {
    redirect: 'follow',
    allowCanonicalRedirect: true,
    maxResponseBytes: MAX_PROBE_BODY_BYTES,
  });
  if (!mainRes) {
    throw new Error('Could not reach the verified domain over public HTTP(S); no deep-scan score was produced.');
  }
  if (!mainRes.ok) {
    throw new Error(`The verified domain returned HTTP ${mainRes.status}; no deep-scan score was produced.`);
  }
  const mainHtml = await readProbeText(mainRes);
  if (requestCoverage.requestsFailed > 0 || requestCoverage.requestsBlocked > 0) {
    throw new Error('The verified page could not be read completely; no deep-scan score was produced.');
  }
  emitPhase(SCAN_PHASES[0], [], {
    status: 'complete',
    coverage: {
      requestsAttempted: requestCoverage.requestsAttempted,
      requestsCompleted: requestCoverage.requestsCompleted,
      requestsFailed: requestCoverage.requestsFailed,
      requestsBlocked: requestCoverage.requestsBlocked,
    },
    durationMs: Date.now() - initStartedAt,
    reason: null,
  });
  const finalMainUrl = finalResponseUrls.get(mainRes);
  if (finalMainUrl) baseUrl = new URL(finalMainUrl).origin;

  let clientSource = mainHtml;
  let clientArtifacts = extractClientArtifactsFromSources([mainHtml]);
  let clientBundles: ClientBundleSource[] = [];

  // Builder provenance is context for the report, never a finding. Knowing a
  // page was generated by Lovable explains a pattern of results; it is not
  // itself a weakness, so it carries no severity and no deduction.
  const provenance = readProvenance(mainHtml, mainRes, baseUrl);


  await run('vibe', async () => {
    // Surface-legal discovery: read only exact-origin script assets already
    // referenced by the page. Transport is capped at 8 x 512 KB; at most
    // 2 MB is retained for evidence extraction and later local checks.
    const scriptUrls = extractSameOriginScriptUrls(mainHtml, baseUrl, 8);
    let aggregateBundleBytes = 0;
    const bundleSources: ClientBundleSource[] = [];
    const bundleResults = await mapWithConcurrency(scriptUrls, 3, async scriptUrl => {
      const response = await safeFetch(scriptUrl, {
        redirect: 'follow',
        maxResponseBytes: 512_000,
        headers: { Accept: 'text/javascript, application/javascript, */*;q=0.1' },
      });
      if (!response?.ok) return null;
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (contentType && !/(?:javascript|ecmascript|text\/plain|application\/octet-stream)/.test(contentType)) return null;
      const source = await readBoundedProbeText(response, 512_000);
      if (source === null) return null;
      return {
        url: finalResponseUrls.get(response) ?? scriptUrl,
        source,
      } satisfies ClientBundleSource;
    });
    for (const result of bundleResults) {
      if (aggregateBundleBytes >= 2_000_000) break;
      if (result.status !== 'fulfilled' || result.value === null) continue;
      const bytes = new TextEncoder().encode(result.value.source).byteLength;
      if (aggregateBundleBytes + bytes > 2_000_000) break;
      aggregateBundleBytes += bytes;
      bundleSources.push(result.value);
    }
    clientBundles = bundleSources;
    const bundleSourceTexts = bundleSources.map(bundle => bundle.source);
    clientSource = [mainHtml, ...bundleSourceTexts].join('\n');
    clientArtifacts = extractClientArtifactsFromSources([mainHtml, ...bundleSourceTexts]);
    return checkVibeCodePatterns(baseUrl, clientSource);
  });
  await run('files',    () => checkSensitiveFiles(baseUrl));
  await run('xss',      () => checkXSS(baseUrl));
  await run('sqli',     () => checkSQLInjection(baseUrl));
  await run('cors',     async () => [
    ...await checkCORS(baseUrl),
    ...await checkCrossdomain(baseUrl),
  ]);
  await run('headers',  () => checkSecurityHeaders(mainRes));
  await run(
    'cookies',
    () => checkCookies(mainRes),
    setCookieHeaders(mainRes).length > 0,
    'No Set-Cookie header was observed on the scanned page',
  );
  await run('ssl',      () => checkSSL(domain));
  await run('admin',    () => checkAdminPaths(baseUrl));
  await run('errors',   () => checkErrorVerbosity(baseUrl));
  await run('redirect', () => checkOpenRedirect(baseUrl));
  await run('dirlist',  () => checkDirectoryListing(baseUrl));
  await run('robots',   () => checkRobotsTxt(baseUrl));
  await run('sri',          () => checkSRI(baseUrl, mainHtml));
  await run('info',         () => checkInfoDisclosure(mainRes));
  await run('serverstatus', () => checkServerStatus(baseUrl));
  await run('forced',     () => checkForcedBrowsing(baseUrl, clientArtifacts.routeLiterals));
  await run('idor',       () => checkIDOR(baseUrl));
  await run('ssrf',       () => checkSSRF(baseUrl));
  await run('traversal',  () => checkPathTraversal(baseUrl));
  await run('components',  () => checkOutdatedLibraries(clientSource));
  await run(
    'sourcemaps',
    () => checkSourceMaps(baseUrl, clientBundles),
    clientBundles.length > 0,
    'No readable same-origin JavaScript bundle was available for source-map discovery',
  );
  await run(
    'supabase',
    () => checkSupabaseExposure(clientArtifacts),
    !!clientArtifacts.supabase,
    'No Supabase client configuration was discovered',
  );
  await run(
    'firebase',
    () => checkFirebaseExposure(clientArtifacts),
    !!(clientArtifacts.firebase?.databaseUrl || clientArtifacts.firebase?.storageBucket),
  );
  await run('storage', async () => [
    ...await checkSupabaseStorage(clientArtifacts),
    ...await checkS3Listings(clientArtifacts),
  ], !!clientArtifacts.supabase || clientArtifacts.s3Hosts.length > 0);
  await run('nextauth', () => checkNextMiddlewareBypass(baseUrl, mainHtml), !!extractNextBuildId(mainHtml));
  await run('graphql',    () => checkGraphQL(baseUrl));
  await run('apidocs',    () => checkAPIDocumentation(baseUrl));
  await run('nosql',      () => checkNoSQLInjection(baseUrl));
  await run('hostheader', () => checkHostHeaderInjection(baseUrl));
  await run('crlf',       () => checkCRLFInjection(baseUrl));

  const expectedCoverageIds = phasesForLane(SCAN_PHASES, lane)
    .map(phase => phase.id)
    .filter(phaseId => phaseId !== 'init' && phaseId !== 'done');
  const recordedCoverageIds = checkCoverage.map(check => check.phaseId);
  if (
    recordedCoverageIds.length !== expectedCoverageIds.length
    || new Set(recordedCoverageIds).size !== recordedCoverageIds.length
    || expectedCoverageIds.some((phaseId, index) => recordedCoverageIds[index] !== phaseId)
  ) {
    throw new Error('The scanner did not account for every expected check; no grade was produced.');
  }

  const donePhase = SCAN_PHASES[SCAN_PHASES.length - 1];
  const doneStartedAt = Date.now();
  emitPhase(donePhase, [], { status: 'start', durationMs: 0, reason: null });

  const findings = allFindings;
  const count = (sev: DeepFinding['severity']) => findings.filter(f => f.severity === sev).length;
  const coverageComplete = checkCoverage.every(check => check.complete);

  const result: DeepScanResult = {
    domain,
    lane,
    scannedAt: new Date().toISOString(),
    duration: Date.now() - start,
    versions: {
      scanner: DEEP_SCANNER_VERSION,
      scoring: DEEP_SCORING_VERSION,
      coverage: DEEP_COVERAGE_VERSION,
      lane,
    },
    summary: {
      critical: count('critical'),
      high: count('high'),
      medium: count('medium'),
      low: count('low'),
      info: count('info'),
      score: scoreIsWithheld(checkCoverage) ? null : calculateDeepScore(findings),
    },
    coverage: { ...requestCoverage, complete: coverageComplete, checks: checkCoverage },
    provenance,
    findings,
    checked: buildChecked(findings, mainRes, checkCoverage, lane),
  };
  if (!options.deferDoneCompletion) {
    emitPhase(donePhase, [], {
      status: 'complete',
      durationMs: Date.now() - doneStartedAt,
      reason: null,
    });
  }
  return result;
  });
}

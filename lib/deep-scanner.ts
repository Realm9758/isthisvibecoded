import type { DeepFinding, DeepScanResult } from '@/types/deep-scan';
import { assertPublicTarget } from '@/lib/url-safety';
import { analyzeSecurityHeaders } from '@/lib/security-headers';
import { AsyncLocalStorage } from 'node:async_hooks';

const TIMEOUT = 8000;
const SCAN_BUDGET_MS = 42_000;
const MAX_REDIRECTS = 5;
const MAX_PROBE_BODY_BYTES = 512_000;
const UA = 'VibeScan-DeepScan/1.0 (Security Audit; Owner-Verified)';

type RequestCoverage = {
  requestsAttempted: number;
  requestsCompleted: number;
  requestsFailed: number;
  requestsBlocked: number;
};

const scanRequestContext = new AsyncLocalStorage<{
  authorizedHostname: string;
  coverage: RequestCoverage;
  deadlineAt: number;
  deadlineExceeded: boolean;
}>();

type SafeFetchOptions = RequestInit & {
  /** A 429 is successful evidence only for the dedicated throttling probe. */
  allowRateLimitResponse?: boolean;
};

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
    const { allowRateLimitResponse = false, ...requestOptions } = options ?? {};
    const requestedRedirectMode = requestOptions.redirect ?? 'follow';
    let currentUrl = parseScanUrl(url);
    const verifiedHostname = context?.authorizedHostname ?? currentUrl.hostname.toLowerCase();
    if (currentUrl.hostname.toLowerCase() !== verifiedHostname) {
      if (context) context.coverage.requestsBlocked++;
      return null;
    }
    let method = requestOptions.method?.toUpperCase() ?? 'GET';
    let body = requestOptions.body;

    const headers = new Headers(requestOptions.headers);
    if (!headers.has('user-agent')) headers.set('user-agent', UA);

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      if (context && Date.now() >= context.deadlineAt) {
        context.deadlineExceeded = true;
        context.coverage.requestsFailed++;
        return null;
      }
      // Re-resolve and reject private/reserved addresses immediately before
      // every request, including each redirect destination.
      if (context) context.coverage.requestsAttempted++;
      await assertPublicTarget(currentUrl);

      const remainingBudget = context ? Math.max(1, context.deadlineAt - Date.now()) : TIMEOUT;
      const res = await fetch(currentUrl, {
        ...requestOptions,
        method,
        body,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.min(TIMEOUT, remainingBudget)),
      });
      if (context) {
        if (res.status >= 500 || (res.status === 429 && !allowRateLimitResponse)) {
          context.coverage.requestsFailed++;
        } else {
          context.coverage.requestsCompleted++;
        }
      }

      const isRedirect = res.status >= 300 && res.status < 400;
      const location = res.headers.get('location');
      if (!isRedirect || !location || requestedRedirectMode === 'manual') return res;
      if (requestedRedirectMode === 'error') {
        if (context) context.coverage.requestsFailed++;
        return null;
      }
      if (redirectCount === MAX_REDIRECTS) {
        if (context) context.coverage.requestsFailed++;
        return null;
      }

      const redirectUrl = parseScanUrl(new URL(location, currentUrl).href);
      // Domain-control verification applies to one exact host. Never forward
      // active payloads to a different host merely because the verified site
      // redirects there.
      if (redirectUrl.hostname.toLowerCase() !== verifiedHostname) {
        if (context) context.coverage.requestsBlocked++;
        return null;
      }
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
      context.coverage.requestsFailed++;
    }
    return null;
  }
}

function recordProbeBodyFailure(): void {
  const context = scanRequestContext.getStore();
  if (context) context.coverage.requestsFailed++;
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
    title: 'Git Config Exposed',
    severity: 'high',
    description: 'Git repository config is accessible. This can expose remote URLs and potentially embedded credentials.',
    remediation: 'Block access to the .git directory entirely in your server configuration.',
  },
  {
    path: '/.git/HEAD',
    title: 'Git Repository Exposed',
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
  // /server-status is checked separately with content verification — a 200 response
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
  // crossdomain.xml is checked separately with content analysis — not via the static list
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

function validateSensitiveFile(path: string, body: string, contentType: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const looksHtml = contentType.toLowerCase().includes('text/html')
    || /<!doctype\s+html|<html\b|<body\b/i.test(trimmed.slice(0, 4_000));

  if (path === '/phpinfo.php' || path === '/info.php') {
    return /phpinfo\(\)|<title>php\s*\d|PHP Version/i.test(trimmed)
      ? 'phpinfo output markers detected'
      : null;
  }
  if (looksHtml) return null;

  if (path.startsWith('/.env')) {
    const assignments = trimmed.match(/^[A-Z_][A-Z0-9_]*\s*=.+$/gm) ?? [];
    return assignments.length >= 2 ? `${assignments.length} environment assignments detected` : null;
  }
  if (path === '/.git/config') {
    return /^\s*\[core\]/m.test(trimmed) && /repositoryformatversion|\[remote\s+"origin"\]/i.test(trimmed)
      ? 'Git configuration syntax detected'
      : null;
  }
  if (path === '/.git/HEAD') {
    return /^(?:ref:\s+refs\/(?:heads|tags)\/[^\s]+|[a-f0-9]{40})$/i.test(trimmed)
      ? 'Git HEAD reference detected'
      : null;
  }
  if (path === '/wp-config.php') {
    return /<\?php/i.test(trimmed) && /DB_(?:NAME|USER|PASSWORD|HOST)|AUTH_KEY|SECURE_AUTH_KEY/i.test(trimmed)
      ? 'WordPress configuration constants detected'
      : null;
  }
  if (path.endsWith('.sql')) {
    return /(?:--\s+(?:MySQL|PostgreSQL).*dump|CREATE\s+TABLE|INSERT\s+INTO|COPY\s+[^\s]+\s+FROM)/i.test(trimmed)
      ? 'SQL dump syntax detected'
      : null;
  }
  if (path === '/.htaccess') {
    return /^(?:RewriteEngine|RewriteRule|Options|AuthType|Require|Deny\s+from)\b/im.test(trimmed)
      ? 'Apache configuration directives detected'
      : null;
  }
  if (path === '/config.json' || path === '/storage.json') {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== 'object') return null;
      return /["'](?:password|passwd|secret|private[_-]?key|access[_-]?token|credential|database[_-]?(?:url|uri))["']\s*:/i.test(trimmed)
        ? 'Sensitive-looking JSON configuration keys detected'
        : null;
    } catch {
      return null;
    }
  }
  if (path === '/.DS_Store') return body.includes('Bud1') ? 'DS_Store binary signature detected' : null;
  if (path === '/.npmrc') return /(?:_authToken|_auth|password)\s*=/i.test(trimmed) ? 'npm credential directive detected' : null;
  if (path === '/docker-compose.yml') return /^\s*services\s*:/m.test(trimmed) && /^\s+(?:image|build)\s*:/m.test(trimmed) ? 'Docker Compose structure detected' : null;
  if (path === '/Dockerfile') return /^\s*FROM\s+\S+/im.test(trimmed) ? 'Dockerfile FROM instruction detected' : null;
  if (path === '/.travis.yml') return /^\s*(?:language|script|deploy)\s*:/m.test(trimmed) ? 'Travis CI configuration detected' : null;
  if (path === '/config/database.yml') return /^\s*adapter\s*:/m.test(trimmed) && /^\s*(?:database|username|password)\s*:/m.test(trimmed) ? 'Rails database configuration detected' : null;
  return null;
}

async function checkSensitiveFiles(baseUrl: string): Promise<DeepFinding[]> {
  const results = await Promise.allSettled(
    SENSITIVE_FILES.map(async (file) => {
      const url = `${baseUrl}${file.path}`;
      const res = await safeFetch(url, { redirect: 'follow' });
      return { file, res, url };
    })
  );

  const findings: DeepFinding[] = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { file, res, url } = r.value;
    if (res?.status === 200) {
      const body = await readBoundedBody(res);
      if (body === null) continue;
      const validation = validateSensitiveFile(file.path, body, res.headers.get('content-type') ?? '');
      if (!validation) continue;
      findings.push({
        id: `exposed-${file.path}`,
        category: 'exposed-files',
        severity: file.severity,
        title: file.title,
        description: file.description,
        evidence: `GET ${url} → HTTP 200; ${validation}`,
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
        severity: 'high',
        title: 'CORS Allows Credentialed Null Origin',
        description: 'The server allows the null origin together with credentials. Sandboxed or local-document origins may be able to read this response with user credentials when the endpoint returns sensitive data.',
        evidence: 'Access-Control-Allow-Origin: null\nAccess-Control-Allow-Credentials: true',
        remediation: 'Do not allow credentialed null origins. Use an exact allowlist of trusted HTTPS origins.',
      });
    }
    // Wildcard on the HTML page itself is only a real issue if credentials are also allowed
    // Don't flag it on regular pages — only flag on API routes
  }

  // Test CORS on API endpoints — this is where wildcard is actually dangerous
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
      findings.push({
        id: 'cors-reflect-credentials',
        category: 'cors',
        severity: 'high',
        title: 'API CORS Reflects Arbitrary Origin with Credentials',
        description: `${path} accepted the scanner's untrusted Origin value on a successful response and allowed credentials. If this endpoint returns user-specific or sensitive data, an attacker-controlled origin could read that response in a signed-in user's browser.`,
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

async function checkCookies(res: Response | null): Promise<DeepFinding[]> {
  if (!res) return [];

  const cookieHeaders: string[] = [];
  try {
    const all = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.();
    if (all?.length) cookieHeaders.push(...all);
  } catch { /* ignore */ }
  if (!cookieHeaders.length) {
    const raw = res.headers.get('set-cookie');
    if (raw) cookieHeaders.push(raw);
  }
  if (!cookieHeaders.length) return [];

  const findings: DeepFinding[] = [];

  for (const cookie of cookieHeaders) {
    const name = cookie.split('=')[0].trim();
    const attributes = cookie
      .split(';')
      .slice(1)
      .map(attribute => attribute.trim().toLowerCase());
    const isAuth = /session|auth|token|jwt|sid|user/i.test(name);
    const hasHttpOnly = attributes.includes('httponly');
    const hasSecure = attributes.includes('secure');
    const hasSameSite = attributes.some(attribute => attribute.startsWith('samesite='));

    if (isAuth && !hasHttpOnly) {
      findings.push({
        id: `cookie-httponly-${name}`,
        category: 'cookies',
        severity: 'high',
        title: `Auth Cookie Missing HttpOnly: ${name}`,
        description: `"${name}" appears to be a session/auth cookie but lacks HttpOnly — JavaScript can steal it during an XSS attack.`,
        evidence: `Set-Cookie: ${cookie.split(';')[0]}`,
        remediation: 'Add the HttpOnly flag to all session and authentication cookies.',
      });
    }

    if (!hasSecure) {
      findings.push({
        id: `cookie-secure-${name}`,
        category: 'cookies',
        severity: isAuth ? 'medium' : 'info',
        title: `Cookie Missing Secure Flag: ${name}`,
        description: isAuth
          ? `"${name}" appears authentication-related and lacks the Secure flag, so it can be transmitted if the site is reached over plain HTTP.`
          : `"${name}" lacks the Secure flag. Its impact depends on whether the cookie carries sensitive or security-relevant state.`,
        evidence: `Set-Cookie: ${cookie.split(';')[0]}`,
        remediation: 'Add the Secure flag to all cookies with sensitive data.',
      });
    }

    if (!hasSameSite) {
      findings.push({
        id: `cookie-samesite-${name}`,
        category: 'cookies',
        severity: isAuth ? 'low' : 'info',
        title: `Cookie Missing SameSite: ${name}`,
        description: `"${name}" has no explicit SameSite attribute. Modern browsers commonly apply a Lax default, but an explicit setting makes intended cross-site behavior auditable; this observation alone does not prove CSRF exposure.`,
        evidence: `Set-Cookie: ${cookie.split(';')[0]}`,
        remediation: 'Add SameSite=Lax (or Strict) to cookies. Use SameSite=None only with Secure for cross-site cookies.',
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
      severity: 'low',
      title: 'Server Version Disclosed',
      description: `The Server header reveals the exact version: "${server}". Attackers use this to target known CVEs for that version.`,
      evidence: `Server: ${server}`,
      remediation: 'Suppress or genericize the Server header in your web server config.',
    });
  }

  if (xpb) {
    findings.push({
      id: 'info-x-powered-by',
      category: 'info-disclosure',
      severity: 'low',
      title: 'Technology Disclosed via X-Powered-By',
      description: `X-Powered-By reveals the technology stack: "${xpb}". Assists targeted attacks.`,
      evidence: `X-Powered-By: ${xpb}`,
      remediation: 'Remove the X-Powered-By header.',
    });
  }

  if (aspnet) {
    findings.push({
      id: 'info-aspnet-version',
      category: 'info-disclosure',
      severity: 'medium',
      title: 'ASP.NET Version Disclosed',
      description: `X-AspNet-Version reveals the exact .NET version: "${aspnet}".`,
      evidence: `X-AspNet-Version: ${aspnet}`,
      remediation: 'Disable via web.config: <httpRuntime enableVersionHeader="false"/>',
    });
  }

  return findings;
}

// ── HTTP methods ──────────────────────────────────────────────────────────

async function checkHTTPMethods(baseUrl: string): Promise<DeepFinding[]> {
  const findings: DeepFinding[] = [];

  const optRes = await safeFetch(baseUrl, { method: 'OPTIONS' });
  if (optRes) {
    const allow = (optRes.headers.get('allow') ?? optRes.headers.get('access-control-allow-methods') ?? '').toUpperCase();
    if (allow.includes('TRACE')) {
      findings.push({
        id: 'methods-trace',
        category: 'http-methods',
        severity: 'medium',
        title: 'HTTP TRACE Method Enabled',
        description: 'TRACE is enabled. Cross-Site Tracing (XST) attacks can steal cookies even when HttpOnly is set.',
        evidence: `Allow: ${allow}`,
        remediation: 'Disable TRACE in your web server configuration.',
      });
    }
    const dangerous = ['PUT', 'DELETE'].filter(m => allow.includes(m));
    if (dangerous.length) {
      findings.push({
        id: 'methods-dangerous',
        category: 'http-methods',
        severity: 'low',
        title: `Potentially Dangerous Methods Allowed: ${dangerous.join(', ')}`,
        description: `The server advertises ${dangerous.join(', ')}. Verify these are intentionally enabled and protected by authentication.`,
        evidence: `Allow: ${allow}`,
        remediation: 'Disable any HTTP methods not explicitly required. Protect write methods with strong authentication.',
      });
    }
  }

  return findings;
}

// ── SSL / HTTPS enforcement ───────────────────────────────────────────────

async function checkSSL(domain: string): Promise<DeepFinding[]> {
  const findings: DeepFinding[] = [];

  const httpRes = await safeFetch(`http://${domain}`, { redirect: 'manual' });
  if (httpRes) {
    if (httpRes.status === 200) {
      findings.push({
        id: 'ssl-http-accessible',
        category: 'ssl',
        severity: 'high',
        title: 'Site Accessible over HTTP',
        description: 'The site responds to plain HTTP without redirecting to HTTPS. Traffic can be intercepted.',
        evidence: `http://${domain} → HTTP 200`,
        remediation: 'Add a 301 redirect from HTTP to HTTPS for all requests.',
      });
    } else if (httpRes.status >= 300 && httpRes.status < 400) {
      const loc = httpRes.headers.get('location') ?? '';
      if (!loc.startsWith('https://')) {
        findings.push({
          id: 'ssl-bad-redirect',
          category: 'ssl',
          severity: 'medium',
          title: 'HTTP Redirect Not Targeting HTTPS',
          description: `HTTP redirects to "${loc}" instead of https://. Users may stay on unencrypted connections.`,
          evidence: `http://${domain} → ${httpRes.status} ${loc}`,
          remediation: 'Ensure HTTP redirects point to the HTTPS version.',
        });
      }
    } else {
      findings.push({
        id: 'ssl-http-not-redirected',
        category: 'ssl',
        severity: 'info',
        title: 'Plain HTTP Did Not Redirect to HTTPS',
        description: `The plain-HTTP endpoint returned ${httpRes.status} instead of an HTTPS redirect. The response may be intentionally blocked and this does not prove content is exposed, but a blanket redirect gives clients a clearer upgrade path.`,
        evidence: `http://${domain} → HTTP ${httpRes.status}`,
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
  // Only flag paths that are genuinely non-obvious and give attackers real info.
  // /admin, /login, /dashboard are universally guessed — listing them adds no signal
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
      severity: 'low',
      title: 'robots.txt Reveals Non-Obvious Sensitive Paths',
      description: `robots.txt lists specific internal paths that attackers wouldn't otherwise guess: ${disallowed.join(', ')}. While Disallow prevents crawling, it serves as a directory of targets.`,
      evidence: disallowed.map(p => `Disallow: ${p}`).join('\n'),
      remediation: 'Remove non-obvious internal paths from robots.txt. Security should not depend on obscurity — protect these endpoints with authentication instead.',
    },
  ];
}

// ── crossdomain.xml — content-aware check ────────────────────────────────

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
    evidence: `GET ${baseUrl}/crossdomain.xml → 200\n${text.substring(0, 200)}`,
    remediation: 'Replace `domain="*"` with a specific allowlist of trusted domains. If Flash/Silverlight is not used, remove the file entirely.',
    url: `${baseUrl}/crossdomain.xml`,
  }];
}

// ── Apache server-status — content-aware check ───────────────────────────

async function checkServerStatus(baseUrl: string): Promise<DeepFinding[]> {
  const res = await safeFetch(`${baseUrl}/server-status`);
  if (!res || res.status !== 200) return [];
  const text = await readProbeText(res);
  // Confirm this is actual Apache mod_status output — not just a 200 page
  const isRealStatus = /Apache\s+Server\s+Status|Current\s+Time.*Server\s+uptime|requests\s+currently\s+being\s+processed/i.test(text);
  if (!isRealStatus) return [];
  return [{
    id: 'server-status-exposed',
    category: 'info-disclosure',
    severity: 'high',
    title: 'Apache Server Status Page Exposed',
    description: 'Apache mod_status is publicly accessible, exposing real-time server info: active connections, request URIs, worker states, and client IPs — useful for targeted attacks.',
    evidence: `GET ${baseUrl}/server-status → 200 (Apache mod_status content confirmed)`,
    remediation: 'Restrict /server-status to localhost or trusted IPs: `Require ip 127.0.0.1`',
    url: `${baseUrl}/server-status`,
  }];
}

// ── Admin path discovery ──────────────────────────────────────────────────

// Only paths that are unambiguously admin/management software — not generic app routes
// like /dashboard (user dashboards) or /portal (marketing pages), /root, /manager
const ADMIN_PATHS = [
  '/admin', '/admin/', '/administrator', '/administrator/',
  '/wp-admin', '/wp-admin/',
  '/cpanel', '/phpmyadmin', '/phpmyadmin/', '/pma', '/pma/',
  '/admin/login', '/adminpanel', '/controlpanel', '/superadmin',
  '/manager/html', '/manager/text',  // Tomcat manager — specific path
  '/cms', '/cms/',
];

// Patterns that confirm the page is actually an admin panel with live content
const ADMIN_CONTENT_INDICATORS = [
  /phpMyAdmin/i,
  /cPanel/i,
  /Plesk\b/,
  /WHM\b/,
  /Webmin/i,
  /admin(?:istrat(?:ion|or))?\s+(?:panel|console|dashboard|area)/i,
  /manage\s+users/i,
  /user\s+management/i,
  /site\s+administration/i,
  /id=["']wpadminbar["']/i,
  /id=["']wpwrap["']/i,
];

// Patterns that indicate the page is merely a login gate (admin IS protected)
const LOGIN_GATE_PATTERNS = [
  /type=["']password["']/i,
  /window\.location.*login/i,
  /href=["'][^"']*login/i,
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

      const hasAdminContent = ADMIN_CONTENT_INDICATORS.some(re => re.test(text));
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
    title: `Admin Panel Accessible Without Auth: ${exposed.slice(0, 3).join(', ')}${exposed.length > 3 ? '…' : ''}`,
    description: `${exposed.length} admin path${exposed.length > 1 ? 's' : ''} returned HTTP 200 with admin panel content and no login gate. Exposed admin panels are high-value targets for attackers.`,
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
    for (const payload of SQL_PAYLOADS) {
      const url = `${baseUrl}${path}${encodeURIComponent(payload)}`;
      const res = await safeFetch(url);
      if (!res) continue;
      const text = await readProbeText(res);
      const match = SQL_ERROR_PATTERNS.find(re => re.test(text));
      if (match) {
        return [{
          id: 'sqli-error-based',
          category: 'info-disclosure',
          severity: 'medium',
          title: 'Database Error Disclosed After Crafted Input',
          description: 'A SQL-shaped error string appeared after crafted input. This may expose implementation details, but one error response does not prove injectable query execution or database compromise without a differential control and exploit confirmation.',
          evidence: `GET ${url}\n→ SQL error: ${text.match(match)?.[0] ?? 'pattern matched'}`,
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
      const snippet = text.substring(text.search(match), text.search(match) + 120).replace(/<[^>]+>/g, '').trim();
      return [{
        id: 'error-stack-trace',
        category: 'info-disclosure',
        severity: 'medium',
        title: 'Stack Trace / Verbose Error Disclosed',
        description: 'The server returns detailed error messages or stack traces to the public. These reveal internal file paths, library versions, and code structure.',
        evidence: `GET ${url}\n→ ${snippet}…`,
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
      if (loc.startsWith(TARGET) || loc.includes('evil-attacker-test.com')) {
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

  // Exposed Supabase URL + anon key in client HTML
  const supabaseUrl = html.match(/https:\/\/[a-z0-9]+\.supabase\.co/);
  const supabaseAnonKey = html.match(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (supabaseUrl && supabaseAnonKey) {
    // Decode to check if it's anon (not service role)
    let isServiceRole = false;
    try {
      const payload = JSON.parse(atob(supabaseAnonKey[0].split('.')[1]));
      isServiceRole = payload.role === 'service_role';
    } catch { /* ignore */ }

    if (isServiceRole) {
      findings.push({
        id: 'vibe-supabase-service-role',
        category: 'exposed-files',
        severity: 'critical',
        title: 'Supabase Service Role Key Exposed in Client HTML',
        description: 'A Supabase SERVICE ROLE key is embedded in the client-side HTML. This key bypasses Row Level Security and gives full database access — read, write, and delete everything. Immediate action required.',
        evidence: `Supabase URL: ${supabaseUrl[0]}\nService role JWT found in page HTML`,
        remediation: '1. Rotate the key immediately in Supabase → Project Settings → API.\n2. Never use the service_role key client-side — only use the anon key in the browser.\n3. Move service_role to server-side only (API routes, server components).',
      });
    } else {
      findings.push({
        id: 'vibe-supabase-anon-key',
        category: 'info-disclosure',
        severity: 'info',
        title: 'Supabase Anon Key Visible in Client HTML',
        description: 'The Supabase anon (public) key is embedded in the client HTML. This is normal and expected for client-side Supabase usage — the anon key is designed to be public. Security depends entirely on your Row Level Security (RLS) policies.',
        evidence: `Supabase project: ${supabaseUrl[0]}`,
        remediation: 'Verify your Supabase tables have RLS enabled with appropriate policies. The anon key is safe to expose — but RLS must be configured correctly.',
      });
    }
  }

  // Exposed Firebase config
  const firebaseConfig = html.match(/apiKey:\s*["']AIza[A-Za-z0-9_-]{35}["']/);
  if (firebaseConfig) {
    findings.push({
      id: 'vibe-firebase-config',
      category: 'info-disclosure',
      severity: 'info',
      title: 'Firebase Config Visible in Client HTML',
      description: 'Firebase configuration (apiKey, projectId, etc.) is embedded in the HTML. Firebase API keys are designed to be public — security depends on Firebase Security Rules, not key secrecy.',
      evidence: firebaseConfig[0].substring(0, 60) + '…',
      remediation: 'Verify your Firestore and Storage security rules are configured correctly. Firebase API keys are public by design — rules are your security layer.',
    });
  }

  // Exposed Stripe publishable key (fine) vs secret key (not fine)
  const stripeSecret = html.match(/sk_(?:live|test)_[A-Za-z0-9]{24,}/);
  if (stripeSecret) {
    findings.push({
      id: 'vibe-stripe-secret',
      category: 'exposed-files',
      severity: 'critical',
      title: 'Stripe Secret Key Exposed in Client HTML',
      description: 'A Stripe SECRET key is embedded in the client-side HTML. Anyone can use this to read your customers, create charges, issue refunds, and access all payment data.',
      evidence: `sk_...${stripeSecret[0].slice(-6)} found in page source`,
      remediation: '1. Rotate the key immediately at dashboard.stripe.com → Developers → API Keys.\n2. Move all Stripe secret key usage to server-side API routes only.\n3. The publishable key (pk_...) is safe for client use.',
    });
  }

  // Generic API key patterns in HTML
  const genericApiKey = html.match(/(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*["']([A-Za-z0-9_\-]{20,})["']/i);
  if (genericApiKey && !html.includes('REPLACE_ME') && !html.includes('your-api-key')) {
    findings.push({
      id: 'vibe-api-key-html',
      category: 'info-disclosure',
      severity: 'info',
      title: 'Client-Visible API-Key-Shaped Value Needs Review',
      description: 'A generic key-shaped value appears in the page HTML. Public client keys, documentation examples, and placeholders can match this pattern, so it is not treated as a leaked secret without a provider-specific secret signature.',
      evidence: genericApiKey[0].substring(0, 80),
      remediation: 'Identify the provider and intended scope. Rotate and move the value server-side only if its documentation classifies it as a secret; otherwise apply the provider-recommended origin, API, and quota restrictions.',
    });
  }

  // Missing RLS warning for Supabase sites with no auth headers
  const hasSupabase = html.includes('supabase');
  if (hasSupabase && !supabaseAnonKey) {
    // Check if any API endpoint returns data without auth
    const apiRes = await safeFetch(`${baseUrl}/api/user`, {
      headers: { 'Accept': 'application/json' },
    });
    if (apiRes?.status === 200) {
      const body = await readProbeText(apiRes);
      if (body.includes('"email"') || body.includes('"userId"') || body.includes('"id"')) {
        findings.push({
          id: 'vibe-api-no-auth',
          category: 'authentication',
          severity: 'high',
          title: 'User Data API Endpoint Unauthenticated',
          description: '/api/user returns what appears to be user data without requiring authentication. This may expose personal information to unauthenticated requests.',
          evidence: `GET ${baseUrl}/api/user → 200 with user-like JSON fields`,
          remediation: 'Add authentication checks to all API routes that return user data. Verify the auth cookie/token before returning any sensitive data.',
          url: `${baseUrl}/api/user`,
        });
      }
    }
  }

  return findings;
}

// ── Reflected XSS detection ───────────────────────────────────────────────

async function checkXSS(baseUrl: string): Promise<DeepFinding[]> {
  const XSS_PAYLOAD = '<script>alert(1)</script>';
  const testPaths = ['/?q=', '/search?q=', '/?s=', '/?name=', '/?message='];

  for (const path of testPaths) {
    const url = `${baseUrl}${path}${encodeURIComponent(XSS_PAYLOAD)}`;
    const res = await safeFetch(url);
    if (!res) continue;
    const text = await readProbeText(res);
    // Reflected unencoded — actual XSS
    if (text.includes('<script>alert(1)</script>')) {
      return [{
        id: 'xss-reflected',
        category: 'injection',
        severity: 'medium',
        title: 'Unencoded Script-Tag Reflection Needs Browser Validation',
        description: `The test string sent to ${path} reappeared unencoded in the response source. It may still be inside JSON, a comment, a template, or another inert context; confirm execution in a controlled browser before classifying it as XSS.`,
        evidence: `GET ${url}\n→ Response contains: <script>alert(1)</script> (unencoded)`,
        remediation: 'HTML-encode all user input before rendering. Use Content-Security-Policy to block inline scripts. Use a templating engine that escapes by default.',
        url,
      }];
    }
    // Reflection alone is not XSS: the value may be in text, JSON, an inert
    // attribute, or an encoded script value. Only the executable-tag fixture
    // above is reported until context-aware browser validation exists.
  }
  return [];
}

// ── Subresource Integrity ─────────────────────────────────────────────────

async function checkSRI(baseUrl: string, html: string): Promise<DeepFinding[]> {
  if (!html) return [];

  // Find external scripts/stylesheets without integrity attribute
  const externalScripts = [...html.matchAll(/<script[^>]+src=["']https?:\/\/(?!.*localhost)[^"']+["'][^>]*>/gi)];
  const externalStyles  = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:\/\/[^"']+["'][^>]*>/gi)];

  const noIntegrity = [...externalScripts, ...externalStyles]
    .map(m => m[0])
    .filter(tag => !tag.includes('integrity='))
    .slice(0, 5);

  if (!noIntegrity.length) return [];

  return [{
    id: 'sri-missing',
    category: 'headers',
    severity: 'low',
    title: `${noIntegrity.length} External Resource${noIntegrity.length > 1 ? 's' : ''} Without Subresource Integrity`,
    description: 'External scripts or stylesheets are loaded without fixed integrity hashes. SRI can add supply-chain defence for immutable third-party assets, but it is not suitable for every dynamically versioned resource and its absence is not an exploit by itself.',
    evidence: noIntegrity.map(t => t.substring(0, 120)).join('\n'),
    remediation: 'Add integrity="sha384-..." and crossorigin="anonymous" to all external <script> and <link> tags. Use srihash.org to generate hashes.',
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
      } else if (hasMaterialValue && /^(?:email|user_?id|role|users|api_?key|token)$/i.test(key) && severity !== 'high') {
        severity = 'medium';
      }
      visit(child, depth + 1);
    }
  }
  visit(parsed, 0);
  return severity;
}

async function checkForcedBrowsing(baseUrl: string): Promise<DeepFinding[]> {
  const PROTECTED_PATHS = [
    '/api/admin', '/api/users', '/api/user/list', '/api/orders',
    '/api/config', '/api/settings', '/api/keys', '/api/secrets',
    '/api/dashboard', '/api/internal', '/api/billing', '/api/payments',
    '/admin/api', '/api/v1/users', '/api/v2/users',
  ];

  const results = await Promise.allSettled(
    PROTECTED_PATHS.map(async (path) => {
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
    remediation: 'Add authentication middleware to all API routes. Return 401 for unauthenticated requests. Never rely on obscurity — assume all endpoint paths are known to attackers.',
  }];
}

// ── IDOR — insecure direct object reference (A01) ─────────────────────────

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
      remediation: 'Check ownership on every resource request — verify the authenticated user owns the record before returning it. Return 403 for resources belonging to other users. Use non-sequential UUIDs as identifiers.',
      url: `${baseUrl}${path}1`,
    }];
  }

  return [];
}

// ── SSRF — server-side request forgery (A10) ──────────────────────────────

async function checkSSRF(baseUrl: string): Promise<DeepFinding[]> {
  const SSRF_PARAMS = ['?url=', '?webhook=', '?callback=', '?proxy=', '?fetch=', '?link=', '?image=', '?src='];
  const METADATA_TARGET = 'http://169.254.169.254/latest/meta-data/';

  for (const param of SSRF_PARAMS) {
    // Cloud metadata probe
    const metaUrl = `${baseUrl}${param}${encodeURIComponent(METADATA_TARGET)}`;
    const metaRes = await safeFetch(metaUrl);
    if (metaRes?.status === 200) {
      const text = await readProbeText(metaRes);
      if (/ami-id|instance-id|security-credentials|iam\//.test(text)) {
        const controlUrl = `${baseUrl}${param}${encodeURIComponent('vibescan-control-value')}`;
        const controlRes = await safeFetch(controlUrl);
        const controlText = controlRes?.status === 200 ? await readProbeText(controlRes) : '';
        if (/ami-id|instance-id|security-credentials|iam\//.test(controlText)) continue;
        return [{
          id: 'ssrf-metadata',
          category: 'authentication',
          severity: 'critical',
          title: 'SSRF — Cloud Metadata Endpoint Accessible',
          description: `The ${param.replace('?', '').replace('=', '')} parameter fetched the AWS instance metadata endpoint and returned cloud data. Attackers can steal IAM credentials to gain full cloud account access.`,
          evidence: `GET ${metaUrl}\n→ Response contains cloud metadata (ami-id / iam credentials)`,
          remediation: 'Validate and allowlist URLs before fetching. Block requests to 169.254.169.254 and private IP ranges. Use IMDSv2 which requires PUT to acquire tokens.',
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
  const UNIX_PASSWD = /root:[x*]:0:0/;

  for (const param of FILE_PARAMS) {
    for (const payload of PAYLOADS) {
      const url = `${baseUrl}${param}${encodeURIComponent(payload)}`;
      const res = await safeFetch(url);
      if (!res || res.status !== 200) continue;
      const text = await readProbeText(res);
      if (UNIX_PASSWD.test(text)) {
        return [{
          id: 'path-traversal',
          category: 'exposed-files',
          severity: 'critical',
          title: 'Path Traversal — /etc/passwd Read Successfully',
          description: `The ${param.replace('?', '').replace('=', '')} parameter is vulnerable to directory traversal. The payload "../../../etc/passwd" returned the Unix password file, confirming full filesystem read access.`,
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
      severity: 'low',
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
      severity: lib.severity,
      title: `Outdated Library: ${lib.name} ${match[1]} (${lib.versionLabel})`,
      description: `${lib.name} version ${match[1]} was detected in the page source.${lib.cve ? ` This version is associated with: ${lib.cve}.` : ''} A version string does not prove the affected code path is loaded or exploitable; confirm the shipped dependency and feature usage before assigning impact.`,
      evidence: `Detected "${match[0]}" in page HTML`,
      remediation: lib.remediation,
    });
  }

  return findings;
}

// ── Source map exposure ────────────────────────────────────────────────────

async function checkSourceMaps(baseUrl: string, html: string): Promise<DeepFinding[]> {
  if (!html) return [];

  const scriptMatches = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js)["'][^>]*>/gi)];
  const scriptUrls = scriptMatches
    .map(m => {
      const src = m[1];
      if (src.startsWith('http')) {
        try {
          return new URL(src).hostname.toLowerCase() === new URL(baseUrl).hostname.toLowerCase()
            ? src
            : null;
        } catch {
          return null;
        }
      }
      if (src.startsWith('/')) return `${baseUrl}${src}`;
      return null;
    })
    .filter(Boolean)
    .slice(0, 8) as string[];

  if (!scriptUrls.length) return [];

  const results = await Promise.allSettled(
    scriptUrls.map(async (url) => {
      const mapUrl = `${url}.map`;
      const res = await safeFetch(mapUrl);
      if (!res || res.status !== 200) return { url: mapUrl, exposed: false };
      const body = await readProbeText(res);
      try {
        const parsed = JSON.parse(body) as {
          version?: unknown;
          sources?: unknown;
          mappings?: unknown;
        };
        const exposed = parsed?.version === 3
          && Array.isArray(parsed.sources)
          && typeof parsed.mappings === 'string';
        return { url: mapUrl, exposed };
      } catch {
        return { url: mapUrl, exposed: false };
      }
    })
  );

  const exposed = results
    .filter(r => r.status === 'fulfilled' && r.value.exposed)
    .map(r => (r as PromiseFulfilledResult<{ url: string; exposed: boolean }>).value.url);

  if (!exposed.length) return [];

  return [{
    id: 'source-maps-exposed',
    category: 'info-disclosure',
    severity: 'medium',
    title: `Source Maps Publicly Accessible (${exposed.length} file${exposed.length > 1 ? 's' : ''})`,
    description: 'JavaScript source map files (.js.map) are publicly accessible. These contain your original, unminified source code — including comments, variable names, internal logic, and sometimes hardcoded values — making reverse engineering trivial.',
    evidence: exposed.slice(0, 3).map(u => `GET ${u} → 200`).join('\n'),
    remediation: 'Disable source map generation for production builds. In Next.js: set productionBrowserSourceMaps: false in next.config.js (this is the default). In Webpack: set devtool: false for production.',
  }];
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

// ── Rate limiting detection ───────────────────────────────────────────────

async function checkRateLimiting(baseUrl: string): Promise<DeepFinding[]> {
  const loginPaths = ['/api/auth', '/api/login', '/login', '/api/signin', '/auth/login'];

  for (const path of loginPaths) {
    const requests = Array.from({ length: 6 }, () =>
      safeFetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ratelimit-probe@vibescan.io', password: 'wrongpassword123' }),
        allowRateLimitResponse: true,
      })
    );

    const responses = await Promise.allSettled(requests);
    const statuses = responses
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => (r as PromiseFulfilledResult<Response>).value.status);

    if (!statuses.length) continue;

    // Only flag if the endpoint responded meaningfully (not 404/405)
    const hasValidEndpoint = statuses.some(s => s === 200 || s === 401 || s === 403 || s === 422 || s === 400);
    if (!hasValidEndpoint) continue;

    const hasRateLimit = statuses.some(s => s === 429);
    if (!hasRateLimit) {
      return [{
        id: 'rate-limit-missing',
        category: 'authentication',
        severity: 'info',
        title: 'No Early HTTP 429 Observed on Authentication Endpoint',
        description: `${path} answered 6 rapid invalid login attempts without HTTP 429. This small black-box sample cannot establish that rate limiting is absent: controls may use a higher threshold, delayed responses, account/device signals, or edge enforcement.`,
        evidence: `POST ${baseUrl}${path} × 6 rapid requests\n→ Statuses: ${statuses.join(', ')} — no 429 Too Many Requests`,
        remediation: 'Verify the documented abuse-control policy with an authorised test that covers IP, account, device, and time windows. Add throttling or step-up controls if the endpoint truly has none.',
        url: `${baseUrl}${path}`,
      }];
    }
    break;
  }

  return [];
}

// ── NoSQL injection ───────────────────────────────────────────────────────

const NOSQL_PAYLOADS = ['[$gt]=', '[$ne]=invalid', '[$regex]=.*'];

const NOSQL_ERROR_PATTERNS = [
  /MongoError/i,
  /mongodb/i,
  /CastError/i,
  /BSON/i,
  /mongoose/i,
  /\$gt.*is not/i,
];

async function checkNoSQLInjection(baseUrl: string): Promise<DeepFinding[]> {
  const testPaths = ['/api/user', '/api/login', '/api/data', '/api/search', '/api/users'];

  for (const path of testPaths) {
    for (const payload of NOSQL_PAYLOADS) {
      const url = `${baseUrl}${path}?id${payload}`;
      const res = await safeFetch(url);
      if (!res) continue;
      const text = await readProbeText(res);
      const match = NOSQL_ERROR_PATTERNS.find(re => re.test(text));
      if (match) {
        return [{
          id: 'nosql-injection',
          category: 'info-disclosure',
          severity: 'medium',
          title: 'Database Error Disclosed After NoSQL-Shaped Input',
          description: 'A MongoDB/Mongoose-shaped error string appeared after crafted input. This is useful error-disclosure evidence, but it does not prove operator injection, authentication bypass, or data extraction without a differential exploit.',
          evidence: `GET ${url}\n→ MongoDB/Mongoose error: ${text.match(match)?.[0] ?? 'pattern matched'}`,
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
  });
  if (!res) return [];

  const text = await readProbeText(res);
  const location = res.headers.get('location') ?? '';

  const redirectsToInjectedHost = res.status >= 300 && res.status < 400 && location.includes(INJECTED_HOST);
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
      remediation: 'Validate the Host header against a strict allowlist of your own domains. Never use the Host header to construct URLs in emails, redirects, or links — use a hardcoded base URL from environment config.',
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
    const res = await safeFetch(url, { redirect: 'manual' });
    if (!res) continue;

    if (res.headers.get('x-injected')) {
      return [{
        id: 'crlf-injection',
        category: 'injection',
        severity: 'high',
        title: 'CRLF Injection — Header Injection Confirmed',
        description: `A CRLF sequence in the ${path} parameter was reflected into HTTP response headers. Attackers can inject arbitrary headers, set cookies, or split the HTTP response to perform session fixation, cache poisoning, or XSS.`,
        evidence: `GET ${url}\n→ X-Injected header appeared in response headers`,
        remediation: 'Strip or reject \\r and \\n characters from any user input reflected into HTTP headers or Location values. Modern frameworks handle this automatically — ensure you are not constructing raw header strings from user input.',
        url,
      }];
    }

    // Also check if CRLF payload was reflected unencoded in body
    const text = await readProbeText(res);
    if (text.includes('X-Injected: malicious')) {
      return [{
        id: 'crlf-injection',
        category: 'injection',
        severity: 'medium',
        title: 'Potential CRLF Injection — Newline Reflected in Response',
        description: `A CRLF payload was reflected unencoded in the response body at ${path}. Depending on context, this may allow header injection or HTTP response splitting.`,
        evidence: `GET ${url}\n→ CRLF payload reflected unencoded in response body`,
        remediation: 'Strip or encode \\r and \\n from user input used in headers or redirects.',
        url,
      }];
    }
  }
  return [];
}

// ── Score calculation ─────────────────────────────────────────────────────

function calculateScore(findings: DeepFinding[]): number {
  // Only count real vulnerabilities — info is never penalised
  const WEIGHTS: Record<string, number> = { critical: 30, high: 15, medium: 7, low: 2, info: 0 };
  // Correlated findings in one category contribute only their worst severity.
  const worstPerCategory = new Map<string, number>();
  for (const f of findings) {
    const w = WEIGHTS[f.severity] ?? 0;
    worstPerCategory.set(f.category, Math.max(worstPerCategory.get(f.category) ?? 0, w));
  }
  const deductions = Array.from(worstPerCategory.values()).reduce((sum, w) => sum + w, 0);
  let score = Math.max(0, 100 - deductions);

  // A severe confirmed finding must constrain the grade even when it is the
  // only category affected. These are severity guardrails, not probabilities.
  if (findings.some(f => f.severity === 'critical')) score = Math.min(score, 35);
  else if (findings.some(f => f.severity === 'high')) score = Math.min(score, 59);
  else if (findings.some(f => f.severity === 'medium')) score = Math.min(score, 79);

  return score;
}

// ── Build checked[] summary ───────────────────────────────────────────────

function buildChecked(
  findings: DeepFinding[],
  mainRes: Response | null,
  coverageComplete: boolean,
): import('@/types/deep-scan').CheckedItem[] {
  function findingsFor(...ids: string[]) {
    return findings.filter(f => ids.some(id => f.id.startsWith(id)));
  }

  function item(
    id: string, label: string, description: string,
    relevant: DeepFinding[],
    passDetail: string,
  ): import('@/types/deep-scan').CheckedItem {
    // Retain the call-site description for now, but do not present it as proof
    // that a broad vulnerability class is absent. These are bounded probes.
    void passDetail;
    if (!relevant.length) {
      return coverageComplete
        ? {
            id,
            label,
            description,
            status: 'pass',
            detail: 'No matching evidence was observed in the selected probes. This does not prove the condition is absent.',
          }
        : { id, label, description, status: 'skip', detail: 'Inconclusive because one or more scan requests failed or were blocked.' };
    }
    const worst = relevant.reduce((a, b) => {
      const order = ['critical','high','medium','low','info'];
      return order.indexOf(a.severity) < order.indexOf(b.severity) ? a : b;
    });
    const status = worst.severity === 'low' || worst.severity === 'info' ? 'warn' : 'fail';
    return { id, label, description, status, detail: relevant.map(f => f.title).join(' · ') };
  }

  const httpsOk = !findings.find(f => f.id === 'ssl-http-accessible');

  return [
    {
      id: 'https-tls',
      label: 'TLS Certificate',
      description: 'Site reachable over HTTPS with a valid certificate',
      status: mainRes ? 'pass' : 'skip',
      detail: mainRes ? 'HTTPS connection successful — valid TLS certificate in use' : 'Could not reach site over HTTPS',
    },
    item('https',      'HTTPS Enforcement',           'Does plain HTTP redirect to HTTPS?',                                     findingsFor('ssl-'), httpsOk ? 'HTTP correctly redirects to HTTPS — no plain HTTP access' : 'HTTPS redirect in place'),
    item('headers',    'Security Headers',             'CSP, HSTS, X-Frame-Options, XCTO, Referrer-Policy',                     findingsFor('header-'), 'All critical security headers present and correctly configured'),
    item('cors',       'CORS Policy',                  'No wildcard+credentials or arbitrary origin reflection on API routes',   findingsFor('cors-', 'crossdomain-'), 'CORS policy is correctly restricted — no dangerous origin reflection found'),
    item('cookies',    'Cookie Security Flags',        'HttpOnly, Secure, SameSite on session/auth cookies',                    findingsFor('cookie-'), 'All cookies have correct HttpOnly, Secure, and SameSite flags'),
    item('sqli',       'SQL Injection',                "Error-based SQLi via ' OR 1=1, SQLSTATE payloads on query params",      findingsFor('sqli-'), 'No SQL errors returned — injection payloads did not trigger database errors'),
    item('xss',        'Reflected XSS',                'Script tag injection into search/query parameters',                     findingsFor('xss-'), 'Input correctly encoded — no unencoded script reflection found'),
    item('vibe',       'Exposed Secrets in HTML',      'Supabase service role key, Stripe secret, API keys in page source',     findingsFor('vibe-'), 'No exposed secrets or dangerous keys found in page HTML'),
    item('files',      'Sensitive File Exposure',      '.env, .git, wp-config.php, phpinfo.php, backup.sql, .htaccess',         findingsFor('exposed-'), 'No sensitive files or paths accessible publicly'),
    item('admin',      'Admin Panel Exposure',         '/wp-admin, /phpmyadmin, /cpanel, /adminpanel — specific software panels', findingsFor('admin-'), 'No unauthenticated admin panels found at tested paths'),
    item('dirlist',    'Directory Listing',            '/uploads, /static, /assets, /files, /backup — open indexes',            findingsFor('directory-'), 'No open directory listings detected'),
    item('redirect',   'Open Redirect',                '?redirect=, ?url=, ?next=, ?return=, ?goto= hijacking',                 findingsFor('open-redirect'), 'No open redirect vectors found — redirect params are absent or validated'),
    item('methods',    'Dangerous HTTP Methods',       'TRACE (XST), unauthenticated PUT/DELETE',                               findingsFor('methods-'), 'No dangerous HTTP methods advertised via OPTIONS'),
    item('errors',     'Error Verbosity',              'Stack traces, file paths, framework versions in error pages',            findingsFor('error-'), 'Error responses use generic messages — no internals disclosed'),
    item('info',       'Technology Disclosure',        'Server version, X-Powered-By, X-AspNet-Version in headers',             findingsFor('info-', 'server-status-'), 'No detailed server/framework version info disclosed in response headers'),
    item('sri',        'Subresource Integrity',        'External CDN scripts and stylesheets have integrity= hashes',           findingsFor('sri-'), 'External resources either have integrity hashes or are same-origin'),
    item('robots',      'robots.txt Path Disclosure',    'Sensitive admin/backup/config paths in Disallow entries',              findingsFor('robots-'),    'robots.txt does not reveal sensitive internal paths'),
    item('forced',      'Forced Browsing',               'Unauthenticated access to /api/admin, /api/users, /api/config, 12 more', findingsFor('auth-unprotected'), 'No unauthenticated API endpoints found — all tested paths require authentication'),
    item('idor',        'Insecure Direct Object Ref',    'Sequential ID enumeration on /api/users/, /api/orders/, /api/posts/',   findingsFor('idor-'),           'No IDOR detected — API endpoints are absent or inaccessible without auth'),
    item('ssrf',        'Server-Side Request Forgery',   '?url=, ?webhook=, ?proxy= probed with metadata + localhost targets',    findingsFor('ssrf-'),           'No SSRF indicators found — URL parameters absent or not making unvalidated fetches'),
    item('traversal',   'Path Traversal',                '../../../etc/passwd in ?file=, ?path=, ?page=, ?template=',             findingsFor('path-traversal'),  'No path traversal — file parameters absent or correctly validated'),
    item('components',  'Vulnerable Libraries (A06)',    'jQuery, AngularJS, Lodash, Moment.js — CVE version matching in HTML',   findingsFor('outdated-'),       'No outdated or vulnerable client-side library versions detected'),
    item('sourcemaps',  'Source Map Exposure',           '.js.map files exposing unminified source, comments, and variable names',  findingsFor('source-maps-'),    'No publicly accessible source map files found — source code is not exposed'),
    item('graphql',     'GraphQL Introspection',         '{__schema} query on /graphql, /api/graphql, /gql, /query',               findingsFor('graphql-'),        'GraphQL introspection disabled or no GraphQL endpoint found'),
    item('apidocs',     'API Documentation Exposure',    '/swagger, /openapi.json, /api-docs, /redoc — public schema exposure',    findingsFor('api-docs-'),       'No public API documentation found at tested paths'),
    item('ratelimit',   'Rate Limiting (Auth)',          '6 rapid POSTs to auth endpoints — brute-force protection check',         findingsFor('rate-limit-'),     'Rate limiting is in place — auth endpoints returned 429 or are unreachable'),
    item('nosql',       'NoSQL Injection',               '[$gt], [$ne], [$regex] operator injection — MongoDB error detection',    findingsFor('nosql-'),          'No NoSQL injection — MongoDB operator payloads did not trigger errors'),
    item('hostheader',  'Host Header Injection',         'Forged Host header reflected in body or Location — reset poisoning',     findingsFor('host-header-'),    'Host header is not reflected — no password reset poisoning vector found'),
    item('crlf',        'CRLF Injection',                '%0d%0a in query params reflected into response headers',                 findingsFor('crlf-'),           'No CRLF injection — newline sequences are stripped or encoded correctly'),
  ];
}

// ── Check phases (for streaming progress) ────────────────────────────────

export type ScanPhase = {
  id: string;
  label: string;
  detail: string;
};

export const SCAN_PHASES: ScanPhase[] = [
  { id: 'init',      label: 'Connecting',             detail: 'Establishing HTTPS connection, reading response headers and framework fingerprint…' },
  { id: 'vibe',      label: 'Secrets in HTML',        detail: 'Scanning page source for Supabase keys, Firebase config, Stripe secrets, exposed API keys…' },
  { id: 'files',     label: 'Sensitive Files',         detail: 'Probing 25 paths: .env, .env.local, .git/HEAD, wp-config.php, .npmrc, docker-compose.yml, Dockerfile, backup.sql…' },
  { id: 'xss',       label: 'Cross-Site Scripting',   detail: "Injecting <script>alert(1)</script> into ?q=, ?s=, ?name= — checking if input is reflected unencoded…" },
  { id: 'sqli',      label: 'SQL Injection',           detail: "Sending ' OR 1=1, \\\" OR \\\"1\\\"=\\\"1, SQLSTATE payloads — watching for database error messages…" },
  { id: 'cors',      label: 'CORS Policy',             detail: 'Null origin + evil-attacker.com on /api routes — testing for wildcard+credentials or arbitrary origin reflection…' },
  { id: 'headers',   label: 'Security Headers',        detail: 'Auditing CSP (with nonce check), HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy…' },
  { id: 'cookies',   label: 'Cookie Security',         detail: 'Inspecting Set-Cookie for HttpOnly, Secure, SameSite=Lax/Strict flags on session/auth cookies…' },
  { id: 'methods',   label: 'HTTP Methods',            detail: 'OPTIONS request — detecting TRACE (XST attacks), PUT, DELETE without authentication…' },
  { id: 'ssl',       label: 'HTTPS / TLS',             detail: 'HTTP → HTTPS redirect check, testing plain HTTP access, checking HSTS preload status…' },
  { id: 'admin',     label: 'Admin Discovery',         detail: 'Probing 18 paths: /admin, /wp-admin, /phpmyadmin, /cpanel, /manager, /backend, /portal…' },
  { id: 'errors',    label: 'Error Verbosity',         detail: 'Triggering 404, /api/nonexistent, ?debug=true — checking for JS/Python/PHP stack traces…' },
  { id: 'redirect',  label: 'Open Redirect',           detail: 'Testing ?redirect=, ?url=, ?next=, ?return=, ?goto= with external target URL…' },
  { id: 'dirlist',   label: 'Directory Listing',       detail: 'Requesting /uploads/, /static/, /assets/, /files/, /backup/ — checking for open indexes…' },
  { id: 'robots',    label: 'robots.txt',              detail: 'Fetching /robots.txt — parsing Disallow entries for accidentally exposed sensitive paths…' },
  { id: 'sri',        label: 'Subresource Integrity',   detail: 'Parsing HTML for external <script> and <link> tags missing integrity= hashes…' },
  { id: 'info',       label: 'Info Disclosure',         detail: 'Reading Server, X-Powered-By, X-AspNet-Version — checking for version numbers in headers…' },
  { id: 'forced',     label: 'Forced Browsing',         detail: 'Probing 15 admin/internal API paths without auth — checking for unauthenticated data exposure…' },
  { id: 'idor',       label: 'IDOR',                    detail: 'Testing /api/users/1, /api/orders/1 — checking if object records are accessible without ownership verification…' },
  { id: 'ssrf',       label: 'SSRF',                    detail: 'Injecting AWS metadata URL + localhost into ?url=, ?webhook=, ?proxy= — testing server-side request forgery…' },
  { id: 'traversal',  label: 'Path Traversal',          detail: 'Sending ../../../etc/passwd into ?file=, ?path=, ?page= — testing directory traversal…' },
  { id: 'components',  label: 'Vulnerable Libraries',    detail: 'Scanning HTML for jQuery, AngularJS, Lodash, Moment.js versions with known CVEs…' },
  { id: 'sourcemaps', label: 'Source Map Exposure',     detail: 'Finding <script src> tags in HTML, probing .js.map files — checking if unminified source code is accessible…' },
  { id: 'graphql',    label: 'GraphQL Introspection',   detail: 'POST {__schema query} to /graphql, /api/graphql, /gql — checking if full schema is enumerable without auth…' },
  { id: 'apidocs',    label: 'API Documentation',       detail: 'Probing /swagger, /openapi.json, /api-docs, /redoc — checking if full API schema is publicly exposed…' },
  { id: 'ratelimit',  label: 'Rate Limiting',           detail: 'Firing 6 rapid POST requests at auth endpoints — checking if login is protected against brute-force…' },
  { id: 'nosql',      label: 'NoSQL Injection',         detail: 'Sending MongoDB operator payloads [$gt], [$ne], [$regex] — watching for BSON/Mongoose errors…' },
  { id: 'hostheader', label: 'Host Header Injection',   detail: 'Sending forged Host: evil-attacker-test.com — checking if reflected in response body or Location header…' },
  { id: 'crlf',       label: 'CRLF Injection',          detail: 'Injecting %0d%0a newlines into query params — checking if sequence breaks into response headers…' },
  { id: 'done',       label: 'Compiling Report',        detail: 'Scoring all findings, computing security grade, building detailed report…' },
];

// ── Main export (with progress callback) ─────────────────────────────────

export async function deepScanDomain(
  domain: string,
  onPhase?: (phase: ScanPhase, findings: DeepFinding[], status: 'start' | 'complete') => void,
): Promise<DeepScanResult> {
  const requestCoverage: RequestCoverage = {
    requestsAttempted: 0,
    requestsCompleted: 0,
    requestsFailed: 0,
    requestsBlocked: 0,
  };
  const requestContext = {
    authorizedHostname: domain.toLowerCase(),
    coverage: requestCoverage,
    deadlineAt: Date.now() + SCAN_BUDGET_MS,
    deadlineExceeded: false,
  };

  return scanRequestContext.run(requestContext, async () => {
  const start = Date.now();
  const baseUrl = `https://${domain}`;
  const allFindings: DeepFinding[] = [];

  async function run<T extends DeepFinding[]>(phaseId: string, fn: () => Promise<T>): Promise<T> {
    const phase = SCAN_PHASES.find(p => p.id === phaseId)!;
    const failedBefore = requestCoverage.requestsFailed;
    const blockedBefore = requestCoverage.requestsBlocked;
    onPhase?.(phase, [], 'start');
    const results = await fn();
    onPhase?.(phase, results, 'complete');
    if (
      requestContext.deadlineExceeded
      || requestCoverage.requestsFailed > failedBefore
      || requestCoverage.requestsBlocked > blockedBefore
    ) {
      throw new Error(
        requestContext.deadlineExceeded
          ? 'The active scan exceeded its safe execution budget; no result was saved and the allowance will be restored.'
          : 'A required probe failed or was blocked; no incomplete score was saved and the allowance will be restored.',
      );
    }
    allFindings.push(...results);
    return results;
  }

  onPhase?.(SCAN_PHASES[0], [], 'start');
  const mainRes = await safeFetch(baseUrl, { redirect: 'follow' });
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
  onPhase?.(SCAN_PHASES[0], [], 'complete');

  await run('vibe',     () => checkVibeCodePatterns(baseUrl, mainHtml));
  await run('files',    () => checkSensitiveFiles(baseUrl));
  await run('xss',      () => checkXSS(baseUrl));
  await run('sqli',     () => checkSQLInjection(baseUrl));
  await run('cors',     () => checkCORS(baseUrl));
  await run('headers',  () => checkSecurityHeaders(mainRes));
  await run('cookies',  () => checkCookies(mainRes));
  await run('methods',  () => checkHTTPMethods(baseUrl));
  await run('ssl',      () => checkSSL(domain));
  await run('admin',    () => checkAdminPaths(baseUrl));
  await run('errors',   () => checkErrorVerbosity(baseUrl));
  await run('redirect', () => checkOpenRedirect(baseUrl));
  await run('dirlist',  () => checkDirectoryListing(baseUrl));
  await run('robots',   () => checkRobotsTxt(baseUrl));
  await run('cors',     () => checkCrossdomain(baseUrl));
  await run('info',     () => checkServerStatus(baseUrl));
  await run('sri',        () => checkSRI(baseUrl, mainHtml));
  await run('info',       () => checkInfoDisclosure(mainRes));
  await run('forced',     () => checkForcedBrowsing(baseUrl));
  await run('idor',       () => checkIDOR(baseUrl));
  await run('ssrf',       () => checkSSRF(baseUrl));
  await run('traversal',  () => checkPathTraversal(baseUrl));
  await run('components',  () => checkOutdatedLibraries(mainHtml));
  await run('sourcemaps', () => checkSourceMaps(baseUrl, mainHtml));
  await run('graphql',    () => checkGraphQL(baseUrl));
  await run('apidocs',    () => checkAPIDocumentation(baseUrl));
  await run('ratelimit',  () => checkRateLimiting(baseUrl));
  await run('nosql',      () => checkNoSQLInjection(baseUrl));
  await run('hostheader', () => checkHostHeaderInjection(baseUrl));
  await run('crlf',       () => checkCRLFInjection(baseUrl));

  onPhase?.(SCAN_PHASES[SCAN_PHASES.length - 1], allFindings, 'complete');

  const findings = allFindings;
  const count = (sev: DeepFinding['severity']) => findings.filter(f => f.severity === sev).length;
  const coverageComplete = requestCoverage.requestsFailed === 0 && requestCoverage.requestsBlocked === 0;

  return {
    domain,
    scannedAt: new Date().toISOString(),
    duration: Date.now() - start,
    summary: {
      critical: count('critical'),
      high: count('high'),
      medium: count('medium'),
      low: count('low'),
      info: count('info'),
      score: coverageComplete ? calculateScore(findings) : null,
    },
    coverage: { ...requestCoverage, complete: coverageComplete },
    findings,
    checked: buildChecked(findings, mainRes, coverageComplete),
  };
  });
}

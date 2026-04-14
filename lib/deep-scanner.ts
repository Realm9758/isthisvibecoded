import type { DeepFinding, DeepScanResult } from '@/types/deep-scan';

const TIMEOUT = 8000;
const UA = 'VibeScan-DeepScan/1.0 (Security Audit; Owner-Verified)';

async function safeFetch(url: string, options?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': UA, ...options?.headers },
    });
  } catch {
    return null;
  }
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
  {
    path: '/server-status',
    title: 'Apache Server Status Exposed',
    severity: 'high',
    description: 'Apache mod_status exposes real-time server information including active connections and request URIs.',
    remediation: 'Restrict /server-status to trusted IPs only, or disable mod_status.',
  },
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
  {
    path: '/crossdomain.xml',
    title: 'Adobe Crossdomain Policy',
    severity: 'medium',
    description: 'A crossdomain.xml policy file is present. Overly permissive policies enable unauthorized cross-domain access.',
    remediation: 'Review and tighten the crossdomain.xml policy. Restrict to specific trusted domains.',
  },
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
      findings.push({
        id: `exposed-${file.path}`,
        category: 'exposed-files',
        severity: file.severity,
        title: file.title,
        description: file.description,
        evidence: `GET ${url} → HTTP 200`,
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
    if (acao === 'null') {
      findings.push({
        id: 'cors-null-origin',
        category: 'cors',
        severity: 'high',
        title: 'CORS Accepts Null Origin',
        description: 'The server reflects the null origin. Attackers can exploit this using sandboxed iframes to make authenticated cross-origin requests.',
        evidence: 'Access-Control-Allow-Origin: null',
        remediation: 'Never allow the null origin in your CORS policy.',
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
        severity: 'critical',
        title: 'API CORS: Wildcard + Credentials',
        description: `${path} returns Access-Control-Allow-Origin: * with Allow-Credentials: true. Any site can make authenticated API requests on behalf of your users.`,
        evidence: `GET ${baseUrl}${path}\nAccess-Control-Allow-Origin: *\nAccess-Control-Allow-Credentials: true`,
        remediation: 'You cannot use * with credentials. Switch to an explicit origin allowlist.',
        url: `${baseUrl}${path}`,
      });
      break;
    }

    if (acao === 'https://evil-attacker.com' && acac === 'true') {
      findings.push({
        id: 'cors-reflect-credentials',
        category: 'cors',
        severity: 'critical',
        title: 'API CORS Reflects Arbitrary Origin with Credentials',
        description: `${path} reflects any arbitrary Origin header back and allows credentials. Attackers can make authenticated API requests from any domain — full account takeover risk.`,
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

function detectFramework(res: Response | null): { isVercel: boolean; isNextJS: boolean; isCDN: boolean } {
  if (!res) return { isVercel: false, isNextJS: false, isCDN: false };
  const server = (res.headers.get('server') ?? '').toLowerCase();
  const via = (res.headers.get('via') ?? '').toLowerCase();
  const xVercel = res.headers.get('x-vercel-id') ?? res.headers.get('x-vercel-cache');
  const powered = (res.headers.get('x-powered-by') ?? '').toLowerCase();
  const isVercel = !!xVercel || server.includes('vercel');
  const isNextJS = powered.includes('next') || server.includes('next');
  const isCDN = isVercel || server.includes('cloudflare') || server.includes('fastly') || via.includes('cloudfront');
  return { isVercel, isNextJS, isCDN };
}

async function checkSecurityHeaders(res: Response | null): Promise<DeepFinding[]> {
  const findings: DeepFinding[] = [];
  if (!res) return findings;

  const { isVercel, isNextJS, isCDN } = detectFramework(res);

  const csp  = res.headers.get('content-security-policy');
  const xfo  = res.headers.get('x-frame-options');
  const xcto = res.headers.get('x-content-type-options');
  const hsts = res.headers.get('strict-transport-security');
  const rp   = res.headers.get('referrer-policy');
  const pp   = res.headers.get('permissions-policy');

  // CSP — always worth flagging, but tell Next.js users where to add it
  if (!csp) {
    const remediation = isNextJS
      ? "Add to next.config.js headers():\n  { key: 'Content-Security-Policy', value: \"default-src 'self'; script-src 'self' 'unsafe-inline'\" }\nOr use the next-safe package."
      : "Add response header: Content-Security-Policy: default-src 'self'; script-src 'self'";
    findings.push({
      id: 'header-csp-missing',
      category: 'headers',
      // Downgrade to medium for CDN/Vercel — they often enforce at edge but don't pass the header through
      severity: isCDN ? 'medium' : 'high',
      title: 'Missing Content-Security-Policy',
      description: "No CSP header found on this response. Without CSP, any XSS vulnerability has no secondary defence — injected scripts can run freely, steal cookies, and exfiltrate data."
        + (isCDN ? ' Note: if you set this at the CDN/edge layer, ensure it\'s also forwarded in the response.' : ''),
      remediation,
    });
  } else {
    if (csp.includes("'unsafe-inline'") && !csp.includes('nonce-') && !csp.includes('strict-dynamic')) {
      findings.push({
        id: 'header-csp-unsafe-inline',
        category: 'headers',
        severity: 'medium',
        title: "CSP Uses 'unsafe-inline' Without Nonces",
        description: "'unsafe-inline' allows arbitrary inline scripts, negating most XSS protection. Use nonces or hashes instead.",
        evidence: `Content-Security-Policy: ${csp.substring(0, 200)}`,
        remediation: "Replace 'unsafe-inline' with per-request nonces: script-src 'nonce-{random}'. Next.js supports this via middleware.",
      });
    }
    if (csp.includes("'unsafe-eval'")) {
      findings.push({
        id: 'header-csp-unsafe-eval',
        category: 'headers',
        severity: 'medium',
        title: "CSP Contains 'unsafe-eval'",
        description: "'unsafe-eval' permits eval(), new Function(), and setTimeout(string) — common XSS escalation vectors.",
        evidence: `CSP contains 'unsafe-eval'`,
        remediation: "Remove 'unsafe-eval'. Refactor code using eval() or Function(). Some bundlers add this — check your build config.",
      });
    }
  }

  // Clickjacking — only meaningful if the page has interactive content
  if (!xfo && !csp?.includes('frame-ancestors')) {
    findings.push({
      id: 'header-xfo-missing',
      category: 'headers',
      severity: 'medium',
      title: 'No Clickjacking Protection (X-Frame-Options / frame-ancestors)',
      description: 'The page can be embedded in a hidden iframe on an attacker\'s site. Users can be tricked into clicking buttons invisibly overlaid on your UI — "likejacking", fake payments, or account actions.',
      remediation: isNextJS
        ? "In next.config.js headers(): { key: 'X-Frame-Options', value: 'DENY' }"
        : "Add header: X-Frame-Options: DENY\nOr CSP: frame-ancestors 'none'",
    });
  }

  // X-Content-Type-Options — low severity, informational
  if (!xcto) {
    findings.push({
      id: 'header-xcto-missing',
      category: 'headers',
      severity: 'low',
      title: 'Missing X-Content-Type-Options: nosniff',
      description: 'Without nosniff, browsers may MIME-sniff responses and interpret a text file as JavaScript — useful in some upload-based XSS attacks.',
      remediation: isNextJS
        ? "next.config.js headers(): { key: 'X-Content-Type-Options', value: 'nosniff' }"
        : 'Add header: X-Content-Type-Options: nosniff',
    });
  }

  // HSTS — CDNs like Vercel inject HSTS at the edge. Downgrade if CDN detected.
  if (!hsts) {
    findings.push({
      id: 'header-hsts-missing',
      category: 'headers',
      severity: isCDN ? 'low' : 'medium',
      title: 'Missing HSTS Header' + (isCDN ? ' (may be set at CDN edge)' : ''),
      description: 'No Strict-Transport-Security header in this response. '
        + (isVercel
          ? 'Vercel injects HSTS at the edge for custom domains, but not for *.vercel.app subdomains. If you\'re on a custom domain, verify it\'s enabled in Vercel project settings.'
          : 'Without HSTS, browsers may access the site over HTTP on first visit, enabling MITM and cookie theft.'),
      remediation: isNextJS
        ? "next.config.js headers(): { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' }"
        : 'Add header: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
    });
  } else {
    const match = hsts.match(/max-age=(\d+)/);
    if (match && parseInt(match[1]) < 31536000) {
      findings.push({
        id: 'header-hsts-short',
        category: 'headers',
        severity: 'low',
        title: 'HSTS max-age Below 1 Year',
        description: `HSTS max-age is ${parseInt(match[1]) / 86400} days. Short durations reduce protection — browsers re-check over HTTP sooner.`,
        evidence: `Strict-Transport-Security: ${hsts}`,
        remediation: 'Set max-age=31536000 (1 year minimum for preload eligibility).',
      });
    }
  }

  // Referrer-Policy — low severity, informational
  if (!rp) {
    findings.push({
      id: 'header-rp-missing',
      category: 'headers',
      severity: 'low',
      title: 'Missing Referrer-Policy',
      description: 'Without Referrer-Policy, full URLs (including sensitive query params like tokens or IDs) are sent in the Referer header to third-party sites loaded on the page.',
      remediation: "Add: Referrer-Policy: strict-origin-when-cross-origin",
    });
  }

  // Permissions-Policy — info only, not truly a vulnerability for most sites
  if (!pp) {
    findings.push({
      id: 'header-pp-missing',
      category: 'headers',
      severity: 'info',
      title: 'No Permissions-Policy',
      description: 'Permissions-Policy is not set. This header restricts which browser APIs (camera, microphone, geolocation) embedded scripts and iframes can access. Good defence-in-depth.',
      remediation: "Add: Permissions-Policy: camera=(), microphone=(), geolocation=()",
    });
  }

  return findings;
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
    const lower = cookie.toLowerCase();
    const isAuth = /session|auth|token|jwt|sid|user/i.test(name);

    if (isAuth && !lower.includes('httponly')) {
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

    if (!lower.includes('secure')) {
      findings.push({
        id: `cookie-secure-${name}`,
        category: 'cookies',
        severity: 'medium',
        title: `Cookie Missing Secure Flag: ${name}`,
        description: `"${name}" lacks the Secure flag and can be transmitted over plain HTTP.`,
        evidence: `Set-Cookie: ${cookie.split(';')[0]}`,
        remediation: 'Add the Secure flag to all cookies with sensitive data.',
      });
    }

    if (!lower.includes('samesite')) {
      findings.push({
        id: `cookie-samesite-${name}`,
        category: 'cookies',
        severity: 'medium',
        title: `Cookie Missing SameSite: ${name}`,
        description: `"${name}" has no SameSite attribute, making it vulnerable to CSRF attacks.`,
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
    }
  }

  return findings;
}

// ── robots.txt sensitive path leak ────────────────────────────────────────

async function checkRobotsTxt(baseUrl: string): Promise<DeepFinding[]> {
  const res = await safeFetch(`${baseUrl}/robots.txt`);
  if (!res || res.status !== 200) return [];

  const text = await res.text();
  const sensitiveRe = /\/admin|\/backup|\/config|\/database|\/private|\/secret|\/internal|\/staging|\/dev\b|\/test\b/i;

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
      title: 'robots.txt Reveals Sensitive Paths',
      description: `robots.txt inadvertently maps out sensitive paths: ${disallowed.join(', ')}. While it prevents crawling, it tells attackers exactly where to look.`,
      evidence: disallowed.map(p => `Disallow: ${p}`).join('\n'),
      remediation: 'Remove sensitive paths from robots.txt. Security should not depend on obscurity.',
    },
  ];
}

// ── Admin path discovery ──────────────────────────────────────────────────

const ADMIN_PATHS = [
  '/admin', '/admin/', '/administrator', '/wp-admin', '/wp-admin/',
  '/dashboard', '/cpanel', '/phpmyadmin', '/pma', '/manager',
  '/admin/login', '/admin/index', '/adminpanel', '/cms', '/backend',
  '/controlpanel', '/portal', '/superadmin', '/root',
];

async function checkAdminPaths(baseUrl: string): Promise<DeepFinding[]> {
  const results = await Promise.allSettled(
    ADMIN_PATHS.map(async (path) => {
      const res = await safeFetch(`${baseUrl}${path}`, { redirect: 'follow' });
      return { path, status: res?.status ?? 0 };
    })
  );

  const exposed = results
    .filter(r => r.status === 'fulfilled' && r.value.status === 200)
    .map(r => (r as PromiseFulfilledResult<{ path: string; status: number }>).value.path);

  if (!exposed.length) return [];

  return [{
    id: 'admin-paths-exposed',
    category: 'exposed-files',
    severity: 'high',
    title: `Admin Panel Accessible: ${exposed.slice(0, 3).join(', ')}${exposed.length > 3 ? '…' : ''}`,
    description: `${exposed.length} admin path${exposed.length > 1 ? 's' : ''} returned HTTP 200 without redirecting to a login page. Exposed admin panels are high-value targets.`,
    evidence: exposed.map(p => `GET ${baseUrl}${p} → 200 OK`).join('\n'),
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
      const text = await res.text().catch(() => '');
      const match = SQL_ERROR_PATTERNS.find(re => re.test(text));
      if (match) {
        return [{
          id: 'sqli-error-based',
          category: 'exposed-files',
          severity: 'critical',
          title: 'SQL Injection — Error-Based',
          description: 'A SQL error message was returned in response to a crafted input. This indicates unsanitised database queries and likely full database compromise.',
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
    const text = await res.text().catch(() => '');
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
    const text = await res.text().catch(() => '');
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

async function checkVibeCodePatterns(baseUrl: string, mainRes: Response | null): Promise<DeepFinding[]> {
  const findings: DeepFinding[] = [];
  if (!mainRes) return findings;

  const html = await mainRes.clone().text().catch(() => '');

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
      category: 'exposed-files',
      severity: 'high',
      title: 'API Key Pattern Detected in HTML Source',
      description: 'An API key or secret appears to be embedded in the page HTML. If this is a server-side secret, it should never appear in client-rendered HTML.',
      evidence: genericApiKey[0].substring(0, 80),
      remediation: 'Move secrets to environment variables and access them only in server-side code (API routes, getServerSideProps, server actions).',
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
      const body = await apiRes.text().catch(() => '');
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
    const text = await res.text().catch(() => '');
    // Reflected unencoded — actual XSS
    if (text.includes('<script>alert(1)</script>')) {
      return [{
        id: 'xss-reflected',
        category: 'injection',
        severity: 'critical',
        title: 'Reflected XSS — Unencoded Script Tag',
        description: `Input injected into ${path} is reflected back in the HTML without encoding. Any script tag sent by an attacker will execute in the victim's browser — enabling session theft, keylogging, or full account takeover.`,
        evidence: `GET ${url}\n→ Response contains: <script>alert(1)</script> (unencoded)`,
        remediation: 'HTML-encode all user input before rendering. Use Content-Security-Policy to block inline scripts. Use a templating engine that escapes by default.',
        url,
      }];
    }
    // Input reflected but partially encoded — warn
    if (text.includes('alert(1)') && !text.includes('&lt;script&gt;')) {
      return [{
        id: 'xss-partial-reflection',
        category: 'injection',
        severity: 'high',
        title: 'Potential XSS — Input Reflected in Response',
        description: `Input from ${path} appears in the HTML response. Partial encoding was detected — may still be exploitable depending on context.`,
        evidence: `GET ${url}\n→ Response contains reflected input`,
        remediation: 'Ensure all user input is fully HTML-encoded. Use context-aware output encoding.',
        url,
      }];
    }
  }
  return [];
}

// ── Subresource Integrity ─────────────────────────────────────────────────

async function checkSRI(baseUrl: string, mainRes: Response | null): Promise<DeepFinding[]> {
  if (!mainRes) return [];
  const html = await mainRes.clone().text().catch(() => '');

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
    severity: 'medium',
    title: `${noIntegrity.length} External Resource${noIntegrity.length > 1 ? 's' : ''} Without Subresource Integrity`,
    description: `External scripts/stylesheets loaded from CDNs without integrity hashes. If the CDN is compromised, attackers can inject malicious code into your site.`,
    evidence: noIntegrity.map(t => t.substring(0, 120)).join('\n'),
    remediation: 'Add integrity="sha384-..." and crossorigin="anonymous" to all external <script> and <link> tags. Use srihash.org to generate hashes.',
  }];
}

// ── Forced browsing / unauthenticated API access (A01) ───────────────────

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

  const exposed: string[] = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { path, res } = r.value;
    if (!res || res.status !== 200) continue;
    const text = await res.text().catch(() => '');
    const looksLikeData =
      (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) &&
      (text.includes('"email"') || text.includes('"userId"') || text.includes('"role"') || text.includes('"users"') || text.includes('"data"'));
    if (looksLikeData) exposed.push(path);
  }

  if (!exposed.length) return [];

  return [{
    id: 'auth-unprotected-api',
    category: 'authentication',
    severity: 'high',
    title: `Unauthenticated API Endpoint${exposed.length > 1 ? 's' : ''}: ${exposed.slice(0, 3).join(', ')}${exposed.length > 3 ? '…' : ''}`,
    description: `${exposed.length} API endpoint${exposed.length > 1 ? 's' : ''} returned JSON data without requiring authentication. This may expose user data, admin functions, or internal configuration to any unauthenticated caller.`,
    evidence: exposed.map(p => `GET ${baseUrl}${p} → 200 JSON`).join('\n'),
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
    const [t1, t2] = await Promise.all([res1.text().catch(() => ''), res2.text().catch(() => '')]);
    const hasData = (t: string) =>
      (t.includes('"id"') || t.includes('"email"') || t.includes('"name"')) &&
      (t.trimStart().startsWith('{') || t.trimStart().startsWith('['));
    if (!hasData(t1) || !hasData(t2)) continue;

    return [{
      id: 'idor-sequential-ids',
      category: 'authentication',
      severity: 'high',
      title: `Possible IDOR: ${path}{id} Returns Records Without Auth`,
      description: `${path}1 and ${path}2 both return what appears to be object data without authentication. If records belong to specific users, any caller can enumerate all of them by incrementing the ID.`,
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
  const LOCALHOST_TARGET = 'http://127.0.0.1/';

  for (const param of SSRF_PARAMS) {
    // Cloud metadata probe
    const metaUrl = `${baseUrl}${param}${encodeURIComponent(METADATA_TARGET)}`;
    const metaRes = await safeFetch(metaUrl);
    if (metaRes?.status === 200) {
      const text = await metaRes.text().catch(() => '');
      if (/ami-id|instance-id|security-credentials|iam\//.test(text)) {
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

    // Localhost probe
    const localUrl = `${baseUrl}${param}${encodeURIComponent(LOCALHOST_TARGET)}`;
    const localRes = await safeFetch(localUrl);
    if (localRes?.status === 200) {
      const text = await localRes.text().catch(() => '');
      if (text.length > 50 && (text.includes('<html') || text.trimStart().startsWith('{'))) {
        return [{
          id: 'ssrf-localhost',
          category: 'authentication',
          severity: 'high',
          title: 'Possible SSRF — Localhost Request Returned Content',
          description: `The ${param.replace('?', '').replace('=', '')} parameter fetched 127.0.0.1 and received a non-empty response. This indicates the server makes outbound requests to user-supplied URLs, potentially exposing internal services.`,
          evidence: `GET ${localUrl}\n→ HTTP 200 with ${text.length} bytes`,
          remediation: 'Validate target URLs against an allowlist. Block private IP ranges (127.x, 10.x, 172.16–31.x, 192.168.x) before making any outbound fetch.',
          url: localUrl,
        }];
      }
    }
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
      const text = await res.text().catch(() => '');
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

async function checkOutdatedLibraries(mainRes: Response | null): Promise<DeepFinding[]> {
  if (!mainRes) return [];
  const html = await mainRes.clone().text().catch(() => '');
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
      severity: 'high',
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
      description: `${lib.name} version ${match[1]} was detected in the page source.${lib.cve ? ` Known CVEs: ${lib.cve}.` : ''} Outdated client-side libraries are a common and easily exploitable attack vector.`,
      evidence: `Detected "${match[0]}" in page HTML`,
      remediation: lib.remediation,
    });
  }

  return findings;
}

// ── Source map exposure ────────────────────────────────────────────────────

async function checkSourceMaps(baseUrl: string, mainRes: Response | null): Promise<DeepFinding[]> {
  if (!mainRes) return [];
  const html = await mainRes.clone().text().catch(() => '');

  const scriptMatches = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js)["'][^>]*>/gi)];
  const scriptUrls = scriptMatches
    .map(m => {
      const src = m[1];
      if (src.startsWith('http')) return src;
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
      return { url: mapUrl, exposed: res?.status === 200 };
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
    const text = await res.text().catch(() => '');
    if (text.includes('__schema') || text.includes('queryType')) {
      return [{
        id: 'graphql-introspection',
        category: 'info-disclosure',
        severity: 'medium',
        title: 'GraphQL Introspection Enabled in Production',
        description: `GraphQL introspection is enabled at ${path}. This lets anyone enumerate your entire API schema — all types, queries, mutations, fields, and arguments — giving attackers a complete map of your backend.`,
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

async function checkAPIDocumentation(baseUrl: string): Promise<DeepFinding[]> {
  const results = await Promise.allSettled(
    API_DOC_PATHS.map(async ({ path, title }) => {
      const res = await safeFetch(`${baseUrl}${path}`, { redirect: 'follow' });
      return { path, title, status: res?.status ?? 0 };
    })
  );

  const exposed = results
    .filter(r => r.status === 'fulfilled' && r.value.status === 200)
    .map(r => (r as PromiseFulfilledResult<{ path: string; title: string; status: number }>).value);

  if (!exposed.length) return [];

  return [{
    id: 'api-docs-exposed',
    category: 'info-disclosure',
    severity: 'medium',
    title: `API Documentation Publicly Accessible: ${exposed[0].title}`,
    description: `API documentation (${exposed.map(e => e.path).join(', ')}) is publicly accessible. This gives attackers a complete map of your endpoints, request formats, authentication requirements, and data models.`,
    evidence: exposed.map(e => `GET ${baseUrl}${e.path} → 200`).join('\n'),
    remediation: 'Restrict API documentation to authenticated users or internal network. Consider password-protecting the docs endpoint or serving it only on staging.',
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
        severity: 'medium',
        title: 'No Rate Limiting on Authentication Endpoint',
        description: `${path} accepted 6 rapid login attempts without returning HTTP 429 Too Many Requests. Without rate limiting, attackers can brute-force passwords, enumerate valid accounts, or run credential stuffing attacks at scale.`,
        evidence: `POST ${baseUrl}${path} × 6 rapid requests\n→ Statuses: ${statuses.join(', ')} — no 429 Too Many Requests`,
        remediation: 'Implement rate limiting on all authentication endpoints. Limit to 5-10 attempts per IP per minute with exponential backoff. Consider account lockout and CAPTCHA after repeated failures.',
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
      const text = await res.text().catch(() => '');
      const match = NOSQL_ERROR_PATTERNS.find(re => re.test(text));
      if (match) {
        return [{
          id: 'nosql-injection',
          category: 'injection',
          severity: 'critical',
          title: 'NoSQL Injection — MongoDB Error Detected',
          description: 'A MongoDB operator injection payload triggered a database error in the response. Attackers can use this to bypass authentication, enumerate records, or extract data without credentials.',
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

  const text = await res.text().catch(() => '');
  const location = res.headers.get('location') ?? '';

  if (text.includes(INJECTED_HOST) || location.includes(INJECTED_HOST)) {
    const source = location.includes(INJECTED_HOST)
      ? `Location: ${location}`
      : 'Response body contains injected Host value';
    return [{
      id: 'host-header-injection',
      category: 'injection',
      severity: 'high',
      title: 'Host Header Injection',
      description: "The application reflects the attacker-controlled Host header in its response. This enables password reset poisoning (reset emails linking to attacker's domain), cache poisoning, and open redirect attacks.",
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
    const text = await res.text().catch(() => '');
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
  // Deduplicate by category — multiple low/medium in same category count once at that severity
  const worstPerCategory = new Map<string, number>();
  for (const f of findings) {
    const w = WEIGHTS[f.severity] ?? 0;
    const key = `${f.category}:${f.severity}`;
    worstPerCategory.set(key, Math.max(worstPerCategory.get(key) ?? 0, w));
  }
  const deductions = Array.from(worstPerCategory.values()).reduce((sum, w) => sum + w, 0);
  return Math.max(0, 100 - deductions);
}

// ── Build checked[] summary ───────────────────────────────────────────────

function buildChecked(findings: DeepFinding[], mainRes: Response | null): import('@/types/deep-scan').CheckedItem[] {
  function findingsFor(...ids: string[]) {
    return findings.filter(f => ids.some(id => f.id.startsWith(id)));
  }

  function item(
    id: string, label: string, description: string,
    relevant: DeepFinding[],
    passDetail: string,
  ): import('@/types/deep-scan').CheckedItem {
    if (!relevant.length) return { id, label, description, status: 'pass', detail: passDetail };
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
    item('https',      'HTTPS Enforcement',           'Does plain HTTP redirect to HTTPS?',                                     findingsFor('ssl-http'), httpsOk ? 'HTTP correctly redirects to HTTPS — no plain HTTP access' : 'HTTPS redirect in place'),
    item('headers',    'Security Headers',             'CSP, HSTS, X-Frame-Options, XCTO, Referrer-Policy',                     findingsFor('header-'), 'All critical security headers present and correctly configured'),
    item('cors',       'CORS Policy',                  'No wildcard+credentials or arbitrary origin reflection on API routes',   findingsFor('cors-'), 'CORS policy is correctly restricted — no dangerous origin reflection found'),
    item('cookies',    'Cookie Security Flags',        'HttpOnly, Secure, SameSite on session/auth cookies',                    findingsFor('cookie-'), 'All cookies have correct HttpOnly, Secure, and SameSite flags'),
    item('sqli',       'SQL Injection',                "Error-based SQLi via ' OR 1=1, SQLSTATE payloads on query params",      findingsFor('sqli-'), 'No SQL errors returned — injection payloads did not trigger database errors'),
    item('xss',        'Reflected XSS',                'Script tag injection into search/query parameters',                     findingsFor('xss-'), 'Input correctly encoded — no unencoded script reflection found'),
    item('vibe',       'Exposed Secrets in HTML',      'Supabase service role key, Stripe secret, API keys in page source',     findingsFor('vibe-'), 'No exposed secrets or dangerous keys found in page HTML'),
    item('files',      'Sensitive File Exposure',      '.env, .git, wp-config.php, phpinfo.php, backup.sql, .htaccess',         findingsFor('exposed-'), 'No sensitive files or paths accessible publicly'),
    item('admin',      'Admin Panel Exposure',         '/admin, /wp-admin, /phpmyadmin, /cpanel, /manager, 13 more',            findingsFor('admin-'), 'No unauthenticated admin panels found at tested paths'),
    item('dirlist',    'Directory Listing',            '/uploads, /static, /assets, /files, /backup — open indexes',            findingsFor('directory-'), 'No open directory listings detected'),
    item('redirect',   'Open Redirect',                '?redirect=, ?url=, ?next=, ?return=, ?goto= hijacking',                 findingsFor('open-redirect'), 'No open redirect vectors found — redirect params are absent or validated'),
    item('methods',    'Dangerous HTTP Methods',       'TRACE (XST), unauthenticated PUT/DELETE',                               findingsFor('methods-'), 'No dangerous HTTP methods advertised via OPTIONS'),
    item('errors',     'Error Verbosity',              'Stack traces, file paths, framework versions in error pages',            findingsFor('error-'), 'Error responses use generic messages — no internals disclosed'),
    item('info',       'Technology Disclosure',        'Server version, X-Powered-By, X-AspNet-Version in headers',             findingsFor('info-'), 'No detailed server/framework version info disclosed in response headers'),
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

const MIN_PHASE_MS = 900;

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
  onPhase?: (phase: ScanPhase, findings: DeepFinding[]) => void,
): Promise<DeepScanResult> {
  const start = Date.now();
  const baseUrl = `https://${domain}`;
  const allFindings: DeepFinding[] = [];

  async function run<T extends DeepFinding[]>(phaseId: string, fn: () => Promise<T>): Promise<T> {
    const phase = SCAN_PHASES.find(p => p.id === phaseId)!;
    onPhase?.(phase, []);
    const t0 = Date.now();
    const results = await fn();
    // Enforce minimum phase duration so the terminal is readable
    const elapsed = Date.now() - t0;
    if (elapsed < MIN_PHASE_MS) await new Promise(r => setTimeout(r, MIN_PHASE_MS - elapsed));
    onPhase?.(phase, results);
    allFindings.push(...results);
    return results;
  }

  onPhase?.(SCAN_PHASES[0], []);
  const mainRes = await safeFetch(baseUrl, { redirect: 'follow' });

  await run('vibe',     () => checkVibeCodePatterns(baseUrl, mainRes));
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
  await run('sri',        () => checkSRI(baseUrl, mainRes));
  await run('info',       () => checkInfoDisclosure(mainRes));
  await run('forced',     () => checkForcedBrowsing(baseUrl));
  await run('idor',       () => checkIDOR(baseUrl));
  await run('ssrf',       () => checkSSRF(baseUrl));
  await run('traversal',  () => checkPathTraversal(baseUrl));
  await run('components',  () => checkOutdatedLibraries(mainRes));
  await run('sourcemaps', () => checkSourceMaps(baseUrl, mainRes));
  await run('graphql',    () => checkGraphQL(baseUrl));
  await run('apidocs',    () => checkAPIDocumentation(baseUrl));
  await run('ratelimit',  () => checkRateLimiting(baseUrl));
  await run('nosql',      () => checkNoSQLInjection(baseUrl));
  await run('hostheader', () => checkHostHeaderInjection(baseUrl));
  await run('crlf',       () => checkCRLFInjection(baseUrl));

  onPhase?.(SCAN_PHASES[SCAN_PHASES.length - 1], allFindings);

  const findings = allFindings;
  const count = (sev: DeepFinding['severity']) => findings.filter(f => f.severity === sev).length;

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
      score: calculateScore(findings),
    },
    findings,
    checked: buildChecked(findings, mainRes),
  };
}

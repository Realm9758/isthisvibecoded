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
  const nullRes = await safeFetch(baseUrl, {
    headers: { Origin: 'null' },
  });
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
    if (acao === '*') {
      findings.push({
        id: 'cors-wildcard',
        category: 'cors',
        severity: 'medium',
        title: 'CORS Wildcard Origin',
        description: 'Access-Control-Allow-Origin: * allows any site to read responses. Dangerous on authenticated endpoints.',
        evidence: 'Access-Control-Allow-Origin: *',
        remediation: 'Restrict CORS to an explicit allowlist of trusted origins.',
      });
    }
  }

  // Test arbitrary origin reflection with credentials
  const evilRes = await safeFetch(baseUrl, {
    headers: { Origin: 'https://evil-attacker.com' },
  });
  if (evilRes) {
    const acao = evilRes.headers.get('access-control-allow-origin');
    const acac = evilRes.headers.get('access-control-allow-credentials');
    if (acao === 'https://evil-attacker.com' && acac === 'true') {
      findings.push({
        id: 'cors-reflect-credentials',
        category: 'cors',
        severity: 'critical',
        title: 'CORS Reflects Arbitrary Origin with Credentials',
        description: 'The server reflects any origin and allows credentials. Attackers can make authenticated requests from any site and read the response — full account takeover risk.',
        evidence: `Access-Control-Allow-Origin: https://evil-attacker.com\nAccess-Control-Allow-Credentials: true`,
        remediation: 'Use a strict origin allowlist. Never combine Allow-Credentials: true with dynamic origin reflection.',
      });
    }
  }

  return findings;
}

// ── Security headers ──────────────────────────────────────────────────────

async function checkSecurityHeaders(res: Response | null): Promise<DeepFinding[]> {
  const findings: DeepFinding[] = [];
  if (!res) return findings;

  const csp = res.headers.get('content-security-policy');
  const xfo = res.headers.get('x-frame-options');
  const xcto = res.headers.get('x-content-type-options');
  const hsts = res.headers.get('strict-transport-security');
  const rp = res.headers.get('referrer-policy');
  const pp = res.headers.get('permissions-policy');

  if (!csp) {
    findings.push({
      id: 'header-csp-missing',
      category: 'headers',
      severity: 'high',
      title: 'Missing Content-Security-Policy',
      description: 'No CSP header. The site is fully vulnerable to XSS attacks — any injected script can run without restriction.',
      remediation: "Add: Content-Security-Policy: default-src 'self'; script-src 'self'",
    });
  } else {
    if (csp.includes("'unsafe-inline'")) {
      findings.push({
        id: 'header-csp-unsafe-inline',
        category: 'headers',
        severity: 'medium',
        title: "CSP Contains 'unsafe-inline'",
        description: "Allowing 'unsafe-inline' enables inline script execution, negating most XSS protection.",
        evidence: `CSP: ...${csp.includes("'unsafe-inline'") ? "'unsafe-inline'" : ''}...`,
        remediation: "Replace 'unsafe-inline' with nonces or hashes for legitimate inline scripts.",
      });
    }
    if (csp.includes("'unsafe-eval'")) {
      findings.push({
        id: 'header-csp-unsafe-eval',
        category: 'headers',
        severity: 'medium',
        title: "CSP Contains 'unsafe-eval'",
        description: "'unsafe-eval' allows eval() and similar dynamic execution functions, increasing XSS risk.",
        evidence: `CSP contains 'unsafe-eval'`,
        remediation: "Remove 'unsafe-eval'. Refactor any code using eval(), setTimeout(string), or Function().",
      });
    }
  }

  if (!xfo && !csp?.includes('frame-ancestors')) {
    findings.push({
      id: 'header-xfo-missing',
      category: 'headers',
      severity: 'medium',
      title: 'Missing Clickjacking Protection',
      description: 'No X-Frame-Options or CSP frame-ancestors directive. The site can be embedded in iframes to trick users into clicking on hidden buttons (clickjacking).',
      remediation: 'Add X-Frame-Options: DENY or include frame-ancestors in your CSP.',
    });
  }

  if (!xcto) {
    findings.push({
      id: 'header-xcto-missing',
      category: 'headers',
      severity: 'low',
      title: 'Missing X-Content-Type-Options',
      description: 'Without nosniff, browsers may MIME-sniff responses and execute non-script content as scripts.',
      remediation: 'Add X-Content-Type-Options: nosniff',
    });
  }

  if (!hsts) {
    findings.push({
      id: 'header-hsts-missing',
      category: 'headers',
      severity: 'medium',
      title: 'Missing HSTS Header',
      description: 'No Strict-Transport-Security. Browsers may access the site over HTTP, enabling downgrade attacks and cookie interception.',
      remediation: 'Add Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
    });
  } else {
    const match = hsts.match(/max-age=(\d+)/);
    if (match && parseInt(match[1]) < 31536000) {
      findings.push({
        id: 'header-hsts-short',
        category: 'headers',
        severity: 'low',
        title: 'HSTS max-age Too Short',
        description: `HSTS max-age is ${match[1]}s (under 1 year). Short durations weaken protection against downgrade attacks.`,
        evidence: `Strict-Transport-Security: ${hsts}`,
        remediation: 'Set max-age to at least 31536000 (1 year). Add includeSubDomains and preload.',
      });
    }
  }

  if (!rp) {
    findings.push({
      id: 'header-rp-missing',
      category: 'headers',
      severity: 'low',
      title: 'Missing Referrer-Policy',
      description: 'No Referrer-Policy. Full page URLs including sensitive query parameters may leak to third-party sites.',
      remediation: 'Add Referrer-Policy: strict-origin-when-cross-origin',
    });
  }

  if (!pp) {
    findings.push({
      id: 'header-pp-missing',
      category: 'headers',
      severity: 'low',
      title: 'Missing Permissions-Policy',
      description: 'No Permissions-Policy header. Browser features like camera and geolocation are not explicitly restricted.',
      remediation: 'Add a Permissions-Policy header to restrict unneeded browser APIs.',
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

// ── Score calculation ─────────────────────────────────────────────────────

function calculateScore(findings: DeepFinding[]): number {
  const WEIGHTS = { critical: 25, high: 15, medium: 8, low: 3, info: 0 };
  const deductions = findings
    .filter(f => !f.id.endsWith('-ok'))
    .reduce((sum, f) => sum + (WEIGHTS[f.severity] ?? 0), 0);
  return Math.max(0, 100 - deductions);
}

// ── Main export ───────────────────────────────────────────────────────────

export async function deepScanDomain(domain: string): Promise<DeepScanResult> {
  const start = Date.now();
  const baseUrl = `https://${domain}`;

  const mainRes = await safeFetch(baseUrl, { redirect: 'follow' });

  const [
    exposedFiles,
    cors,
    headers,
    cookies,
    infoDisclosure,
    httpMethods,
    ssl,
    robots,
  ] = await Promise.all([
    checkSensitiveFiles(baseUrl),
    checkCORS(baseUrl),
    checkSecurityHeaders(mainRes),
    checkCookies(mainRes),
    checkInfoDisclosure(mainRes),
    checkHTTPMethods(baseUrl),
    checkSSL(domain),
    checkRobotsTxt(baseUrl),
  ]);

  const findings: DeepFinding[] = [
    ...exposedFiles,
    ...cors,
    ...headers,
    ...cookies,
    ...infoDisclosure,
    ...httpMethods,
    ...ssl,
    ...robots,
  ];

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
  };
}

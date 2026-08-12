/**
 * Scanner phase metadata: the labels and descriptions streamed to the client
 * while a scan runs.
 *
 * This is data, not scanner logic, and it lives apart from lib/deep-scanner.ts
 * so that routes, the client, and the test suite can read the phase list
 * without loading the scanner and its server-only transport stack.
 *
 * Which of these phases actually runs is decided by lib/scan-lanes.ts.
 */

export type ScanPhase = {
  id: string;
  label: string;
  detail: string;
};

export const SCAN_PHASES: ScanPhase[] = [
  { id: 'init',       label: 'Connecting',              detail: 'Establishing HTTPS connection, reading response headers and framework fingerprint…' },
  { id: 'vibe',       label: 'Secrets in HTML',         detail: 'Scanning page source for Supabase keys, Firebase config, Stripe secrets, exposed API keys…' },
  { id: 'files',      label: 'Sensitive Files',         detail: 'Probing well-known paths: .env, .env.local, .git/HEAD, wp-config.php, .npmrc, docker-compose.yml, Dockerfile, backup.sql…' },
  { id: 'xss',        label: 'Cross-Site Scripting',    detail: 'Injecting <script>alert(1)</script> into ?q=, ?s=, ?name= to see whether input is reflected unencoded…' },
  { id: 'sqli',       label: 'SQL Injection',           detail: "Sending ' OR 1=1, \\\" OR \\\"1\\\"=\\\"1, SQLSTATE payloads and watching for database error messages…" },
  { id: 'cors',       label: 'CORS Policy',             detail: 'Null origin plus evil-attacker.com on /api routes, testing for wildcard with credentials or arbitrary origin reflection…' },
  { id: 'headers',    label: 'Security Headers',        detail: 'Auditing CSP (with nonce check), HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy…' },
  { id: 'cookies',    label: 'Cookie Security',         detail: 'Inspecting Set-Cookie for HttpOnly, Secure, SameSite=Lax/Strict flags on session and auth cookies…' },
  { id: 'ssl',        label: 'HTTPS / TLS',             detail: 'Following a bounded plain-HTTP redirect chain and checking that it finishes on HTTPS…' },
  { id: 'admin',      label: 'Admin Discovery',         detail: 'Probing 18 paths: /admin, /wp-admin, /phpmyadmin, /cpanel, /manager, /backend, /portal…' },
  { id: 'errors',     label: 'Error Verbosity',         detail: 'Triggering 404, /api/nonexistent, ?debug=true to check for JS, Python, and PHP stack traces…' },
  { id: 'redirect',   label: 'Open Redirect',           detail: 'Testing ?redirect=, ?url=, ?next=, ?return=, ?goto= with an external target URL…' },
  { id: 'dirlist',    label: 'Directory Listing',       detail: 'Requesting /uploads/, /static/, /assets/, /files/, /backup/ to check for open indexes…' },
  { id: 'robots',     label: 'robots.txt',              detail: 'Fetching /robots.txt and parsing Disallow entries for accidentally exposed sensitive paths…' },
  { id: 'sri',        label: 'Subresource Integrity',   detail: 'Parsing HTML for external <script> and <link> tags missing integrity= hashes…' },
  { id: 'info',       label: 'Info Disclosure',         detail: 'Reading Server, X-Powered-By, and X-AspNet-Version, checking for version numbers in headers…' },
  { id: 'serverstatus', label: 'Server Status Exposure', detail: 'Requesting Apache /server-status and requiring real mod_status content before reporting exposure…' },
  { id: 'forced',     label: 'Forced Browsing',         detail: 'Probing selected admin and internal API paths, including routes passively discovered in bundles, for unauthenticated data exposure…' },
  { id: 'idor',       label: 'IDOR',                    detail: 'Testing /api/users/1 and /api/orders/1 to check whether records are readable without ownership verification…' },
  { id: 'ssrf',       label: 'SSRF',                    detail: 'Injecting an AWS metadata URL into ?url=, ?webhook=, ?proxy= and checking for a metadata-specific response…' },
  { id: 'traversal',  label: 'Path Traversal',          detail: 'Sending ../../../etc/passwd into ?file=, ?path=, ?page= to test directory traversal…' },
  { id: 'components', label: 'Vulnerable Libraries',    detail: 'Scanning HTML for jQuery, AngularJS, Lodash, and Moment.js versions with known CVEs…' },
  { id: 'sourcemaps', label: 'Source Map Exposure',     detail: 'Finding <script src> tags in HTML and probing .js.map files to check whether unminified source is readable…' },
  { id: 'supabase',   label: 'Supabase Access',         detail: 'Using passively discovered table names to test a few bounded anonymous reads with the public project key…' },
  { id: 'firebase',   label: 'Firebase Rules',          detail: 'Checking exact discovered Firebase endpoints with shallow or one-item anonymous reads…' },
  { id: 'storage',    label: 'Storage Listing',         detail: 'Testing discovered Supabase Storage and S3 endpoints with one-item listing requests…' },
  { id: 'nextauth',   label: 'Next.js Auth Bypass',     detail: 'Reading the public build manifest, then differentially testing discovered protected routes for a known middleware bypass…' },
  { id: 'graphql',    label: 'GraphQL Introspection',   detail: 'POST {__schema} query to /graphql, /api/graphql, /gql to check whether the full schema is enumerable without auth…' },
  { id: 'apidocs',    label: 'API Documentation',       detail: 'Probing /swagger, /openapi.json, /api-docs, /redoc to check whether the full API schema is public…' },
  { id: 'nosql',      label: 'NoSQL Injection',         detail: 'Sending MongoDB operator payloads [$gt], [$ne], [$regex] and watching for BSON or Mongoose errors…' },
  { id: 'hostheader', label: 'Host Header Injection',   detail: 'Sending a forged Host: evil-attacker-test.com to check whether it is reflected in the body or Location header…' },
  { id: 'crlf',       label: 'CRLF Injection',          detail: 'Injecting %0d%0a newlines into query params to check whether the sequence breaks into response headers…' },
  { id: 'done',       label: 'Compiling Report',        detail: 'Scoring all findings, computing the security grade, building the detailed report…' },
];

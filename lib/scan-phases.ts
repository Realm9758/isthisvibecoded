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
  { id: 'init',       label: 'Connecting',              detail: 'Connecting to the submitted public page, reading bounded HTML and response headers…' },
  { id: 'vibe',       label: 'Secrets in HTML',         detail: 'Scanning page source for Supabase keys, Firebase config, Stripe secrets, exposed API keys…' },
  { id: 'files',      label: 'Sensitive Files',         detail: 'Probing well-known paths: .env, .env.local, .git/HEAD, wp-config.php, .npmrc, docker-compose.yml, Dockerfile, backup.sql…' },
  { id: 'xss',        label: 'HTML Reflection Review',  detail: 'Sending unique markup-shaped input to selected query parameters and checking for unencoded reflection…' },
  { id: 'sqli',       label: 'SQL Error Differential',  detail: 'Comparing SQL-shaped inputs with benign controls on selected query parameters, looking for database-only error signatures…' },
  { id: 'cors',       label: 'CORS Policy',             detail: 'Null origin plus evil-attacker.com on /api routes, testing for wildcard with credentials or arbitrary origin reflection…' },
  { id: 'headers',    label: 'Security Headers',        detail: 'Auditing CSP (with nonce check), HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy…' },
  { id: 'cookies',    label: 'Cookie Security',         detail: 'Inspecting observed Set-Cookie headers for HttpOnly, Secure, valid SameSite values, and cookie-prefix rules…' },
  { id: 'ssl',        label: 'HTTPS / TLS',             detail: 'Following a bounded plain-HTTP redirect chain and checking that it finishes on HTTPS…' },
  { id: 'admin',      label: 'Admin Discovery',         detail: 'Probing 18 paths: /admin, /wp-admin, /phpmyadmin, /cpanel, /manager, /backend, /portal…' },
  { id: 'errors',     label: 'Error Verbosity',         detail: 'Triggering 404, /api/nonexistent, ?debug=true to check for JS, Python, and PHP stack traces…' },
  { id: 'redirect',   label: 'Open Redirect',           detail: 'Testing ?redirect=, ?url=, ?next=, ?return=, ?goto= with an external target URL…' },
  { id: 'dirlist',    label: 'Directory Listing',       detail: 'Requesting /uploads/, /static/, /assets/, /files/, /backup/ to check for open indexes…' },
  { id: 'robots',     label: 'robots.txt',              detail: 'Fetching /robots.txt and parsing Disallow entries for accidentally exposed sensitive paths…' },
  { id: 'sri',        label: 'Subresource Integrity',   detail: 'Validating integrity hashes and crossorigin settings on immutable external scripts and stylesheets…' },
  { id: 'info',       label: 'Info Disclosure',         detail: 'Reading Server, X-Powered-By, and X-AspNet-Version, checking for version numbers in headers…' },
  { id: 'serverstatus', label: 'Server Status Exposure', detail: 'Requesting Apache /server-status and requiring real mod_status content before reporting exposure…' },
  { id: 'forced',     label: 'Forced Browsing',         detail: 'Probing selected admin and internal API paths, including routes passively discovered in bundles, for unauthenticated data exposure…' },
  { id: 'idor',       label: 'Sequential Object Review', detail: 'Comparing selected sequential public object responses for data that may need an authorization review…' },
  { id: 'ssrf',       label: 'SSRF',                    detail: 'Injecting an AWS metadata URL into ?url=, ?webhook=, ?proxy= and checking for a metadata-specific response…' },
  { id: 'traversal',  label: 'Path Traversal',          detail: 'Sending ../../../etc/passwd into ?file=, ?path=, ?page= to test directory traversal…' },
  { id: 'components', label: 'Library Version Review',  detail: 'Scanning browser-delivered source for reviewable jQuery, AngularJS, Lodash, and Moment.js version strings…' },
  { id: 'sourcemaps', label: 'Source Map Exposure',     detail: 'Finding same-origin scripts and probing selected map files for source paths, mappings, or embedded source…' },
  { id: 'supabase',   label: 'Supabase Access',         detail: 'Using passively discovered table names to test a few bounded anonymous reads with the public project key…' },
  { id: 'firebase',   label: 'Firebase Rules',          detail: 'Checking exact discovered Firebase endpoints with shallow or one-item anonymous reads…' },
  { id: 'storage',    label: 'Storage Listing',         detail: 'Testing discovered Supabase Storage and S3 endpoints with one-item listing requests…' },
  { id: 'nextauth',   label: 'Next.js Auth Bypass',     detail: 'Reading the public build manifest, then differentially testing discovered protected routes for a known middleware bypass…' },
  { id: 'graphql',    label: 'GraphQL Introspection',   detail: 'POST {__schema} query to /graphql, /api/graphql, /gql to check whether the full schema is enumerable without auth…' },
  { id: 'apidocs',    label: 'API Documentation',       detail: 'Probing /swagger, /openapi.json, /api-docs, /redoc to check whether the full API schema is public…' },
  { id: 'nosql',      label: 'NoSQL Error Differential', detail: 'Comparing MongoDB-shaped operator inputs with benign controls, looking for crafted-input-only error signatures…' },
  { id: 'hostheader', label: 'Host Header Handling',    detail: 'Sending a forged Host value to check for body reflection or control of an external redirect…' },
  { id: 'crlf',       label: 'CRLF Injection',          detail: 'Injecting %0d%0a newlines into query params to check whether the sequence breaks into response headers…' },
  { id: 'done',       label: 'Finalizing Report',       detail: 'Scoring findings, building the detailed report, and saving it to scan history…' },
];

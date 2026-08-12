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
  { id: 'xss',        label: 'HTML Input Handling',     detail: 'Testing real public GET inputs discovered in forms, links, or browser scripts for unencoded HTML reflection…' },
  { id: 'sqli',       label: 'SQL Input Safety',        detail: 'Comparing benign and SQL-shaped values on discovered public GET inputs; password forms are identified but not automatically submitted…' },
  { id: 'cors',       label: 'CORS Policy',             detail: 'Null origin plus evil-attacker.com on /api routes, testing for wildcard with credentials or arbitrary origin reflection…' },
  { id: 'headers',    label: 'Security Headers',        detail: 'Auditing CSP (with nonce check), HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy…' },
  { id: 'cookies',    label: 'Cookie Security',         detail: 'Inspecting observed Set-Cookie headers for HttpOnly, Secure, valid SameSite values, and cookie-prefix rules…' },
  { id: 'ssl',        label: 'HTTPS / TLS',             detail: 'Following a bounded plain-HTTP redirect chain and checking that it finishes on HTTPS…' },
  { id: 'admin',      label: 'Admin Access',            detail: 'Checking common management paths and requiring real privileged-interface evidence rather than treating a login page as exposure…' },
  { id: 'errors',     label: 'Error Verbosity',         detail: 'Triggering 404, /api/nonexistent, ?debug=true to check for JS, Python, and PHP stack traces…' },
  { id: 'redirect',   label: 'Open Redirect',           detail: 'Testing ?redirect=, ?url=, ?next=, ?return=, ?goto= with an external target URL…' },
  { id: 'dirlist',    label: 'Directory Listing',       detail: 'Requesting /uploads/, /static/, /assets/, /files/, /backup/ to check for open indexes…' },
  { id: 'robots',     label: 'robots.txt',              detail: 'Fetching /robots.txt and parsing Disallow entries for accidentally exposed sensitive paths…' },
  { id: 'sri',        label: 'Subresource Integrity',   detail: 'Validating integrity hashes and crossorigin settings on immutable external scripts and stylesheets…' },
  { id: 'info',       label: 'Info Disclosure',         detail: 'Reading Server, X-Powered-By, and X-AspNet-Version, checking for version numbers in headers…' },
  { id: 'serverstatus', label: 'Server Status Exposure', detail: 'Requesting Apache /server-status and requiring real mod_status content before reporting exposure…' },
  { id: 'forced',     label: 'Unauthenticated API Access', detail: 'Checking passively discovered and selected API paths for material account or secret data returned without authentication…' },
  { id: 'ratelimit',  label: 'Rate-Limit Signals',        detail: 'Sending a six-request bounded burst to one discovered public API route and recording 429, Retry-After, or standard rate-limit headers…' },
  { id: 'idor',       label: 'Public Object Access',    detail: 'Comparing selected public object responses to identify records that may need an ownership and authorization review…' },
  { id: 'ssrf',       label: 'Server-Side URL Fetching', detail: 'Testing discovered URL, webhook, proxy, or image parameters for a differential cloud-metadata response…' },
  { id: 'traversal',  label: 'File Path Handling',      detail: 'Testing discovered file, path, template, or download parameters for a differential local-file response…' },
  { id: 'components', label: 'Library Version Review',  detail: 'Scanning browser-delivered source for reviewable jQuery, AngularJS, Lodash, and Moment.js version strings…' },
  { id: 'sourcemaps', label: 'Source Map Exposure',     detail: 'Finding same-origin scripts and probing selected map files for source paths, mappings, or embedded source…' },
  { id: 'supabase',   label: 'Supabase Access',         detail: 'Using passively discovered table names to test a few bounded anonymous reads with the public project key…' },
  { id: 'firebase',   label: 'Firebase Rules',          detail: 'Checking exact discovered Firebase endpoints with shallow or one-item anonymous reads…' },
  { id: 'storage',    label: 'Storage Listing',         detail: 'Testing discovered Supabase Storage and S3 endpoints with one-item listing requests…' },
  { id: 'nextauth',   label: 'Next.js Auth Bypass',     detail: 'Reading the public build manifest, then differentially testing discovered protected routes for a known middleware bypass…' },
  { id: 'graphql',    label: 'GraphQL Introspection',   detail: 'Sending a bounded schema query to /graphql, /api/graphql, /gql, and /query to check whether the API shape is public…' },
  { id: 'apidocs',    label: 'API Documentation',       detail: 'Probing /swagger, /openapi.json, /api-docs, /redoc to check whether the full API schema is public…' },
  { id: 'nosql',      label: 'NoSQL Input Safety',      detail: 'Comparing benign and MongoDB-shaped values on discovered public API inputs; password forms are not automatically submitted…' },
  { id: 'hostheader', label: 'Host Header Handling',    detail: 'Sending a forged Host value to check for body reflection or control of an external redirect…' },
  { id: 'crlf',       label: 'Response Header Injection', detail: 'Testing discovered response-shaping query inputs to see whether a newline can create an unintended HTTP header…' },
  { id: 'done',       label: 'Finalizing Report',       detail: 'Scoring findings, building the detailed report, and saving it to scan history…' },
];

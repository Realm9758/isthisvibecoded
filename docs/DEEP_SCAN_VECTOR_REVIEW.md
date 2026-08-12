# Ironclad deep-scan vector review

Status: 2026-08-12  
Scanner contract: `4.2.0-scoped-rate-signals`  
Scope: bounded, unauthenticated, black-box assessment of one submitted public page and selected same-origin/provider targets

## Bottom line

The scanner has useful modules, but the modules are not equal and they are not substitutes for a penetration test. The strongest modules require distinctive response evidence: exposed-file signatures, response-header creation, differential local-file evidence, structured GraphQL/OpenAPI data, provider list/read responses, and dangerous CORS reflection. The weakest modules are low-volume indicators: library version strings, a six-request rate-limit sample, public object comparisons, and conventional-path discovery.

The most important next product is not another guessed payload list. It is an **authenticated test workspace** with owner-provided test accounts, a bounded route/schema inventory, and explicit permission for safe POST requests. Without that, login SQL/NoSQL behaviour, session rotation, password reset, role authorization, CSRF, authenticated IDOR, and business workflows cannot be tested honestly.

## Current modules

Ratings mean:

- **Strong evidence** — a positive result has a distinctive, validated response signature.
- **Useful indicator** — good triage evidence, but confirmation or application context is still required.
- **Narrow indicator** — honest and sometimes useful, but meaningful false negatives are expected.
- **Configuration review** — evaluates hardening, not exploitability.

| Module | Current evidence and usefulness | Rating | Highest-value improvement |
| --- | --- | --- | --- |
| Client-code secrets | Reads the submitted HTML and up to eight selected same-origin scripts; distinguishes material secrets from public/provider keys and placeholders. | Strong evidence for validated secrets | Follow preload/modulepreload and chunk manifests under one aggregate byte cap; correlate every provider credential to the discovered project. |
| Library versions | Finds version strings for jQuery, AngularJS, Lodash, and Moment.js. It does not prove reachability or exploitation. | Narrow indicator | Parse source maps/package metadata when published, expand a version-tested catalogue, and label results as dependency review rather than vulnerability proof. |
| Source maps | Follows declared same-origin `sourceMappingURL` values and bounded conventional fallbacks; distinguishes embedded source from metadata-only maps. | Strong evidence for published map content | Cover CSS maps and manifest-discovered chunks; separately classify secrets found inside confirmed embedded source. |
| Security headers | Evaluates effective CSP, HSTS, framing, MIME, referrer, and permissions-policy values on the submitted response. | Configuration review | Sample discovered HTML/auth/API routes and report policy drift rather than implying one page represents the origin. |
| Cookies | Validates observed Secure, HttpOnly, SameSite, `__Host-`, and `__Secure-` contracts. | Configuration review | Add an authenticated session mode so cookies set during login/refresh/logout can be tested for rotation, scope, expiry, and invalidation. |
| HTTPS redirect | Requests plain HTTP and checks that a bounded redirect chain ends on the verified HTTPS host. | Useful indicator | Add a real TLS handshake audit for certificate hostname/expiry/chain, TLS versions, and selected weak ciphers. |
| Technology disclosure | Reports detailed server/framework versions in response headers. | Configuration review | Sample error and API responses and distinguish harmless product branding from actionable patch-level disclosure. |
| Subresource integrity | Validates integrity/crossorigin on immutable third-party scripts and stylesheets. | Configuration review | Verify the declared hash against the fetched resource in an opt-in higher-traffic mode and cover modulepreload assets. |
| CORS | Sends hostile and null origins to the page and selected API routes; high severity requires reflected credentials plus sensitive-looking JSON. | Useful indicator | Repeat with an authenticated test session, preflight requests, method/header variants, and cache-key checks. |
| Host header | Detects a forged host controlling an external redirect or appearing in a successful body. | Useful indicator | Add owner-configured password-reset and absolute-link test flows plus cache comparison; reflection alone must remain informational. |
| Response-header injection | Sends a newline only through discovered response-shaping GET inputs and confirms a new response header. | Strong evidence when confirmed | Add encoded variants and structured redirect/download endpoints discovered from OpenAPI while retaining strict controls. |
| Rate-limit signals | Sends six safe GETs to one discovered public API route and records `429`, `Retry-After`, and standard rate-limit headers. | Narrow indicator | Let the owner choose endpoints, safe methods, expected thresholds, test accounts, and cool-down windows; support distributed-source tests only in an isolated authorised worker. |
| Sensitive files | Probes a bounded high-risk path inventory and requires type-specific content evidence instead of trusting HTTP 200. | Strong evidence | Add platform-specific manifests and pair Git markers before high severity; use a random-path baseline consistently for catch-all applications. |
| Admin access | Probes conventional management paths and requires privileged-interface content with no visible login gate. | Useful indicator | Use route discovery and platform fingerprints to choose paths; confirm functionality with a non-mutating browser action before high severity. |
| Error verbosity | Requests a random missing page, a missing API route, and a debug-shaped query, then looks for stack traces. | Useful indicator | Drive safe malformed values through each discovered input/content type and compare against a random-path baseline. |
| Directory listing | Checks selected common directories and requires real index-listing markup. | Strong evidence for tested paths | Add directories learned from HTML, source maps, robots, and manifests rather than relying mainly on common names. |
| robots.txt | Parses public Disallow entries for sensitive-looking paths. | Narrow indicator | Verify each disclosed path with the appropriate content classifier and keep the robots observation informational by itself. |
| Apache server status | Requires real mod_status markers at `/server-status`. | Strong evidence for Apache | Add bounded signatures for nginx status, PHP-FPM, Spring Actuator, Rails diagnostics, and common cloud health consoles. |
| API documentation | Requires structured OpenAPI/Swagger/ReDoc evidence at selected paths. | Useful indicator | Use confirmed schemas as a route/parameter inventory for later selected modules, with method and mutation safety classification. |
| GraphQL introspection | Sends a bounded schema query to four conventional endpoints and requires structured schema data. | Useful indicator | Parse the schema to find read-only operations, test field-level authorization with owner accounts, and avoid treating intentional public introspection as a flaw. |
| HTML input handling | Sends a unique markup-shaped value to discovered public GET inputs and requires differential unencoded HTML reflection. | Useful indicator | Run a real browser context to distinguish text, attribute, URL, script, and DOM sinks and to confirm execution; add stored/POST workflows only with a disposable test workspace. |
| SQL input safety | Compares benign and SQL-shaped values on discovered GET inputs and reports only database-specific differential errors. | Useful indicator for error disclosure; not SQL injection proof | Use schema/form discovery, boolean/time differentials with conservative timing controls, and owner-provided login/test endpoints. |
| NoSQL input safety | Compares benign and MongoDB-shaped query operators on discovered public API inputs. | Useful indicator for error disclosure | Add JSON-body testing from OpenAPI and safe authenticated login fixtures; do not claim bypass without a changed authorization outcome. |
| Open redirect | Sends an external target only through discovered redirect-like GET parameters and checks the actual Location destination. | Strong evidence for tested inputs | Add browser/JavaScript redirects, multi-step return URLs, encoded variants, and POST-only flows in an authorised test workspace. |
| Server-side URL fetching | Looks only for differential cloud-metadata markers through discovered URL-like inputs. | Narrow but high-confidence indicator | Add an Ironclad-controlled, consented out-of-band callback service for blind SSRF, DNS-only callbacks, redirect handling, and egress-policy evidence. |
| File path handling | Sends traversal-shaped values only through discovered file/path GET inputs and requires differential Unix account-file records. | Strong evidence for the tested Unix file | Add Windows targets, encoded variants, archive/download parameters, and schema-discovered POST bodies under explicit opt-in. |
| Unauthenticated API access | Checks discovered and selected conventional API paths for material secret/account JSON without authentication. | Useful indicator | Stop guessing most paths once an OpenAPI/bundle inventory exists; compare unauthenticated and least-privilege authenticated roles. |
| Public object access | Requires two distinct sequential public records and a nonexistent-ID control. It deliberately does not call this IDOR. | Narrow indicator | Use two owner-supplied principals and known owned/unowned object IDs to test authorization decisions directly. |
| Next.js middleware auth | Uses a public build manifest and differential protected-route responses for the known middleware-bypass pattern. | Strong evidence when the differential is confirmed | Version-gate the probe, test app/router route forms, and verify authorization again at data endpoints rather than only page content. |
| Supabase access | Uses discovered project configuration and selected table names for bounded anonymous reads; material values determine severity. | Useful indicator | Ingest owner-supplied schema metadata or generated types because modern hosted schema discovery may be unavailable; add authenticated role/RLS comparisons. |
| Firebase rules | Makes shallow/one-item reads against exact discovered database/storage endpoints. | Useful indicator | Traverse several prioritized shallow branches, compare authenticated rules, and distinguish intentional public content collections. |
| Storage listing | Makes one-item anonymous list requests to discovered Supabase Storage and S3 endpoints. | Strong evidence for LIST permission | Add bounded object-read checks only for objects already advertised publicly; add write tests only against an owner-created disposable prefix. |

## Important coverage that does not exist yet

Priority is based on client value, not ease of implementation.

1. **Authenticated role and ownership testing.** Two disposable accounts, known objects, and explicit expected access would turn public-object indicators into real authorization tests.
2. **Login/session/password-reset testing.** Session fixation/rotation, logout invalidation, cookie refresh, account enumeration, reset-token handling, MFA recovery, and login throttling require safe accounts and user-configured flows.
3. **Schema-assisted API coverage.** Import OpenAPI/Postman collections or parse confirmed GraphQL schemas, classify read versus mutation operations, and let the owner select exact endpoints.
4. **Bounded crawl and browser execution.** One landing page misses client-side routes, DOM XSS, CSP runtime behaviour, JavaScript redirects, and forms rendered after hydration.
5. **CSRF and state-changing forms.** SameSite/header checks are not a CSRF test. Real testing requires a disposable account, known safe mutation, origin/referer variants, and cleanup.
6. **Upload handling.** Extension/MIME mismatch, SVG/script execution, path handling, malware controls, and public object ACLs need an owner-created disposable upload destination.
7. **Command injection, template injection, XXE, unsafe deserialization, and request smuggling.** These need parser/framework evidence and isolated targets; blind generic payload spraying would add risk and noise.
8. **Cache/CDN behaviour.** Cache-key confusion, authenticated response caching, poisoning, and web-cache deception require controlled baseline pairs and careful cleanup.
9. **Complete TLS/DNS/mail posture.** Certificate chain/expiry, TLS protocols, DNSSEC, CAA, SPF, DKIM, and DMARC are separate infrastructure modules, not implied by the current HTTPS redirect check.
10. **Dependency and source review.** A URL scanner cannot reliably produce an SBOM, identify server packages, or prove vulnerable code reachability. Repository/package-lock integration is the useful path.
11. **WebSockets, server-sent events, and background jobs.** The current route inventory is HTTP request/response focused.
12. **Business logic and race conditions.** Pricing, credits, inventory, invitations, tenancy, and multi-step workflow abuse need application-specific invariants and human-designed tests.

## Product rules resulting from this review

- Every scan has an explicit backend-enforced module scope.
- Modules that need browser-bundle route/input discovery visibly include the client-code discovery module; the backend enforces the same dependency.
- A custom scope receives no overall grade.
- Every module presents its benefit and its most important limitation before the scan starts.
- A rate-limit result is an observation, not a pass/fail security finding.
- Login and other state-changing POST forms are mapped but not submitted without a future authenticated test workspace.
- New modules need a negative/control fixture, positive fixture, catch-all fixture, blocked/timeout fixture, a hard request/body cap, and plain-language result copy before release.

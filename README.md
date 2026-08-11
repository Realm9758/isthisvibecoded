# Ironclad

**Is your site ironclad?** Point Ironclad at any URL and it reports what your site exposes: leaked keys, public config files, missing headers, source maps, and the other things that ship when nobody was looking.

## The two lanes

Ironclad separates two questions the product used to conflate. **Permission decides which checks run. Payment decides how many scans you get.**

**Surface lane, 15 checks, any URL, no account.** Every probe is a read-only request of the class a browser or a search crawler already makes: secrets in HTML, exposed `.env` and `.git`, security headers, cookie flags, TLS and HSTS, CORS, directory listing, `robots.txt`, subresource integrity, server version disclosure, vulnerable libraries, source maps, GraphQL introspection, public API schemas, and allowed HTTP methods.

**Deep lane, 13 more checks, verified domains only.** SQL injection, cross-site scripting, NoSQL injection, path traversal, SSRF, CRLF injection, host header injection, open redirect, error verbosity, admin panel discovery, forced browsing, IDOR, and authentication rate limiting. Each sends a real test payload or repeats requests against an endpoint, so each runs only against a domain whose control the requester has proved within the last 30 days.

No plan moves a check between lanes. Sending an attack payload at a server you do not control is not something a subscription should be able to buy.

The rule that decides membership lives in [`lib/scan-lanes.ts`](lib/scan-lanes.ts), and `tests/scan-lanes.test.ts` exists so moving a check is a deliberate act rather than an accident.

## Plans

| | Anonymous | Free account | Pro, £4.99/mo |
| --- | --- | --- | --- |
| Surface scan, any URL | 1 per day, redacted | 3 lifetime, full report | unlimited, fair-use burst limits |
| Deep scan, verified domain | not available | included, uses one of the 3 | unlimited, fair-use burst limits |
| Evidence and remediation | withheld | shown | shown |
| Scan history and rescan diff | no | no | yes |

The three free scans deliberately include the deep lane. Nobody subscribes to a product they have not watched work.

An anonymous scan is stored privately with a one-time claim token, so creating an account unlocks that exact report without spending one of the three.

## Privacy and scanner boundaries

- Query strings and fragments are stripped before any scan.
- Every scan result is private to the account that ran it. There is no public feed, leaderboard, or shareable result page, because a scan can describe a site its requester does not own.
- Unclaimed anonymous results are deleted after 7 days.
- Each lane sends its own user agent naming what it is, with a URL a site owner can follow to identify and block it. See [`/scanner`](app/scanner/page.tsx).
- Any single domain can be scanned at most 10 times per hour across all users combined. That cap applies to paying accounts exactly as it applies to anonymous ones, so Ironclad cannot be used to sustain traffic against a target.
- Outbound connections bind the validated public IP to the socket while preserving hostname and TLS verification, closing the application-level DNS-rebinding gap. This still does not replace an egress-restricted worker.
- Anonymous rate-limit identifiers use a keyed HMAC rather than a stored IP address.

## Coverage and grades

A blocked probe marks its own check inconclusive with a stated reason. The report still renders, and the grade is withheld only when a check that carries deductions could not run. A scan fails outright in two cases: the main page is unreachable, or the scan budget expires.

A clean surface scan is never presented as "secure". It reports that no issues were found in 15 surface checks and that 13 deeper checks require domain verification.

Surface grades and deep grades are different measurements and are never compared, including in the rescan diff. Results from different model versions must not be compared either.

## Local setup

Requires Node.js 20.9 or newer, npm, and a Supabase PostgreSQL project.

```bash
npm ci
cp .env.local.example .env.local
```

Fill in the environment variables below, then run `supabase/schema.sql` in the Supabase SQL editor. The schema supports a fresh install and an in-place upgrade, and every migration in it is additive. Back up before applying it to an existing database.

```bash
npm run dev
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Yes in deployment | Canonical application origin used for links and redirects |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only database credential; never expose it to browser code |
| `JWT_SECRET` | Yes | Signs authentication cookies; use at least 32 random bytes |
| `RATE_LIMIT_SECRET` | Recommended | HMAC key for anonymous rate-limit identifiers; keep distinct from the JWT key |
| `TRUST_PROXY_HEADERS` | Self-hosted only | Set `true` only when a trusted proxy overwrites forwarding headers; Vercel is detected automatically |
| `STRIPE_SECRET_KEY` | For billing | Server-only Stripe API key |
| `STRIPE_PRO_PRICE_ID` | For billing | Allowed Pro subscription price |
| `STRIPE_WEBHOOK_SECRET` | For billing | Verifies Stripe webhook payloads |
| `RESEND_API_KEY` | Optional | Enables notification email delivery |
| `EMAIL_FROM` | Optional | Verified sender used for notification email |

Generate secrets with `openssl rand -hex 32`. Do not commit `.env.local`.

## Verification

```bash
npm run check
```

That runs typecheck, tests, lint, and build in order.

The test suite compiles through `tsconfig.test.json` and runs under `node --test` with `tests/support/alias-hook.mjs`, which resolves the `@/` path alias. tsc type-checks that alias but does not rewrite it on emit, so without the hook any module with a runtime `@/` import fails to load and takes its whole test file with it.

Unit coverage: lane membership, coverage attribution, redaction, quota keys, rescan diff, provenance detection, evidence validation, scoring correlation, effective security-header values, Stripe entitlement selection, and outbound-address rejection. Database, access-control integration, and browser tests remain release-gate work.

## Important limitations

A scan looks from the outside at one moment in time. It cannot read your source, review your access control, or reason about your business logic, and it is not a penetration test. A check that finds nothing means these bounded probes observed nothing, not that the condition is absent.

The deep scanner remains experimental. Sensitive-path handling needs a larger false-positive corpus, and the request-bound scan job should move to a durable, egress-restricted worker. See [the audit and reliability roadmap](docs/AUDIT_AND_ROADMAP.md).

## Not yet built

The trust badge and shareable result cards are not implemented. They were tied to the retired passive scanner and its publish flag; rebuilding them on the current store needs a deliberate publish flow, and no plan advertises them in the meantime.

# Ironclad

**Is your site ironclad?** Point Ironclad at any URL and it reports what your site exposes: leaked keys, public config files, missing headers, source maps, and the other things that ship when nobody was looking.

## The two lanes

Ironclad separates two questions the product used to conflate. **Permission decides which checks run. Payment decides how many scans you get.**

**Surface lane, 12 checks, any URL, no account.** Every probe is a read-only request of the class a browser or search crawler already makes: client bundles, exposed `.env` and `.git`, security headers, cookie flags, TLS, directory listing, `robots.txt`, subresource integrity, server version disclosure, vulnerable-library inventory, source maps, and public API schemas.

**Deep lane, 20 more checks (32 total), verified domains only.** SQL input differentials, reflection analysis, NoSQL input differentials, path traversal, SSRF, CRLF injection, host header handling, open redirect, error verbosity, admin and diagnostic-console discovery, unauthenticated API access, public object comparisons, active CORS, GraphQL introspection, bounded Supabase, Firebase, and storage checks, Next.js middleware bypass validation, and rate-limit signals. Each sends a test value, probes an application entry point, reads a discovered provider API, or intentionally repeats a safe request, so each runs only after live domain control is revalidated.

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

Deep verification can use a read-only Vercel or Netlify connection, DNS TXT, a real meta element in the server-rendered document head, or an exact plain-text file. Manual and provider proofs are checked again immediately before every active scan.

An anonymous scan is stored privately with a one-time claim token, so creating an account unlocks that exact report without spending one of the three.

## Privacy and scanner boundaries

- Query strings and fragments are stripped before any scan.
- Every scan result is private to the account that ran it. There is no public feed, leaderboard, or shareable result page, because a scan can describe a site its requester does not own.
- Unclaimed anonymous results are deleted after 7 days.
- Each lane sends its own user agent naming what it is, with a URL a site owner can follow to identify and block it. See [`/scanner`](app/scanner/page.tsx).
- Any single domain can be scanned at most 10 times per hour across all users combined. Surface scans may consume at most 6 of those slots, reserving capacity for a verified owner. Quotas are reserved atomically.
- Outbound connections bind the validated public IP to the socket while preserving hostname and TLS verification, closing the application-level DNS-rebinding gap. This still does not replace an egress-restricted worker.
- Anonymous rate-limit identifiers use a keyed HMAC rather than a stored IP address.

## Coverage and grades

A blocked probe marks its own check inconclusive with a stated reason. The report still renders, and the grade is withheld only when a check that carries deductions could not run. A scan fails outright in two cases: the main page is unreachable, or the scan budget expires.

A clean surface scan is never presented as "secure". It reports only what the bounded Surface checks observed and shows which additional checks require domain verification.

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

Deep scans are durable jobs. The web app creates and displays them; a separate
fixed-egress worker performs target requests:

```bash
npm run scan-worker
```

In production build `Dockerfile.worker`, attach fixed outbound IP addresses,
set `IRONCLAD_SCANNER_EGRESS_IPS` to those exact addresses, and run at least one
worker replica. Do not enable deep scans until the additive `deep_scan_jobs`
and `deep_scan_events` schema in `supabase/schema.sql` has been applied. The
worker refuses to run a production scan when no fixed scanner IP is published.
After the schema, worker, and public scanner-information page are live, set
`IRONCLAD_DURABLE_SCANNER_ENABLED=true` in both the web and worker deployments.
While that flag is false, a bounded four-minute Vercel `after()` task executes
each newly created job. It retains sequential requests, durable events,
checkpoints, retries, credit restoration, and honest coverage, but it has a
changing source address and therefore cannot offer a safe WAF allowlist rule.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Yes in deployment | Canonical application origin used for links and redirects |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only database credential; never expose it to browser code |
| `JWT_SECRET` | Yes | Signs authentication cookies; use at least 32 random bytes |
| `RATE_LIMIT_SECRET` | Recommended | HMAC key for anonymous rate-limit identifiers; keep distinct from the JWT key |
| `TRUST_PROXY_HEADERS` | Self-hosted only | Set `true` only when a trusted proxy overwrites forwarding headers; Vercel is detected automatically |
| `IRONCLAD_DURABLE_SCANNER_ENABLED` | Optional | `false` uses temporary bounded Vercel execution; `true` hands jobs to the fixed-egress worker |
| `IRONCLAD_SCANNER_EGRESS_IPS` | Dedicated worker | Comma-separated fixed outbound IPs published to verified owners for narrow WAF exceptions |
| `IRONCLAD_WORKER_ID` | Dedicated worker | Stable, non-secret worker name used for leases and operations logs |
| `OAUTH_STATE_SECRET` | Hosting OAuth | Signs ten-minute provider verification state |
| `OAUTH_TOKEN_ENCRYPTION_KEY` | Hosting OAuth | Encrypts provider access tokens before database storage |
| `VERCEL_INTEGRATION_SLUG` | Vercel verification | Public integration slug used to begin installation |
| `VERCEL_INTEGRATION_CLIENT_ID` | Vercel verification | Vercel OAuth client identifier |
| `VERCEL_INTEGRATION_CLIENT_SECRET` | Vercel verification | Server-only Vercel OAuth secret |
| `NETLIFY_OAUTH_CLIENT_ID` | Netlify verification | Netlify OAuth client identifier |
| `STRIPE_SECRET_KEY` | For billing | Server-only Stripe API key |
| `STRIPE_PRO_PRICE_ID` | For billing | Allowed Pro subscription price |
| `STRIPE_WEBHOOK_SECRET` | For billing | Verifies Stripe webhook payloads |
| `RESEND_API_KEY` | Optional | Enables notification email delivery |
| `EMAIL_FROM` | Optional | Verified sender used for notification email |

Generate secrets with `openssl rand -hex 32`. Do not commit `.env.local`.

For hosting verification, configure these production callbacks in the provider consoles:

- Vercel: `https://bhopstudio.com/ironclad/api/verify/oauth/vercel/callback`
- Netlify: `https://bhopstudio.com/ironclad/verify/netlify/callback`

Grant only the project and domain visibility required by verification. Ironclad encrypts the returned access token and rechecks the provider attachment before every active scan.

## Verification

```bash
npm run check
```

That runs typecheck, tests, lint, and build in order.

The test suite compiles through `tsconfig.test.json` and runs under `node --test` with `tests/support/alias-hook.mjs`, which resolves the `@/` path alias. tsc type-checks that alias but does not rewrite it on emit, so without the hook any module with a runtime `@/` import fails to load and takes its whole test file with it.

Unit coverage: lane membership, coverage attribution, redaction, quota keys, rescan diff, provenance detection, evidence validation, scoring correlation, effective security-header values, Stripe entitlement selection, and outbound-address rejection. Database, access-control integration, and browser tests remain release-gate work.

## Important limitations

A scan looks from the outside at one moment in time. It cannot read private source, fully review role/ownership rules, or reason about business logic. It is a bounded automated part of a penetration-testing workflow, not a substitute for an authenticated manual penetration test. A check that finds nothing means these named probes observed nothing, not that the condition is absent.

Deep scans run as durable, leased jobs. Target requests are globally serialised, normal request starts are paced by 750 ms, retries are bounded, confirmed challenges pause the job, and saved module checkpoints are reused after an executor lease expires. The temporary Vercel executor has a four-minute safety window and dynamic egress; the dedicated worker raises the active budget to ten minutes and adds a safely allowlistable identity. The interrupted module restarts from its beginning because detector conclusions depend on complete control/candidate pairs. See [the vector review](docs/DEEP_SCAN_VECTOR_REVIEW.md) for the evidence and remaining limitation of every module.

## Not yet built

The trust badge and shareable result cards are not implemented. They were tied to the retired passive scanner and its publish flag; rebuilding them on the current store needs a deliberate publish flow, and no plan advertises them in the meantime.

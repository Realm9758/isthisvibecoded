# VibeCheck

VibeCheck inspects a public web page for explicit generative-builder provenance and runs a separate, bounded review of public response headers, client-visible keys, technology markers, and selected public paths.

It does **not** determine whether a developer understood or reviewed generated code. The provenance number is a versioned heuristic evidence index, not a probability or an authorship percentage. See [the full audit and reliability roadmap](docs/AUDIT_AND_ROADMAP.md) before changing the model or making product claims about it.

## Local setup

Requirements: Node.js 20.9 or newer, npm, and a Supabase PostgreSQL project.

```bash
npm ci
cp .env.local.example .env.local
```

Fill in the required environment variables, then run `supabase/schema.sql` in the Supabase SQL editor. The schema is designed to support a fresh install and an in-place upgrade. Before applying it to an existing database, back up the database and inspect case-insensitive email/name duplicates and duplicate Stripe IDs; new uniqueness indexes will intentionally reject ambiguous legacy data.

Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Yes in deployment | Canonical application origin used for links and redirects |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only database credential; never expose it to browser code |
| `JWT_SECRET` | Yes | Signs authentication cookies; use at least 32 random bytes |
| `RATE_LIMIT_SECRET` | Recommended | HMAC key for anonymous daily-rate identifiers; keep distinct from the JWT key |
| `STRIPE_SECRET_KEY` | For billing | Server-only Stripe API key |
| `STRIPE_PRO_PRICE_ID` | For billing | Allowed Pro subscription price |
| `STRIPE_WEBHOOK_SECRET` | For billing | Verifies Stripe webhook payloads |
| `RESEND_API_KEY` | Optional | Enables notification email delivery |
| `EMAIL_FROM` | Optional | Verified sender used for notification email |

Generate secrets with `openssl rand -hex 32`. Do not commit `.env.local`.

## Verification

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

`npm run check` runs those four gates in order. The focused unit suite covers negative and negated provenance controls, direct/strong provenance fixtures, builder-family correlation, determinism, malformed-input handling, effective security-header values, and client-visible key severity. Database migration, access-control integration, and browser tests remain release-gate work documented in the roadmap.

## Model rules

The current `2.0.0-heuristic` model scores only allowlisted public provenance markers:

- explicit generator metadata naming a generative builder;
- a builder-specific project hostname;
- an explicit “built with” attribution to an allowlisted builder;
- a builder-specific deployed asset; or
- a structured Replit Agent marker, not Replit hosting alone.

Common frameworks, Vercel/Netlify/Replit/StackBlitz hosting, Supabase/Firebase, UI libraries, generic copy, placeholder content, and starter titles contribute zero points. An index of zero means **inconclusive**, never “human-coded.”

## Privacy and scanner boundaries

- Query strings and fragments are removed before a public scan.
- Anonymous scan results are returned but not persisted.
- Signed-in scan results are private until their owner explicitly publishes them.
- Private result pages, metadata, badges, share cards, and comments are owner-gated.
- Public scans use read-only page and bounded public-path requests. Active deep scans require a signed-in account, explicit acceptance of the current active-scan terms for each run, and domain-control evidence renewed at least every 30 days.
- Public write endpoints have bounded account/IP abuse controls. Anonymous rate-limit identifiers use a keyed HMAC rather than persisting a raw IP address.
- Application-level DNS/IP validation narrows SSRF risk but does not replace an egress-restricted worker with IP-pinned connections. Do not treat the active scanner as production-ready until the P0 roadmap is complete.

## Important limitations

The passive hardening index covers selected headers and public observations; it is not an overall security grade. The active scanner is still experimental: failures withhold the overall score through request-level coverage, but coverage is not yet attributed to every individual check; sensitive-path handling needs a larger false-positive corpus; and the request-bound job should move to a durable, egress-restricted worker.

Historic results from different model versions must not be compared. Public rankings and feeds use only current vibe and security model versions, and ranking tables keep the latest qualifying scan per domain rather than its historical maximum. Deployed legacy rows still need an explicit visibility/version migration.

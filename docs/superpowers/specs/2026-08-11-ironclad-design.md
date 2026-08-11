# Ironclad: repositioning VibeCheck as a security scanner

Date: 2026-08-11
Status: approved, ready for implementation planning

## 1. Summary

VibeCheck currently leads with a novelty question ("is this site vibe-coded?") and hides
its real asset, a 1,946-line active security scanner with 28 check families, behind an
account, a domain-verification wall, and a dashboard tab.

This spec inverts that. The security scan becomes the product and the landing page. AI
builder provenance survives as one section of the security report rather than the reason
the product exists. The product is renamed Ironclad.

The commercial model is three free scans, then a subscription.

## 2. Naming and identity

| Field | Value |
| --- | --- |
| Product name | Ironclad |
| Tagline | Is your site ironclad? |
| Verdict copy | "Not ironclad. 4 critical findings." |
| Badge copy | "Ironclad certified" |
| Surface scanner UA | `Ironclad-Surface/2.0 (+https://ironclad.dev/scanner)` |
| Deep scanner UA | `Ironclad-Deep/2.0 (authorized domain-control scan; +https://ironclad.dev/scanner)` |
| Verifier UA | `Ironclad-Verifier/2.0 (+https://ironclad.dev/scanner)` |

The rename covers `package.json`, page metadata and titles, all user-facing copy, the
README, the scanner user-agent strings, and email templates. The git remote and repository
name stay as they are; renaming the GitHub repository is a separate manual action.

`https://ironclad.dev` is used as the canonical host throughout this document. If that
domain is unavailable, the chosen host is substituted everywhere at implementation time,
including in the user-agent strings, and `NEXT_PUBLIC_APP_URL` remains the runtime source
of truth for links and redirects.

## 3. The two-axis model

The existing design conflates permission with payment. Ironclad separates them, and the
separation is what allows "scan any URL" and "do not attack strangers" to both hold.

**Permission decides which checks run.** Sending an SQL injection string to a server you
do not control is unauthorised access in several jurisdictions, and no amount of money
paid to Ironclad changes that. Payment must never unlock aggression.

**Payment decides how many scans and how much history.** Volume, retention, comparison
over time, and the trust badge are the things a subscription buys.

## 4. Two lanes

### 4.1 Surface lane

Fifteen checks. Runs against any URL. No account, no verification, no payment.

Every surface probe is a read-only request of the same class a browser, a search crawler,
or a public asset scanner already makes against the site. It sends no attack payload, and
it never tries to make the server do something it was not designed to do.

| Phase id | Check | Requests made |
| --- | --- | --- |
| `vibe` | Client-visible secrets in HTML | reads the already-fetched page |
| `files` | Sensitive files (25 paths: `.env`, `.git/HEAD`, `wp-config.php`, `backup.sql`, `.npmrc`, `docker-compose.yml`) | GET of well-known static paths |
| `cors` | CORS policy and `crossdomain.xml` | GET with an `Origin` header |
| `headers` | Security headers | reads the already-fetched response |
| `cookies` | Cookie flags | reads the already-fetched response |
| `methods` | Allowed HTTP methods | one OPTIONS request |
| `ssl` | HTTPS redirect, HSTS, preload | GET over HTTP and HTTPS |
| `dirlist` | Directory listing on common asset directories | GET of `/uploads/`, `/static/`, `/assets/` |
| `robots` | `robots.txt` disallow entries | GET |
| `sri` | Subresource integrity | reads the already-fetched page |
| `info` | Server and framework version disclosure, `/server-status` | reads response headers, one GET |
| `components` | JavaScript libraries with known CVEs | reads the already-fetched page |
| `sourcemaps` | Exposed `.js.map` source maps | GET of referenced map files |
| `graphql` | GraphQL introspection | POST of a read-only introspection query |
| `apidocs` | Public API schema (`/swagger`, `/openapi.json`) | GET |

### 4.2 Deep lane

Thirteen further checks. Requires current domain-control evidence, as today.

| Phase id | Check |
| --- | --- |
| `xss` | Reflected cross-site scripting |
| `sqli` | SQL injection |
| `nosql` | NoSQL injection |
| `traversal` | Path traversal |
| `ssrf` | Server-side request forgery |
| `crlf` | CRLF injection |
| `hostheader` | Host header injection |
| `redirect` | Open redirect |
| `errors` | Error verbosity and debug parameters |
| `admin` | Admin panel discovery (18 paths) |
| `forced` | Forced browsing of internal API paths (15 paths) |
| `idor` | Insecure direct object reference |
| `ratelimit` | Authentication rate limiting (6 rapid POSTs) |

`init` and `done` are framing phases present in both lanes.

### 4.3 Where the line sits, and why

Three surface checks probe paths the site never advertised, so the boundary needs an
explicit rule rather than intuition:

> The surface lane may request **static artifacts that were published by accident**:
> configuration files, backups, build output, and documentation. It may not request
> **application entry points**: admin panels, internal APIs, and object endpoints.

Requesting `/.env` retrieves a file the web server is already serving to anyone who asks.
Requesting `/admin` and `/api/users/1` looks like an intrusion attempt, can lock out
accounts, and will page somebody's on-call. That is the difference, and it is the line.

`graphql` is the one surface POST. An introspection query mutates nothing and returns only
schema the endpoint chose to expose publicly, so it stays in the surface lane. Any future
GraphQL check that issues a non-introspection operation belongs in the deep lane.

### 4.4 Marketing consequence

"Fifteen checks on any site. Twenty-eight when you prove it is yours."

The upsell is honest, which makes it durable: the deep lane is withheld because of
permission, not because of a paywall, and the copy says so.

## 5. Entitlements

| | Anonymous | Free account | Pro |
| --- | --- | --- | --- |
| Surface scan, any URL | 1 per day, redacted report | 3 lifetime, full report | unlimited, subject to burst limits |
| Deep scan, verified domain | not available | included, consumes one of the 3 | unlimited, subject to burst limits |
| Evidence and remediation | locked | shown | shown |
| Scan history | none | latest scan per domain | full history |
| Rescan and diff | not available | not available | included |
| Trust badge | not available | not available | included |

The three free scans deliberately include the deep lane. Nobody subscribes to a product
they have not seen work, and the deep lane is the product. A free user who verifies a
domain gets the complete twenty-eight-check report three times.

Price stays at GBP 4.99 per month against the existing `STRIPE_PRO_PRICE_ID`. Changing the
price is a Stripe dashboard action and is out of scope for this implementation.

### 5.1 Quota mechanics

All quota reservations continue to use the existing atomic `consume_usage` and
`refund_usage` RPCs, so a scan that fails restores its allowance.

| Key | Limit | Applies to |
| --- | --- | --- |
| `surface:{ipHmac}:{YYYY-MM-DD}` | 1 | anonymous surface scans |
| `deep:{userId}:lifetime` | 3 | all scans by a free account, either lane |
| `scan-burst:{userId}:{YYYY-MM-DDTHH:mm}` | 1 | signed-in scans, either lane, all plans |
| `scan-target:{domain}:{YYYY-MM-DDTHH}` | 10 | every scan of that domain, all lanes, all plans, including anonymous |

The lifetime key keeps its current name so the existing seeded counters stay valid. Its
limit rises from 2 to 3, which grants existing free accounts one additional scan. That is
intended.

The per-target hourly cap applying to anonymous scans is the control that stops Ironclad
being used as an attack amplifier against a third party. It is not a billing limit and
must not be relaxed for paying accounts.

## 6. Redaction

An anonymous scan returns a real report with the persuasive parts withheld. The reader can
see they have three critical findings. They cannot see what those findings are.

Redaction happens **server-side, before serialisation**. The full result object must never
be sent to an unauthenticated client and hidden with CSS or a client-side flag.

Withheld for anonymous readers:

- `findings[].description`, `findings[].evidence`, `findings[].remediation`, `findings[].url`
- `checked[].detail`, which can contain site-specific observations

Returned for anonymous readers:

- `domain`, `scannedAt`, `duration`, `versions`, `lane`, `coverage`
- `summary`, meaning every severity count and the grade
- `findings[].id`, `findings[].category`, `findings[].severity`, `findings[].title`
- `checked[].label`, `checked[].description`, `checked[].status`

## 7. Coverage attribution

This is the change without which the launch fails.

`deepScanDomain` currently throws away the entire scan if any single probe fails or is
blocked, and the route saves nothing. That is right for a verified domain where clean
access is expected. Pointed at an arbitrary Cloudflare-fronted site from a public landing
page, it means most scans return an error and no report.

New behaviour:

1. Coverage is tracked **per check**, not only per scan. `RequestCoverage` gains the
   originating phase id, and each check records its own attempted, completed, failed, and
   blocked counts.
2. A check whose probes failed or were blocked is reported as `status: 'skip'` in `checked`
   with a stated reason, for example "blocked by the site's firewall" or "the request timed
   out". It contributes no findings and no deductions.
3. The report always renders. A blocked check is a gap in coverage, not a scan failure.
4. The numeric grade is withheld, `summary.score` is `null` and the UI shows "Incomplete",
   only when a check that can carry deductions did not run. The existing rule that a null
   score is never presented as a grade is unchanged.
5. A scan still fails outright, with the allowance refunded, in exactly two cases: the main
   page could not be fetched at all, or the scan budget expired before the lane completed.

The deep lane keeps its stricter posture in one respect: because the user has verified
control and expects a complete result, a deep scan with any skipped check surfaces a
prominent coverage banner rather than a quiet footnote.

## 8. Anonymous scan persistence and the claim flow

An anonymous scan persists so a visitor can sign up and see the full report without
spending one of their three scans on a site they just scanned.

1. The anonymous scan writes a `deep_scans` row with `user_id = null`, `lane = 'surface'`,
   a 32-byte hex `claim_token`, and `claim_expires_at = now + 7 days`.
2. The response carries `scanId` and `claimToken`. The client holds them in
   `sessionStorage`.
3. After signup or login, if a claim token is present, the client calls
   `POST /api/scans/claim`. The route sets `user_id`, clears `claim_token` and
   `claim_expires_at`, and **does not** consume quota.
4. Claiming is rejected if the token has expired, the row is already owned, or the token
   does not match.
5. Expired unclaimed rows are deleted opportunistically on each scan insert. No scheduled
   job is introduced.

Anonymous rows are private for their whole life. They are never listed, never public, and
never surfaced anywhere except to the account that claims them.

## 9. Rescan and diff

The reason to keep paying past month one is watching findings close.

A Pro user rescanning a domain in the same lane gets a comparison against the previous
scan of that domain and lane:

- **Resolved**: present before, absent now
- **New**: absent before, present now
- **Still open**: present in both

Findings match on `id` plus `url`. The comparison is computed on read from the two most
recent stored scans, so no new storage is required. It renders as a strip above the report:
"3 resolved, 2 new since 4 August."

## 10. Removals

### 10.1 Social surfaces, removed

A public feed ranking which sites have exposed `.env` files is a shopping list for
attackers and a standing legal exposure for the operator. It is incompatible with the
repositioning and is removed.

Deleted routes: `app/feed/`, `app/u/[name]/`, `app/api/users/[name]/`,
`app/api/comments/` and its children, `app/api/comments/like/`,
`app/api/scans/[id]/like/`, `app/api/scans/activity/`, `app/api/user/activity/`.

The `comments` and `likes` tables are **not** dropped. No destructive migration is written.
They are documented as unused in `supabase/schema.sql`.

### 10.2 Retained

- **Trust badge** and **share card**, owner-gated as today, rendering the grade only. They
  must never render finding titles, because a badge is a public object.
- **Roast Mode**, as a toggle on the report. It costs nothing, it already exists, and a
  blunt read of a bad result is good marketing to this audience.
- **Provenance detection**, as a section of the security report: "Built with Lovable,
  detected via generator metadata."

### 10.3 Scanner consolidation

Two parallel scanning stacks currently exist. The passive stack under `lib/analyzer.ts`
serves `POST /api/analyze` and nothing else. The active stack under `lib/deep-scanner.ts`
serves the deep scan. Keeping both would mean two sources of truth for the same findings.

The passive stack is retired into the lane model:

| Module | Disposition |
| --- | --- |
| `lib/analyzer.ts` | deleted |
| `app/api/analyze/route.ts` | deleted |
| `types/analysis.ts` | deleted |
| `components/ResultsDashboard.tsx` | replaced by `components/ScanReport.tsx` |
| `components/LoadingAnimation.tsx` | replaced by the SSE phase progress view |
| `lib/vibe-detector.ts` | kept, called by the scan pipeline on the fetched HTML |
| `lib/tech-detector.ts`, `lib/hosting-detector.ts` | kept, feeding the report's context section |
| `lib/roast.ts` | kept |
| `lib/security-headers.ts`, `lib/url-safety.ts`, `lib/pinned-fetch.ts`, `lib/store.ts`, `lib/scan-access.ts` | kept, unchanged in purpose |
| `lib/key-scanner.ts` | see below |
| `lib/public-files.ts` | see below |

`lib/key-scanner.ts` overlaps `checkVibeCodePatterns`, and `lib/public-files.ts` overlaps
`checkSensitiveFiles`. For each pair: compare detections. If the retiring module's
detections are a strict subset, delete it and its test. If it detects anything the scanner
misses, merge those patterns or paths into `lib/deep-evidence.ts` or the scanner's path
list and move the corresponding test cases across. Coverage must not decrease.

### 10.4 The legacy `scans` table

Retiring `POST /api/analyze` leaves the `scans` table holding passive results in a format
nothing produces any more. Those rows use retired model versions, and the README already
forbids comparing results across model versions, so migrating them into `deep_scans` would
manufacture a false history.

`deep_scans` becomes the single store for every scan at both lanes. The `scans` table is
left in place, not dropped, and documented as legacy alongside `comments` and `likes`.

Consequently:

- `GET /api/scans`, `GET /api/user/scans`, and `GET /api/user/deep-scans` collapse into one
  route, `GET /api/user/scans`, reading `deep_scans` for the calling account.
- `/result/[id]` renders a `DeepScanResult` through `components/ScanReport.tsx`, the same
  component the landing page uses, and keeps its existing owner gating through
  `lib/scan-access.ts`. Legacy `scans` rows are no longer reachable through it.
- Badge and share card read `deep_scans`.

## 11. Scanner ethics and abuse controls

These are requirements, not recommendations.

- **Honest identification.** The surface user-agent must not claim authorisation it does
  not have. The current string, `VibeScan-DeepScan/1.0 (Authorized domain-control scan)`,
  would be a false statement on an unverified target. Each lane gets its own string with a
  URL a site owner can follow to identify and block the scanner.
- **A public scanner page** at `/scanner`, reachable without an account, stating what the
  surface lane requests, how to block it, and an abuse contact address.
- **The per-target hourly cap covers anonymous scans.** Non-negotiable.
- **Existing safety controls are preserved unchanged**: `assertPublicTarget` outbound
  address validation, `pinnedFetch` socket pinning against DNS rebinding, the redirect
  host-lock, the scan budget deadline, query-string and fragment stripping, and bounded
  response reads.
- **Authorised-use notice** on the scan form, stating plainly that surface checks are
  read-only public requests and that deep checks require proof of control.
- **No result of an unverified third-party site is ever published**, by any mechanism,
  at any tier.

## 12. Data model

`supabase/schema.sql` changes, all additive and idempotent, consistent with the file's
existing upgrade-in-place design:

```sql
alter table public.deep_scans
  add column if not exists lane text not null default 'deep',
  add column if not exists claim_token text,
  add column if not exists claim_expires_at bigint;

alter table public.deep_scans
  alter column user_id drop not null;
```

- `lane` is constrained to `'surface'` or `'deep'`. Existing rows default to `'deep'`,
  which is what they are.
- `user_id` becomes nullable to hold anonymous scans. The existing cascade on user deletion
  is unaffected.
- A unique index on `claim_token` where it is not null.
- An index on `(claim_expires_at)` where `user_id is null`, supporting the purge.
- A check constraint requiring `lane = 'surface'` whenever `user_id is null`, so an
  anonymous deep scan cannot exist even by accident.

`DeepScanResult` gains `lane: 'surface' | 'deep'`, an optional `provenance` section, and a
`lane` entry inside `versions`.

## 13. Scoring

`calculateDeepScore` is unchanged in mechanism. Two presentation rules are added:

1. **Grades from different lanes are never compared.** A surface grade and a deep grade
   are different measurements. `versions.lane` records which produced the number, and any
   diff or history view refuses to compare across lanes.
2. **A clean surface scan is never presented as "secure".** The copy is: "No issues found
   in 15 surface checks. 13 deeper checks require domain verification." Saying anything
   stronger would be false, and it also happens to be the strongest upsell on the page.

## 14. API surface

| Route | Change |
| --- | --- |
| `POST /api/scan` | new. Surface lane, SSE, no auth required. Redacts for unauthenticated callers. Enforces the anonymous daily key, the signed-in lifetime key, and the per-target cap. |
| `POST /api/deep-scan` | kept. Auth, current verification, and terms acceptance still required. Records `lane: 'deep'`. |
| `POST /api/scans/claim` | new. Attaches an anonymous scan to the calling account. |
| `GET /api/scans/[id]` | kept, owner-gated. Returns the redacted shape to non-owners. |
| `POST /api/analyze` | deleted. |
| comments, likes, activity, public user routes | deleted per section 10.1. |

## 15. UI surface

**`/`** is the scanner:

- Hero: name, tagline, URL input, one Scan button, authorised-use notice.
- Live progress driven by the existing SSE phase stream, one row per phase with status and
  a running finding count. That stream consumer currently lives inline inside
  `app/dashboard/page.tsx`, which is 1,286 lines. It is extracted into
  `components/ScanRunner.tsx` and consumed by both the landing page and the dashboard, so
  the two surfaces cannot drift apart. `components/VulnScanSection.tsx` is the domain
  verification funnel, not a stream consumer, and it moves to the deep-lane upsell.
- The report renders inline below: grade, severity counts, coverage banner when checks were
  skipped, findings grouped by severity, the checked list, the provenance section, the deep
  lane upsell, and the Roast Mode toggle.
- Idle state below the fold: what the fifteen checks are, what the thirteen further checks
  are, pricing, and the ethics statement.

**`/pricing`** is rewritten around the three tiers in section 5.

**`/dashboard`** keeps domain verification, scan history, and rescan. It loses its role as
the only route to a deep scan.

**`/result/[id]`** renders a stored scan through the same `ScanReport` component, owner-gated.

**`/scanner`** is new, public, and states what the surface lane requests, how to block it,
and where to report abuse.

**`/security` and `/vulnerability`** are merged into one "What we check" page listing the
fifteen surface checks and the thirteen deep checks, with the permission rule from section
4.3 stated plainly. `/privacy` is updated for anonymous scan retention and the claim flow.

**Navigation** becomes Scan, Dashboard, Pricing, and the account control. Feed is removed.

## 16. Testing

New unit tests, following the existing `node --test` suite:

- **Lane membership**: the surface lane contains exactly the fifteen listed phase ids and
  the deep lane exactly the thirteen listed. This test is the guard that stops an active
  payload check drifting into the open lane during future work.
- **Redaction**: the anonymous serialiser emits no `evidence`, `remediation`,
  `description`, `url`, or `checked[].detail` field, asserted over a fixture containing all
  of them.
- **Coverage attribution**: a blocked probe marks its own check `skip` and leaves other
  checks intact; a blocked scored check yields `score: null`; a blocked unscored check
  leaves the score intact.
- **Quota**: anonymous daily, free lifetime of 3 across both lanes, per-target cap applying
  to anonymous callers, and refund on failure.
- **Claim flow**: happy path, expired token, already-owned row, token mismatch, and the
  assertion that claiming consumes no quota.
- **Diff**: resolved, new, and still-open classification, and refusal to compare across
  lanes.

Existing tests for evidence validation, scoring correlation, URL safety, security headers,
and Stripe entitlements are preserved. Any test moved during the section 10.3
consolidation keeps its assertions.

`npm run check` (typecheck, test, lint, build) must pass.

## 17. Implementation staging

Sequenced so the tree is releasable at each step:

1. Lane split in the scanner, plus lane membership tests. No behaviour change yet.
2. Coverage attribution rework, plus its tests.
3. Schema migration and `DeepScanResult` type changes.
4. `POST /api/scan` with redaction, plus redaction and quota tests.
5. Claim flow, route and tests.
6. Landing page rewrite and `components/ScanReport.tsx`.
7. Rescan and diff.
8. Scanner consolidation and removal of the passive stack.
9. Social surface removal.
10. Rename, pricing page, README, `/scanner` page.

## 18. Out of scope

- Scheduled rescans and email alerting on newly appearing findings. The Resend integration
  and notification tables exist, but scheduling needs infrastructure this pass does not
  introduce. It is the natural next subscription feature.
- Moving the scan off the request path onto a durable, egress-restricted worker. Still the
  correct end state, still tracked in `docs/AUDIT_AND_ROADMAP.md`, still not this pass.
- Any price change.
- Renaming the GitHub repository.

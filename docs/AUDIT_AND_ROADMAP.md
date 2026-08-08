# VibeCheck audit and reliability roadmap

Status: 2026-08-08

Current public-evidence model: `2.0.0-heuristic`

## Executive decision

The original product question, “Was this app vibe coded?”, cannot be answered reliably from a deployed web page. Vibe coding describes a development process: how much implementation was delegated to generative tools, how well the developer understood the result, and what review and testing happened before release. Public HTML, headers, copy, and hosting do not expose those facts.

The defensible product is therefore narrower:

> VibeCheck reports public evidence of generative-builder provenance, plus a separate, bounded review of observable web hardening. It abstains when the evidence is insufficient.

This distinction is not cosmetic. A Next.js app hosted on Vercel, a Supabase client, shadcn-style markup, generic marketing copy, a default title, and placeholder images can all occur in human-written, AI-assisted, or prompt-led projects. Those observations must not be treated as proof. Likewise, the absence of a marker must never be presented as proof of human authorship.

The branch substantially improves the passive scanner and removes several fail-open behaviours, but it is not ready to advertise authorship detection, a penetration test, full OWASP coverage, or a calibrated probability. The release blockers and follow-up work are listed below.

## What “vibe coded” should mean

For owner-supplied research labels, use this process-level definition:

> A project is vibe coded when natural-language interaction with generative systems was the primary implementation method and material generated code was accepted or deployed with limited code-level understanding, review, or validation by the people responsible for it.

This deliberately excludes ordinary AI assistance. Autocomplete, a generated helper that was reviewed, or an AI-authored draft backed by normal testing and code review does not by itself make an application vibe coded.

A credible ground-truth submission should record separate axes instead of forcing one ambiguous yes/no answer:

1. **Generation reliance:** none, assistive, substantial, or primary; ideally corroborated by repository history or consenting tool logs.
2. **Developer understanding:** whether a responsible developer can explain the shipped architecture and material changes.
3. **Review depth:** line-level review, peer review, security review, and whether generated changes were accepted substantially as produced.
4. **Validation depth:** automated tests, manual acceptance tests, dependency review, and production monitoring performed before release.
5. **Builder provenance:** which tools generated or transformed the project and whether the deployed artifact still carries their markers.

The first four axes are not observable from a public URL. They may support a separate, opt-in owner assessment later. The URL scanner should target only the fifth axis.

## Public scanner outcome contract

The scanner should return one of four outcomes and display the supporting observation beside it:

| Outcome | Meaning | Permitted basis |
| --- | --- | --- |
| Direct AI-builder provenance | The page itself contains an exact allowlisted generator declaration | Exact `meta[name="generator"]` value or another equally explicit declaration; this is a direct marker, not verified development history |
| Strong supporting evidence | A builder origin is strongly supported but not explicitly declared | An AI-only project hostname, validated builder attribution, or builder-specific deployed asset |
| Limited supporting evidence | A specific public provenance observation supports a builder origin but does not meet the strong threshold | Only allowlisted builder-specific signals; no commodity-stack or generic-copy shortcuts |
| Inconclusive | The public evidence is absent, conflicting, unavailable, or too weak | This is an abstention, not a claim that a human wrote the site |

Current policy for individual observations:

| Observation | Score today? | Reason |
| --- | --- | --- |
| Exact allowlisted AI-builder generator metadata | Yes | Explicit public provenance marker |
| AI-builder-specific project hostname | Yes | Strong origin evidence, but custom domains can hide it |
| “Built with” attribution linking to an allowlisted builder | Yes | The wording and destination jointly identify provenance |
| Builder-specific asset path | Yes | Useful when it is specific and continuously regression-tested |
| Replit Agent marker | Yes | Names the generative agent rather than the general host |
| Replit, Vercel, Netlify, or another general-purpose host alone | No | Hosting does not reveal implementation process |
| Next.js, Vite, Supabase, Firebase, shadcn/Radix, Tailwind, or another common stack | No | Common to human and AI-assisted projects |
| Generic marketing copy, lorem ipsum, placeholders, or starter text | No | Indicates generic or unfinished content, not authorship |
| WordPress, Drupal, Webflow, Squarespace, Bootstrap, or jQuery | No positive score | Alternative tooling is contextual and is not proof of human authorship |
| A page that merely discusses or links to an AI builder | No | Mentions are not provenance |
| No matching public marker | No | The correct result is inconclusive |

Any new positive detector must enter through the benchmark process below. It must not be added because it “feels AI-ish.”

## Audit findings

### Provenance detector and score

The previous detector was both broken at integration time and conceptually unreliable. Its implementation had been deleted while callers still imported it. Its hand-selected weights could classify a normal modern stack as strong evidence, generic copy and styling were counted as authorship evidence, common older tools reduced the score as if they proved human work, correlated observations were added repeatedly, confidence was derived from the same arbitrary score, and result copy made claims stronger than the observations supported.

There was no labelled benchmark, model version, calibration report, false-positive budget, or meaningful regression suite. A percentage-like `0–100` display therefore looked probabilistic without having probabilistic semantics.

### Passive scan reliability

The original path could analyse error documents, catch-all pages, bot challenges, non-HTML responses, or incomplete fetches as if they were the requested site. Public-path probes treated status codes too optimistically. Query strings could be retained even though they may contain signed preview tokens or personal data. SSRF checks were inconsistent across fetch sites and redirects.

The audited baseline resolved and validated DNS separately from the network connection, leaving a DNS-rebinding/time-of-check-to-time-of-use gap. This branch replaces that transport with a connection whose lookup is pinned to the checked public IP while retaining hostname/TLS verification. Application controls still do not substitute for independent network egress enforcement.

### Security and deep scan

The passive `security.score` is principally a header-hardening checklist. It originally rewarded header presence regardless of whether the value was effective. This branch adds focused value checks and partial credit, but the index still does not establish that the application is secure. Public key matching and public-path checks are similarly bounded observations.

The deep scanner had more serious trust problems:

- fetch failures were converted to `null`, allowing unavailable checks to contribute no finding and potentially produce a perfect-looking score;
- any HTTP 200 for many “sensitive” filenames could become a finding, even when an SPA catch-all returned ordinary HTML;
- deductions intended to be category-deduplicated were in fact keyed by category and severity;
- numerous requests, sequential groups, and artificial per-phase delays made the route likely to exceed its execution budget;
- redirect and DNS checks were not consistently applied at every outbound request;
- the route could report success even when persistence failed; and
- marketing described full OWASP coverage and no false positives, neither of which was supported.

An active black-box scan is not a complete OWASP assessment. It cannot evaluate business logic, authorization design, source-code data flows, dependency reachability, infrastructure configuration, or authenticated workflows it was not given.

### Privacy, access control, and persistence

The previous user journey described scans as private until publication while passive scans were persisted publicly. Direct result, badge, share-card, and comment paths did not consistently enforce visibility. Anonymous input could be stored, including query data, and rate-limit identifiers could be derived from raw network identifiers. Some privacy and consent copy contradicted actual request behaviour.

The schema was incomplete and contained invalid SQL. Tables and columns used by the application were missing, foreign keys and constraints did not match route assumptions, and quota updates were vulnerable to read/write races. Several store calls still ignore returned Supabase errors, so “no thrown exception” does not always mean a write succeeded.

### Product and operational trust

The repository began without detector regression tests, end-to-end access-control tests, a production setup guide, a release migration strategy, or telemetry that distinguishes `pass`, `fail`, and `unknown`. Feedback writes were best-effort and could tell a user a report succeeded when the database rejected it. Rankings also allowed results produced by different scoring versions to be compared as if they were equivalent. This branch now surfaces feedback failures and limits public rankings to current-model results, but the broader release and observability gaps remain.

Signup and login now have bounded input checks and atomic abuse limits, but authentication and mutation endpoints still need consistent shared-schema validation, trusted-proxy verification, account recovery/session revocation, and a documented CSRF/origin policy. Payment handling verifies Stripe webhook signatures, but entitlement reconciliation, event replay tracking, and failed-payment states still need production hardening. The production CSP still relies on `unsafe-inline` rather than a complete nonce/hash design.

## What this branch fixes

### Evidence model

- Restores a working detector and replaces broad “AI-looking” cues with exact, allowlisted provenance rules.
- Makes commodity frameworks, hosting, BaaS products, UI systems, generic copy, placeholders, and starter content contextual only; they contribute zero points.
- Represents each observation with an ID, source, category, direction, strength, evidence text, and correlation key.
- Takes only the strongest observation in a correlation family so one builder is not counted repeatedly through its hostname, attribution, and assets.
- Caps category contributions, applies explicit conflict attenuation, bounds the result to `0–100`, and makes the result deterministic.
- Introduces the versioned `evidence-index` contract and honest labels: direct provenance, strong evidence, limited evidence, or inconclusive.
- Assigns high confidence only to an explicit declaration and never equates an inconclusive result with human authorship.
- Preserves the structured signal audit trail and limitations through the analyzer and stored result shape.
- Centralizes bands and colours so dashboards, feed cards, badges, and share cards do not silently use contradictory thresholds.
- Makes roast text deterministic and prevents it from asserting human or AI authorship that the scan did not establish.
- Excludes legacy or mixed-version results from feeds and rankings, compares only the latest current-model scan for each domain, and keys rank snapshots by the relevant scoring version.

The current heuristic calculation is:

```text
positive = capped(provenance) + capped(scaffold) + capped(stack) + capped(content)
score    = clamp(round(positive - round(conflicts × attenuation)), 0, 100)
```

The configured caps are provenance `80`, scaffold `22`, stack `14`, content `6`, and conflict `35`. Correlated signals contribute only their maximum value. Direct provenance reduces conflict attenuation to `0.20`; strong provenance uses `0.45`; otherwise it is `1.00`. The current label thresholds are `20` for limited and `50` for strong, with an explicit declaration overriding the label to direct provenance.

These values are intentionally conservative but are still expert-chosen. They are not empirical probabilities and must be replaced by the calibration plan below. In the present rules, scaffold, stack, and content observations are retained as explainable context and score zero.

### Fetching, safety, and coverage

- Canonicalizes public scan URLs and drops query strings and fragments before fetching or persistence.
- Rejects embedded credentials, non-HTTP protocols, non-standard ports, local names, private ranges, link-local ranges, multicast, and documentation-only IP ranges.
- Resolves and validates every passive target immediately before a request, then pins the socket lookup to that checked public IP while preserving the original hostname for HTTP Host, SNI, and TLS certificate verification. Redirect hops and public-path probes use the same transport.
- Caps the main response at 2 MB, rejects non-success responses, non-HTML bodies, undersized pages, and recognizable access-denied or bot-challenge pages.
- Records response status, content type, HTML size, redirect count, and public-path completion counts.
- Requires content evidence for passive `.env`, JSON configuration, WordPress-admin, and generic-admin findings instead of trusting a 200 status alone.
- Treats an AWS access-key ID without a secret as review context rather than claiming the identifier alone is an exposed credential.
- Returns meaningful `4xx` errors for unreachable or unsuitable pages and refunds a reserved free-tier scan when analysis fails.

### Privacy, visibility, and quotas

- Anonymous passive results are returned to the browser without being persisted.
- Signed-in passive scans are created private and must be explicitly published.
- Private result pages are owner-only; metadata, badges, and share cards require a public scan.
- Comment reads and writes honor scan visibility, and replies must reference a parent comment from the same scan.
- Requires a deliberate public display handle instead of deriving one from the email address, and tells the user that comments and replies expose that handle.
- Keeps the public profile endpoint undiscoverable until the account has explicitly published a current-model scan, and returns only the public handle, optional profile presentation fields, and public scan summaries.
- Fixes notification links to point at the real `/result/:id` route.
- Uses an HMAC-derived anonymous rate key in usage rows instead of a raw IP-derived identifier when a rate-limit secret is configured. This does not make a claim about infrastructure or proxy logs.
- Applies fail-closed, atomic limits to signup, login, anonymous passive scans, and feedback submission.
- Reserves free-tier quota atomically and refunds it after a failed scan.
- Replaces the partial schema with an idempotent migration containing the application tables, missing columns, constraints, indexes, row-level-security enablement, and atomic quota functions.
- Changes the database default for new scans to private as well as setting private explicitly in application code. Runtime access now treats legacy/mixed-version auto-public rows as private and refuses to republish them; their stored flags still require a consent review and backfill during deployment.
- Updates consent and product copy to describe bounded read-only requests, owner-controlled publication, and the difference between public provenance evidence and development process.

### Policy consent and domain-control authorization

- Requires an explicit, initially unchecked account-policy acceptance, links to the real privacy policy, rejects missing or stale policy versions server-side, and records the accepted version and server timestamp. Legacy accounts remain nullable rather than receiving fabricated consent history.
- Requires a separate explicit authorization for every active scan, enforces the exact current active-scan terms version, and stores that version with the server acceptance time on the deep-scan record.
- Accepts only exact DNS TXT, exact verification-meta, or exact non-HTML verification-file content. HTTP bodies are bounded, redirects are manual and limited, and web verification redirects must remain on the exact original HTTPS host.
- Treats domain verification as fresh for at most 30 days before another active scan, completes or transfers a verified claim atomically under a database lock, and lets the claimant revoke their own token and verified claim.

### Regression tests and application hardening

- Adds focused detector fixtures for ordinary HTML, a common modern stack, generic copy and placeholders, discussion pages, CMS context, explicit metadata, builder hostnames, attribution wording, correlated observations, Replit hosting, determinism, and score bounds.
- Adds header-value fixtures covering valid controls, ineffective values, partial credit, and CSP `frame-ancestors` equivalence.
- Adds `typecheck`, `test`, and combined `check` scripts.
- Removes an unused HTML-parser import that stalled the toolchain in the audited runtime.
- Upgrades Next.js to the patched `16.3.0` release, refreshes vulnerable transitive dependencies to advisory-free versions, and separates client-safe plan data from the server-only Stripe module.
- Adds server-only guards to secret-bearing Stripe and Supabase clients; removes production `unsafe-eval`; adds HSTS, stricter CSP directives, and disables the framework-identifying response header.
- Validates focused CSP, HSTS, clickjacking, MIME-sniffing, referrer, and Permissions-Policy semantics instead of granting full credit for arbitrary non-empty values. A nonce/hash must apply to the effective script directive before it mitigates script `unsafe-inline`, and an unrestricted Permissions-Policy receives no hardening credit.
- Makes feedback writes validate input, inspect returned database errors, and show failure to the reporter instead of always claiming success.

### Deep-scan damage containment

- Removes the artificial 900 ms delay that was added to every progress phase.
- Requires the initial target request to return a successful response; an unreachable or non-success target now aborts without producing a score.
- Deduplicates equivalent evidence by stable rule family rather than collapsing unrelated findings into broad categories; independent rules continue to accumulate, while repeated cookie instances cannot dominate the grade.
- Uses explicit policy deductions of `42/28/14/4/0` for critical/high/medium/low/info and grade-aligned ceilings of `24/49/74/89` (F/D/C/B). These are conservative heuristic guardrails, not probabilities or calibrated loss estimates.
- Stores separate deep scanner, scoring, and request-coverage contract versions and withholds legacy/unversioned grades in the UI.
- Applies one 42-second active-scan deadline and fails without persistence or a grade when a required request, redirect, body read, or execution budget is unavailable; `429`/`5xx` probe responses no longer become green coverage.
- Resolves, validates, and IP-pins every deep-scan request and redirect hop, follows at most five redirects manually, and rejects redirects away from the exact verified hostname. The target is also validated before quota and domain-control checks.
- Reserves the free deep-scan allowance atomically, seeds the lifetime counter from existing scans during migration, and refunds the reservation when the scan cannot complete.
- Requires bounded, type-specific content signatures before reporting a static sensitive-file exposure instead of treating a `200` catch-all response as proof.
- Tracks request-level attempted, completed, failed, and blocked coverage. Any failed or blocked deep-scan request withholds the score and grade rather than becoming a clean pass.
- No longer describes wildcard-origin plus credentials as authenticated cross-origin exposure, because browsers reject that combination, and requires actual admin-panel content without a login gate before reporting an exposed admin surface.
- Surfaces plan lookup, scan-count, domain-control lookup, persistence, and quota-refund errors instead of silently continuing, and applies per-account/per-target active-scan burst limits to every plan.

### Billing containment

- Reuses a stored Stripe customer and an existing open checkout session where possible, checks Stripe's current customer-wide subscription state before checkout, blocks active or recoverable duplicate subscriptions, and supplies idempotency keys for new customer, session, and subscription creation.
- Derives entitlement from the configured Stripe price and active/trialing subscription status rather than trusting mutable checkout metadata.
- Reconciles create, update, delete, pause, resume, and pending-update events against Stripe's current customer-wide state, so delayed/out-of-order events and multiple subscriptions converge on the newest qualifying entitlement.
- Propagates entitlement-write failures so Stripe retries instead of acknowledging a lost database update.

These changes make the passive result substantially more honest. They do not complete the production hardening below.

## Remaining roadmap

Priority means release risk, not implementation size.

### P0 — required before a trustworthy public launch

1. **Complete the privacy migration.** The repository now defaults new rows to private, but deployment must inventory and back up existing scans, treat previously auto-published rows as lacking informed publication consent, complete a reviewed visibility backfill, and test every result, metadata, badge, share-card, feed, comment, and like route as owner, other user, and anonymous user.
2. **Deploy and verify the database migration.** Run it first in a production-shaped staging database, inspect legacy duplicates before unique indexes are created, validate constraints after cleanup, verify no old permissive RLS policies survive, and prove the service-role key is server-only. A SQL file in the repository does not migrate a deployed database.
3. **Enforce outbound-request policy at the network boundary.** The application now binds each connection to the validated public IP and keeps active redirects on the exact verified hostname. Also run scanners in an isolated worker with egress allowlisting, block private/link-local/metadata destinations at the network layer, and log the connected address. Transport pinning closes the known application DNS-rebinding race; independent egress enforcement remains necessary defense in depth.
4. **Finish first-class scan coverage.** Request-level deep coverage now tracks failures and blocks and withholds the score when either occurs. Every individual probe, body read, parse, and semantic check must still return `pass`, `fail`, or `unknown` with a reason. A timeout, DNS error, blocked response, size limit, or parse error must reduce coverage and must never improve a score.
5. **Keep the deep scan experimental until it passes a fixture corpus and leaves the request path.** Static sensitive-file responses now require bounded content signatures, but some individual body-read, parse, and probe outcomes can still look like absence of a finding. The broader active-check set has not passed a catch-all/WAF/network fixture corpus. Add per-probe coverage, validate and bound every remaining response body, move the scan to a durable queue with cancellation and retry semantics, and keep “full OWASP,” “penetration test,” “no false positives,” and equivalent claims removed.
6. **Finish authorization regression coverage.** Generated SVG values are escaped and the currently identified result, share, comment, and like paths enforce visibility. Add a route-matrix integration suite covering owner, unrelated user, and anonymous access to every existing and future result, activity, notification, and export surface so later routes cannot regress.
7. **Add a production release gate.** A release must pass typecheck, unit tests, lint, production build, database migration tests, access-control integration tests, and representative browser journeys. It must fail on skipped or hung required jobs.

### P1 — accuracy and production hardening

1. **Build the labelled benchmark and replace hand-set weights.** Use the process described in the next section. Until it exists, keep `heuristic` in the model version and never label the number as a probability.
2. **Benchmark the header-hardening model.** Focused value validation, CSP `frame-ancestors` equivalence, partial credit, and honest naming now exist. Next, test the accepted policy grammar and hand-set deductions against a representative corpus; add explicit unknown/parse states; keep public exposure and key findings outside that number or define and validate a separate model.
3. **Finish deep-scan evidence validation.** Use content signatures for every sensitive path, bound all response bodies, deduplicate equivalent routes, include request/response evidence safely, and test redirect, catch-all, WAF, CDN, and intermittent-network cases. Validate the rule-family deductions and grade-aligned severity ceilings against the fixture corpus rather than treating them as calibrated risk math.
4. **Make database errors impossible to ignore.** Feedback, quota, scan visibility, and several critical writes now inspect errors. Wrap the remaining Supabase access behind helpers that always inspect `{ data, error }`; add transactions/RPCs where multiple writes form one action; and add request IDs without logging secrets.
5. **Harden authentication and mutations.** Signup/login validation and atomic rate limits now exist. Move email, handle, password, IDs, URLs, sizes, and content types to shared schemas; extend fail-closed abuse controls to the remaining sensitive endpoints; verify that only a trusted proxy can set the client-address headers; define Origin/CSRF protection for cookie-authenticated mutations; rotate sessions when account or plan state changes; and add account recovery and session revocation.
6. **Finish billing entitlement hardening.** Customer/session reuse, current-state preflight, active/recoverable-plan guards, idempotency keys, price/status-derived customer-wide reconciliation, and write-failure retries now exist. Add a processed-event ledger, reconcile against Stripe on a schedule, and add signed webhook, replay, DB-outage, and live Stripe fixture coverage.
7. **Finish application-header hardening.** Production `unsafe-eval` is removed, HSTS and restrictive CSP directives are configured, and the framework-identifying header is disabled. Replace remaining `unsafe-inline` allowances with a tested nonce/hash design where feasible and verify the actual deployed edge response rather than only configuration.
8. **Make feedback useful for calibration.** Record model version, signal IDs, result ID, reporter relationship to the site, claimed ground truth, evidence/consent status, and adjudication state. Separate “marker is wrong” from “site was AI-assisted but carefully engineered.”
9. **Add observability and budgets.** Measure fetch latency, bytes, redirects, per-check outcomes, unknown coverage, queue time, false-positive reports, publish rate, and model-version distribution. Alert on latency/unknown-rate regressions without retaining raw page bodies or sensitive URL parameters.

### P2 — product quality and maintainability

1. Move active scans to a durable, rate-limited worker with resumable status rather than a long-lived Route Handler stream.
2. Add scheduled drift checks for builder metadata, domains, and asset patterns; require fixtures and benchmark results for allowlist changes.
3. Show uncertainty and coverage prominently in rankings, preserve the latest-result/current-model-only rule, and avoid competitive language that treats the evidence index as an objective quality score.
4. Add scan deletion, data export, and publication history; document actual retention periods and enforce them with jobs. Domain-control claim revocation now exists, but its audit trail and retention behaviour still need documentation.
5. Add accessible status announcements, explicit URL input semantics, reduced-motion behaviour, keyboard/browser tests, and truthful indeterminate progress.
6. Replace hand-maintained detection parsing with a bounded parser only after its runtime compatibility and denial-of-service behaviour are tested; fuzz malformed markup either way.
7. Document local setup, environment variables, migration order, operating limits, incident response, and rollback procedures.

## Empirical evidence-index plan

### 1. Build trustworthy labels

Create an owner-consented evaluation set containing:

- operator-attested generative-builder projects, including exported and custom-domain deployments;
- operator-attested human-written and conventionally AI-assisted projects;
- matched controls with the same framework, host, component library, industry, language, launch period, and template family;
- hard negatives that discuss AI builders, intentionally copy marketing language, retain starter content, or run on a builder-adjacent host; and
- adversarial fixtures with forged, removed, duplicated, or conflicting provenance markers.

Store public-page snapshots and detector outputs, not secrets or private repository content unless the owner separately consents. Record label source and uncertainty. Have ambiguous submissions adjudicated independently or excluded from threshold setting.

Prevent leakage by splitting train/calibration/test sets by organization, template family, and project lineage—not random pages. Otherwise clones of one template can appear on both sides and make accuracy look unrealistically high. Keep a final time-based holdout for drift testing.

### 2. Estimate evidence strength

For each signal `i`, measure true positives (`TP`), false negatives (`FN`), false positives (`FP`), and true negatives (`TN`) on the training/calibration data. Use beta-binomial smoothing, for example Jeffreys priors:

```text
TPR_i ~ Beta(TP_i + 0.5, FN_i + 0.5)
FPR_i ~ Beta(FP_i + 0.5, TN_i + 0.5)
```

Use a conservative positive likelihood ratio rather than the point estimate:

```text
LR_i+ = max(1, lower95(TPR_i) / upper95(FPR_i))
w_i   = ln(LR_i+)
```

Treat a signal with too little support as context until its confidence interval is useful. Estimate negative/conflicting evidence separately; never assign “human” points merely because a legacy tool appears.

### 3. Control correlation

Place signals caused by the same underlying fact into a declared correlation family, such as one family for all Lovable deployment traces. Within a family, take the maximum validated log weight rather than summing observations:

```text
L_family = max(w_i for i in family)
L_total  = sum(L_family across independent families) - validated_conflict_weight
```

If data shows material dependencies between families, fit and validate a small regularized model at the family level. Do not assume independence because two strings are different.

### 4. Produce an index with honest semantics

A monotonic evidence index can map `1:1` evidence to zero and `100:1` evidence to 100:

```text
evidence_index = round(100 × clamp(L_total / ln(100), 0, 1))
```

This is a likelihood-evidence scale, not `P(vibe coded | page)`. It deliberately omits a population prevalence prior because the deployment population changes and is not known. If the product later displays a probability, calibrate a separate posterior for a stated population and report its sample period and base rate.

Set display thresholds on the untouched holdout set. The “strong” threshold must achieve at least 95% observed precision, with a predeclared one-sided confidence-bound requirement and minimum sample count. Optimize recall only subject to that precision constraint. A conservative scanner that often abstains is preferable to a broad detector that publicly mislabels sites.

### 5. Evaluate and monitor

Report, overall and per builder/stack/language:

- precision, recall, false-positive rate, and abstention/coverage rate;
- recall at 95% precision and the exact threshold chosen;
- PR-AUC as the primary ranking metric for an imbalanced dataset;
- ROC-AUC only as a secondary diagnostic;
- bootstrap or beta-binomial confidence intervals;
- Brier score and expected calibration error only for any separately displayed probability;
- performance on custom domains, exported projects, hard negatives, adversarial pages, and unavailable/blocked pages; and
- drift against the time-based holdout and the prior production version.

Publish a compact model card with dataset dates, inclusion rules, sample counts, subgroup results, known blind spots, thresholds, and change history.

## Acceptance criteria

### Passive provenance model

- Ordinary HTML and common modern-stack fixtures produce `Inconclusive` with zero scored evidence.
- A page mentioning or linking to a builder without attribution produces no provenance score.
- A general-purpose host alone produces no provenance score.
- Correlated traces from one builder never add together.
- Output is deterministic, bounded, versioned, and includes every scored observation.
- Strong evidence reaches at least 95% precision on the untouched, lineage-separated holdout; its confidence interval and sample size are published.
- The strong-band false-positive rate on matched human/assistive controls is at most 1% overall and is reported per major stack.
- Removing all public builder markers changes the outcome to inconclusive rather than “human-written.”
- Unsupported, blocked, challenged, oversized, or timed-out responses return unknown/error, never a clean verdict.

### Passive hardening scan

- A local fixture server covers valid HTML, redirects, redirect loops, private redirects, oversized bodies, non-HTML responses, HTTP errors, SPA catch-alls, bot challenges, timeouts, and partial public-path failures.
- Coverage counts exactly match attempted/completed/unknown checks.
- Sensitive-path findings require a matching content signature and bounded body read.
- Header findings validate values and do not describe the absence of one defence-in-depth header as proof of a vulnerability.
- A script nonce/hash in an unrelated CSP directive cannot excuse `script-src 'unsafe-inline'`, an unrestricted Permissions-Policy receives no hardening credit, and an AWS access-key identifier without a paired secret is not labelled a leaked credential.

### Deep scan

- Every phase reports pass/fail/unknown and a coverage denominator.
- Loss of DNS/network access cannot yield `100`, an A grade, or “no findings.”
- A critical finding enforces the predeclared F-grade ceiling; duplicate evidence in one rule family cannot overwhelm the score, while independent confirmed rules still accumulate.
- Redirects to a different or private target are blocked, including DNS-rebinding fixtures.
- Catch-all HTML never becomes an exposed `.env`, Git, SQL, Docker, or configuration-file finding.
- Wildcard-origin plus `Access-Control-Allow-Credentials: true` is at most an informational contradiction, while arbitrary credentialed origin reflection remains a finding. A login gate or a generic `200` page is not reported as an exposed admin panel.
- The full fixture corpus completes within the execution budget with margin, or the scan runs in a durable worker.
- Only an origin with fresh domain-control evidence and explicit scan authorization can be actively scanned, and both are rechecked when a queued job starts.
- Active scans reject missing or stale terms acceptance, record the exact accepted version and server time, and reject domain verifications older than 30 days.
- DNS, metadata, and file verification require exact token evidence; verification bodies are bounded; web redirects stay on the exact original HTTPS host; concurrent claim transfers are atomic; and revocation makes the claim unusable.

### Privacy and application integrity

- Anonymous scans create no scan row and persist no submitted query string.
- New account scans remain private until an authenticated owner publishes them.
- An unrelated user and an anonymous user receive indistinguishable 404 responses for every private-result surface.
- Account creation requires the exact current policy version and stores a server timestamp; the checkbox begins unchecked, and legacy accounts with no recorded acceptance remain distinguishable from accepted accounts.
- A public profile is unavailable until its owner publishes a current-model scan, exposes no account ID, email, plan, or join date, and clearly discloses that the chosen handle appears with comments and replies.
- Concurrent free-tier requests cannot exceed the allowance, and failed scans restore exactly one reservation.
- Signup, login, anonymous-scan, and feedback limits fail closed when their backing store or rate-key configuration is unavailable.
- Database failures surface as failures; no API confirms a write that was rejected.
- The schema migrates both a clean database and a representative legacy database twice without data loss or error.
- Stripe replay, out-of-order, cancellation, unpaid, and plan-change fixtures produce the correct entitlement exactly once.

### Engineering release gate

The required CI gate is:

```text
typecheck → unit/integration tests → lint → production build → browser smoke tests
         → schema fresh-install test → schema legacy-upgrade test → security/access tests
```

No required step may be best-effort. Add dependency and secret scanning, lockfile review, and a deployed-header smoke test before production promotion.

## Rollout, versioning, and migration

1. **Freeze the claim surface.** Ship the revised language first. Hide or label legacy percentage-style results and remove unsubstantiated security claims before promoting the scanner.
2. **Back up and migrate staging.** Apply the idempotent schema to a production-shaped copy. Resolve duplicate users, names, verification claims, and other rows before creating unique indexes or validating deferred constraints. Leave legacy policy version/time fields null unless there is real acceptance evidence; do not manufacture consent during migration.
3. **Migrate visibility deliberately.** Change the database default to private. Because older scans were auto-published, treat their consent as uncertain: back them up, remove them from public feeds/share artifacts by default, and require an owner to republish where practical.
4. **Deploy access controls and network isolation.** Verify every read/write matrix and outbound target class in staging before enabling public traffic.
5. **Complete result version metadata.** Vibe/header model versions, deep scanner/scoring/request-coverage versions, signal evidence, and scoring-version rank snapshots are now stored; public lists exclude model mismatches and deep legacy grades are withheld. Add per-probe semantic-contract versions when first-class check coverage lands. Legacy results may remain privately readable, but they must display `legacy/unversioned` and must never enter current-model feeds or rankings.
6. **Shadow the empirical model.** Run it beside the heuristic without changing user-visible results. Compare disagreements, inspect false positives, and freeze the holdout before threshold selection.
7. **Canary by model version.** Release to a small percentage, monitor unknown rate, latency, subgroup false-positive reports, and privacy/security errors, then increase gradually. Never mutate the meaning of an existing version.
8. **Rescan instead of rewriting history.** A material signal, weight, threshold, parser, or coverage change requires a new model version. Store new results as new observations; do not silently recalculate old published rows.
9. **Keep a rollback path.** Feature-flag the new model and active scanner independently. A rollback must restore the prior executable version without making private rows public or reinterpreting stored scores.

Suggested version rules:

- patch: implementation fix with identical fixtures and scoring outputs;
- minor: allowlist or weight change that can alter scores but preserves outcome semantics;
- major: definition, scale, threshold, evidence family, or output-contract change; and
- non-model scanner changes get a separate scanner/coverage version so fetch-policy changes remain auditable.

## Explicit limitations to show users

- A public page cannot reveal prompts, repository history, authorship percentages, developer understanding, code review, or testing quality.
- Provenance markers can be removed, copied, forged, transformed by an export, or hidden behind a custom domain.
- A site may be heavily AI-assisted and still have no public marker; another may retain a builder marker after extensive human rewriting.
- The index is evidence strength under a named model version, not a probability, moral judgment, or software-quality rating.
- Results are a point-in-time view and can vary with deployment, geography, authentication, personalization, caching, WAFs, and bot protection.
- Client-only behaviour, authenticated routes, source code, infrastructure, dependencies, and private APIs are outside a passive scan.
- Header and public-file observations do not prove that a site is secure or vulnerable. They identify bounded configuration signals for human review.
- Domain-control checks require an exact token match, are revocable, and expire for active-scan eligibility after 30 days. They provide bounded evidence of control at verification time, not cryptographic proof of authorship, organizational authority, or continuous control throughout that period.
- An active scan covers only its implemented checks. It is not a certification, comprehensive penetration test, or replacement for source review and professional assessment.
- Request-level deep failures currently withhold its score, but per-probe and parse coverage is not yet complete. Network and parsing failures must always be shown as unknown coverage, not silently interpreted as absence of evidence.

The durable product promise should be modest: show exactly what was observable, how it affected a versioned result, what could not be checked, and where the scanner must abstain.

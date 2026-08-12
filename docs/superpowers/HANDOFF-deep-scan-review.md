# Handoff: Ironclad deep-scan flow review

Paste the "PROMPT FOR NEW SESSION" block below into a fresh chat. Everything the new
session needs is in this file; it cannot see the previous conversation.

---

## PROMPT FOR NEW SESSION

You are picking up a review-and-improvement effort on **Ironclad**, a web security scanner.
Repo: `/Users/realm/Desktop/|work/school page/vibe-check`. It is live in production at
`https://bhopstudio.com/ironclad` (served as a path-based zone under bhopstudio.com, alongside
Redock at /redock; `basePath` and all client `fetch` calls go through `apiPath()` in `lib/site.ts`).

The product: point it at a URL, get security findings. 15 "surface" checks run on any URL free
and read-only; 13 "deep" checks send real attack payloads and require the user to prove they
control the domain first. Audience: people who built a site with AI tools (Lovable, v0, Bolt,
Replit, Cursor) and do not know security.

We are MID-BRAINSTORM (superpowers:brainstorming) on a review of the entire deep-scan flow:
domain authentication → running the scan → the report, plus a UI/UX audit and a scanner
correctness/coverage audit. **Start by invoking superpowers:brainstorming**, then resume from
"WHAT IS STILL NOT DONE" below. Do NOT jump to a plan or code until the design is presented and
the user approves it.

### DECISIONS THE USER HAS ALREADY MADE (do not re-ask)
- **Domain verification:** add Vercel/Netlify OAuth as the PRIMARY one-click path (connect account,
  read domains attached to their projects, ownership proven by the platform), and KEEP the three
  existing manual methods (meta tag, file, DNS TXT) as fallback. `verification_tokens.verification_method`
  is already free-text, so an OAuth-proven domain needs no schema change — a synthetic token
  satisfies the not-null `token` check and the deep-scan gate is unchanged.

### WHAT IS STILL NOT DONE
1. **UI/UX audit — LOST, must be relaunched.** An agent was dispatched to audit the deep-scan UI/UX
   but its result never came back (cancelled/dropped). Re-dispatch a general-purpose agent with the
   brief in "UI/UX AUDIT BRIEF" below. Nothing from it exists yet.
2. **Synthesis + clarifying questions + design.** Once the UI/UX audit lands, combine it with the
   scanner audit (already done, below), ask any remaining one-at-a-time clarifying questions, then
   present the design in sections for approval.
3. **Spec** → `docs/superpowers/specs/YYYY-MM-DD-deep-scan-overhaul-design.md`, then user review.
4. **Plan** via superpowers:writing-plans. No implementation yet.

### ALSO NOT DONE (separate, flagged repeatedly, still outstanding)
- **`supabase/schema.sql` has not been run against the production Supabase project.** Scans complete
  and render but do NOT persist — the app returns a "could not be saved" notice and refunds the
  allowance. History and anonymous-scan claim depend on it. This is a paste-into-SQL-editor task
  for the user, not code. Confirm whether it has been done before assuming persistence works.

### ONE FLOW BUG I FOUND MYSELF (fold into the plan)
- The surface report's "Verify a domain" button links to `/dashboard` WITHOUT carrying the scanned
  domain, so a user who just scanned `theirsite.com` lands on an empty form and retypes it. Carry
  the domain through. (`components/ScanReport.tsx` deep-lane upsell → `app/dashboard/page.tsx`.)

### HOUSE RULES
- No em dashes anywhere (prose, comments, commits). Rewrite, do not swap the character.
- Strict lane rule: a check that sends a payload MUST be in the deep lane; the surface lane may
  only make read-only requests a browser/crawler would already make. Any new check must state its
  lane. (One existing violation flagged below: `graphql`.)
- Verify gate before done: `npm run check` (typecheck, test, lint, build). Currently 83 tests pass.
- The dashboard needs an account; the consent modal is dismissed by setting localStorage
  `ironclad-consent-v3` = `1`.

---

## UI/UX AUDIT BRIEF (re-dispatch this to a general-purpose agent)

Audit the UI/UX of the deep-scan flow. Repo `/Users/realm/Desktop/|work/school page/vibe-check`.
Read: `app/dashboard/page.tsx` (flow: idle → enter-url → verify → confirmed → scanning → results),
`components/OwnershipVerify.tsx`, `components/ScanRunner.tsx`, `components/ScanReport.tsx`,
`app/globals.css`, `app/page.tsx`, `lib/scan-phases.ts`. Do not modify files. Answer with
file:line refs and concrete rewrites, not vague advice:
1. Does it look like AI slop? Where exactly (generic cards, no hierarchy, emoji, SaaS sameness)?
2. Is each step informative — what's happening, why, what it does to their site, how long, what they get?
3. Verification screen is the biggest drop-off risk (they must edit + redeploy their site before any
   deep value). Is the method choice clear? DNS propagation explained? "I did it but it says not
   verified" handled? Can they leave and come back? Platform-specific placement (Lovable/v0/Bolt)?
4. The ~40s / 28-phase SSE wait — satisfying or just a bar + log? What would make it compelling?
5. The report — leads with what matters? Non-expert knows what to do next? Severity legible at a glance?
6. Ranked, specific improvements: what, which file, why. Cheap-and-transformative over expensive polish.

---

## SCANNER CORRECTNESS + COVERAGE AUDIT — DONE (findings verbatim)

Scope: all 28 checks in `lib/deep-scanner.ts`, lanes in `lib/scan-lanes.ts`, validators in
`lib/deep-evidence.ts` / `lib/key-scanner.ts` / `lib/security-headers.ts`, scoring in
`lib/deep-score.ts`. The outbound layer `lib/pinned-fetch.ts` pins DNS and blocks any host ≠
`authorizedHostname` (safeFetch, `deep-scanner.ts:74-78`) — relevant to the Section C gaps.

### Section A — WRONG (false positives / broken logic)

**A1. NoSQL injection matches any page that mentions Mongo.** `deep-scanner.ts:1630-1637`, read at
`1645-1648`. `NOSQL_ERROR_PATTERNS` has bare vendor names `/mongodb/i`, `/mongoose/i`, `/BSON/i`,
and reads the body for every response regardless of status/content-type. On AI SPAs, `/api/*`
routinely returns the index.html shell or a marketing 404; any page containing "MongoDB"/"Mongoose"
fires a medium "Database Error Disclosed" with no injection. Fix: delete bare-name patterns, keep
`/MongoError/i`, `/CastError/i`, `/\$gt.*is not/i`; gate on JSON content-type; require the signature
to be ABSENT from a control request (differential, like `checkSSRF` at 1289-1292). Apply the same
content-type/differential gate to `checkSQLInjection` (846-850, 859-862) — `/Warning.*mysql/i` and
`/syntax error.*near/i` match WAF/CDN block pages and marketing copy too.

**A2. Open redirect fires on any redirect that preserves the query string.** `deep-scanner.ts:934`:
`if (loc.startsWith(TARGET) || loc.includes('evil-attacker-test.com'))`. An apex→www or trailing-slash
308 that carries `?redirect=https://evil-attacker-test.com` makes `loc.includes(...)` true →
false-positive medium. `redirect` is scored, so it drags the grade to C. Fix: resolve and compare
host — `const dest = new URL(loc, url); if (dest.hostname === 'evil-attacker-test.com') {...}`.

**A3. Admin-panel "confirmation" flags marketing/docs prose at HIGH.** `deep-scanner.ts:793` indicator,
`833-840` finding. `ADMIN_CONTENT_INDICATORS` includes free-text `/admin...(panel|console|dashboard|area)/i`,
`/user management/i`, `/manage users/i`. A landing/docs page with "admin dashboard" and no password
field on that page is reported high "Apparent Unauthenticated Admin Content." Fix: drop the prose
indicators, keep only product fingerprints (phpMyAdmin, cPanel, wpadminbar, Webmin); if kept, emit `info`.

**A4. Cookie check treats any cookie whose name contains "user" as auth, at HIGH.** `deep-scanner.ts:518`:
`/session|auth|token|jwt|sid|user/i`. `userLocale`, `user_prefs`, `userConsent`, analytics `token` →
high "Auth Cookie Missing HttpOnly." Fix: tighten to
`/session|auth|jwt|csrf|sid|access[_-]?token|refresh[_-]?token|user[_-]?(?:id|session|token)/i`.

**A5. Systematic false-negative: secret/library/vibe detection only reads top-level HTML, never JS
bundles.** `deep-scanner.ts:1968` (`checkVibeCodePatterns(baseUrl, mainHtml)`), `1064`
(`scanForPublicKeys(html)`), `1994` (`checkOutdatedLibraries(mainHtml)`). For React/Next SPAs the
served HTML is an empty shell; the Supabase URL + anon/service key, Firebase config, Stripe keys, and
real dependency versions live in `/_next/static/chunks/*.js`. `checkSourceMaps` already extracts
same-origin `<script src>` (1430-1447) but only fetches the `.map`. Fix (surface-legal, see C1): reuse
that extractor, fetch the top N same-origin bundles (bounded via `readBoundedProbeText`), run
`scanForPublicKeys` + Supabase/Firebase/Stripe regexes over their contents.

**A6. SSL redirect check only inspects the first hop.** `deep-scanner.ts:667-679`. With manual redirects,
a first hop `http://site/x` → `http://site/x/` before HTTPS yields `loc` starting `http://` →
false-positive medium (scored). Fix: follow the chain (bounded), only flag if it never reaches
`https://` on the same host.

Minor/lower-confidence (already hedged to "Need Review"/info, degrade signal rather than assert):
`checkForcedBrowsing`/`classifyUnauthenticatedJson` (1164-1239) can flag a public `{"role":"guest"}`;
`checkHostHeaderInjection` body reflection (1681) matches any page echoing Host into canonical/og:url.

### Section B — NOISE (drop or downgrade)
- **`methods` (TRACE/PUT/DELETE via OPTIONS, 616-648).** TRACE is dead (XST killed in browsers);
  PUT/DELETE in `Allow`/CORS preflight is a framework default, not unauthenticated write. Drop both.
- **`sri` (1137-1160).** Near-universal absence on these sites; remediation wrongly tells users to add
  `integrity=` to Stripe.js / GA / Fonts (mutable, will break). Keep at most `info`, stop recommending
  SRI on auto-updating third parties.
- **`ratelimit` (1583-1624).** Already info, copy admits a 6-request sample "cannot establish absence."
  It sends 6 real POST logins at a stranger's auth endpoint for a non-actionable line. Make conclusive
  or drop.
- **`components` (outdated jQuery/Angular/Bootstrap/Lodash/Moment, 1348-1423).** Audience ships
  React/Next; bundled+hashed deps won't match these URL regexes. Near-zero hit rate.
- Keep as-is (low yield, cheap, harmless): `idor` (info), `crlf`, `info-disclosure`.
- **Lane violation:** `graphql` runs a POST introspection body in the SURFACE lane (`scan-lanes.ts:34`,
  `checkGraphQL` 1496-1500). Read-only but a crafted POST, not "a request any browser already makes."
  Either move to deep or explicitly re-justify.

### Section C — TOP MISSING CHECKS (ranked)

**C1. Fetch and scan client JS bundles for secrets/config. Lane: SURFACE.** Highest leverage; pure
read-only GETs of assets the page references (same class as `sourcemaps`). Extract same-origin
`<script src>` (extractor at 1430-1447), fetch top ~8 bundles bounded by `MAX_PROBE_BODY_BYTES`, run
`scanForPublicKeys` + Supabase/Firebase/Stripe/service-role regexes over their bodies. Near-perfect
reliability, ~every SPA, high impact (a leaked `service_role` JWT or `sk_live` hides here). Fixes A5.

**C2. Active Supabase anon-key read probe (RLS-off detection). Lane: DEEP.** The single biggest
real-world killer for this audience. Once C1/`vibe` recovers a `*.supabase.co` URL + anon JWT, hit
PostgREST with the public key: `GET https://<ref>.supabase.co/rest/v1/` (OpenAPI listing of exposed
tables), then for user-data-shaped tables `GET /rest/v1/<table>?select=*&limit=1` with
`apikey`+`Authorization: Bearer <anon>`. Rows returned for a table with email/user_id/stripe_customer
columns = RLS off → critical. Anon key is public by design (not credential theft), but it reads an
application data API, so deep. Notes: (a) safeFetch hard-blocks any host ≠ verified domain (74-78), so
this needs a deliberate carve-out to `*.supabase.co` derived only from the site's own embedded config;
(b) `limit=1` and redact.

**C3. Firebase open-rules / public-bucket probe. Lane: DEEP.** From recovered Firebase config
(projectId, storageBucket, databaseURL): RTDB world-read
`GET https://<projectId>-default-rtdb.firebaseio.com/.json` (whole DB as JSON if read:true → critical);
public Storage listing `GET https://firebasestorage.googleapis.com/v0/b/<bucket>/o`. Same third-party
carve-out as C2. RTDB world-read returns an unambiguous dump — very reliable.

**C4. Public cloud-storage listing (Supabase Storage / S3). Lane: DEEP.** When `*.supabase.co` or
`<bucket>.s3.amazonaws.com` appears: read/list only, never PUT. Supabase `GET /storage/v1/bucket` +
`POST /storage/v1/object/list/<bucket>` with anon key; S3 `GET https://<bucket>.s3.amazonaws.com/?list-type=2`.
Object list on a user-uploads bucket = high/critical.

**C5. Next.js middleware auth bypass + route enumeration. Lane: DEEP.** (a) Middleware bypass: on a
route that redirects unauth users to `/login`, resend with `x-middleware-subrequest` set (2025
Next.js middleware-auth-bypass class) and check whether protected content now 200s. (b) Route
enumeration: `GET /_next/static/<buildId>/_buildManifest.js` / `app-build-manifest.json` to recover
real routes+APIs, then feed those into `forced`/`idor` instead of guessed constants. Moderate
detectability, high impact, exact-stack-specific.

---

## SESSION STATE SUMMARY
- Ironclad shipped and live at bhopstudio.com/ironclad; design system rebuilt (near-black, one blue
  accent, mono-for-evidence); account pages restyled; dead components removed.
- This review effort produced: the scanner audit above (done) + a lost UI/UX audit (redo).
- Nothing from this review has been written to a spec, plan, or code yet.
- Outstanding user tasks: run `supabase/schema.sql`; Stripe was being wired (price
  `price_1U3ODoFh6zteGonSz2OMMUpW`, product `prod_V3VEAaLYM1egUL`) — confirm webhook secret is set.

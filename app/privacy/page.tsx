import Link from 'next/link';
import type { Metadata } from 'next';

const BASE = 'https://isthisvibecoded-one.vercel.app';

export const metadata: Metadata = {
  title: 'Privacy Policy | Ironclad',
  description: 'What Ironclad requests, stores, and cannot determine.',
  alternates: { canonical: `${BASE}/privacy` },
  openGraph: {
    type: 'website',
    url: `${BASE}/privacy`,
    title: 'Privacy Policy | Ironclad',
    description: 'What Ironclad requests, stores, and cannot determine.',
    images: [{ url: `${BASE}/og/default.png` }],
  },
  twitter: { card: 'summary_large_image' },
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen px-6 py-16" style={{ background: '#0a0a0f' }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(139,92,246,0.07) 0%, transparent 70%)' }}
      />

      <div className="relative max-w-2xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors mb-10">
          ← Back to home
        </Link>

        <div className="mb-10">
          <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
          <p className="text-sm text-white/35">Last updated: August 2026</p>
          <div className="mt-4 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
            <p className="text-sm text-emerald-300/80 font-medium">
              Short version: we do not sell personal data or use it for advertising. Every scan result is private to the account that ran it, and there is no public feed, leaderboard, or shareable result page at all.
            </p>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-10 text-sm text-white/50 leading-relaxed">

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              Who we are
            </h2>
            <p>
              Ironclad (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is a website security scanner.
              It reports visible generative-builder provenance signals, a limited response-header hardening index, and visible technology indicators.
              It does not determine whether a developer understood, reviewed, or personally wrote the code.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              What we scan, and what we do not
            </h2>
            <p className="mb-3">
              Passive scans are read-only but are not a single-request operation. We fetch the submitted public page, follow a bounded number
              of validated redirects, and make up to 15 HEAD or GET requests to a fixed list of public paths on the same origin:
            </p>
            <ul className="space-y-1.5 mb-3">
              {[
                'HTTP response headers (security headers, server info)',
                'HTML source code (publicly rendered in any browser)',
                'A fixed list of public paths such as robots.txt, sitemap.xml, security.txt, login, admin, and selected configuration paths',
                'JavaScript references and potential public key or token patterns already present in the returned HTML',
              ].map(item => (
                <li key={item} className="flex gap-2">
                  <span className="text-violet-500/60 shrink-0">›</span>
                  {item}
                </li>
              ))}
            </ul>
            <p>
              Passive checks do <strong className="text-white/70">not</strong> submit exploit payloads, brute-force credentials, authenticate,
              or attempt to bypass access controls. A path returning HTTP 200 is not automatically treated as a confirmed exposure where content validation is available.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              What the provenance result means
            </h2>
            <p>
              The evidence index is a versioned heuristic over public page signals. Exact generator metadata, explicit builder attribution,
              and builder-specific hosted markers can support a result; ordinary frameworks, hosting providers, generic marketing copy,
              and placeholder text do not establish authorship. The index is not a probability and an inconclusive result is not proof of human authorship.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-red-500 shrink-0" />
              Deep vulnerability scans
            </h2>
            <p className="mb-3">
              The Deep Scan route is available only when <strong className="text-white/70">all three</strong> of the following are true:
            </p>
            <ul className="space-y-1.5 mb-3">
              {[
                'You are logged in to a verified Ironclad account',
                'You have demonstrated control of the domain by placing a unique token in DNS, an HTML meta tag, or a hosted verification file',
                'You have explicitly requested the scan and accepted these terms',
              ].map(item => (
                <li key={item} className="flex gap-2">
                  <span className="text-red-500/60 shrink-0">›</span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="mb-2">
              Domain-control verification is a technical gate, not a legal determination of ownership or permission. You must have explicit authorisation
              to run active tests; placing a token on a site without that authorisation does not grant it. Deep checks are best-effort indicators and are not
              a complete OWASP audit, a penetration test, or a guarantee that findings contain no false positives or negatives.
            </p>
            <p>Deep scan results are stored privately in the requesting user&apos;s account.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              Data we collect
            </h2>
            <p className="mb-2"><strong className="text-white/70">Anonymous users (no account):</strong></p>
            <ul className="space-y-1.5 mb-4">
              {[
                'The submitted URL is processed to run the scan. The result is stored privately for up to 7 days with a one-time claim token so you can attach it to an account you create afterwards, and it is deleted unclaimed after that',
                'For rate limiting, an IP-derived value is transformed with a server-side HMAC and used in a date-scoped usage row; the raw IP is not stored in that row',
                'A local-storage consent flag is saved in your browser only after you explicitly accept this policy',
              ].map(item => (
                <li key={item} className="flex gap-2">
                  <span className="text-violet-500/60 shrink-0">›</span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="mb-2"><strong className="text-white/70">Registered users:</strong></p>
            <ul className="space-y-1.5">
              {[
                'Email address (required for login)',
                'A display handle you choose at signup',
                'Password, stored as a salted cryptographic hash (scrypt). We never store plain-text passwords.',
                'Profile details you provide, plus comments, reactions, and notification preferences created through the service',
                'Passive and deep scan results linked to your account; new passive scans start private',
                'Subscription status if you upgrade, via Stripe, so we never see your card details',
              ].map(item => (
                <li key={item} className="flex gap-2">
                  <span className="text-violet-500/60 shrink-0">›</span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-4 mb-2"><strong className="text-white/70">Optional false-positive feedback:</strong></p>
            <p>
              If you submit a false-positive report, we store the scanned site URL, finding identifier and title, your optional comment,
              and a submission timestamp. A pseudonymous HMAC-derived, date-scoped counter limits feedback abuse; feedback is not published.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              What passive scanning intentionally excludes
            </h2>
            <ul className="space-y-1.5">
              {[
                'Credentials or other data behind a login',
                'Forms submitted to the scanned site',
                'Cookies set by, or browser sessions with, the scanned site',
                'Device fingerprints or advertising identifiers for profiling',
                'Payment card details (payments are handled by Stripe)',
              ].map(item => (
                <li key={item} className="flex gap-2">
                  <span className="text-emerald-500/60 shrink-0">✗</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              Cookies and sessions
            </h2>
            <p>
              Our application uses an httpOnly cookie (<code className="text-violet-300 font-mono text-xs bg-violet-500/10 px-1 py-0.5 rounded">vc-auth</code>) to
              maintain a signed-in session. It contains a signed JWT with account identifiers and plan information and expires after seven days.
              After explicit consent, the browser also stores the consent version in local storage. We do not use these values for advertising or cross-site tracking.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              Data storage and security
            </h2>
            <p className="mb-2">
              Scan results and account data are stored in Supabase (PostgreSQL). Passwords are hashed with scrypt before storage.
              JWT tokens are signed with a server-side secret and expire after 7 days.
            </p>
            <p>
              The production service is served over HTTPS. Anonymous rate limiting uses an HMAC-derived identifier rather than storing the raw IP
              in the daily usage table; signed-in limits use the user ID. Hosting and infrastructure providers may still process ordinary request metadata.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              Public feed
            </h2>
            <p>
              Scan results are private to the account that ran them and are visible only at the direct result route to their owner. There is no publish action,
              no public feed, and no shareable result link, because a scan can describe a site its requester does not own,
              and can later switch it back to private.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              Data sharing
            </h2>
            <p className="mb-3">
              We <strong className="text-white/70">do not</strong> sell, rent, or share your personal data with any third party for
              marketing or advertising. The only third-party services we use are:
            </p>
            <ul className="space-y-1.5">
              {[
                'Supabase, for database storage of account and saved service data',
                'Stripe, for payment processing. We never see card details',
                'Vercel, for hosting and the edge network',
                'Resend, for optional transactional notification email when configured and enabled',
                'Google Favicon Service, which supplies the small site icons shown in the interface',
              ].map(item => (
                <li key={item} className="flex gap-2">
                  <span className="text-violet-500/60 shrink-0">›</span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-3">
              Social-share buttons contact their named destination only after you choose that link; the destination then applies its own privacy policy.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              Your rights
            </h2>
            <p className="mb-3">Depending on where you live and subject to applicable law, you may have rights to:</p>
            <ul className="space-y-1.5 mb-3">
              {[
                'Access the data we hold about you',
                'Correct inaccurate data',
                'Request deletion of your account and associated personal data',
                'Request a portable copy of applicable data',
                'Object to or restrict certain processing, or withdraw consent where consent is the legal basis',
              ].map(item => (
                <li key={item} className="flex gap-2">
                  <span className="text-violet-500/60 shrink-0">›</span>
                  {item}
                </li>
              ))}
            </ul>
            <p>
              These are request rights, not a claim that each action currently has a one-click control in the app.
              The current interface does not provide self-service account deletion or full data export; those requests require operator support through the{' '}
              <a href="https://github.com/Realm9758/isthisvibecoded/issues" className="text-violet-300 hover:text-violet-200 underline underline-offset-2">project issue tracker</a>.
              Because that tracker is public, do not include an email address, account data, or other personal information; request a private contact channel instead.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              Data retention
            </h2>
            <p>
              An unclaimed anonymous scan result is deleted 7 days after it was run. Account data and saved scan results remain stored while the account or record exists,
              subject to legal and operational retention needs. Rate-limit counts use date-scoped database rows; the count window resets daily,
              but that does not mean the underlying row is deleted immediately. The free active-scan allowance also uses a lifetime counter.
              Stripe retains billing records under its own policy.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              Children
            </h2>
            <p>
              This service is not directed at children under 13. We do not knowingly collect data from children.
              If you believe a child has created an account, please contact us through the project issue tracker to request removal.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              Changes to this policy
            </h2>
            <p>
              We may update this policy as the service evolves. Material changes will be communicated via the app and, where acceptance is required,
              the service will request acceptance of the new version rather than inferring it from an old checkbox.
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-white/6 flex items-center justify-between gap-4 flex-wrap">
          <Link href="/" className="text-xs text-white/30 hover:text-white/60 transition-colors">← Back to home</Link>
          <p className="text-xs text-white/20">Passive public analysis · active checks require verified domain control</p>
        </div>
      </div>
    </main>
  );
}

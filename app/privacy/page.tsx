import Link from 'next/link';
import type { Metadata } from 'next';

const BASE = 'https://isthisvibecoded-one.vercel.app';

export const metadata: Metadata = {
  title: 'Privacy Policy — Is This Vibe-Coded?',
  description: 'How we handle your data, what we collect, and your rights.',
  alternates: { canonical: `${BASE}/privacy` },
  openGraph: {
    type: 'website',
    url: `${BASE}/privacy`,
    title: 'Privacy Policy — Is This Vibe-Coded?',
    description: 'How we handle your data, what we collect, and your rights.',
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
          <p className="text-sm text-white/35">Last updated: April 2026</p>
          <div className="mt-4 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
            <p className="text-sm text-emerald-300/80 font-medium">
              Short version: We don&apos;t sell your data, we don&apos;t share it with advertisers, and passive scans collect nothing personal from the site being scanned.
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
              Is This Vibe-Coded? (&ldquo;VibeScan&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is a web security and AI fingerprinting tool.
              We help developers and site owners understand whether a site was AI-generated and audit its passive security posture.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              What we scan — and what we don&apos;t
            </h2>
            <p className="mb-3">
              All passive scans are strictly read-only. We send a single HTTP request to the URL you provide and analyse only
              what a normal web browser can already see:
            </p>
            <ul className="space-y-1.5 mb-3">
              {[
                'HTTP response headers (security headers, server info)',
                'HTML source code (publicly rendered in any browser)',
                'Publicly accessible files (robots.txt, sitemap.xml, .well-known/*)',
                'JavaScript bundle references and API key patterns in the rendered HTML',
              ].map(item => (
                <li key={item} className="flex gap-2">
                  <span className="text-violet-500/60 shrink-0">›</span>
                  {item}
                </li>
              ))}
            </ul>
            <p>
              We <strong className="text-white/70">do not</strong> send any exploits, run brute-force attacks, probe authenticated endpoints,
              or access content that requires a login.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-red-500 shrink-0" />
              Deep vulnerability scans
            </h2>
            <p className="mb-3">
              Active security testing (Deep Scan) is only ever run when <strong className="text-white/70">all three</strong> of the following are true:
            </p>
            <ul className="space-y-1.5 mb-3">
              {[
                'You are logged in to a verified VibeScan account',
                'You have proven ownership of the domain via DNS TXT record, HTML meta tag, or a hosted verification file',
                'You have explicitly requested the scan and accepted these terms',
              ].map(item => (
                <li key={item} className="flex gap-2">
                  <span className="text-red-500/60 shrink-0">›</span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="mb-2">
              We will <strong className="text-white/70">never</strong> run active tests against any domain you do not own.
              Attempting to verify a domain you do not control is a violation of these terms and may be reported to the relevant authority.
            </p>
            <p>Deep scan results are stored in your account and are never made public without your explicit consent.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              Data we collect
            </h2>
            <p className="mb-2"><strong className="text-white/70">Anonymous users (no account):</strong></p>
            <ul className="space-y-1.5 mb-4">
              {[
                'The URL you submitted (stored to power the public feed)',
                'Your IP address for rate limiting only — not stored after the request',
                'Scan result data (vibe score, security headers, tech stack)',
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
                'Password — stored as a salted cryptographic hash (scrypt). We never store plain-text passwords.',
                'Scan results linked to your account',
                'Subscription status if you upgrade (via Stripe — we never see your card details)',
              ].map(item => (
                <li key={item} className="flex gap-2">
                  <span className="text-violet-500/60 shrink-0">›</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              Data we never collect
            </h2>
            <ul className="space-y-1.5">
              {[
                'Passwords in plain text — ever',
                'Payment card details (handled entirely by Stripe)',
                'Personal data from the websites being scanned',
                'Cookies or tracking pixels from scanned sites',
                'Device fingerprints or advertising identifiers',
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
              We use a single httpOnly cookie (<code className="text-violet-300 font-mono text-xs bg-violet-500/10 px-1 py-0.5 rounded">vc-auth</code>) to
              maintain your login session. This cookie contains a signed JWT with your user ID and plan — no third-party tracking.
              We do not use advertising cookies, analytics cookies, or any third-party cookies.
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
              We use HTTPS for all connections. We do not log request bodies. Rate limiting is applied by IP address and user ID;
              raw IP addresses are not persisted.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              Public feed
            </h2>
            <p>
              Scan results are public by default and appear on the Leaderboard. You can make any scan private at any time
              from the Share tab of your results. Private scans are only accessible via their direct link.
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
                'Supabase — database storage (we share only the data you explicitly save)',
                'Stripe — payment processing (we never see card details)',
                'Vercel — hosting and edge network',
              ].map(item => (
                <li key={item} className="flex gap-2">
                  <span className="text-violet-500/60 shrink-0">›</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              Your rights
            </h2>
            <p className="mb-3">Under GDPR and applicable law, you have the right to:</p>
            <ul className="space-y-1.5 mb-3">
              {[
                'Access the data we hold about you',
                'Correct inaccurate data',
                'Delete your account and all associated data',
                'Export your scan history',
                'Withdraw consent at any time',
              ].map(item => (
                <li key={item} className="flex gap-2">
                  <span className="text-violet-500/60 shrink-0">›</span>
                  {item}
                </li>
              ))}
            </ul>
            <p>We will action all data requests within 30 days.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              Data retention
            </h2>
            <p>
              Account data is retained until you delete your account. Anonymous scan results are retained for 90 days.
              Rate-limiting counters are cleared daily. Stripe billing data is retained per Stripe&apos;s own policy.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              Children
            </h2>
            <p>
              This service is not directed at children under 13. We do not knowingly collect data from children.
              If you believe a child has created an account, please contact us to remove it.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/80 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-500 shrink-0" />
              Changes to this policy
            </h2>
            <p>
              We may update this policy as the service evolves. Material changes will be communicated via the app.
              Continued use after changes constitutes acceptance of the updated policy.
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-white/6 flex items-center justify-between gap-4 flex-wrap">
          <Link href="/" className="text-xs text-white/30 hover:text-white/60 transition-colors">← Back to home</Link>
          <p className="text-xs text-white/20">Is This Vibe-Coded? — passive analysis only</p>
        </div>
      </div>
    </main>
  );
}

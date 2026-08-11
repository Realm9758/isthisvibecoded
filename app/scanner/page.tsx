import Link from 'next/link';
import type { Metadata } from 'next';
import { SURFACE_PHASE_IDS, DEEP_ONLY_PHASE_IDS } from '@/lib/scan-lanes';

export const metadata: Metadata = {
  title: 'About the Ironclad scanner',
  description: 'What the Ironclad scanner requests, how to identify it, and how to block it.',
};

/**
 * The page a site owner reaches from the scanner's user-agent string when they
 * find it in their logs and want to know who is knocking.
 */
export default function ScannerPage() {
  return (
    <main className="min-h-screen px-6 py-16" style={{ background: '#0a0a0f' }}>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-white/90 mb-3">About the Ironclad scanner</h1>
        <p className="text-white/45 leading-relaxed mb-10">
          If you found this page from a user agent in your access logs, this explains what we requested and
          how to stop us.
        </p>

        <section className="rounded-2xl border border-white/8 bg-white/2 p-6 mb-6">
          <h2 className="text-sm font-semibold text-white/80 mb-3">How to identify us</h2>
          <p className="text-sm text-white/45 leading-relaxed mb-3">
            Every request carries one of two user agents:
          </p>
          <pre className="text-xs font-mono text-white/60 p-3 rounded-lg bg-black/40 overflow-x-auto mb-3">
Ironclad-Surface/2.0 (+https://ironclad.dev/scanner)
Ironclad-Deep/2.0 (authorized domain-control scan; +https://ironclad.dev/scanner)</pre>
          <p className="text-sm text-white/45 leading-relaxed">
            <span className="text-white/70">Surface</span> means somebody asked us to look at your site from
            the outside. They did not have to prove they own it, so this lane only makes read-only requests.
            <span className="text-white/70"> Deep</span> means the requester proved control of the domain
            within the last 30 days.
          </p>
        </section>

        <section className="rounded-2xl border border-white/8 bg-white/2 p-6 mb-6">
          <h2 className="text-sm font-semibold text-white/80 mb-3">What the surface lane requests</h2>
          <p className="text-sm text-white/45 leading-relaxed mb-3">
            {SURFACE_PHASE_IDS.length} checks, all read-only. It fetches your homepage, issues one OPTIONS
            request, and requests a fixed list of well-known paths such as{' '}
            <code className="font-mono text-xs text-white/60">/.env</code>,{' '}
            <code className="font-mono text-xs text-white/60">/robots.txt</code>,{' '}
            <code className="font-mono text-xs text-white/60">/.git/HEAD</code>, and{' '}
            <code className="font-mono text-xs text-white/60">/openapi.json</code>. Every one of those is a
            plain GET for a file your server either serves or does not.
          </p>
          <p className="text-sm text-white/45 leading-relaxed">
            It sends no attack payloads, no credentials, no brute force, and it does not attempt to write
            anything. It is bounded to roughly 60 requests and around 40 seconds.
          </p>
        </section>

        <section className="rounded-2xl border border-white/8 bg-white/2 p-6 mb-6">
          <h2 className="text-sm font-semibold text-white/80 mb-3">What needs permission</h2>
          <p className="text-sm text-white/45 leading-relaxed">
            The other {DEEP_ONLY_PHASE_IDS.length} checks send real test payloads: injection strings, path
            traversal, forged headers, and repeated requests against authentication endpoints. Those run only
            against a domain whose control the requester has proved, and no plan or payment changes that.
          </p>
        </section>

        <section className="rounded-2xl border border-white/8 bg-white/2 p-6 mb-6">
          <h2 className="text-sm font-semibold text-white/80 mb-3">Rate limits</h2>
          <p className="text-sm text-white/45 leading-relaxed">
            Any single domain can be scanned at most 10 times per hour across all of our users combined. That
            limit applies to paying accounts exactly as it applies to anonymous ones, so Ironclad cannot be
            used to generate sustained traffic against you.
          </p>
        </section>

        <section className="rounded-2xl border border-white/8 bg-white/2 p-6 mb-6">
          <h2 className="text-sm font-semibold text-white/80 mb-3">Blocking us</h2>
          <p className="text-sm text-white/45 leading-relaxed mb-3">
            Block on the user agent. In nginx:
          </p>
          <pre className="text-xs font-mono text-white/60 p-3 rounded-lg bg-black/40 overflow-x-auto mb-3">
if ($http_user_agent ~* &quot;Ironclad-&quot;) &#123; return 403; &#125;</pre>
          <p className="text-sm text-white/45 leading-relaxed">
            A blocked check is reported to the requester as inconclusive with the reason stated. It never
            becomes a passing result, so blocking us costs you nothing but the report.
          </p>
        </section>

        <section className="rounded-2xl border border-amber-500/20 p-6" style={{ background: 'rgba(245,158,11,0.04)' }}>
          <h2 className="text-sm font-semibold text-amber-300/90 mb-2">Reporting abuse</h2>
          <p className="text-sm text-white/45 leading-relaxed">
            If you believe Ironclad has been pointed at your infrastructure improperly, contact us through
            the feedback form and include the timestamps and user agent from your logs. We keep a record of
            which account requested each scan.
          </p>
        </section>

        <div className="mt-10 flex gap-3 flex-wrap">
          <Link href="/what-we-check" className="px-5 py-2.5 rounded-xl text-sm text-white/50 border border-white/8 hover:bg-white/5 transition-colors">
            Every check in detail
          </Link>
          <Link href="/privacy" className="px-5 py-2.5 rounded-xl text-sm text-white/50 border border-white/8 hover:bg-white/5 transition-colors">
            Privacy policy
          </Link>
        </div>
      </div>
    </main>
  );
}

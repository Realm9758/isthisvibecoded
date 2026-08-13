import Link from 'next/link';
import type { Metadata } from 'next';
import { SURFACE_PHASE_IDS, DEEP_ONLY_PHASE_IDS } from '@/lib/scan-lanes';
import { TARGET_HOURLY_LIMIT } from '@/lib/scan-quota';
import { SCANNER_INFO_URL } from '@/lib/site';
import { DEEP_SCANNER_ID_HEADER, DEEP_SCANNER_ID_VALUE, DEEP_SCANNER_USER_AGENT, scannerEgressIps } from '@/lib/scan-identity';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'The scanner | Ironclad',
  description: 'What the Ironclad scanner requests, how to identify it, and how to block it.',
};

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border p-7" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
      <h2 className="label mb-4">{title}</h2>
      <div className="space-y-3.5 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{children}</div>
    </section>
  );
}

/**
 * The page a site owner reaches from the scanner's user-agent string when they
 * find it in their logs and want to know who is knocking.
 */
export default function ScannerPage() {
  const egressIps = scannerEgressIps();
  return (
    <main style={{ background: 'var(--bg)' }}>
      <section className="px-6 py-20 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-3xl mx-auto">
          <p className="eyebrow mb-6">the scanner</p>
          <h1 className="display text-white text-[clamp(2.25rem,5vw,3.5rem)] mb-7">
            Found us in<br />your logs?
          </h1>
          <p className="text-lg leading-relaxed" style={{ color: 'var(--muted)' }}>
            This page explains exactly what we requested, how to identify us, and how to make us stop.
          </p>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="max-w-3xl mx-auto space-y-5">

          <Block title="how to identify us">
            <p>Every request carries one of two user agents:</p>
            <pre
              className="font-mono text-xs p-4 overflow-x-auto"
              style={{ background: 'var(--bg)', color: 'var(--accent)', borderRadius: 4 }}
            >{`Ironclad-Surface/2.0 (+${SCANNER_INFO_URL})
Ironclad-Deep/2.0 (authorized domain-control scan; +${SCANNER_INFO_URL})`}</pre>
            <p>
              <span className="text-white/80">Surface</span> means somebody asked us to look at your site
              from the outside. They did not have to prove they own it, so that lane makes read-only requests
              only. <span className="text-white/80">Deep</span> means the requester proved control of the
              domain and that proof was checked again before active requests began.
            </p>
          </Block>

          <Block title="what the surface lane requests">
            <p>
              {SURFACE_PHASE_IDS.length} assessment modules, all read-only. It fetches your submitted page, exact-origin script
              assets referenced by that page, and a fixed list of public file paths such as{' '}
              <span className="font-mono text-xs text-white/70">/.env</span>,{' '}
              <span className="font-mono text-xs text-white/70">/robots.txt</span>,{' '}
              <span className="font-mono text-xs text-white/70">/.git/HEAD</span> and{' '}
              <span className="font-mono text-xs text-white/70">/openapi.json</span>. Each is a plain GET for
              a file your server either serves or does not.
            </p>
            <p>
              No attack payloads, no credentials, no brute force, and no attempt to write anything. It is
              bounded to roughly 60 requests and about 40 seconds.
            </p>
          </Block>

          <Block title="what needs permission">
            <p>
              The other {DEEP_ONLY_PHASE_IDS.length} modules send real test payloads when the scanner finds a suitable target: injection strings, path
              traversal, forged headers, GraphQL introspection, bounded provider-rule reads, and—when selected—a six-request GET-only rate-limit sample on one discovered public API route. Those run
              only against a domain whose control the requester has proved, and no plan or payment changes
              that.
            </p>
          </Block>

          <Block title={egressIps.length > 0 ? 'letting an authorised deep scan through your firewall' : 'temporary scanner identity'}>
            <p>
              If you started a verified-domain scan, Ironclad first makes four safe access checks. A bot challenge or temporary rate limit pauses the job before the application modules start and before a scan credit is used.
            </p>
            <p>{egressIps.length > 0
              ? 'Use both the fixed source address and exact verified hostname for a temporary WAF exception:'
              : 'The temporary Vercel scanner has no stable source address. Most sites need no setup, but an owner cannot safely allowlist this temporary mode through a browser challenge.'}</p>
            <pre className="font-mono text-xs p-4 overflow-x-auto" style={{ background: 'var(--bg)', color: 'var(--accent)', borderRadius: 4 }}>{`Fixed scanner IP${egressIps.length === 1 ? '' : 's'}: ${egressIps.length > 0 ? egressIps.join(', ') : 'not published in this environment'}
User-Agent: ${DEEP_SCANNER_USER_AGENT}
${DEEP_SCANNER_ID_HEADER}: ${DEEP_SCANNER_ID_VALUE}`}</pre>
            {egressIps.length > 0 ? (<>
              <p>
                The header is an extra identity signal, not a secret. Do not allow it on its own because another client could copy it. Match the fixed IP and your exact hostname, recheck access from the saved scan, then remove the temporary rule when the application pass is complete.
              </p>
              <p>
                Provider instructions:{' '}
                <a className="underline underline-offset-2" style={{ color: 'var(--accent)' }} href="https://developers.cloudflare.com/waf/custom-rules/skip/" target="_blank" rel="noreferrer">Cloudflare Skip rules</a>
                {' · '}
                <a className="underline underline-offset-2" style={{ color: 'var(--accent)' }} href="https://vercel.com/docs/vercel-firewall/vercel-waf/system-bypass-rules" target="_blank" rel="noreferrer">Vercel bypass rules</a>.
              </p>
            </>) : (
              <p>
                If a real challenge appears, Ironclad stops immediately and offers a later recheck instead of spraying the remaining modules. It never suggests trusting the copyable header by itself.
              </p>
            )}
            <p>Ironclad does not solve challenges, rotate proxies, or impersonate a browser.</p>
          </Block>

          <Block title="rate limits">
            <p>
              Any single domain can be scanned at most {TARGET_HOURLY_LIMIT} times per hour across all of our
              users combined. That limit applies to paying accounts exactly as it applies to anonymous ones,
              so Ironclad cannot be used to generate sustained traffic against you.
            </p>
          </Block>

          <Block title="blocking us">
            <p>Block on the user agent. In nginx:</p>
            <pre
              className="font-mono text-xs p-4 overflow-x-auto"
              style={{ background: 'var(--bg)', color: 'var(--muted)', borderRadius: 4 }}
            >{`if ($http_user_agent ~* "Ironclad-") { return 403; }`}</pre>
            <p>
              A confirmed challenge pauses a durable deep scan immediately, so later modules are not sprayed
              with requests or shown as clean. The requester sees the provider/status when available and can cancel the job.
            </p>
          </Block>

          <section className="border p-7" style={{ borderColor: 'rgba(245,158,11,0.25)', borderRadius: 6 }}>
            <h2 className="label mb-4" style={{ color: 'var(--high)' }}>reporting abuse</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              If you believe Ironclad has been pointed at your infrastructure improperly, contact us through
              the feedback form with the timestamps and user agent from your logs. We keep a record of which
              account requested each scan.
            </p>
          </section>

          <div className="flex gap-4 flex-wrap pt-5">
            <Link
              href="/what-we-check"
              className="px-6 py-3 font-mono text-sm border transition-colors hover:bg-white/4"
              style={{ borderColor: 'var(--border-2)', color: 'var(--muted)', borderRadius: 4 }}
            >
              every check in detail
            </Link>
            <Link
              href="/privacy"
              className="px-6 py-3 font-mono text-sm border transition-colors hover:bg-white/4"
              style={{ borderColor: 'var(--border-2)', color: 'var(--muted)', borderRadius: 4 }}
            >
              privacy policy
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

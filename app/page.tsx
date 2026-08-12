'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ScanRunner, type CompletedScan, type ScanErrorMeta } from '@/components/ScanRunner';
import { ScanReport } from '@/components/ScanReport';
import { useAuth } from '@/contexts/AuthContext';
import { DEEP_ONLY_PHASE_IDS, LANE_CHECK_COUNTS, SURFACE_PHASE_IDS } from '@/lib/scan-lanes';
import { SCAN_PHASES } from '@/lib/scan-phases';
import { FREE_LIFETIME_LIMIT } from '@/lib/scan-quota';
import { holdClaim } from '@/lib/claim-scan';

const SURFACE = LANE_CHECK_COUNTS.surface;
const DEEP_ONLY = DEEP_ONLY_PHASE_IDS.length;
const TOTAL = LANE_CHECK_COUNTS.deep;

const STEPS = [
  {
    n: '01',
    title: 'Scan any URL, free',
    body: `Type a domain. ${SURFACE} read-only checks run immediately, no account: leaked keys in your bundle, a public .env, an exposed source map, headers you never set.`,
  },
  {
    n: '02',
    title: 'Prove you control the domain',
    body: 'Connect Vercel or Netlify, or use a TXT record, meta tag, or file. The live proof is checked again before active requests begin.',
  },
  {
    n: '03',
    title: 'Fix it with the evidence',
    body: 'Every finding ships with what we requested, what came back, and what to change. No finding is reported without the observation behind it.',
  },
];

/** The real check inventory, grouped for the coverage matrix. */
const SURFACE_SET = new Set<string>(SURFACE_PHASE_IDS);
const COVERAGE = SCAN_PHASES
  .filter(phase => phase.id !== 'init' && phase.id !== 'done')
  .map(phase => ({ name: phase.label, lane: SURFACE_SET.has(phase.id) ? 'surface' : 'deep' }));

/** Shown in the hero as a worked example, never presented as a live result. */
const EXAMPLE_FINDINGS = [
  { sev: 'CRIT', color: 'var(--crit)', title: 'Supabase service role key in client HTML', meta: 'GET /  ·  bypasses row level security' },
  { sev: 'CRIT', color: 'var(--crit)', title: 'Environment file publicly readable',       meta: 'GET /.env  ·  200  ·  non-placeholder secret' },
  { sev: 'HIGH', color: 'var(--high)', title: 'Source maps expose unminified source',     meta: 'GET /_next/static/main.js.map  ·  200' },
  { sev: 'HIGH', color: 'var(--high)', title: 'Site reachable over plain HTTP',           meta: 'GET http://  ·  200  ·  no redirect to HTTPS' },
];

const FAQ = [
  {
    q: `Why can I only run ${SURFACE} checks on someone else's site?`,
    a: `Because the other ${DEEP_ONLY} send attack payloads. Firing those at a server you do not control is unauthorised access in a lot of places, and a checkbox saying you had permission is not a defence. The ${SURFACE} open checks are read-only requests of the kind any browser or search crawler already makes, so they are safe on any target.`,
  },
  {
    q: 'Does paying unlock more checks?',
    a: `No. Permission decides which checks run; payment decides how many scans you get. Verifying a domain unlocks all ${TOTAL} on the free plan too.`,
  },
  {
    q: 'What if my firewall blocks the scanner?',
    a: 'The blocked check is reported as inconclusive with the reason stated, and the rest of the report still renders. A blocked check never becomes a passing one, so blocking us costs you the report rather than hiding a problem.',
  },
  {
    q: 'Is this a penetration test?',
    a: 'No. Ironclad looks from the outside at one moment in time with bounded, automated probes. It cannot read your source, review your access control, or reason about your business logic. A clean result means these checks observed nothing, not that your site is secure.',
  },
];

function isValidUrl(value: string) {
  try {
    new URL(value.startsWith('http') ? value : `https://${value}`);
    return true;
  } catch {
    return false;
  }
}

export default function Home() {
  const { user, refreshUser } = useAuth();
  const [url, setUrl] = useState('');
  const [target, setTarget] = useState('');
  const [status, setStatus] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<CompletedScan | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [errorMeta, setErrorMeta] = useState<ScanErrorMeta>({});
  const runRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === 'scanning' || status === 'done') {
      setTimeout(() => runRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    }
  }, [status]);

  function startScan() {
    const value = url.trim();
    if (!value || !isValidUrl(value)) {
      setErrorMsg('Enter a valid URL, for example example.com');
      setErrorMeta({});
      setStatus('error');
      return;
    }
    setErrorMsg('');
    setErrorMeta({});
    setResult(null);
    setTarget(value);
    setStatus('scanning');
  }

  function handleResult(completed: CompletedScan) {
    setResult(completed);
    setStatus('done');
    if (completed.claimToken && completed.scanId) {
      holdClaim({ scanId: completed.scanId, claimToken: completed.claimToken });
    }
    refreshUser();
  }

  function reset() {
    setStatus('idle');
    setResult(null);
    setErrorMsg('');
    setErrorMeta({});
    setUrl('');
    setTarget('');
  }

  const running = status === 'scanning' || status === 'done';

  return (
    <main style={{ background: 'var(--bg)' }}>
      {/* ── Hero ───────────────────────────────────────── */}
      <section className="px-6 pt-20 pb-24 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto grid lg:grid-cols-[1fr_1.05fr] gap-14 lg:gap-16 items-start">

          <div className="min-w-0">
            <div
              className="inline-flex items-center gap-2.5 px-3 py-1.5 mb-9 border font-mono text-xs"
              style={{ borderColor: 'var(--border-2)', borderRadius: 999, color: 'var(--muted)' }}
            >
              <span className="w-1.5 h-1.5 rounded-full animate-pulse-glow" style={{ background: 'var(--accent)' }} />
              verified-domain attack simulation
            </div>

            <h1 className="display text-white text-[clamp(2.75rem,6.5vw,4.25rem)] mb-7 max-w-[13ch]">
              Find what a hacker would find, first.
            </h1>

            <p className="text-lg leading-relaxed mb-10 max-w-xl" style={{ color: 'var(--muted)' }}>
              Ironclad runs live SQL injection, XSS, SSRF and {DEEP_ONLY - 3} other attack
              checks against a domain you have verified, then hands you the exact request
              that broke it.
            </p>

            {user?.plan === 'free' && user.scansRemaining !== null && (
              <p className="font-mono text-xs mb-4" style={{ color: 'var(--faint)' }}>
                <span className="text-white/70">{user.scansRemaining}</span> of {FREE_LIFETIME_LIMIT} free scans left
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-3 max-w-xl">
              <div
                className="flex-1 flex items-center border px-4 focus-within:border-[var(--accent)] transition-colors"
                style={{ borderColor: 'var(--border-2)', background: 'var(--surface)', borderRadius: 4 }}
              >
                <span className="font-mono text-sm shrink-0" style={{ color: 'var(--ghost)' }}>https://</span>
                <input
                  id="scan-url"
                  type="text"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label="Domain to scan"
                  aria-describedby={status === 'error' ? 'scan-error' : 'scan-terms'}
                  aria-invalid={status === 'error'}
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && startScan()}
                  className="flex-1 bg-transparent py-3.5 px-1 font-mono text-sm text-white outline-none focus-visible:outline-none min-w-0"
                />
              </div>
              <button
                type="button"
                onClick={startScan}
                disabled={status === 'scanning'}
                className="px-7 py-3.5 text-sm font-semibold text-white shrink-0 transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'var(--accent)', borderRadius: 4 }}
              >
                {status === 'scanning' ? 'Scanning…' : `Run ${SURFACE} safe checks`}
              </button>
            </div>

            {status === 'error' && (
              <p id="scan-error" role="alert" className="mt-4 text-sm" style={{ color: 'var(--crit)' }}>
                {errorMsg}{' '}
                {errorMeta.signupRequired && (
                  <Link href="/signup" className="underline underline-offset-4" style={{ color: 'var(--accent)' }}>
                    Create a free account
                  </Link>
                )}
                {errorMeta.upgradeRequired && (
                  <Link href="/pricing" className="underline underline-offset-4" style={{ color: 'var(--accent)' }}>
                    See Pro
                  </Link>
                )}
              </p>
            )}

            <p id="scan-terms" className="mt-5 font-mono text-xs leading-relaxed" style={{ color: 'var(--ghost)' }}>
              no account · usually under 45 seconds · active checks require current domain control
            </p>
          </div>

          {/* Example report */}
          <div
            className="border min-w-0"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}
            aria-label="Example scan report"
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--ok)' }} />
              <span className="font-mono text-sm text-white truncate">acme-store.example</span>
              <span className="font-mono text-xs shrink-0" style={{ color: 'var(--faint)' }}>verified</span>
              <span className="ml-auto label shrink-0">example</span>
            </div>

            <div style={{ height: 2, background: 'var(--accent)' }} />

            <div className="grid grid-cols-4 border-b" style={{ borderColor: 'var(--border)' }}>
              {[
                { k: 'critical', v: '2' },
                { k: 'high',     v: '2' },
                { k: 'medium',   v: '5' },
                { k: 'checks',   v: String(TOTAL) },
              ].map((cell, i) => (
                <div
                  key={cell.k}
                  className="px-4 py-4"
                  style={{ borderRight: i < 3 ? '1px solid var(--border)' : undefined }}
                >
                  <p className="label mb-1.5">{cell.k}</p>
                  <p className="font-mono text-lg text-white">{cell.v}</p>
                </div>
              ))}
            </div>

            <ul>
              {EXAMPLE_FINDINGS.map((f, i) => (
                <li
                  key={f.title}
                  className="flex items-start gap-3.5 px-5 py-4"
                  style={{ borderBottom: i < EXAMPLE_FINDINGS.length - 1 ? '1px solid var(--border)' : undefined }}
                >
                  <span className="chip shrink-0 mt-0.5" style={{ color: f.color }}>{f.sev}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white/90 leading-snug">{f.title}</p>
                    <p className="font-mono text-xs mt-1.5 truncate" style={{ color: 'var(--faint)' }}>{f.meta}</p>
                  </div>
                </li>
              ))}
            </ul>

            <p className="px-5 py-4 font-mono text-xs border-t" style={{ color: 'var(--ghost)', borderColor: 'var(--border)' }}>
              + 7 more findings
            </p>
          </div>
        </div>
      </section>

      {/* ── Live run ───────────────────────────────────── */}
      {running && (
        <section ref={runRef} className="px-6 py-16 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="max-w-6xl mx-auto">
            {status === 'scanning' && (
              <ScanRunner
                endpoint="/api/scan"
                label={target}
                body={{ url: target }}
                onResult={handleResult}
                onError={(message, meta) => { setErrorMsg(message); setErrorMeta(meta); setStatus('error'); }}
              />
            )}
            {status === 'done' && result && (
              <>
                {result.notSaved && (
                  <p
                    className="max-w-4xl mx-auto mb-5 px-4 py-3 font-mono text-xs border"
                    style={{ color: 'var(--high)', borderColor: 'rgba(245,158,11,0.25)', borderRadius: 4 }}
                  >
                    {result.notSaved}
                  </p>
                )}
                <ScanReport result={result} onReset={reset} />
              </>
            )}
          </div>
        </section>
      )}

      {/* ── 01 How it works ────────────────────────────── */}
      <section className="px-6 py-24 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto">
          <p className="eyebrow mb-6">01 / how it works</p>
          <h2 className="display text-white text-[clamp(2rem,4.5vw,3rem)] mb-14 max-w-2xl">
            Three steps between you<br />and a real attack report.
          </h2>

          <div className="grid md:grid-cols-3 grid-hairline">
            {STEPS.map(step => (
              <div key={step.n} className="p-7">
                <p className="label mb-5">step {step.n}</p>
                <h3 className="text-lg font-semibold text-white mb-3">{step.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 02 Coverage ────────────────────────────────── */}
      <section className="px-6 py-24 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto grid lg:grid-cols-[0.85fr_1.15fr] gap-14 items-start">
          <div>
            <p className="eyebrow mb-6">02 / attack coverage</p>
            <h2 className="display text-white text-[clamp(2rem,4.5vw,3rem)] mb-6">
              Not a header<br />checklist.
            </h2>
            <p className="text-base leading-relaxed mb-9" style={{ color: 'var(--muted)' }}>
              Plenty of scanners read your response headers and infer the rest. Ironclad sends the
              payload, watches what comes back, and reports only what it managed to observe.
            </p>
            <dl className="font-mono text-sm space-y-2.5">
              <div className="flex gap-3">
                <dt style={{ color: 'var(--faint)' }}>{String(TOTAL).padStart(2, '0')}</dt>
                <dd style={{ color: 'var(--muted)' }}>checks in total</dd>
              </div>
              <div className="flex gap-3">
                <dt style={{ color: 'var(--faint)' }}>{String(SURFACE).padStart(2, '0')}</dt>
                <dd style={{ color: 'var(--muted)' }}>run on any URL, free</dd>
              </div>
              <div className="flex gap-3">
                <dt style={{ color: 'var(--faint)' }}>{String(DEEP_ONLY).padStart(2, '0')}</dt>
                <dd style={{ color: 'var(--muted)' }}>need domain proof</dd>
              </div>
              <div className="flex gap-3">
                <dt style={{ color: 'var(--faint)' }}>00</dt>
                <dd style={{ color: 'var(--muted)' }}>findings without evidence</dd>
              </div>
            </dl>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 grid-hairline">
            {COVERAGE.map(check => (
              <div key={check.name} className="px-4 py-3.5 flex items-center gap-2.5 min-w-0">
                <span
                  className="w-1 h-1 rounded-full shrink-0"
                  style={{ background: check.lane === 'deep' ? 'var(--accent)' : 'var(--ghost)' }}
                  aria-hidden="true"
                />
                <span className="font-mono text-[13px] truncate" style={{ color: 'var(--muted)' }}>
                  {check.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="max-w-6xl mx-auto mt-6 flex items-center gap-6 font-mono text-xs" style={{ color: 'var(--ghost)' }}>
          <span className="flex items-center gap-2">
            <span className="w-1 h-1 rounded-full" style={{ background: 'var(--ghost)' }} /> open to any URL
          </span>
          <span className="flex items-center gap-2">
            <span className="w-1 h-1 rounded-full" style={{ background: 'var(--accent)' }} /> verified domains only
          </span>
        </div>
      </section>

      {/* ── 03 Evidence ────────────────────────────────── */}
      <section className="px-6 py-24 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto">
          <p className="eyebrow mb-6">03 / evidence</p>
          <h2 className="display text-white text-[clamp(2rem,4.5vw,3rem)] mb-14 max-w-2xl">
            Every finding comes<br />with the receipt.
          </h2>

          <div className="border" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
            <div className="flex flex-wrap items-center gap-4 px-6 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
              <span className="chip" style={{ color: 'var(--crit)' }}>critical</span>
              <h3 className="text-base font-semibold text-white">Environment file publicly readable</h3>
              <span className="ml-auto font-mono text-xs" style={{ color: 'var(--ghost)' }}>
                exposed-files · surface lane
              </span>
            </div>

            <div className="grid md:grid-cols-2">
              <div className="p-6 border-b md:border-b-0 md:border-r" style={{ borderColor: 'var(--border)' }}>
                <p className="label mb-4">request sent</p>
                <pre className="font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-all" style={{ color: 'var(--muted)' }}>
{`GET /.env HTTP/1.1
Host: acme-store.example
User-Agent: `}<span style={{ color: 'var(--accent)' }}>Ironclad-Surface/2.0</span>
                </pre>
              </div>

              <div className="p-6">
                <p className="label mb-4">response observed</p>
                <pre className="font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-all" style={{ color: 'var(--muted)' }}>
{`HTTP/1.1 `}<span style={{ color: 'var(--crit)' }}>200 OK</span>{`
Content-Type: text/plain

`}<span style={{ color: 'var(--ok)' }}>→ 6 assignments, one a non-placeholder secret</span>
                </pre>
              </div>
            </div>

            <div className="grid md:grid-cols-2 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="p-6 border-b md:border-b-0 md:border-r" style={{ borderColor: 'var(--border)' }}>
                <p className="label mb-4">reproduce</p>
                <pre
                  className="font-mono text-[13px] p-3.5 overflow-x-auto"
                  style={{ background: 'var(--bg)', color: 'var(--muted)', borderRadius: 4 }}
                >curl -i https://acme-store.example/.env</pre>
              </div>
              <div className="p-6">
                <p className="label mb-4">fix</p>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
                  Block <span className="font-mono text-white/75">.env*</span> at the server or CDN, then rotate
                  every credential the file contained. Treat them as compromised: you cannot know who read it
                  before you did.
                </p>
              </div>
            </div>
          </div>

          <p className="mt-6 font-mono text-xs" style={{ color: 'var(--ghost)' }}>
            Redacted for anonymous scans. Evidence and remediation are withheld until you create an account.
          </p>
        </div>
      </section>

      {/* ── Boundaries ─────────────────────────────────── */}
      <section className="px-6 py-20 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto">
          <p className="font-mono text-sm mb-8" style={{ color: 'var(--muted)' }}>
            What Ironclad does not claim
          </p>
          <div className="grid md:grid-cols-3 grid-hairline">
            {[
              ['Not a penetration test', 'Automated, bounded probes from outside, at one moment in time. No source review, no business logic, no chained exploitation.'],
              ['A clean result is not a clearance', `It means these ${TOTAL} checks observed nothing. It is evidence of absence only for what was actually tested.`],
              ['Blocked is not passed', 'If your firewall stops a check, the report says so and withholds the grade rather than quietly scoring it as fine.'],
            ].map(([title, body]) => (
              <div key={title} className="p-7">
                <h3 className="text-sm font-semibold text-white mb-2.5">{title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 04 Pricing ─────────────────────────────────── */}
      <section className="px-6 py-24 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto">
          <p className="eyebrow mb-6">04 / pricing</p>
          <h2 className="display text-white text-[clamp(2rem,4.5vw,3rem)] mb-14">
            Start free. Keep going for £4.99.
          </h2>

          <div className="grid md:grid-cols-2 gap-5 max-w-4xl">
            <div className="border p-8" style={{ borderColor: 'var(--border)', borderRadius: 6 }}>
              <p className="label mb-6">free</p>
              <p className="display text-white text-5xl mb-3">£0</p>
              <p className="text-sm mb-8" style={{ color: 'var(--muted)' }}>
                Enough to find out whether you have a real problem.
              </p>
              <ul className="space-y-3 mb-9">
                {[
                  `${FREE_LIFETIME_LIMIT} scans total`,
                  `All ${TOTAL} checks on a domain you verify`,
                  'Full evidence on every finding',
                  `${SURFACE} checks on any URL, no account`,
                ].map(item => (
                  <li key={item} className="text-sm flex gap-3" style={{ color: 'var(--muted)' }}>
                    <span style={{ color: 'var(--ghost)' }}>·</span>{item}
                  </li>
                ))}
              </ul>
              <Link href="/signup" className="font-mono text-sm hover:opacity-70 transition-opacity" style={{ color: 'var(--accent)' }}>
                run a free scan →
              </Link>
            </div>

            <div
              className="border p-8"
              style={{ borderColor: 'var(--accent-line)', background: 'rgba(59,130,246,0.03)', borderRadius: 6 }}
            >
              <div className="flex items-center justify-between mb-6">
                <p className="label" style={{ color: 'var(--accent)' }}>pro</p>
                <span className="chip" style={{ color: 'var(--accent)' }}>most picked</span>
              </div>
              <p className="display text-white text-5xl mb-3">
                £4.99<span className="font-mono text-sm font-normal ml-2" style={{ color: 'var(--faint)' }}>/ month</span>
              </p>
              <p className="text-sm mb-8" style={{ color: 'var(--muted)' }}>Scan as often as you ship.</p>
              <ul className="space-y-3 mb-9">
                {[
                  'Unlimited scans, fair-use burst limits',
                  `All ${TOTAL} checks on every domain you verify`,
                  'Scan history with a fixed-since-last-time diff',
                  'Everything in Free',
                ].map(item => (
                  <li key={item} className="text-sm flex gap-3" style={{ color: 'var(--muted)' }}>
                    <span style={{ color: 'var(--accent)' }}>·</span>{item}
                  </li>
                ))}
              </ul>
              <Link
                href="/pricing"
                className="block text-center py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: 'var(--accent)', borderRadius: 4 }}
              >
                Go Pro
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────── */}
      <section className="px-6 py-24 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto">
          <p className="eyebrow mb-12">05 / questions</p>
          <dl className="space-y-9 max-w-3xl">
            {FAQ.map(item => (
              <div key={item.q}>
                <dt className="text-base font-semibold text-white mb-2.5">{item.q}</dt>
                <dd className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────── */}
      <footer className="px-6 py-10 print:hidden">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-5 justify-between">
          <p className="font-mono text-xs" style={{ color: 'var(--ghost)' }}>
            IRONCLAD · scan only what you own or are permitted to test
          </p>
          <div className="flex items-center gap-6 font-mono text-xs flex-wrap">
            {[
              ['/what-we-check', 'coverage'],
              ['/scanner', 'scanner'],
              ['/pricing', 'pricing'],
              ['/privacy', 'privacy'],
            ].map(([href, label]) => (
              <Link key={href} href={href} className="hover:text-white transition-colors" style={{ color: 'var(--faint)' }}>
                {label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </main>
  );
}

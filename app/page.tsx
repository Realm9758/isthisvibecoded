'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ScanRunner, type CompletedScan, type ScanErrorMeta } from '@/components/ScanRunner';
import { ScanReport } from '@/components/ScanReport';
import { Confetti } from '@/components/Confetti';
import { useAuth } from '@/contexts/AuthContext';
import { SURFACE_PHASE_IDS, DEEP_ONLY_PHASE_IDS } from '@/lib/scan-lanes';
import { FREE_LIFETIME_LIMIT } from '@/lib/scan-quota';
import { holdClaim } from '@/lib/claim-scan';

const SURFACE_CHECKS = [
  'Secrets in your HTML',
  'Exposed .env and .git',
  'Security headers',
  'Cookie flags',
  'HTTPS and HSTS',
  'CORS policy',
  'Source maps',
  'Vulnerable libraries',
  'Directory listing',
  'GraphQL introspection',
  'Public API schemas',
  'Server version leaks',
  'Subresource integrity',
  'robots.txt disclosure',
  'HTTP methods',
];

const DEEP_CHECKS = [
  'SQL injection',
  'Cross-site scripting',
  'NoSQL injection',
  'Path traversal',
  'Server-side request forgery',
  'CRLF injection',
  'Host header injection',
  'Open redirect',
  'Error verbosity',
  'Admin panel discovery',
  'Forced browsing',
  'Insecure direct object reference',
  'Auth rate limiting',
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
  const [confetti, setConfetti] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === 'done') {
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
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

    // An anonymous scan is held so signing up unlocks this exact report
    // rather than spending one of the three free scans re-running it.
    if (completed.claimToken && completed.scanId) {
      holdClaim({ scanId: completed.scanId, claimToken: completed.claimToken });
    }

    if (completed.findings.length === 0 && completed.summary.score !== null) {
      setConfetti(true);
      setTimeout(() => setConfetti(false), 4000);
    }
    refreshUser();
  }

  function handleError(message: string, meta: ScanErrorMeta) {
    setErrorMsg(message);
    setErrorMeta(meta);
    setStatus('error');
  }

  function reset() {
    setStatus('idle');
    setResult(null);
    setErrorMsg('');
    setErrorMeta({});
    setUrl('');
    setTarget('');
  }

  const showIdle = status === 'idle' || status === 'error';

  return (
    <>
      <Confetti active={confetti} />

      <main className="min-h-screen" style={{ background: '#0a0a0f' }}>
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(139,92,246,0.12) 0%, transparent 70%), radial-gradient(ellipse 60% 40% at 80% 80%, rgba(6,182,212,0.06) 0%, transparent 60%)',
          }}
        />

        <div className="relative z-10">
          <section className="px-6 pt-20 pb-12 text-center">
            <div className="max-w-2xl mx-auto">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-violet-500/20 bg-violet-500/5 text-violet-400 text-xs font-medium mb-8">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse-glow" />
                {SURFACE_PHASE_IDS.length} checks on any site, no account
              </div>

              <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4 leading-tight">
                Is your site{' '}
                <span style={{
                  background: 'linear-gradient(135deg, #a78bfa 0%, #818cf8 50%, #38bdf8 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>
                  ironclad?
                </span>
              </h1>

              <p className="text-white/50 text-lg mb-10 max-w-lg mx-auto">
                Point Ironclad at any URL. It finds leaked keys, exposed config files, missing headers,
                and the other things that ship when nobody was looking.
              </p>

              {user && user.plan === 'free' && user.scansRemaining !== null && (
                <div className="mb-6 inline-flex items-center gap-3 px-4 py-2 rounded-xl border border-white/8 bg-white/3 text-xs">
                  <span className="text-white/40">
                    <span className="text-white/70 font-semibold">{user.scansRemaining}</span> free scan
                    {user.scansRemaining !== 1 ? 's' : ''} left
                  </span>
                  <Link href="/pricing" className="text-violet-400 hover:text-violet-300 transition-colors font-medium">
                    Upgrade
                  </Link>
                </div>
              )}

              <div className="max-w-xl mx-auto">
                <div className="flex gap-2 p-1.5 rounded-xl border border-white/8 bg-white/3 backdrop-blur-sm focus-within:border-violet-500/40 transition-colors">
                  <input
                    id="scan-url"
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label="Website URL to scan"
                    aria-describedby={status === 'error' ? 'scan-error' : 'scan-authorised-use'}
                    aria-invalid={status === 'error'}
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && startScan()}
                    placeholder="example.com"
                    className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white placeholder-white/25 outline-none min-w-0"
                  />
                  <button
                    type="button"
                    onClick={startScan}
                    disabled={status === 'scanning'}
                    className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    style={{
                      background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                      boxShadow: '0 0 20px rgba(124,58,237,0.3)',
                    }}
                  >
                    {status === 'scanning' ? 'Scanning…' : 'Scan'}
                  </button>
                </div>

                {status === 'error' && (
                  <div className="mt-3 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <p id="scan-error" role="alert" className="text-sm text-red-400 text-left px-1">{errorMsg}</p>
                    {errorMeta.signupRequired && (
                      <Link href="/signup" className="text-xs font-semibold text-violet-400 shrink-0 hover:text-violet-300 transition-colors">
                        Create a free account
                      </Link>
                    )}
                    {errorMeta.upgradeRequired && (
                      <Link href="/pricing" className="text-xs font-semibold text-violet-400 shrink-0 hover:text-violet-300 transition-colors">
                        See Pro
                      </Link>
                    )}
                  </div>
                )}
              </div>

              <p id="scan-authorised-use" className="mt-4 text-[11px] text-white/25 text-center max-w-lg mx-auto leading-relaxed">
                Surface checks are read-only public requests, the same kind any browser makes, so they run
                on any URL. The {DEEP_ONLY_PHASE_IDS.length} deeper checks send test payloads and run only on
                domains you have verified.{' '}
                <Link href="/scanner" className="underline underline-offset-2 hover:text-white/50 transition-colors">
                  About the scanner
                </Link>
              </p>
            </div>
          </section>

          {status === 'scanning' && (
            <section className="px-6 pb-16 max-w-3xl mx-auto">
              <ScanRunner
                endpoint="/api/scan"
                label={target}
                body={{ url: target }}
                onResult={handleResult}
                onError={handleError}
              />
            </section>
          )}

          {status === 'done' && result && (
            <section ref={resultsRef} className="px-6 pb-20">
              {result.notSaved && (
                <p className="max-w-4xl mx-auto mb-4 text-xs text-amber-300/70 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                  {result.notSaved}
                </p>
              )}
              <ScanReport result={result} onReset={reset} />
            </section>
          )}

          {showIdle && (
            <>
              {/* The two lanes */}
              <section className="px-6 pb-20 max-w-5xl mx-auto">
                <div className="border-t border-white/5 pt-16">
                  <h2 className="text-2xl font-bold text-white/80 mb-2 text-center">What gets checked</h2>
                  <p className="text-white/40 text-center text-sm mb-12 max-w-lg mx-auto">
                    We limit checks by permission, not by payment. Sending an attack payload at a server you
                    do not control is not something money should be able to buy.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="p-6 rounded-2xl border border-emerald-500/15" style={{ background: 'rgba(34,197,94,0.03)' }}>
                      <div className="flex items-baseline gap-2 mb-1">
                        <h3 className="font-semibold text-white/85">{SURFACE_PHASE_IDS.length} surface checks</h3>
                        <span className="text-[10px] uppercase tracking-widest text-emerald-400/70">Any site</span>
                      </div>
                      <p className="text-xs text-white/35 mb-4 leading-relaxed">
                        Read-only requests. No payloads, no brute force, nothing a search crawler does not
                        already do.
                      </p>
                      <ul className="space-y-1">
                        {SURFACE_CHECKS.map(check => (
                          <li key={check} className="text-xs text-white/50 flex gap-2">
                            <span className="text-emerald-400/50 shrink-0">✓</span>{check}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="p-6 rounded-2xl border border-red-500/15" style={{ background: 'rgba(239,68,68,0.03)' }}>
                      <div className="flex items-baseline gap-2 mb-1">
                        <h3 className="font-semibold text-white/85">{DEEP_ONLY_PHASE_IDS.length} deep checks</h3>
                        <span className="text-[10px] uppercase tracking-widest text-red-400/70">Verified domains</span>
                      </div>
                      <p className="text-xs text-white/35 mb-4 leading-relaxed">
                        These send real test payloads. Prove you control the domain and they unlock, on the
                        free plan too.
                      </p>
                      <ul className="space-y-1">
                        {DEEP_CHECKS.map(check => (
                          <li key={check} className="text-xs text-white/50 flex gap-2">
                            <span className="text-red-400/50 shrink-0">›</span>{check}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </section>

              {/* Pricing strip */}
              <section className="px-6 pb-24 max-w-3xl mx-auto text-center">
                <div className="border-t border-white/5 pt-16">
                  <h2 className="text-2xl font-bold text-white/80 mb-3">
                    {FREE_LIFETIME_LIMIT} free scans, then £4.99 a month
                  </h2>
                  <p className="text-white/40 text-sm mb-8 max-w-md mx-auto leading-relaxed">
                    The free scans are the whole product, deep checks included. Nobody should subscribe to
                    something they have not watched work.
                  </p>
                  <div className="flex gap-3 justify-center flex-wrap">
                    <Link
                      href="/signup"
                      className="px-6 py-3 rounded-xl text-sm font-semibold text-white transition-all"
                      style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
                    >
                      Create a free account
                    </Link>
                    <Link
                      href="/pricing"
                      className="px-6 py-3 rounded-xl text-sm text-white/50 border border-white/8 hover:bg-white/5 transition-colors"
                    >
                      Compare plans
                    </Link>
                  </div>
                </div>
              </section>
            </>
          )}

          <footer className="border-t border-white/5 px-6 py-6 print:hidden">
            <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-white/20">Ironclad</p>
              <div className="flex items-center gap-4 flex-wrap justify-center">
                <Link href="/privacy" className="text-xs text-white/20 hover:text-white/50 transition-colors">Privacy</Link>
                <Link href="/pricing" className="text-xs text-white/20 hover:text-white/50 transition-colors">Pricing</Link>
                <Link href="/scanner" className="text-xs text-white/20 hover:text-white/50 transition-colors">Scanner</Link>
                <p className="text-xs text-white/15">Scan only sites you own or have permission to test.</p>
              </div>
            </div>
          </footer>
        </div>
      </main>
    </>
  );
}

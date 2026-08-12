'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { OwnershipVerify } from '@/components/OwnershipVerify';
import { ScanRunner, type CompletedScan, type ScanErrorMeta } from '@/components/ScanRunner';
import { ScanReport } from '@/components/ScanReport';
import { TOOLS, buildFixPrompt, type AiTool } from '@/lib/fix-prompt';
import { DEEP_SCAN_TERMS_VERSION } from '@/lib/policy';
import { LANE_CHECK_COUNTS, DEEP_ONLY_PHASE_IDS, type ScanLane } from '@/lib/scan-lanes';
import { FREE_LIFETIME_LIMIT } from '@/lib/scan-quota';
import type { DeepScanResult } from '@/types/deep-scan';
import { apiPath } from '@/lib/site';

interface ScanSummary {
  id: string;
  domain: string;
  lane: ScanLane;
  createdAt: number;
  score: number | null;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  coverageComplete: boolean;
}

type Step = 'idle' | 'enter-url' | 'verify' | 'confirmed' | 'scanning' | 'results';

function timeAgo(ms: number) {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function gradeFor(score: number) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 50) return 'C';
  if (score >= 25) return 'D';
  return 'F';
}

function gradeColour(score: number) {
  if (score >= 90) return 'var(--ok)';
  if (score >= 75) return '#84cc16';
  if (score >= 50) return 'var(--med)';
  if (score >= 25) return 'var(--high)';
  return 'var(--crit)';
}

// ── Signed out ─────────────────────────────────────────────────────────

function AuthGate({ returnTo }: { returnTo: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-6" style={{ background: 'var(--bg)' }}>
      <div className="max-w-md text-center">
        <p className="eyebrow mb-6">dashboard</p>
        <h1 className="display text-white text-3xl mb-4">Sign in to run a deep scan</h1>
        <p className="text-sm leading-relaxed mb-8" style={{ color: 'var(--muted)' }}>
          The {DEEP_ONLY_PHASE_IDS.length} active modules may send payloads when a suitable target is found.
          They run only against a domain whose control you have proved, so they need an account tied to that proof.
        </p>
        <div className="flex gap-3 justify-center">
          <Link
            href={`/signup?returnTo=${encodeURIComponent(returnTo)}`}
            className="px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent)', borderRadius: 4 }}
          >
            Create a free account
          </Link>
          <Link
            href={`/login?returnTo=${encodeURIComponent(returnTo)}`}
            className="px-6 py-3 font-mono text-sm border transition-colors hover:bg-white/4"
            style={{ borderColor: 'var(--border-2)', color: 'var(--muted)', borderRadius: 4 }}
          >
            sign in
          </Link>
        </div>
      </div>
    </main>
  );
}

// ── Paste-into-your-tool prompt ────────────────────────────────────────

function FixPrompt({ result }: { result: DeepScanResult }) {
  const detectedTool = (() => {
    const builder = result.provenance?.builder?.toLowerCase() ?? '';
    return TOOLS.find(entry => builder.includes(entry.id))?.id ?? 'cursor';
  })();
  const [tool, setTool] = useState<AiTool>(detectedTool);
  const [copied, setCopied] = useState(false);
  const prompt = buildFixPrompt(tool, result);
  const actionable = result.summary.critical + result.summary.high + result.summary.medium;

  function copy() {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (actionable === 0) return null;

  return (
    <section className="border" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
      <div className="px-5 py-3.5 border-b" style={{ borderColor: 'var(--border)' }}>
        <p className="label">fix it with the tool that built it</p>
      </div>

      <div className="p-5 space-y-4">
        <div className="flex flex-wrap gap-2">
          {TOOLS.map(entry => (
            <button
              key={entry.id}
              onClick={() => setTool(entry.id)}
              className="px-3 py-1.5 font-mono text-xs border transition-colors"
              style={{
                borderRadius: 3,
                borderColor: tool === entry.id ? 'var(--accent-line)' : 'var(--border-2)',
                background: tool === entry.id ? 'var(--accent-dim)' : 'transparent',
                color: tool === entry.id ? 'var(--accent)' : 'var(--faint)',
              }}
            >
              {entry.name}
            </button>
          ))}
        </div>

        <pre
          className="font-mono text-xs p-4 max-h-64 overflow-y-auto whitespace-pre-wrap break-words"
          style={{ background: 'var(--bg)', color: 'var(--muted)', borderRadius: 4 }}
        >{prompt}</pre>

        <button
          onClick={copy}
          className="px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'var(--accent)', borderRadius: 4 }}
        >
          {copied ? 'Copied' : 'Copy prompt'}
        </button>
      </div>
    </section>
  );
}

// ── Deep scan flow ─────────────────────────────────────────────────────

function DeepScanPanel({
  onComplete,
  initialDomain,
  initialIntent,
  verificationNotice,
}: {
  onComplete: () => void;
  initialDomain: string;
  initialIntent: string;
  verificationNotice: string;
}) {
  const [step, setStep] = useState<Step>('idle');
  const [inputUrl, setInputUrl] = useState('');
  const [scanDomain, setScanDomain] = useState('');
  const [scanTarget, setScanTarget] = useState('');
  const [urlError, setUrlError] = useState('');
  const [scanError, setScanError] = useState('');
  const [errorMeta, setErrorMeta] = useState<ScanErrorMeta>({});
  const [result, setResult] = useState<CompletedScan | null>(null);
  const [authorised, setAuthorised] = useState(false);

  useEffect(() => {
    if (!initialDomain) return;
    const timer = window.setTimeout(() => {
      setInputUrl(initialDomain);
      setScanDomain(initialDomain);
      setScanTarget(initialDomain);
      setStep(initialIntent === 'verified' ? 'confirmed' : 'verify');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialDomain, initialIntent]);

  function submitUrl(event: React.FormEvent) {
    event.preventDefault();
    setUrlError('');
    let host = '';
    let target = '';
    try {
      const parsed = new URL(inputUrl.startsWith('http') ? inputUrl : `https://${inputUrl}`);
      host = parsed.hostname;
      parsed.search = '';
      parsed.hash = '';
      target = parsed.href;
    } catch {
      setUrlError('Enter a valid domain, for example example.com');
      return;
    }
    if (!host) { setUrlError('Enter a valid domain'); return; }
    setScanDomain(host);
    setScanTarget(target);
    setAuthorised(false);
    setStep('verify');
  }

  function reset() {
    setStep('idle');
    setInputUrl('');
    setScanDomain('');
    setScanTarget('');
    setScanError('');
    setErrorMeta({});
    setResult(null);
    setAuthorised(false);
  }

  return (
    <section className="border" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h2 className="text-sm font-semibold text-white">Deep scan</h2>
          <p className="font-mono text-xs mt-1" style={{ color: 'var(--faint)' }}>
            {LANE_CHECK_COUNTS.deep} assessment modules · verified domains only
          </p>
        </div>
        <Link href="/what-we-check" className="font-mono text-xs hover:text-white transition-colors shrink-0" style={{ color: 'var(--faint)' }}>
          what runs →
        </Link>
      </div>

      <div className="p-5">
        {step === 'idle' && (
          <div>
            <p className="text-sm leading-relaxed mb-6 max-w-xl" style={{ color: 'var(--muted)' }}>
              Maps the submitted page and its public inputs, then runs bounded injection, traversal, SSRF,
              access-control and header probes where a suitable target exists. Prove you control the domain
              and they run, on the free plan too.
            </p>
            <button
              onClick={() => setStep('enter-url')}
              className="px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: 'var(--accent)', borderRadius: 4 }}
            >
              New deep scan
            </button>
          </div>
        )}

        {step === 'enter-url' && (
          <form onSubmit={submitUrl} className="space-y-4 max-w-xl">
            <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              Only submit a site you are authorised to test.
            </p>
            <div>
              <label htmlFor="deep-domain" className="label block mb-2">your domain</label>
              <input
                id="deep-domain"
                type="text"
                value={inputUrl}
                onChange={e => setInputUrl(e.target.value)}
                placeholder="example.com"
                autoFocus
                className="w-full px-4 py-3 font-mono text-sm text-white outline-none"
                style={{ background: 'var(--bg)', border: '1px solid var(--border-2)', borderRadius: 4 }}
              />
              {urlError && <p className="text-xs mt-2" style={{ color: 'var(--crit)' }}>{urlError}</p>}
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                className="px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: 'var(--accent)', borderRadius: 4 }}
              >
                Continue
              </button>
              <button
                type="button"
                onClick={reset}
                className="px-5 py-3 font-mono text-sm border transition-colors hover:bg-white/4"
                style={{ borderColor: 'var(--border-2)', color: 'var(--faint)', borderRadius: 4 }}
              >
                cancel
              </button>
            </div>
          </form>
        )}

        {step === 'verify' && (
          <div className="space-y-4">
            {verificationNotice && (
              <p role="alert" className="border px-4 py-3 text-xs" style={{ borderColor: 'rgba(239,68,68,0.3)', color: 'var(--crit)', borderRadius: 4 }}>
                {verificationNotice}
              </p>
            )}
            <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              Prove current control of <span className="font-mono text-white/80">{scanDomain}</span> through
              its hosting account or a token you publish before any active test runs. This is a technical gate,
              not a legal determination: you remain responsible for having permission to test the target.
            </p>
            <OwnershipVerify domain={scanDomain} onVerified={() => setStep('confirmed')} />
            <button
              onClick={reset}
              className="font-mono text-xs transition-colors hover:text-white"
              style={{ color: 'var(--ghost)' }}
            >
              cancel
            </button>
          </div>
        )}

        {step === 'confirmed' && (
          <div className="space-y-4 max-w-xl">
            <p className="font-mono text-sm" style={{ color: 'var(--ok)' }}>
              domain control verified for {scanDomain}
            </p>

            {scanError && (
              <div className="border px-4 py-3" style={{ borderColor: 'rgba(239,68,68,0.3)', borderRadius: 4 }}>
                <p className="text-xs" style={{ color: 'var(--crit)' }}>{scanError}</p>
                {errorMeta.upgradeRequired && (
                  <Link href="/pricing" className="text-xs underline underline-offset-2 mt-1 inline-block" style={{ color: 'var(--accent)' }}>
                    See Pro
                  </Link>
                )}
              </div>
            )}

            <label
              className="flex items-start gap-3 border p-4 cursor-pointer"
              style={{ borderColor: 'var(--border-2)', borderRadius: 4 }}
            >
              <input
                type="checkbox"
                checked={authorised}
                onChange={e => setAuthorised(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0"
                style={{ accentColor: 'var(--accent)' }}
              />
              <span className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                I confirm I am authorised to test <span className="font-mono text-white/80">{scanDomain}</span> and
                its publicly configured Supabase, Firebase, or storage projects, and to run the bounded active requests described in the{' '}
                <Link href="/what-we-check" className="underline underline-offset-2" style={{ color: 'var(--accent)' }}>
                  active-check inventory
                </Link>
                . This confirmation is recorded with the result.
                <span className="block mt-1.5 font-mono text-[10px]" style={{ color: 'var(--ghost)' }}>
                  terms {DEEP_SCAN_TERMS_VERSION}
                </span>
              </span>
            </label>

            <div className="flex gap-3">
              <button
                onClick={() => { setScanError(''); setStep('scanning'); }}
                disabled={!authorised}
                className="px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-35 disabled:cursor-not-allowed"
                style={{ background: 'var(--accent)', borderRadius: 4 }}
              >
                Start {LANE_CHECK_COUNTS.deep}-check deep scan
              </button>
              <button
                onClick={reset}
                className="px-5 py-3 font-mono text-sm border transition-colors hover:bg-white/4"
                style={{ borderColor: 'var(--border-2)', color: 'var(--faint)', borderRadius: 4 }}
              >
                cancel
              </button>
            </div>
          </div>
        )}

        {step === 'scanning' && (
          <ScanRunner
            endpoint="/api/deep-scan"
            label={scanTarget || scanDomain}
            body={{ domain: scanTarget || scanDomain, authorizationAccepted: authorised, termsVersion: DEEP_SCAN_TERMS_VERSION }}
            onResult={completed => { setResult(completed); setStep('results'); onComplete(); }}
            onError={(message, meta) => {
              setAuthorised(false);
              setScanError(message);
              setErrorMeta(meta);
              setStep('confirmed');
            }}
          />
        )}

        {step === 'results' && result && (
          <ScanReport
            result={result}
            onReset={reset}
            afterSummary={<FixPrompt result={result} />}
          />
        )}
      </div>
    </section>
  );
}

// ── History ────────────────────────────────────────────────────────────

function HistoryRow({ scan, last }: { scan: ScanSummary; last: boolean }) {
  return (
    <Link
      href={`/result/${scan.id}`}
      className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white/3"
      style={{ borderBottom: last ? undefined : '1px solid var(--border)' }}
    >
      <span
        className="font-mono text-sm w-6 shrink-0"
        style={{ color: scan.score === null ? 'var(--ghost)' : gradeColour(scan.score) }}
      >
        {scan.score === null ? '?' : gradeFor(scan.score)}
      </span>
      <span className="font-mono text-sm text-white/80 truncate flex-1 min-w-0">{scan.domain}</span>
      <span className="font-mono text-[11px] shrink-0 hidden sm:block" style={{ color: 'var(--ghost)' }}>
        {scan.lane}
      </span>
      <span className="flex items-center gap-2.5 shrink-0 font-mono text-xs">
        {scan.critical > 0 && <span style={{ color: 'var(--crit)' }}>{scan.critical}C</span>}
        {scan.high > 0 && <span style={{ color: 'var(--high)' }}>{scan.high}H</span>}
        {scan.medium > 0 && <span style={{ color: 'var(--med)' }}>{scan.medium}M</span>}
        {scan.critical + scan.high + scan.medium === 0 && (
          <span style={{ color: 'var(--ok)' }}>clean</span>
        )}
      </span>
      <span className="font-mono text-[11px] shrink-0 w-16 text-right" style={{ color: 'var(--ghost)' }}>
        {timeAgo(scan.createdAt)}
      </span>
    </Link>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [scansLoading, setScansLoading] = useState(true);
  const [entry, setEntry] = useState({ domain: '', intent: '', error: '', returnTo: '/dashboard' });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const domain = params.get('domain') ?? '';
      const intent = params.get('intent') ?? '';
      const error = params.get('verificationError') ?? '';
      setEntry({ domain, intent, error, returnTo: `/dashboard${window.location.search}` });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const loadScans = useCallback(() => {
    fetch(apiPath('/api/user/scans'))
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setScans(data); })
      .catch(() => undefined)
      .finally(() => setScansLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    loadScans();
  }, [user, loadScans]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <span className="font-mono text-sm" style={{ color: 'var(--ghost)' }}>loading…</span>
      </main>
    );
  }

  if (!user) return <AuthGate returnTo={entry.returnTo} />;

  return (
    <main className="min-h-screen px-6 py-12" style={{ background: 'var(--bg)' }}>
      <div className="max-w-4xl mx-auto space-y-6">

        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow mb-3">dashboard</p>
            <h1 className="display text-white text-3xl">{user.name}</h1>
            <p className="font-mono text-xs mt-2.5" style={{ color: 'var(--faint)' }}>
              {user.plan}
              {user.plan === 'free' && user.scansRemaining !== null && (
                <> · {user.scansRemaining} of {FREE_LIFETIME_LIMIT} scans left</>
              )}
            </p>
          </div>
          {user.plan === 'free' && (
            <Link
              href="/pricing"
              className="px-5 py-2.5 font-mono text-sm border transition-colors hover:bg-white/4"
              style={{ borderColor: 'var(--accent-line)', color: 'var(--accent)', borderRadius: 4 }}
            >
              upgrade to pro
            </Link>
          )}
        </header>

        <DeepScanPanel
          onComplete={loadScans}
          initialDomain={entry.domain}
          initialIntent={entry.intent}
          verificationNotice={entry.error}
        />

        <section className="border" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
          <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: 'var(--border)' }}>
            <p className="label">your scans</p>
            <span className="font-mono text-xs" style={{ color: 'var(--ghost)' }}>{scans.length}</span>
          </div>

          {scansLoading ? (
            <p className="px-5 py-8 font-mono text-sm text-center" style={{ color: 'var(--ghost)' }}>loading…</p>
          ) : scans.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>No scans yet.</p>
              <Link
                href="/"
                className="font-mono text-sm hover:opacity-70 transition-opacity"
                style={{ color: 'var(--accent)' }}
              >
                scan any URL free →
              </Link>
            </div>
          ) : (
            <div>
              {scans.map((scan, i) => (
                <HistoryRow key={scan.id} scan={scan} last={i === scans.length - 1} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

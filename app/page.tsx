'use client';

import { useState, useEffect, useRef } from 'react';
import type { AnalysisResult } from '@/types/analysis';
import { LoadingAnimation } from '@/components/LoadingAnimation';
import { ResultsDashboard } from '@/components/ResultsDashboard';
import { Confetti } from '@/components/Confetti';
import { useAuth } from '@/contexts/AuthContext';

const EXAMPLE_SITES = [
  { label: 'google.com',   url: 'https://google.com',   hint: 'Highly hand-crafted' },
  { label: 'vercel.com',   url: 'https://vercel.com',   hint: 'Polished SaaS' },
  { label: 'notion.so',    url: 'https://notion.so',    hint: 'Custom-built' },
  { label: 'supabase.com', url: 'https://supabase.com', hint: 'Modern stack' },
  { label: 'github.com',   url: 'https://github.com',   hint: 'Enterprise built' },
];

type FullResult = AnalysisResult & { scanId?: string; roasts?: string[]; scansRemaining?: number | null };

function isValidUrl(val: string) {
  try { new URL(val.startsWith('http') ? val : `https://${val}`); return true; }
  catch { return false; }
}

const SCAN_STEP_MS = 1400;

export default function Home() {
  const { user, refreshUser } = useAuth();
  const [url, setUrl]             = useState('');
  const [status, setStatus]       = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult]       = useState<FullResult | null>(null);
  const [errorMsg, setErrorMsg]   = useState('');
  const [loadStep, setLoadStep]   = useState(0);
  const [confetti, setConfetti]   = useState(false);
  const [roastMode, setRoastMode] = useState(false);
  const stepRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === 'loading') {
      setLoadStep(0);
      stepRef.current = setInterval(() => setLoadStep(s => s + 1), SCAN_STEP_MS);
    } else {
      if (stepRef.current) clearInterval(stepRef.current);
    }
    return () => { if (stepRef.current) clearInterval(stepRef.current); };
  }, [status]);

  useEffect(() => {
    if (status === 'done') {
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [status]);

  async function analyze(targetUrl?: string) {
    const target = (targetUrl ?? url).trim();
    if (!target || !isValidUrl(target)) {
      setErrorMsg('Please enter a valid URL — e.g. example.com');
      return;
    }
    setErrorMsg('');
    setStatus('loading');
    setResult(null);
    setConfetti(false);

    try {
      const res  = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
      });
      const data = await res.json();

      if (res.status === 429) {
        setErrorMsg(data.error ?? 'Daily scan limit reached.');
        setStatus('error');
        return;
      }
      if (!res.ok) throw new Error(data.error ?? 'Analysis failed');

      setResult(data as FullResult);
      setStatus('done');
      setConfetti(true);
      setTimeout(() => setConfetti(false), 4000);
      refreshUser(); // update scansRemaining in nav
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Something went wrong');
      setStatus('error');
    }
  }

  function reset() {
    setStatus('idle');
    setResult(null);
    setErrorMsg('');
    setUrl('');
    setConfetti(false);
  }

  const showIdle = status === 'idle' || status === 'error';

  return (
    <>
      <Confetti active={confetti} />

      <main className="min-h-screen" style={{ background: '#0a0a0f' }}>
        {/* Ambient glow */}
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(139,92,246,0.12) 0%, transparent 70%), radial-gradient(ellipse 60% 40% at 80% 80%, rgba(6,182,212,0.06) 0%, transparent 60%)',
          }}
        />

        <div className="relative z-10">
          {/* Hero */}
          <section className="px-6 pt-20 pb-12 text-center">
            <div className="max-w-2xl mx-auto">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-violet-500/20 bg-violet-500/5 text-violet-400 text-xs font-medium mb-8">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse-glow" />
                Passive security &amp; AI fingerprinting
              </div>

              <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4 leading-tight">
                Is This{' '}
                <span style={{
                  background: 'linear-gradient(135deg, #a78bfa 0%, #818cf8 50%, #38bdf8 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>
                  Vibe-Coded?
                </span>
              </h1>

              <p className="text-white/50 text-lg mb-10 max-w-lg mx-auto">
                Detect AI-generated patterns, security misconfigurations, exposed keys, and tech stack — instantly and passively.
              </p>

              {/* Scan limit strip for free logged-in users */}
              {user && user.plan === 'free' && user.scansRemaining !== null && (
                <div className="mb-6 inline-flex items-center gap-3 px-4 py-2 rounded-xl border border-white/8 bg-white/3 text-xs">
                  <span className="text-white/40">
                    <span className="text-white/70 font-semibold">{user.scansRemaining}</span> free scan{user.scansRemaining !== 1 ? 's' : ''} left today
                  </span>
                  <a href="/pricing" className="text-violet-400 hover:text-violet-300 transition-colors font-medium">
                    Upgrade →
                  </a>
                </div>
              )}

              {/* URL Input */}
              <div className="max-w-xl mx-auto">
                <div className="flex gap-2 p-1.5 rounded-xl border border-white/8 bg-white/3 backdrop-blur-sm focus-within:border-violet-500/40 transition-colors">
                  <input
                    type="text"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && analyze()}
                    placeholder="Enter a URL — e.g. example.com"
                    className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white placeholder-white/25 outline-none min-w-0"
                  />
                  <button
                    onClick={() => analyze()}
                    disabled={status === 'loading'}
                    className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    style={{
                      background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                      boxShadow: '0 0 20px rgba(124,58,237,0.3)',
                    }}
                  >
                    {status === 'loading' ? 'Analyzing…' : 'Analyze'}
                  </button>
                </div>

                {(errorMsg || status === 'error') && (
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="text-sm text-red-400 text-left px-1">{errorMsg || 'Analysis failed.'}</p>
                    {errorMsg.includes('limit') && (
                      <a href="/pricing" className="text-xs font-semibold text-violet-400 shrink-0 hover:text-violet-300 transition-colors">
                        Upgrade →
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Roast mode toggle */}
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => setRoastMode(r => !r)}
                  className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-medium transition-all ${
                    roastMode
                      ? 'bg-orange-500/15 border-orange-500/35 text-orange-400'
                      : 'border-white/10 text-white/35 hover:border-white/20 hover:text-white/55'
                  }`}
                >
                  <span>🔥</span>
                  {roastMode ? 'Roast Mode On — results will be brutal' : 'Enable Roast Mode'}
                </button>
              </div>

              {/* Example sites */}
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <span className="text-xs text-white/25 self-center">Try:</span>
                {EXAMPLE_SITES.map(site => (
                  <button
                    key={site.url}
                    onClick={() => { setUrl(site.url); analyze(site.url); }}
                    disabled={status === 'loading'}
                    title={site.hint}
                    className="px-3 py-1 rounded-full text-xs border border-white/10 text-white/50 hover:border-white/20 hover:text-white/80 transition-colors disabled:opacity-40"
                  >
                    {site.label}
                  </button>
                ))}
              </div>

              {/* Viral CTA */}
              {showIdle && (
                <div className="mt-10">
                  <button
                    onClick={() => { const el = document.querySelector('input[type=text]') as HTMLInputElement; el?.focus(); }}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-violet-500/25 bg-violet-500/8 text-violet-300 text-sm font-medium hover:bg-violet-500/12 transition-colors"
                  >
                    <span>🚀</span>
                    Scan your startup
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Loading */}
          {status === 'loading' && (
            <section className="px-6 pb-16 flex justify-center">
              <LoadingAnimation step={loadStep} />
            </section>
          )}

          {/* Results */}
          {status === 'done' && result && (
            <section ref={resultsRef} className="px-6 pb-20">
              <ResultsDashboard result={result} onReset={reset} defaultRoastMode={roastMode} />
            </section>
          )}

          {/* Why This Matters */}
          {showIdle && (
            <section className="px-6 pb-24 max-w-5xl mx-auto">
              <div className="border-t border-white/5 pt-16">
                <h2 className="text-2xl font-bold text-white/80 mb-2 text-center">Why this matters</h2>
                <p className="text-white/40 text-center text-sm mb-12 max-w-md mx-auto">
                  AI-generated code ships fast — but often with security defaults left unconfigured.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  {[
                    {
                      icon: '◈', color: '#8b5cf6',
                      title: 'Vibe-Code Fingerprinting',
                      desc: 'AI tools produce identifiable patterns — generic Tailwind layouts, Supabase defaults, shadcn scaffolds, and boilerplate copy that reveal their origin.',
                    },
                    {
                      icon: '⬡', color: '#06b6d4',
                      title: 'Passive Security Audit',
                      desc: 'Missing CSP, no HSTS, exposed .env files — common oversights that happen when you ship without reviewing the defaults your AI tool generated.',
                    },
                    {
                      icon: '◻', color: '#22c55e',
                      title: 'Zero Exploitation',
                      desc: 'Every check is read-only and passive. We detect what public crawlers can already see — no scanning, no probing, no brute force.',
                    },
                  ].map(item => (
                    <div key={item.title} className="p-6 rounded-xl border border-white/5 bg-white/2">
                      <div className="text-2xl mb-4" style={{ color: item.color }}>{item.icon}</div>
                      <h3 className="font-semibold text-white/80 mb-2">{item.title}</h3>
                      <p className="text-sm text-white/40 leading-relaxed">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Footer */}
          <footer className="border-t border-white/5 px-6 py-6 print:hidden">
            <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-white/20">Is This Vibe-Coded? — passive analysis only</p>
              <div className="flex items-center gap-4">
                <a href="/privacy" className="text-xs text-white/20 hover:text-white/50 transition-colors">Privacy Policy</a>
                <a href="/pricing" className="text-xs text-white/20 hover:text-white/50 transition-colors">Pricing</a>
                <p className="text-xs text-white/15">Scan only sites you own or have permission to test.</p>
              </div>
            </div>
          </footer>
        </div>
      </main>
    </>
  );
}

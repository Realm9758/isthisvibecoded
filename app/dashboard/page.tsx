'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { OwnershipVerify } from '@/components/OwnershipVerify';

interface ScanSummary {
  id: string;
  createdAt: number;
  isPublic: boolean;
  result: {
    url: string;
    vibe: { score: number; label: string };
    security: { score: number; riskLevel: string };
    techStack: { name: string }[];
  };
}

function vibeColor(s: number) { return s >= 70 ? '#8b5cf6' : s >= 30 ? '#f59e0b' : '#22c55e'; }
function secColor(s: number)  { return s >= 70 ? '#22c55e' : s >= 40 ? '#f59e0b' : '#ef4444'; }
function domain(url: string)  { try { return new URL(url.startsWith('http') ? url : `https://${url}`).hostname; } catch { return url; } }
function timeAgo(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

type DeepStep = 'idle' | 'enter-url' | 'verify' | 'done';

// ── Auth gate ──────────────────────────────────────────────────────────────

function AuthGate() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login, signup } = useAuth();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') await login(email, password);
      else await signup(email, password, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-57px)] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}
          >
            <span className="text-2xl">⚡</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">
            {mode === 'login' ? 'Sign in to your scans' : 'Create your account'}
          </h1>
          <p className="text-white/40 text-sm">
            Deep vulnerability scans require a verified account
          </p>
        </div>

        <div
          className="rounded-2xl p-7 border border-white/8"
          style={{ background: 'rgba(255,255,255,0.025)', backdropFilter: 'blur(16px)' }}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-all"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)')}
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-all"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}
                onFocus={e => (e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)')}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Min. 8 characters"
                className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-all"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}
                onFocus={e => (e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)')}
              />
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
              style={{
                background: loading ? 'rgba(220,38,38,0.5)' : 'linear-gradient(135deg, #dc2626, #b91c1c)',
                boxShadow: '0 0 20px rgba(220,38,38,0.2)',
              }}
            >
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-white/30 mt-5">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            onClick={() => { setMode(m => m === 'login' ? 'signup' : 'login'); setError(''); }}
            className="text-red-400 hover:text-red-300 transition-colors font-medium"
          >
            {mode === 'login' ? 'Sign up free →' : 'Sign in →'}
          </button>
        </p>
      </div>
    </div>
  );
}

// ── Deep scan request panel ────────────────────────────────────────────────

function DeepScanPanel() {
  const [step, setStep] = useState<DeepStep>('idle');
  const [inputUrl, setInputUrl] = useState('');
  const [scanDomain, setScanDomain] = useState('');
  const [urlError, setUrlError] = useState('');

  function handleUrlSubmit(e: React.FormEvent) {
    e.preventDefault();
    setUrlError('');
    let d = '';
    try {
      d = new URL(inputUrl.startsWith('http') ? inputUrl : `https://${inputUrl}`).hostname;
    } catch {
      setUrlError('Enter a valid domain — e.g. example.com');
      return;
    }
    if (!d) { setUrlError('Enter a valid domain'); return; }
    setScanDomain(d);
    setStep('verify');
  }

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: 'rgba(239,68,68,0.03)', borderColor: 'rgba(239,68,68,0.18)' }}
    >
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}
          >
            ⚡
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white/85">New Deep Vulnerability Scan</h2>
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.25)' }}
              >
                Coming Soon
              </span>
            </div>
            <p className="text-xs text-white/35 mt-0.5">Verify ownership then run OWASP Top 10 checks</p>
          </div>
        </div>
        <Link
          href="/vulnerability"
          className="text-xs text-white/30 hover:text-white/60 transition-colors hidden sm:block"
        >
          How it works →
        </Link>
      </div>

      <div className="p-6">
        {step === 'idle' && (
          <div className="text-center py-4">
            <p className="text-sm text-white/45 mb-5 max-w-sm mx-auto leading-relaxed">
              Enter your website URL below. We&apos;ll ask you to prove ownership before running any active tests.
            </p>
            <button
              onClick={() => setStep('enter-url')}
              className="px-6 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.25)',
                color: 'rgba(248,113,113,0.9)',
              }}
            >
              + Request Deep Scan
            </button>
          </div>
        )}

        {step === 'enter-url' && (
          <div className="animate-fade-in-up">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/8 border border-amber-500/20 mb-5">
              <span className="text-amber-400 shrink-0">⚠</span>
              <p className="text-xs text-amber-300/80">
                Only submit a website you own or have explicit written permission to test.
                We verify ownership before running any active checks.
              </p>
            </div>
            <form onSubmit={handleUrlSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5">Your website URL</label>
                <input
                  type="text"
                  value={inputUrl}
                  onChange={e => setInputUrl(e.target.value)}
                  placeholder="example.com or https://example.com"
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-all"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'rgba(239,68,68,0.45)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)')}
                />
                {urlError && <p className="text-xs text-red-400 mt-1.5">{urlError}</p>}
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
                    boxShadow: '0 0 16px rgba(220,38,38,0.2)',
                  }}
                >
                  Continue to Verify Ownership
                </button>
                <button
                  type="button"
                  onClick={() => setStep('idle')}
                  className="px-4 py-2.5 rounded-xl text-sm border border-white/8 text-white/40 hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {step === 'verify' && (
          <div className="space-y-4 animate-fade-in-up">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/8 border border-red-500/18">
              <span className="text-red-400 shrink-0 text-sm">🔐</span>
              <p className="text-xs text-red-300/80">
                Proving ownership of <span className="font-mono font-semibold text-white/65">{scanDomain}</span>.
                Only the legitimate site owner can complete this step.
              </p>
            </div>
            <OwnershipVerify domain={scanDomain} onVerified={() => setStep('done')} />
            <button
              onClick={() => setStep('enter-url')}
              className="text-xs text-white/25 hover:text-white/55 transition-colors"
            >
              ← Change URL
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/8 p-5 animate-fade-in-up">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0 text-lg">
                🚀
              </div>
              <div>
                <p className="font-bold text-violet-300 mb-1">
                  Ownership verified for {scanDomain}!
                </p>
                <p className="text-xs text-white/45 leading-relaxed">
                  You&apos;re on the early access list for Deep Scan. Active pentesting is in development —
                  you&apos;ll be notified the moment it launches. Your verified domain is saved to your account.
                </p>
                <button
                  onClick={() => { setStep('idle'); setInputUrl(''); setScanDomain(''); }}
                  className="mt-3 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                >
                  Verify another domain →
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Scan history card ──────────────────────────────────────────────────────

function ScanCard({ scan }: { scan: ScanSummary }) {
  const d = domain(scan.result.url);
  const vc = vibeColor(scan.result.vibe.score);
  const sc = secColor(scan.result.security.score);
  const topTech = scan.result.techStack.slice(0, 3).map(t => t.name).join(' · ');

  return (
    <Link
      href={`/result/${scan.id}`}
      className="block p-4 rounded-xl border border-white/6 bg-white/2 hover:bg-white/4 hover:border-white/10 transition-all group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-mono text-sm font-semibold text-white/80 truncate">{d}</span>
            {!scan.isPublic && (
              <span className="text-[9px] text-white/30 border border-white/10 px-1.5 py-0.5 rounded uppercase tracking-wider">Private</span>
            )}
          </div>
          {topTech && <p className="text-xs text-white/30 truncate">{topTech}</p>}
          <p className="text-xs text-white/20 mt-1">{timeAgo(scan.createdAt)}</p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <p className="text-xs text-white/25 uppercase tracking-wider text-[9px]">Vibe</p>
            <p className="text-sm font-bold" style={{ color: vc }}>{scan.result.vibe.score}%</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-white/25 uppercase tracking-wider text-[9px]">Security</p>
            <p className="text-sm font-bold" style={{ color: sc }}>{scan.result.security.score}</p>
          </div>
          <svg className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
}

// ── Main dashboard ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [scansLoading, setScansLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!user) return;
    setScansLoading(true);
    fetch('/api/user/scans')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setScans(data); })
      .finally(() => setScansLoading(false));
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a0f' }}>
        <div className="w-5 h-5 border-2 border-white/20 border-t-violet-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ background: '#0a0a0f' }}>
        <AuthGate />
      </div>
    );
  }

  const PLAN_COLOR: Record<string, string> = {
    pro: 'text-violet-300 bg-violet-500/15 border-violet-500/30',
    team: 'text-cyan-300 bg-cyan-500/15 border-cyan-500/30',
    free: 'text-white/40 bg-white/5 border-white/10',
  };

  return (
    <main className="min-h-screen px-6 py-10" style={{ background: '#0a0a0f' }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 40% at 50% -5%, rgba(239,68,68,0.06) 0%, transparent 60%)' }}
      />

      <div className="relative max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
          <div>
            <p className="text-white/35 text-sm mb-0.5">Welcome back</p>
            <h1 className="text-2xl font-bold text-white">{user.name}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${PLAN_COLOR[user.plan]}`}>
                {user.plan}
              </span>
              {user.plan === 'free' && user.scansRemaining !== null && (
                <span className="text-xs text-white/30">
                  {user.scansRemaining} passive scan{user.scansRemaining !== 1 ? 's' : ''} left today
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              href="/"
              className="px-4 py-2 rounded-xl text-xs font-medium border border-white/10 text-white/50 hover:bg-white/5 transition-colors"
            >
              ← Run passive scan
            </Link>
            <Link
              href="/vulnerability"
              className="px-4 py-2 rounded-xl text-xs font-medium border border-red-500/25 bg-red-500/8 text-red-400 hover:bg-red-500/12 transition-colors"
            >
              About deep scans
            </Link>
          </div>
        </div>

        {/* Deep scan panel */}
        <div className="mb-8">
          <DeepScanPanel />
        </div>

        {/* My Scans */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white/70 uppercase tracking-wider">My Passive Scans</h2>
            <span className="text-xs text-white/25">{scans.length} scan{scans.length !== 1 ? 's' : ''}</span>
          </div>

          {scansLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 rounded-xl border border-white/5 bg-white/2 animate-pulse" />
              ))}
            </div>
          ) : scans.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-white/5 bg-white/2">
              <p className="text-3xl mb-3 opacity-20">◌</p>
              <p className="text-sm text-white/40 mb-1">No scans yet</p>
              <p className="text-xs text-white/25 mb-4">Run a passive scan from the homepage to see your history here.</p>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium border border-white/10 text-white/50 hover:bg-white/5 transition-colors"
              >
                Scan a site →
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {scans.map(scan => (
                <ScanCard key={scan.id} scan={scan} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

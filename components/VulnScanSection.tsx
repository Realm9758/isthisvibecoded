'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { OwnershipVerify } from './OwnershipVerify';

interface Props {
  domain: string;
}

type Step = 'guide' | 'login' | 'verify' | 'done';

export function VulnScanSection({ domain }: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('guide');
  const [open, setOpen] = useState(false);

  function handleStart() {
    if (!user) { setStep('login'); setOpen(true); return; }
    setStep('verify');
    setOpen(true);
  }

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: 'rgba(239,68,68,0.03)', borderColor: 'rgba(239,68,68,0.13)' }}
    >
      {/* Header — always visible */}
      <div className="p-5">
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-base"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.22)' }}
          >
            ⚡
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-white/80">Deep Vulnerability Scan</h3>
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.25)' }}
              >
                Coming Soon
              </span>
            </div>
            <p className="text-xs text-white/35 mt-0.5">
              Active security testing — only on sites you own
            </p>
          </div>
        </div>

        {/* How it works — 3 steps */}
        <div className="mb-4">
          <p className="text-[10px] font-semibold text-white/25 uppercase tracking-widest mb-3">How it works</p>
          <div className="space-y-0">
            {[
              {
                n: '1',
                title: 'Create a free account',
                desc: 'Sign up or log in. Deep scans are only available to verified account holders so we can confirm who requested the test.',
                color: '#8b5cf6',
                done: !!user,
              },
              {
                n: '2',
                title: 'Prove you own the domain',
                desc: (
                  <span>
                    Add a unique token to your site using one of three methods:
                    <span className="block mt-1.5 space-y-1">
                      <span className="flex gap-1.5 items-start">
                        <span className="text-violet-400/60 shrink-0 font-mono text-[10px] mt-0.5">DNS</span>
                        <span>Add a TXT record <code className="font-mono text-[10px] text-violet-300/70 bg-violet-500/10 px-1 rounded">_vibecoded-verification.{domain}</code> to your domain registrar (Cloudflare, Namecheap, etc.)</span>
                      </span>
                      <span className="flex gap-1.5 items-start">
                        <span className="text-violet-400/60 shrink-0 font-mono text-[10px] mt-0.5">META</span>
                        <span>Add a <code className="font-mono text-[10px] text-violet-300/70 bg-violet-500/10 px-1 rounded">&lt;meta&gt;</code> tag to your homepage HTML</span>
                      </span>
                      <span className="flex gap-1.5 items-start">
                        <span className="text-violet-400/60 shrink-0 font-mono text-[10px] mt-0.5">FILE</span>
                        <span>Upload a small text file to <code className="font-mono text-[10px] text-violet-300/70 bg-violet-500/10 px-1 rounded">/.well-known/vibecoded.txt</code></span>
                      </span>
                    </span>
                  </span>
                ),
                color: '#f59e0b',
                done: false,
              },
              {
                n: '3',
                title: 'Run the scan',
                desc: 'Once ownership is confirmed, we run OWASP Top 10 checks, exposed endpoint audits, dependency vulnerability scanning, and more — only on your domain.',
                color: '#22c55e',
                done: false,
              },
            ].map((s, i, arr) => (
              <div key={s.n} className="flex gap-3">
                {/* Step connector */}
                <div className="flex flex-col items-center shrink-0">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                    style={{
                      background: s.done ? `${s.color}25` : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${s.done ? s.color + '60' : 'rgba(255,255,255,0.1)'}`,
                      color: s.done ? s.color : 'rgba(255,255,255,0.3)',
                    }}
                  >
                    {s.done ? '✓' : s.n}
                  </div>
                  {i < arr.length - 1 && (
                    <div className="w-px flex-1 my-1" style={{ background: 'rgba(255,255,255,0.06)', minHeight: 12 }} />
                  )}
                </div>
                {/* Content */}
                <div className="pb-4 min-w-0">
                  <p className="text-xs font-semibold text-white/70 mb-0.5">{s.title}</p>
                  <div className="text-xs text-white/38 leading-relaxed">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* What gets checked */}
        <div className="rounded-lg bg-white/3 border border-white/6 p-3 mb-4">
          <p className="text-[10px] font-semibold text-white/25 uppercase tracking-widest mb-2">What gets scanned</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {[
              'OWASP Top 10',
              'SQL injection & XSS',
              'Auth bypass checks',
              'Exposed endpoints',
              'Dependency CVEs',
              'Misconfigurations',
              'CORS policy audit',
              'Sensitive data leaks',
            ].map(f => (
              <div key={f} className="flex items-center gap-1.5 text-xs text-white/38">
                <span className="text-red-500/50 shrink-0">›</span>
                {f}
              </div>
            ))}
          </div>
        </div>

        {/* Action */}
        {!open && (
          <button
            onClick={handleStart}
            className="w-full py-2.5 text-sm font-medium rounded-xl transition-all"
            style={{
              background: 'rgba(239,68,68,0.07)',
              border: '1px solid rgba(239,68,68,0.22)',
              color: 'rgba(248,113,113,0.85)',
            }}
          >
            {user ? 'Verify Ownership & Run Scan' : 'Get Started — it\'s free'}
          </button>
        )}
      </div>

      {/* Expanded flow */}
      {open && (
        <div className="border-t border-white/6 p-5 pt-4 animate-fade-in-up">
          {step === 'login' && (
            <div className="rounded-xl border border-white/8 bg-white/3 p-4 text-center">
              <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center mx-auto mb-3">
                <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-white/70 mb-0.5">Account required</p>
              <p className="text-xs text-white/35 mb-4 leading-relaxed">
                Create a free account to verify ownership. We log who requested each deep scan for accountability.
              </p>
              <div className="flex gap-2 justify-center">
                <Link
                  href="/signup"
                  className="px-4 py-2 text-xs font-semibold rounded-lg text-white"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
                >
                  Create Free Account
                </Link>
                <Link
                  href="/login"
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-white/10 text-white/55 hover:bg-white/5 transition-colors"
                >
                  Sign In
                </Link>
              </div>
              <button onClick={() => setOpen(false)} className="mt-3 text-xs text-white/20 hover:text-white/50 transition-colors">Cancel</button>
            </div>
          )}

          {step === 'verify' && (
            <div className="space-y-3 animate-fade-in-up">
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-orange-500/8 border border-orange-500/20">
                <span className="text-orange-400 shrink-0 text-sm">⚠</span>
                <p className="text-xs text-orange-300/80">
                  Prove you own <span className="font-mono font-semibold">{domain}</span> before we run any active tests.
                  Only the legitimate site owner can pass this step.
                </p>
              </div>
              <OwnershipVerify domain={domain} onVerified={() => setStep('done')} />
              <button onClick={() => setOpen(false)} className="text-xs text-white/20 hover:text-white/50 transition-colors">Cancel</button>
            </div>
          )}

          {step === 'done' && (
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/8 p-4 animate-fade-in-up">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0">
                  <span className="text-sm">🚀</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-violet-300">Ownership Verified — You&apos;re on the early access list!</p>
                  <p className="text-xs text-white/40 mt-1 leading-relaxed">
                    Active pentesting for <span className="font-mono text-white/55">{domain}</span> is in development.
                    You&apos;ve proven ownership and will be first to know when Deep Scan launches.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

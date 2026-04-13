'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { OwnershipVerify } from './OwnershipVerify';

interface Props {
  domain: string;
}

type Step = 'cta' | 'login' | 'verify' | 'done';

const FEATURES = [
  'OWASP Top 10 checks',
  'Exposed endpoints audit',
  'Dependency vulnerability scan',
  'SQL injection & XSS probing',
  'Auth bypass detection',
  'Misconfiguration scanner',
];

export function VulnScanSection({ domain }: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('cta');

  function handleClick() {
    if (!user) { setStep('login'); return; }
    setStep('verify');
  }

  return (
    <div
      className="rounded-xl border p-5 relative overflow-hidden"
      style={{ background: 'rgba(239,68,68,0.04)', borderColor: 'rgba(239,68,68,0.15)' }}
    >
      {/* Background glow */}
      <div
        className="absolute -top-10 -right-10 w-40 h-40 rounded-full pointer-events-none"
        style={{ background: '#ef4444', filter: 'blur(60px)', opacity: 0.06 }}
      />

      <div className="relative">
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-base"
            style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}
          >
            ⚡
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-white/80">Deep Vulnerability Scan</h3>
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.25)' }}
              >
                Coming Soon
              </span>
            </div>
            <p className="text-xs text-white/35 mt-0.5">Active security testing — requires proof of site ownership</p>
          </div>
        </div>

        {/* Feature list */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-5">
          {FEATURES.map(f => (
            <div key={f} className="flex items-center gap-1.5 text-xs text-white/40">
              <span className="text-red-500/50 shrink-0">›</span>
              {f}
            </div>
          ))}
        </div>

        {/* State machine */}
        {step === 'cta' && (
          <button
            onClick={handleClick}
            className="w-full py-2.5 text-sm font-medium rounded-xl transition-all"
            style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.25)',
              color: 'rgba(248,113,113,0.9)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.14)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.08)';
            }}
          >
            Check My Site for Vulnerabilities
          </button>
        )}

        {step === 'login' && (
          <div className="rounded-xl border border-white/8 bg-white/3 p-4 text-center animate-fade-in-up">
            <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center mx-auto mb-3">
              <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-white/70 mb-0.5">Account required</p>
            <p className="text-xs text-white/35 mb-4 leading-relaxed">
              Create a free account to verify ownership and run vulnerability scans on your site.
            </p>
            <div className="flex gap-2 justify-center">
              <Link
                href="/signup"
                className="px-4 py-2 text-xs font-semibold rounded-lg text-white transition-all"
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
            <button
              onClick={() => setStep('cta')}
              className="mt-3 text-xs text-white/20 hover:text-white/50 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {step === 'verify' && (
          <div className="space-y-3 animate-fade-in-up">
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-orange-500/8 border border-orange-500/20">
              <span className="text-orange-400 shrink-0">⚠</span>
              <p className="text-xs text-orange-300/80">
                Prove you own <span className="font-mono font-semibold">{domain}</span> before we run active tests.
              </p>
            </div>
            <OwnershipVerify domain={domain} onVerified={() => setStep('done')} />
            <button
              onClick={() => setStep('cta')}
              className="text-xs text-white/20 hover:text-white/50 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/8 p-4 animate-fade-in-up">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0">
                <span className="text-violet-400 text-sm">🚀</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-violet-300">Ownership Verified — You're on the list!</p>
                <p className="text-xs text-white/40 mt-1 leading-relaxed">
                  Active pentesting is in development. Since you've verified ownership of{' '}
                  <span className="font-mono text-white/55">{domain}</span>, you'll be notified first when it launches.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

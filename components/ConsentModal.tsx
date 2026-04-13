'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const CONSENT_KEY = 'vc-consent-v1';

export function ConsentModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(CONSENT_KEY)) setVisible(true);
    } catch {
      // localStorage unavailable (SSR / private browsing)
    }
  }, []);

  function accept() {
    try { localStorage.setItem(CONSENT_KEY, '1'); } catch { /* ignore */ }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)' }}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 overflow-hidden animate-fade-in-up"
        style={{ background: '#0d0d1a' }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-white/6 flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)' }}
          >
            <span className="text-violet-400 text-base">◈</span>
          </div>
          <div>
            <h2 className="text-sm font-bold text-white/90">Before you continue</h2>
            <p className="text-xs text-white/35 mt-0.5">Is This Vibe-Coded? — Privacy &amp; Usage</p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* What we do */}
          <div className="space-y-2.5">
            {[
              {
                icon: '👁',
                title: 'Passive scanning only',
                desc: 'We read only what any browser can already see — HTTP headers, public HTML, and tech signals. We never exploit, probe, or brute-force anything.',
              },
              {
                icon: '🔐',
                title: 'Deep scans require ownership proof',
                desc: 'Active vulnerability testing is only ever run on sites you can cryptographically prove you own (via DNS record, meta tag, or file upload). We never test third-party sites.',
              },
              {
                icon: '💾',
                title: 'What we store',
                desc: 'If you create an account: your email (hashed password, never plain text) and scan results tied to your account. Anonymous scans store no personal data.',
              },
              {
                icon: '🚫',
                title: "What we don't do",
                desc: "We don't sell your data, share it with third parties, or use it for advertising. Scan results are yours — delete them any time.",
              },
            ].map(item => (
              <div key={item.title} className="flex gap-3">
                <span className="text-base shrink-0 mt-0.5">{item.icon}</span>
                <div>
                  <p className="text-xs font-semibold text-white/75">{item.title}</p>
                  <p className="text-xs text-white/40 mt-0.5 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Privacy link */}
          <p className="text-xs text-white/30 leading-relaxed">
            By continuing you agree to our{' '}
            <Link href="/privacy" className="text-violet-400 hover:text-violet-300 transition-colors underline underline-offset-2">
              Privacy Policy
            </Link>
            . You must only scan websites you own or have explicit permission to test.
          </p>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex gap-2">
          <button
            onClick={accept}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', boxShadow: '0 0 20px rgba(124,58,237,0.25)' }}
          >
            I Understand &amp; Agree
          </button>
          <Link
            href="/privacy"
            onClick={accept}
            className="px-4 py-2.5 rounded-xl text-sm text-white/40 border border-white/8 hover:bg-white/5 transition-colors"
          >
            Read Policy
          </Link>
        </div>
      </div>
    </div>
  );
}

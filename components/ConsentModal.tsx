'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const CONSENT_KEY = 'vc-consent-v2';

export function ConsentModal() {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    // The policy must remain readable before consent. Navigating back to the app
    // will show this notice again unless the user explicitly accepts it.
    if (pathname === '/privacy') return;

    const timer = window.setTimeout(() => {
      try {
        setVisible(!localStorage.getItem(CONSENT_KEY));
      } catch {
        // localStorage unavailable (SSR / private browsing)
        setVisible(true);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [pathname]);

  function accept() {
    try { localStorage.setItem(CONSENT_KEY, '1'); } catch { /* ignore */ }
    setVisible(false);
  }

  if (!visible || pathname === '/privacy') return null;

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
            <p className="text-xs text-white/35 mt-0.5">Ironclad: privacy and usage</p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* What we do */}
          <div className="space-y-2.5">
            {[
              {
                icon: '👁',
                title: 'Bounded, read-only public checks',
                desc: 'A passive scan fetches the submitted public page, reads its response headers and HTML, then makes up to 15 HEAD or GET requests to a fixed list of public paths. It does not log in, exploit, inject payloads, or brute-force credentials.',
              },
              {
                icon: '🔐',
                title: 'Deep scans require domain-control verification',
                desc: 'Before active checks can start, a signed-in user must place a unique token in DNS, a meta tag, or a hosted file and explicitly request the scan. You remain responsible for having legal permission to test the site.',
              },
              {
                icon: '💾',
                title: 'What we store',
                desc: 'Anonymous scan results are not saved. For abuse prevention, an HMAC-derived identifier is used in a date-scoped usage row. If you sign in, account details and scan results are stored; new results start private.',
              },
              {
                icon: '🚫',
                title: "What we don't do",
                desc: "We don't sell personal data or use it for advertising. A signed-in scan appears publicly only after its owner explicitly publishes it; private result routes are restricted to that owner.",
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
            className="px-4 py-2.5 rounded-xl text-sm text-white/40 border border-white/8 hover:bg-white/5 transition-colors"
          >
            Read Policy
          </Link>
        </div>
      </div>
    </div>
  );
}

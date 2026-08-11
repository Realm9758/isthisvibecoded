'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SURFACE_PHASE_IDS, DEEP_ONLY_PHASE_IDS } from '@/lib/scan-lanes';

/**
 * Bumped when the terms below change materially, so an old acceptance never
 * stands in for a new one.
 */
const CONSENT_KEY = 'ironclad-consent-v3';

const TERMS = [
  {
    title: `${SURFACE_PHASE_IDS.length} read-only checks run on any URL`,
    body: 'They fetch the page, read its headers, and request a fixed list of well-known public paths. No login, no payloads, no brute force, nothing written.',
  },
  {
    title: `${DEEP_ONLY_PHASE_IDS.length} more need proof you control the domain`,
    body: 'Those send real test payloads, so a signed-in user must place a token in DNS, a meta tag, or a hosted file first. You remain responsible for having permission to test the target.',
  },
  {
    title: 'What we store',
    body: 'An anonymous result is kept privately for 7 days with a one-time claim token so you can attach it to an account, then deleted. Rate limiting uses an HMAC-derived identifier rather than your address.',
  },
  {
    title: 'What we never do',
    body: 'No selling personal data, no advertising, and no public results. There is no feed, leaderboard, or shareable result page: every scan is private to the account that ran it.',
  },
];

export function ConsentModal() {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    // The policy must stay readable before consent. Navigating back into the
    // app shows this again unless it was explicitly accepted.
    if (pathname === '/privacy') return;

    const timer = window.setTimeout(() => {
      try {
        setVisible(!localStorage.getItem(CONSENT_KEY));
      } catch {
        setVisible(true);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [pathname]);

  function accept() {
    try { localStorage.setItem(CONSENT_KEY, '1'); } catch { /* private browsing */ }
    setVisible(false);
  }

  if (!visible || pathname === '/privacy') return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(8px)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
    >
      <div
        className="w-full max-w-lg border overflow-hidden animate-fade-in-up"
        style={{ background: 'var(--surface)', borderColor: 'var(--border-2)', borderRadius: 6 }}
      >
        <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <p className="label mb-1.5">before you continue</p>
          <h2 id="consent-title" className="text-sm font-semibold text-white">
            How the Ironclad scanner behaves
          </h2>
        </div>

        <div className="px-6 py-5 space-y-4">
          {TERMS.map(term => (
            <div key={term.title} className="flex gap-3.5">
              <span className="font-mono text-xs shrink-0 mt-0.5" style={{ color: 'var(--accent)' }}>·</span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white/80">{term.title}</p>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--faint)' }}>{term.body}</p>
              </div>
            </div>
          ))}

          <p className="text-xs leading-relaxed pt-1" style={{ color: 'var(--ghost)' }}>
            By continuing you agree to our{' '}
            <Link
              href="/privacy"
              className="underline underline-offset-2 transition-opacity hover:opacity-70"
              style={{ color: 'var(--accent)' }}
            >
              privacy policy
            </Link>
            . Scan only sites you own or have explicit permission to test.
          </p>
        </div>

        <div className="px-6 pb-6 flex gap-2.5">
          <button
            onClick={accept}
            className="flex-1 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent)', borderRadius: 4 }}
          >
            I understand
          </button>
          <Link
            href="/privacy"
            className="px-5 py-3 font-mono text-sm border transition-colors hover:bg-white/4"
            style={{ borderColor: 'var(--border-2)', color: 'var(--faint)', borderRadius: 4 }}
          >
            read policy
          </Link>
        </div>
      </div>
    </div>
  );
}

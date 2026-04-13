'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { PLANS } from '@/lib/stripe';

function PlanCard({
  planId, plan, current, onUpgrade, loading,
}: {
  planId: string;
  plan: typeof PLANS[keyof typeof PLANS];
  current: boolean;
  onUpgrade: (p: string) => void;
  loading: boolean;
}) {
  const isPro = planId === 'pro';

  return (
    <div className={`relative rounded-2xl border p-7 flex flex-col gap-6 transition-all ${isPro ? 'border-violet-500/40 bg-violet-500/5' : 'border-white/8 bg-white/2'}`}>
      {isPro && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-xs font-semibold bg-violet-600 text-white border border-violet-400/30">
          Most Popular
        </div>
      )}

      <div>
        <p className="text-sm font-semibold text-white/60 mb-1">{plan.name}</p>
        <div className="flex items-end gap-1">
          {plan.price === 0 ? (
            <span className="text-4xl font-bold text-white">Free</span>
          ) : (
            <>
              <span className="text-white/50 text-xl mb-1">£</span>
              <span className="text-4xl font-bold text-white">{plan.price}</span>
              <span className="text-white/40 text-sm mb-1.5">/month</span>
            </>
          )}
        </div>
        {'scansPerDay' in plan && plan.scansPerDay && (
          <p className="text-xs text-white/40 mt-1">{plan.scansPerDay} passive scans / day</p>
        )}
        {'scansPerDay' in plan && plan.scansPerDay === null && (
          <p className="text-xs text-violet-400 mt-1">Unlimited scans</p>
        )}
      </div>

      <ul className="space-y-2.5 flex-1">
        {plan.features.map(f => (
          <li key={f} className="flex items-start gap-2.5 text-sm text-white/70">
            <span className="text-emerald-400 shrink-0 mt-0.5 text-xs font-bold">✓</span>
            {f}
          </li>
        ))}
        {'missing' in plan && (plan.missing as readonly string[]).map((f: string) => (
          <li key={f} className="flex items-start gap-2.5 text-sm text-white/25">
            <span className="shrink-0 mt-0.5 text-xs">✗</span>
            {f}
          </li>
        ))}
      </ul>

      {current ? (
        <div className="py-2.5 rounded-xl text-sm font-medium text-center text-emerald-400 border border-emerald-500/20 bg-emerald-500/5">
          Current Plan
        </div>
      ) : planId === 'free' ? (
        <Link href="/" className="py-2.5 rounded-xl text-sm font-medium text-center text-white/50 border border-white/10 hover:bg-white/5 transition-colors block">
          Get Started Free
        </Link>
      ) : (
        <button
          onClick={() => onUpgrade(planId)}
          disabled={loading}
          className="py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', boxShadow: '0 0 20px rgba(124,58,237,0.3)' }}
        >
          {loading ? 'Redirecting…' : `Upgrade to ${plan.name}`}
        </button>
      )}
    </div>
  );
}

export default function PricingPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState<string | null>(null);
  const [flash, setFlash] = useState<'success' | 'canceled' | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success')) setFlash('success');
    else if (params.get('canceled')) setFlash('canceled');
  }, []);

  async function handleUpgrade(planId: string) {
    if (!user) { window.location.href = '/signup'; return; }
    setLoading(planId);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      });
      const data = await res.json();
      if (data.url) { window.location.href = data.url; }
      else { alert(data.error ?? 'Could not start checkout. Set up Stripe environment variables.'); }
    } finally {
      setLoading(null);
    }
  }

  const currentPlan = user?.plan ?? 'free';
  const planEntries = Object.entries(PLANS).filter(([id]) => id !== 'team') as [string, typeof PLANS[keyof typeof PLANS]][];

  return (
    <main className="min-h-screen px-6 py-20" style={{ background: '#0a0a0f' }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(139,92,246,0.1) 0%, transparent 70%)' }}
      />
      <div className="relative max-w-4xl mx-auto">

        {flash === 'success' && (
          <div className="mb-8 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
            <p className="text-emerald-400 font-semibold">Upgrade successful! Welcome to Pro.</p>
          </div>
        )}
        {flash === 'canceled' && (
          <div className="mb-8 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-center">
            <p className="text-yellow-400">Checkout canceled. You&apos;re still on the free plan.</p>
          </div>
        )}

        <div className="text-center mb-14">
          <h1 className="text-4xl font-bold text-white mb-3">Simple, Transparent Pricing</h1>
          <p className="text-white/40 text-lg">Start free. Upgrade when you need more.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-2xl mx-auto mb-16">
          {planEntries.map(([planId, plan]) => (
            <PlanCard
              key={planId}
              planId={planId}
              plan={plan}
              current={currentPlan === planId}
              onUpgrade={handleUpgrade}
              loading={loading === planId}
            />
          ))}
        </div>

        {/* Feature comparison table */}
        <div className="rounded-2xl border border-white/8 bg-white/2 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/8">
            <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Full Feature Comparison</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8">
                <th className="text-left px-6 py-3 text-white/40 font-medium">Feature</th>
                <th className="text-center px-6 py-3 text-white/40 font-medium">Free</th>
                <th className="text-center px-6 py-3 text-violet-400 font-semibold">Pro · £4.99/mo</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Passive scans per day',    '5',          'Unlimited'],
                ['Deep scans (active OWASP)', '2 lifetime', 'Unlimited'],
                ['Vibe-code detection',       '✓',          '✓'],
                ['Security headers audit',    '✓',          '✓'],
                ['Tech stack detection',      '✓',          '✓'],
                ['Shareable scan links',      '✓',          '✓'],
                ['Roast Mode',                '✓',          '✓'],
                ['Leaderboard & comments',    '✓',          '✓'],
                ['PDF export',                '—',          '✓'],
                ['Verified badge embed',      '—',          '✓'],
                ['Scan history',              '—',          '✓'],
                ['Priority analysis queue',   '—',          '✓'],
              ].map(([feat, free, pro]) => (
                <tr key={feat} className="border-b border-white/4 last:border-0">
                  <td className="px-6 py-3 text-white/60">{feat}</td>
                  <td className="text-center px-6 py-3 text-white/40">{free}</td>
                  <td className="text-center px-6 py-3 text-violet-300">{pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-center text-xs text-white/20 mt-8">
          Prices in GBP. Cancel anytime. Stripe powers all payments.
        </p>
      </div>
    </main>
  );
}

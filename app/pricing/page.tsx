'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { PLANS } from '@/lib/plans';
import { LANE_CHECK_COUNTS, DEEP_ONLY_PHASE_IDS } from '@/lib/scan-lanes';
import {
  FREE_LIFETIME_LIMIT, ANONYMOUS_DAILY_LIMIT, TARGET_HOURLY_LIMIT,
} from '@/lib/scan-quota';
import { apiPath } from '@/lib/site';

const SURFACE = LANE_CHECK_COUNTS.surface;
const TOTAL = LANE_CHECK_COUNTS.deep;

/** Truthful comparison. Nothing here is a feature that does not exist yet. */
const COMPARISON: Array<[string, string, string]> = [
  ['Scans',                              `${FREE_LIFETIME_LIMIT} total`,  'Unlimited'],
  [`Surface checks on any URL`,          `${SURFACE}`,                    `${SURFACE}`],
  ['All checks on a verified domain',    `${TOTAL}`,                      `${TOTAL}`],
  ['Evidence and remediation',           'Included',                      'Included'],
  ['Roast Mode',                         'Included',                      'Included'],
  ['Scan history',                       'Not included',                  'Included'],
  ['Rescan diff since last time',        'Not included',                  'Included'],
  ['Verified domains',                   'Unlimited',                     'Unlimited'],
];

function Flash({ tone, title, note }: { tone: string; title: string; note?: string }) {
  return (
    <div className="mb-8 border px-5 py-4" style={{ borderColor: tone, borderRadius: 4 }}>
      <p className="text-sm font-semibold" style={{ color: tone }}>{title}</p>
      {note && <p className="text-xs mt-1.5" style={{ color: 'var(--faint)' }}>{note}</p>}
    </div>
  );
}

export default function PricingPage() {
  const { user, refreshUser } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [flash, setFlash] = useState<'returned' | 'success' | 'canceled' | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success')) {
      setFlash('returned');
      void refreshUser();
    } else if (params.get('canceled')) {
      setFlash('canceled');
    }
  }, [refreshUser]);

  useEffect(() => {
    if (flash === 'returned' && user && user.plan !== 'free') setFlash('success');
  }, [flash, user]);

  async function handleUpgrade(planId: string) {
    if (!user) { router.push('/signup'); return; }
    setLoading(planId);
    try {
      const res = await fetch(apiPath('/api/stripe/checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert(data.error ?? 'Could not start checkout. Check the Stripe environment variables.');
    } finally {
      setLoading(null);
    }
  }

  const currentPlan = user?.plan ?? 'free';

  return (
    <main style={{ background: 'var(--bg)' }}>
      <section className="px-6 py-20 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-4xl mx-auto">
          {flash === 'success' && <Flash tone="var(--ok)" title="Upgrade complete. Welcome to Pro." />}
          {flash === 'returned' && (
            <Flash
              tone="var(--accent)"
              title="Payment returned. Confirming your subscription…"
              note="Your plan updates once Stripe's signed webhook is processed."
            />
          )}
          {flash === 'canceled' && (
            <Flash tone="var(--high)" title="Checkout cancelled. No subscription change was made." />
          )}

          <p className="eyebrow mb-6">pricing</p>
          <h1 className="display text-white text-[clamp(2.25rem,5vw,3.5rem)] mb-7">
            Start free.<br />Keep going for £4.99.
          </h1>
          <p className="text-lg leading-relaxed max-w-2xl" style={{ color: 'var(--muted)' }}>
            The {FREE_LIFETIME_LIMIT} free scans are the whole product, deep checks included. Nobody should
            subscribe to something they have not watched work.
          </p>
        </div>
      </section>

      <section className="px-6 py-16 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-5">

          <div className="border p-8 flex flex-col" style={{ borderColor: 'var(--border)', borderRadius: 6 }}>
            <p className="label mb-6">{PLANS.free.name.toLowerCase()}</p>
            <p className="display text-white text-5xl mb-3">£0</p>
            <p className="text-sm mb-8" style={{ color: 'var(--muted)' }}>
              Enough to find out whether you have a real problem.
            </p>
            <ul className="space-y-3 mb-9 flex-1">
              {PLANS.free.features.map(item => (
                <li key={item} className="text-sm flex gap-3" style={{ color: 'var(--muted)' }}>
                  <span style={{ color: 'var(--ghost)' }}>·</span>{item}
                </li>
              ))}
              {PLANS.free.missing.map(item => (
                <li key={item} className="text-sm flex gap-3" style={{ color: 'var(--ghost)' }}>
                  <span>×</span>{item}
                </li>
              ))}
            </ul>
            {currentPlan === 'free' ? (
              <Link
                href="/"
                className="block text-center py-3 font-mono text-sm border transition-colors hover:bg-white/4"
                style={{ borderColor: 'var(--border-2)', color: 'var(--muted)', borderRadius: 4 }}
              >
                run a free scan →
              </Link>
            ) : (
              <p className="text-center py-3 font-mono text-sm" style={{ color: 'var(--ghost)' }}>included in Pro</p>
            )}
          </div>

          <div
            className="border p-8 flex flex-col"
            style={{ borderColor: 'var(--accent-line)', background: 'rgba(59,130,246,0.03)', borderRadius: 6 }}
          >
            <div className="flex items-center justify-between mb-6">
              <p className="label" style={{ color: 'var(--accent)' }}>{PLANS.pro.name.toLowerCase()}</p>
              <span className="chip" style={{ color: 'var(--accent)' }}>most picked</span>
            </div>
            <p className="display text-white text-5xl mb-3">
              £{PLANS.pro.price}
              <span className="font-mono text-sm font-normal ml-2" style={{ color: 'var(--faint)' }}>/ month</span>
            </p>
            <p className="text-sm mb-8" style={{ color: 'var(--muted)' }}>Scan as often as you ship.</p>
            <ul className="space-y-3 mb-9 flex-1">
              {PLANS.pro.features.map(item => (
                <li key={item} className="text-sm flex gap-3" style={{ color: 'var(--muted)' }}>
                  <span style={{ color: 'var(--accent)' }}>·</span>{item}
                </li>
              ))}
            </ul>
            {currentPlan === 'pro' ? (
              <p
                className="text-center py-3 font-mono text-sm border"
                style={{ borderColor: 'rgba(34,197,94,0.3)', color: 'var(--ok)', borderRadius: 4 }}
              >
                current plan
              </p>
            ) : (
              <button
                onClick={() => handleUpgrade('pro')}
                disabled={loading === 'pro'}
                className="py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--accent)', borderRadius: 4 }}
              >
                {loading === 'pro' ? 'Redirecting…' : 'Upgrade to Pro'}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="px-6 py-16 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-4xl mx-auto">
          <p className="label mb-6">full comparison</p>
          <div className="border overflow-x-auto" style={{ borderColor: 'var(--border)', borderRadius: 6 }}>
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th className="text-left px-6 py-4 label font-normal">feature</th>
                  <th className="text-right px-6 py-4 label font-normal">free</th>
                  <th className="text-right px-6 py-4 label font-normal" style={{ color: 'var(--accent)' }}>pro</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(([feature, free, pro], i) => (
                  <tr key={feature} style={{ borderBottom: i < COMPARISON.length - 1 ? '1px solid var(--border)' : undefined }}>
                    <td className="px-6 py-3.5" style={{ color: 'var(--muted)' }}>{feature}</td>
                    <td className="px-6 py-3.5 text-right font-mono text-xs" style={{ color: 'var(--faint)' }}>{free}</td>
                    <td className="px-6 py-3.5 text-right font-mono text-xs" style={{ color: 'var(--accent)' }}>{pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="border p-7" style={{ borderColor: 'var(--border)', borderRadius: 6 }}>
            <h2 className="text-base font-semibold text-white mb-2.5">What money does not buy</h2>
            <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--muted)' }}>
              Pro does not unlock more checks. The {DEEP_ONLY_PHASE_IDS.length} payload-sending checks are
              gated on proving you control the domain, not on paying, and they run on the free plan the
              moment you verify one.
            </p>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              Rate limits also apply on every plan: {ANONYMOUS_DAILY_LIMIT} anonymous scan per day, and any
              single domain can be scanned at most {TARGET_HOURLY_LIMIT} times an hour across all users
              combined. That last one is an abuse control, so paying never relaxes it.
            </p>
          </div>

          <p className="text-center font-mono text-xs mt-8" style={{ color: 'var(--ghost)' }}>
            prices in GBP · cancel anytime · payments by Stripe
          </p>
        </div>
      </section>
    </main>
  );
}

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

const PLAN_BADGE: Record<string, string> = {
  pro:  'bg-violet-500/15 text-violet-300 border-violet-500/30',
  team: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  free: 'bg-white/5 text-white/40 border-white/10',
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center px-4 py-3">
      <p className="text-xl font-bold text-white/85">{value}</p>
      <p className="text-[11px] text-white/30 uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
      <div className="px-5 py-3 border-b border-white/6">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider">{title}</h2>
      </div>
      <div className="divide-y divide-white/5">{children}</div>
    </div>
  );
}

function Row({ label, value, action }: { label: string; value: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
      <div className="min-w-0">
        <p className="text-xs text-white/35 mb-0.5">{label}</p>
        <div className="text-sm text-white/75">{value}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export default function ProfilePage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [passiveCount, setPassiveCount] = useState<number | null>(null);
  const [deepCount, setDeepCount] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    fetch('/api/user/scans').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setPassiveCount(d.length);
    }).catch(() => {});
    fetch('/api/user/deep-scans').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setDeepCount(d.length);
    }).catch(() => {});
  }, [user]);

  async function handleLogout() {
    await logout();
    router.push('/');
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a0f' }}>
        <div className="w-5 h-5 border-2 border-white/20 border-t-violet-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#0a0a0f' }}>
        <div className="text-center">
          <p className="text-white/40 text-sm mb-4">You need to be signed in to view your profile.</p>
          <Link href="/login" className="px-5 py-2.5 rounded-xl text-sm font-medium text-white" style={{ background: 'rgba(139,92,246,0.85)', border: '1px solid rgba(139,92,246,0.5)' }}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const joinedDate = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date());

  return (
    <main className="min-h-screen px-6 py-10" style={{ background: '#0a0a0f' }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 30% at 50% 0%, rgba(139,92,246,0.05) 0%, transparent 60%)' }}
      />

      <div className="relative max-w-xl mx-auto">
        {/* Back link */}
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-xs text-white/30 hover:text-white/55 transition-colors mb-6">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          Dashboard
        </Link>

        {/* Avatar + name */}
        <div className="flex items-center gap-4 mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold shrink-0"
            style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.25)', color: '#a78bfa' }}
          >
            {user.name[0]?.toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{user.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${PLAN_BADGE[user.plan]}`}>
                {user.plan}
              </span>
              <span className="text-xs text-white/25">Member since {joinedDate}</span>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div
          className="rounded-2xl border border-white/8 mb-6 grid divide-x divide-white/8"
          style={{ background: 'rgba(255,255,255,0.02)', gridTemplateColumns: 'repeat(3, 1fr)' }}
        >
          <Stat label="Passive Scans" value={passiveCount ?? '—'} />
          <Stat label="Deep Scans" value={deepCount ?? '—'} />
          <Stat label="Plan" value={user.plan.toUpperCase()} />
        </div>

        {/* Account info */}
        <div className="space-y-4">
          <Section title="Account">
            <Row label="Display name" value={user.name} />
            <Row label="Email address" value={<span className="font-mono text-sm">{user.email}</span>} />
            <Row
              label="Plan"
              value={
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${PLAN_BADGE[user.plan]}`}>
                  {user.plan}
                </span>
              }
              action={
                user.plan === 'free' ? (
                  <Link
                    href="/pricing"
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                    style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)', color: '#a78bfa' }}
                  >
                    Upgrade
                  </Link>
                ) : (
                  <button
                    onClick={async () => {
                      const res = await fetch('/api/stripe/portal', { method: 'POST' });
                      const data = await res.json();
                      if (data.url) window.location.href = data.url;
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs text-white/40 border border-white/8 hover:bg-white/5 transition-colors"
                  >
                    Manage billing
                  </button>
                )
              }
            />
          </Section>

          {user.plan === 'free' && (
            <div
              className="rounded-2xl border p-5"
              style={{ background: 'rgba(139,92,246,0.04)', borderColor: 'rgba(139,92,246,0.2)' }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-white/80 mb-1">Upgrade to Pro</p>
                  <p className="text-xs text-white/40 leading-relaxed">
                    Unlimited passive scans, unlimited deep scans, priority queue, and full OWASP reporting.
                  </p>
                </div>
                <Link
                  href="/pricing"
                  className="shrink-0 px-4 py-2 rounded-xl text-xs font-bold text-white transition-colors"
                  style={{ background: 'rgba(139,92,246,0.85)', border: '1px solid rgba(139,92,246,0.5)' }}
                >
                  See plans
                </Link>
              </div>
            </div>
          )}

          <Section title="Usage">
            {user.plan === 'free' && (
              <Row
                label="Passive scans today"
                value={
                  <span className="text-sm">
                    <span className="font-semibold text-white/75">{user.scansRemaining ?? 0}</span>
                    <span className="text-white/30"> remaining</span>
                  </span>
                }
              />
            )}
            <Row label="Passive scan history" value={passiveCount !== null ? `${passiveCount} total` : '—'} action={
              <Link href="/dashboard" className="text-xs text-white/35 hover:text-white/60 transition-colors">View →</Link>
            } />
            <Row label="Deep scan history" value={deepCount !== null ? `${deepCount} total` : '—'} action={
              <Link href="/dashboard" className="text-xs text-white/35 hover:text-white/60 transition-colors">View →</Link>
            } />
          </Section>

          <Section title="Session">
            <Row
              label="Signed in as"
              value={<span className="font-mono text-xs text-white/55">{user.email}</span>}
              action={
                <button
                  onClick={handleLogout}
                  className="px-3 py-1.5 rounded-lg text-xs text-white/40 border border-white/8 hover:bg-white/5 transition-colors"
                >
                  Sign out
                </button>
              }
            />
          </Section>
        </div>
      </div>
    </main>
  );
}

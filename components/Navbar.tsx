'use client';

import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { NotificationBell } from './NotificationBell';

const PLAN_BADGE: Record<string, string> = {
  pro:  'bg-violet-500/15 text-violet-300 border-violet-500/25',
  team: 'bg-sky-500/15 text-sky-300 border-sky-500/25',
  free: 'bg-white/5 text-white/35 border-white/10',
};

// Minimal SVG icons — no emoji
function IconScan() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
    </svg>
  );
}
function IconShield() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  );
}
function IconFeed() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  );
}
function IconUser() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  );
}
function IconChevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6"/>
    </svg>
  );
}

export function Navbar() {
  const { user, loading, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push('/');
  }

  return (
    <nav className="border-b border-white/6 px-6 py-0 sticky top-0 z-40 backdrop-blur-xl" style={{ background: 'rgba(8,8,14,0.85)' }}>
      <div className="max-w-5xl mx-auto flex items-center justify-between h-14 gap-6">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group shrink-0">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold select-none transition-opacity group-hover:opacity-80"
            style={{ background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.3)', color: '#a78bfa' }}
          >
            VS
          </div>
          <span className="font-semibold text-white/75 text-sm hidden sm:block tracking-tight">VibeScan</span>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-0.5 flex-1">
          <Link href="/" className="flex items-center gap-1.5 px-3 py-2 text-xs text-white/45 hover:text-white/75 transition-colors rounded-lg hover:bg-white/4">
            <IconScan />
            <span>Scanner</span>
          </Link>
          <Link href="/security" className="items-center gap-1.5 px-3 py-2 text-xs text-white/45 hover:text-white/75 transition-colors rounded-lg hover:bg-white/4 hidden sm:flex">
            <IconShield />
            <span>Deep Scan</span>
          </Link>
          <Link href="/feed" className="items-center gap-1.5 px-3 py-2 text-xs text-white/45 hover:text-white/75 transition-colors rounded-lg hover:bg-white/4 hidden md:flex">
            <IconFeed />
            <span>Leaderboard</span>
          </Link>
          <Link href="/pricing" className="px-3 py-2 text-xs text-white/45 hover:text-white/75 transition-colors rounded-lg hover:bg-white/4">
            Pricing
          </Link>
        </div>

        {/* Auth */}
        <div className="flex items-center gap-2 shrink-0">
          {loading ? (
            <div className="w-24 h-7 rounded-lg bg-white/5 animate-pulse" />
          ) : user ? (
            <>
            <NotificationBell />
            <div className="relative">
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/8 hover:bg-white/4 transition-colors text-sm"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ background: 'rgba(139,92,246,0.2)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.25)' }}
                >
                  {user.name[0]?.toUpperCase()}
                </div>
                <span className="text-white/65 text-xs max-w-20 truncate hidden sm:block">{user.name}</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border hidden sm:block ${PLAN_BADGE[user.plan]}`}>
                  {user.plan.toUpperCase()}
                </span>
                <span className="text-white/25"><IconChevron /></span>
              </button>

              {menuOpen && (
                <div
                  className="absolute right-0 top-full mt-1.5 w-52 rounded-xl border border-white/8 py-1 z-50 shadow-2xl"
                  style={{ background: '#0f0f18' }}
                >
                  <div className="px-3 py-2.5 border-b border-white/6">
                    <p className="text-xs font-medium text-white/70 truncate">{user.email}</p>
                    {user.plan === 'free' && (
                      <p className="text-xs text-white/30 mt-0.5">
                        {user.scansRemaining ?? 0} scan{user.scansRemaining !== 1 ? 's' : ''} remaining today
                      </p>
                    )}
                  </div>

                  <div className="py-1">
                    <Link href="/dashboard" onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2 text-xs text-white/55 hover:bg-white/4 hover:text-white/80 transition-colors">
                      <IconShield />
                      Security Dashboard
                    </Link>
                    <Link href="/profile" onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2 text-xs text-white/55 hover:bg-white/4 hover:text-white/80 transition-colors">
                      <IconUser />
                      Profile &amp; Settings
                    </Link>
                    {user.plan === 'free' && (
                      <Link href="/pricing" onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 text-xs text-violet-400 hover:bg-violet-500/8 transition-colors">
                        <span className="text-[10px]">↑</span>
                        Upgrade plan
                      </Link>
                    )}
                    {user.plan !== 'free' && (
                      <button
                        onClick={async () => {
                          setMenuOpen(false);
                          const res = await fetch('/api/stripe/portal', { method: 'POST' });
                          const data = await res.json();
                          if (data.url) window.location.href = data.url;
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/45 hover:bg-white/4 transition-colors text-left"
                      >
                        Billing &amp; Subscription
                      </button>
                    )}
                  </div>

                  <div className="border-t border-white/6 py-1">
                    <button onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/40 hover:bg-white/4 hover:text-white/70 transition-colors text-left">
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
            </>
          ) : (
            <>
              <Link href="/login" className="px-3 py-1.5 text-xs text-white/45 hover:text-white/75 transition-colors">
                Sign in
              </Link>
              <Link
                href="/signup"
                className="px-4 py-1.5 text-xs font-semibold rounded-lg text-white transition-colors"
                style={{ background: 'rgba(139,92,246,0.85)', border: '1px solid rgba(139,92,246,0.5)' }}
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </div>

      {menuOpen && <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />}
    </nav>
  );
}

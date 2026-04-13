'use client';

import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const PLAN_BADGE: Record<string, string> = {
  pro: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  team: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  free: 'bg-white/5 text-white/30 border-white/10',
};

export function Navbar() {
  const { user, loading, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push('/');
  }

  return (
    <nav className="border-b border-white/5 px-6 py-4 sticky top-0 z-40 backdrop-blur-md bg-[#0a0a0f]/80">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center text-sm font-bold select-none group-hover:bg-violet-500 transition-colors">
            V
          </div>
          <span className="font-semibold text-white/90 text-sm hidden sm:block">Is This Vibe-Coded?</span>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-1">
          <Link href="/feed" className="px-3 py-1.5 text-xs text-white/50 hover:text-white/80 transition-colors rounded-lg hover:bg-white/5">
            Feed
          </Link>
          <Link href="/pricing" className="px-3 py-1.5 text-xs text-white/50 hover:text-white/80 transition-colors rounded-lg hover:bg-white/5">
            Pricing
          </Link>
        </div>

        {/* Auth */}
        <div className="flex items-center gap-2">
          {loading ? (
            <div className="w-20 h-7 rounded-lg bg-white/5 animate-pulse" />
          ) : user ? (
            <div className="relative">
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/3 hover:bg-white/5 transition-colors text-sm"
              >
                <div className="w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center text-xs font-bold">
                  {user.name[0]?.toUpperCase()}
                </div>
                <span className="text-white/80 text-xs max-w-[80px] truncate hidden sm:block">{user.name}</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${PLAN_BADGE[user.plan]} hidden sm:block`}>
                  {user.plan.toUpperCase()}
                </span>
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-white/10 bg-[#111118] shadow-xl py-1 z-50">
                  <div className="px-3 py-2 border-b border-white/5">
                    <p className="text-xs font-medium text-white/80 truncate">{user.email}</p>
                    {user.plan === 'free' && (
                      <p className="text-xs text-white/30 mt-0.5">
                        {user.scansRemaining ?? 0} scan{user.scansRemaining !== 1 ? 's' : ''} left today
                      </p>
                    )}
                  </div>
                  {user.plan === 'free' && (
                    <Link
                      href="/pricing"
                      onClick={() => setMenuOpen(false)}
                      className="block px-3 py-2 text-xs text-violet-400 hover:bg-violet-500/10 transition-colors"
                    >
                      Upgrade to Pro →
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
                      className="block w-full text-left px-3 py-2 text-xs text-white/50 hover:bg-white/5 transition-colors"
                    >
                      Manage Billing
                    </button>
                  )}
                  <button
                    onClick={handleLogout}
                    className="block w-full text-left px-3 py-2 text-xs text-white/50 hover:bg-white/5 transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link
                href="/login"
                className="px-3 py-1.5 text-xs text-white/50 hover:text-white/80 transition-colors"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors"
              >
                Sign up free
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Click outside to close menu */}
      {menuOpen && <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />}
    </nav>
  );
}

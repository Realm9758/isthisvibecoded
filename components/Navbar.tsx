'use client';

import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NotificationBell } from './NotificationBell';
import { apiPath } from '@/lib/site';

const PLAN_BADGE: Record<string, string> = {
  pro:  'text-[#3b82f6] border-[rgba(59,130,246,0.35)]',
  team: 'text-[#38bdf8] border-[rgba(56,189,248,0.35)]',
  free: 'text-white/35 border-white/12',
};

const NAV_LINKS = [
  { href: '/what-we-check', label: 'coverage' },
  { href: '/scanner',       label: 'scanner' },
  { href: '/pricing',       label: 'pricing' },
];

/** The wordmark. A rotated square reads as a rivet plate at 12px. */
export function IroncladMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="12" y="1.5"
        width="14.85" height="14.85"
        transform="rotate(45 12 1.5)"
        fill="var(--accent)"
      />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function Navbar() {
  const { user, loading, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const router = useRouter();

  /*
   * At the very top of a page the bar has nothing to separate itself from, and
   * a solid strip with a border there just crops the hero. So it starts
   * invisible and materialises once there is content passing underneath it.
   *
   * The listener is passive and only ever flips a boolean, so a scroll that
   * does not cross the threshold costs one comparison.
   */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  async function handleLogout() {
    await logout();
    router.push('/');
  }

  return (
    <nav
      className="sticky top-0 z-40 px-6 backdrop-blur-xl border-b transition-colors duration-300"
      style={{
        background: scrolled ? 'rgba(0,0,0,0.82)' : 'transparent',
        borderColor: scrolled ? 'var(--border)' : 'transparent',
      }}
    >
      <div className="max-w-6xl mx-auto flex items-center h-16 gap-8">

        <Link href="/" className="flex items-center gap-2.5 shrink-0 group">
          <IroncladMark />
          <span className="font-mono text-sm font-semibold tracking-[0.18em] text-white group-hover:text-white/80 transition-colors">
            IRONCLAD
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-7 flex-1">
          {NAV_LINKS.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="font-mono text-[13px] text-white/45 hover:text-white transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3 shrink-0 ml-auto">
          {loading ? (
            <div className="w-32 h-8 bg-white/4 animate-pulse rounded" />
          ) : user ? (
            <>
              <NotificationBell />
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(v => !v)}
                  className="flex items-center gap-2 px-2.5 py-1.5 border transition-colors hover:bg-white/4"
                  style={{ borderColor: 'var(--border)', borderRadius: 4 }}
                >
                  {user.avatarUrl ? (
                    // User avatars are stored as compressed data URLs.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.avatarUrl} alt="" className="w-5 h-5 object-cover shrink-0" style={{ borderRadius: 2 }} />
                  ) : (
                    <div
                      className="w-5 h-5 flex items-center justify-center font-mono text-[10px] font-bold shrink-0"
                      style={{ background: 'var(--accent-dim)', color: 'var(--accent)', borderRadius: 2 }}
                    >
                      {user.name[0]?.toUpperCase()}
                    </div>
                  )}
                  <span className="font-mono text-xs text-white/60 max-w-20 truncate hidden sm:block">{user.name}</span>
                  <span className={`font-mono text-[9px] px-1 py-0.5 border hidden sm:block ${PLAN_BADGE[user.plan]}`} style={{ borderRadius: 2 }}>
                    {user.plan.toUpperCase()}
                  </span>
                  <span className="text-white/25"><IconChevron /></span>
                </button>

                {menuOpen && (
                  <div
                    className="absolute right-0 top-full mt-2 w-56 border py-1 z-50"
                    style={{ background: 'var(--surface-2)', borderColor: 'var(--border-2)', borderRadius: 4 }}
                  >
                    <div className="px-3 py-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
                      <p className="font-mono text-xs text-white/70 truncate">{user.email}</p>
                      {user.plan === 'free' && (
                        <p className="font-mono text-[11px] text-white/30 mt-1">
                          {user.scansRemaining ?? 0} of 3 scans left
                        </p>
                      )}
                    </div>

                    <div className="py-1">
                      <Link href="/dashboard" onClick={() => setMenuOpen(false)}
                        className="block px-3 py-2 font-mono text-xs text-white/55 hover:bg-white/4 hover:text-white transition-colors">
                        dashboard
                      </Link>
                      <Link href="/profile" onClick={() => setMenuOpen(false)}
                        className="block px-3 py-2 font-mono text-xs text-white/55 hover:bg-white/4 hover:text-white transition-colors">
                        settings
                      </Link>
                      {user.plan === 'free' ? (
                        <Link href="/pricing" onClick={() => setMenuOpen(false)}
                          className="block px-3 py-2 font-mono text-xs transition-colors hover:bg-[rgba(59,130,246,0.08)]"
                          style={{ color: 'var(--accent)' }}>
                          upgrade to pro
                        </Link>
                      ) : (
                        <button
                          onClick={async () => {
                            setMenuOpen(false);
                            const res = await fetch(apiPath('/api/stripe/portal'), { method: 'POST' });
                            const data = await res.json();
                            if (data.url) window.location.href = data.url;
                          }}
                          className="w-full text-left px-3 py-2 font-mono text-xs text-white/55 hover:bg-white/4 transition-colors"
                        >
                          billing
                        </button>
                      )}
                    </div>

                    <div className="border-t py-1" style={{ borderColor: 'var(--border)' }}>
                      <button onClick={handleLogout}
                        className="w-full text-left px-3 py-2 font-mono text-xs text-white/40 hover:bg-white/4 hover:text-white/70 transition-colors">
                        sign out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <Link href="/login" className="font-mono text-[13px] text-white/45 hover:text-white transition-colors">
                sign in
              </Link>
              <Link
                href="/"
                className="px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: 'var(--accent)', borderRadius: 4 }}
              >
                Scan my domain
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

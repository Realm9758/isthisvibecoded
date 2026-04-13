'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

// ── Constants ─────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#14b8a6',
  '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899',
];

const PLAN_BADGE: Record<string, { class: string; label: string }> = {
  pro:  { class: 'bg-violet-500/15 text-violet-300 border-violet-500/30',  label: 'Pro' },
  team: { class: 'bg-sky-500/15 text-sky-300 border-sky-500/30',           label: 'Team' },
  free: { class: 'bg-white/5 text-white/40 border-white/10',               label: 'Free' },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function getVibeColor(s: number) { return s >= 70 ? '#8b5cf6' : s >= 30 ? '#f59e0b' : '#22c55e'; }
function getSecColor(s: number)  { return s >= 70 ? '#22c55e' : s >= 40 ? '#f59e0b' : '#ef4444'; }

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
      <div className="px-5 py-3 border-b border-white/6">
        <h2 className="text-[11px] font-bold text-white/40 uppercase tracking-widest">{title}</h2>
      </div>
      <div>{children}</div>
    </div>
  );
}

function FieldRow({
  label, children, action,
}: {
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-white/5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-white/30 mb-0.5 uppercase tracking-wider">{label}</p>
        <div className="text-sm text-white/70">{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`rounded-lg bg-white/5 animate-pulse ${className ?? ''}`} />;
}

// ── Avatar component ───────────────────────────────────────────────────────

function Avatar({
  name, color, size = 56,
}: {
  name: string;
  color: string;
  size?: number;
}) {
  return (
    <div
      className="rounded-2xl flex items-center justify-center font-bold select-none shrink-0"
      style={{
        width: size,
        height: size,
        background: `${color}22`,
        border: `2px solid ${color}50`,
        color,
        fontSize: size * 0.38,
      }}
    >
      {name[0]?.toUpperCase()}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

interface Activity {
  posts: { id: string; domain: string; vibeScore: number; securityScore: number; createdAt: number }[];
  comments: { id: string; body: string; scanId: string; scanDomain: string; createdAt: number }[];
}

export default function ProfilePage() {
  const { user, loading, logout, refreshUser } = useAuth();
  const router = useRouter();

  // Edit state
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  // Avatar color picker
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [colorSaving, setColorSaving] = useState(false);

  // Activity
  const [activity, setActivity] = useState<Activity | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  // Stats
  const [passiveCount, setPassiveCount] = useState<number | null>(null);
  const [deepCount, setDeepCount] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    setNameInput(user.name);

    // Fetch stats
    fetch('/api/user/scans').then(r => r.json()).then(d => { if (Array.isArray(d)) setPassiveCount(d.length); });
    fetch('/api/user/deep-scans').then(r => r.json()).then(d => { if (Array.isArray(d)) setDeepCount(d.length); });

    // Fetch activity
    setActivityLoading(true);
    fetch('/api/user/activity').then(r => r.json()).then(d => {
      if (d.posts) setActivity(d);
    }).finally(() => setActivityLoading(false));
  }, [user]);

  useEffect(() => {
    if (editingName) nameRef.current?.focus();
  }, [editingName]);

  async function saveName() {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === user?.name) { setEditingName(false); return; }
    setNameError('');
    setNameSaving(true);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) { setNameError(data.error ?? 'Failed to save'); return; }
      await refreshUser();
      setEditingName(false);
    } finally {
      setNameSaving(false);
    }
  }

  async function saveColor(color: string) {
    setColorSaving(true);
    setColorPickerOpen(false);
    try {
      await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarColor: color }),
      });
      await refreshUser();
    } finally {
      setColorSaving(false);
    }
  }

  async function handleLogout() {
    await logout();
    router.push('/');
  }

  // ── Loading / unauthenticated guards ──

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
          <p className="text-white/40 text-sm mb-4">Sign in to view your profile.</p>
          <Link href="/login" className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'rgba(139,92,246,0.85)', border: '1px solid rgba(139,92,246,0.5)' }}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const avatarColor = user.avatarColor ?? '#8b5cf6';
  const badge = PLAN_BADGE[user.plan] ?? PLAN_BADGE.free;

  return (
    <main className="min-h-screen px-6 py-10" style={{ background: '#0a0a0f' }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 30% at 50% 0%, rgba(139,92,246,0.05) 0%, transparent 60%)' }}
      />

      <div className="relative max-w-2xl mx-auto">

        {/* Back */}
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-xs text-white/30 hover:text-white/55 transition-colors mb-8">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          Dashboard
        </Link>

        {/* ── Profile hero ── */}
        <div
          className="rounded-2xl border border-white/8 p-6 mb-5 flex flex-col sm:flex-row items-start sm:items-center gap-5"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
          {/* Avatar with color picker */}
          <div className="relative shrink-0">
            <Avatar name={user.name} color={avatarColor} size={64} />
            <button
              onClick={() => setColorPickerOpen(o => !o)}
              className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full border border-white/15 flex items-center justify-center transition-colors hover:bg-white/15"
              style={{ background: 'rgba(255,255,255,0.08)' }}
              title="Change avatar colour"
            >
              {colorSaving ? (
                <div className="w-3 h-3 border border-white/30 border-t-white/70 rounded-full animate-spin" />
              ) : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
                  <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
                  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
                </svg>
              )}
            </button>

            {/* Color picker popover */}
            {colorPickerOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setColorPickerOpen(false)} />
                <div
                  className="absolute top-full left-0 mt-2 z-20 p-3 rounded-xl border border-white/10 shadow-2xl"
                  style={{ background: '#0f0f18' }}
                >
                  <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Avatar colour</p>
                  <div className="grid grid-cols-5 gap-1.5">
                    {AVATAR_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => saveColor(c)}
                        className="w-7 h-7 rounded-lg transition-transform hover:scale-110 border-2"
                        style={{
                          background: c,
                          borderColor: c === avatarColor ? 'white' : 'transparent',
                        }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Name + meta */}
          <div className="flex-1 min-w-0">
            {editingName ? (
              <div className="flex items-center gap-2 mb-1">
                <input
                  ref={nameRef}
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
                  maxLength={40}
                  className="text-xl font-bold bg-transparent text-white outline-none border-b-2 pb-0.5 transition-colors"
                  style={{ borderColor: avatarColor }}
                />
                <button
                  onClick={saveName}
                  disabled={nameSaving}
                  className="px-3 py-1 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-colors"
                  style={{ background: `${avatarColor}bb` }}
                >
                  {nameSaving ? '…' : 'Save'}
                </button>
                <button onClick={() => { setEditingName(false); setNameInput(user.name); }} className="text-xs text-white/30 hover:text-white/55 transition-colors px-2 py-1">
                  Cancel
                </button>
                {nameError && <p className="text-xs text-red-400 ml-1">{nameError}</p>}
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl font-bold text-white">{user.name}</h1>
                <button
                  onClick={() => setEditingName(true)}
                  className="p-1 rounded-md text-white/25 hover:text-white/55 hover:bg-white/6 transition-colors"
                  title="Edit username"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
              </div>
            )}

            <p className="text-xs text-white/35 font-mono mb-2">{user.email}</p>

            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${badge.class}`}>
                {badge.label}
              </span>
              {user.plan === 'free' && user.scansRemaining !== null && (
                <span className="text-[11px] text-white/30">
                  {user.scansRemaining} passive scan{user.scansRemaining !== 1 ? 's' : ''} left today
                </span>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="flex sm:flex-col gap-4 sm:gap-3 shrink-0 sm:text-right">
            <div>
              <p className="text-lg font-bold text-white/80">{passiveCount ?? '—'}</p>
              <p className="text-[10px] text-white/30 uppercase tracking-wider">Scans</p>
            </div>
            <div>
              <p className="text-lg font-bold text-white/80">{deepCount ?? '—'}</p>
              <p className="text-[10px] text-white/30 uppercase tracking-wider">Deep Scans</p>
            </div>
            <div>
              <p className="text-lg font-bold" style={{ color: avatarColor }}>
                {activity?.posts.length ?? '—'}
              </p>
              <p className="text-[10px] text-white/30 uppercase tracking-wider">Posts</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">

          {/* ── Account ── */}
          <SectionCard title="Account">
            <FieldRow label="Email address">
              <span className="font-mono text-sm text-white/60">{user.email}</span>
            </FieldRow>
            <FieldRow
              label="Subscription plan"
              action={
                user.plan === 'free' ? (
                  <Link
                    href="/pricing"
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                    style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)', color: '#a78bfa' }}
                  >
                    Upgrade to Pro
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
            >
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${badge.class}`}>
                {badge.label}
              </span>
            </FieldRow>
            {user.plan === 'free' && (
              <FieldRow label="Deep scans remaining">
                <span className="text-sm">
                  <span className="font-semibold text-white/70">{Math.max(0, 2 - (deepCount ?? 0))}</span>
                  <span className="text-white/30"> of 2 remaining</span>
                </span>
              </FieldRow>
            )}
          </SectionCard>

          {/* ── Upgrade banner for free users ── */}
          {user.plan === 'free' && (
            <div
              className="rounded-2xl border p-5 flex items-center justify-between gap-4"
              style={{ background: 'rgba(139,92,246,0.04)', borderColor: 'rgba(139,92,246,0.2)' }}
            >
              <div>
                <p className="text-sm font-semibold text-white/80 mb-0.5">Go unlimited with Pro</p>
                <p className="text-xs text-white/35">Unlimited scans, deep scans, PDF export — £4.99/month.</p>
              </div>
              <Link
                href="/pricing"
                className="shrink-0 px-4 py-2 rounded-xl text-xs font-bold text-white"
                style={{ background: 'rgba(139,92,246,0.85)', border: '1px solid rgba(139,92,246,0.5)' }}
              >
                See plans
              </Link>
            </div>
          )}

          {/* ── Recent Posts ── */}
          <SectionCard title="Recent Posts">
            {activityLoading ? (
              <div className="p-5 space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : !activity?.posts.length ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-white/30 mb-1">No posts yet</p>
                <p className="text-xs text-white/20">Scan a site and hit "Publish" to share it on the leaderboard.</p>
              </div>
            ) : (
              <>
                {activity.posts.map(p => (
                  <Link
                    key={p.id}
                    href={`/result/${p.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-white/5 last:border-0 hover:bg-white/2 transition-colors group"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white/75 truncate group-hover:text-white/90 transition-colors">{p.domain}</p>
                      <p className="text-[11px] text-white/25 mt-0.5">{timeAgo(p.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-center">
                        <p className="text-xs font-bold tabular-nums" style={{ color: getVibeColor(p.vibeScore) }}>{p.vibeScore}%</p>
                        <p className="text-[9px] text-white/25 uppercase tracking-wider">vibe</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs font-bold tabular-nums" style={{ color: getSecColor(p.securityScore) }}>{p.securityScore}</p>
                        <p className="text-[9px] text-white/25 uppercase tracking-wider">sec</p>
                      </div>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/20 group-hover:text-white/50 transition-colors">
                        <path d="m9 18 6-6-6-6"/>
                      </svg>
                    </div>
                  </Link>
                ))}
                <div className="px-5 py-3 border-t border-white/5">
                  <Link href="/feed" className="text-xs text-white/30 hover:text-white/55 transition-colors">
                    View all on Leaderboard →
                  </Link>
                </div>
              </>
            )}
          </SectionCard>

          {/* ── Recent Comments ── */}
          <SectionCard title="Recent Comments">
            {activityLoading ? (
              <div className="p-5 space-y-3">
                {[1, 2].map(i => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : !activity?.comments.length ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-white/30 mb-1">No comments yet</p>
                <p className="text-xs text-white/20">Join the discussion on scans in the Leaderboard.</p>
              </div>
            ) : (
              <>
                {activity.comments.map(c => (
                  <div key={c.id} className="px-5 py-3.5 border-b border-white/5 last:border-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      {c.scanDomain ? (
                        <Link href={`/result/${c.scanId}`} className="text-[11px] font-mono text-white/40 hover:text-white/65 transition-colors truncate">
                          {c.scanDomain}
                        </Link>
                      ) : (
                        <span className="text-[11px] text-white/25">Unknown site</span>
                      )}
                      <span className="text-[10px] text-white/20 shrink-0">{timeAgo(c.createdAt)}</span>
                    </div>
                    <p className="text-sm text-white/55 leading-relaxed line-clamp-2">{c.body}</p>
                  </div>
                ))}
                <div className="px-5 py-3 border-t border-white/5">
                  <Link href="/feed" className="text-xs text-white/30 hover:text-white/55 transition-colors">
                    Browse Leaderboard →
                  </Link>
                </div>
              </>
            )}
          </SectionCard>

          {/* ── Session ── */}
          <SectionCard title="Session">
            <FieldRow
              label="Signed in as"
              action={
                <button
                  onClick={handleLogout}
                  className="px-3 py-1.5 rounded-lg text-xs text-white/40 border border-white/8 hover:bg-red-500/8 hover:text-red-400 hover:border-red-500/20 transition-colors"
                >
                  Sign out
                </button>
              }
            >
              <span className="font-mono text-xs text-white/55">{user.email}</span>
            </FieldRow>
          </SectionCard>

        </div>
      </div>
    </main>
  );
}

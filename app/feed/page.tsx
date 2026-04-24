'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';

// ── Types ──────────────────────────────────────────────────────────────────

interface LeaderboardItem {
  id: string;
  url: string;
  vibeScore: number;
  vibeLabel: string;
  securityScore: number;
  riskLevel: string;
  techStack: string[];
  hosting?: string | null;
  createdAt: number;
  scannedBy?: string;
  likeCount?: number;
  likedByMe?: boolean;
  rankDelta: number | null;     // positive = moved up, negative = dropped
  previousRank: number | null;  // null = first appearance
  topStreak?: number;           // days held at #1 (only on rank=1 items)
}

interface PopularItem {
  domain: string;
  count: number;
  latestScan: {
    id: string;
    createdAt: number;
    scannedBy?: string;
    result?: {
      vibe?: { score: number; label: string };
      security?: { score: number; riskLevel: string };
      techStack?: { name: string }[];
    };
  };
}

interface Comment {
  id: string;
  user_name: string;
  body: string;
  created_at: number;
  edited_at: number | null;
  parent_id: string | null;
  is_mine: boolean;
  like_count: number;
  liked_by_me: boolean;
  replies?: Comment[];
}

interface FullScan {
  result: {
    url: string;
    vibe: { score: number; label: string; reasons: string[]; confidence: string };
    security: {
      score: number;
      riskLevel: string;
      httpsEnabled: boolean;
      headers: { name: string; present: boolean; recommendation: string }[];
    };
    techStack: { name: string; category: string }[];
    publicKeys: { type: string; risk: string }[];
  };
}

interface Badge {
  emoji: string;
  label: string;
  color: string;
  bg: string;
  border: string;
}

interface Moment {
  id: string;
  icon: string;
  text: string;
}

type Category = 'vibe' | 'secure' | 'recent' | 'popular';
type TimeFilter = 'today' | 'week' | 'all';

// ── Helpers ────────────────────────────────────────────────────────────────

function getVibeColor(s: number) { return s >= 70 ? '#8b5cf6' : s >= 30 ? '#f59e0b' : '#22c55e'; }
function getSecColor(s: number)  { return s >= 70 ? '#22c55e' : s >= 40 ? '#f59e0b' : '#ef4444'; }
function hostname(url: string)   { try { return new URL(url).hostname; } catch { return url; } }

function timeAgo(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fullDate(ms: number) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(ms));
}

function timeUntilReset(): string {
  const now = new Date();
  const midnight = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1,
  ));
  const ms = midnight.getTime() - now.getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const RISK_COLOR: Record<string, string> = {
  Low: '#22c55e', Medium: '#f59e0b', High: '#f97316', Critical: '#ef4444',
};
const RISK_BG: Record<string, string> = {
  Low: 'rgba(34,197,94,0.1)', Medium: 'rgba(245,158,11,0.1)', High: 'rgba(249,115,22,0.1)', Critical: 'rgba(239,68,68,0.1)',
};
const RISK_BORDER: Record<string, string> = {
  Low: 'rgba(34,197,94,0.25)', Medium: 'rgba(245,158,11,0.25)', High: 'rgba(249,115,22,0.25)', Critical: 'rgba(239,68,68,0.25)',
};

const PODIUM = {
  1: { rank: '#fbbf24', bg: 'rgba(251,191,36,0.06)',  border: 'rgba(251,191,36,0.25)', glow: 'rgba(251,191,36,0.18)' },
  2: { rank: '#94a3b8', bg: 'rgba(148,163,184,0.04)', border: 'rgba(148,163,184,0.18)', glow: 'transparent' },
  3: { rank: '#cd7f32', bg: 'rgba(180,110,60,0.05)',  border: 'rgba(180,110,60,0.2)',  glow: 'transparent' },
} as Record<number, { rank: string; bg: string; border: string; glow: string }>;

function getBadges(item: LeaderboardItem, rank: number): Badge[] {
  const badges: Badge[] = [];
  const age = Date.now() - item.createdAt;

  if (rank === 1)
    badges.push({ emoji: '👑', label: 'Champion', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.3)' });
  if (item.vibeScore >= 95 && item.securityScore >= 95)
    badges.push({ emoji: '💯', label: 'Flawless', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.3)' });
  else if (item.securityScore >= 90)
    badges.push({ emoji: '🔒', label: 'Fortress', color: '#34d399', bg: 'rgba(52,211,153,0.08)', border: 'rgba(52,211,153,0.25)' });
  if (item.vibeScore >= 90 && !(item.vibeScore >= 95 && item.securityScore >= 95))
    badges.push({ emoji: '🔥', label: 'Pure Vibe', color: '#c4b5fd', bg: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.28)' });
  if (age < 3_600_000)
    badges.push({ emoji: '🆕', label: 'Just Arrived', color: '#38bdf8', bg: 'rgba(56,189,248,0.08)', border: 'rgba(56,189,248,0.22)' });

  return badges.slice(0, 2);
}

function generateMoments(items: LeaderboardItem[], category: Category): Moment[] {
  const moments: Moment[] = [];
  if (items.length === 0) return moments;

  const top = items[0];
  const topAge = Date.now() - top.createdAt;

  if (topAge < 3_600_000 && (category === 'vibe' || category === 'secure'))
    moments.push({ id: 'new-1', icon: '👑', text: `${hostname(top.url)} just took #1` });

  const perfect = items.find(i => i.vibeScore >= 99 && i.securityScore >= 99);
  if (perfect)
    moments.push({ id: 'perfect', icon: '💯', text: `${hostname(perfect.url)} hit the ceiling — 99/99` });

  const biggestMover = items
    .filter(i => i.rankDelta !== null && i.rankDelta >= 5)
    .sort((a, b) => (b.rankDelta ?? 0) - (a.rankDelta ?? 0))[0];
  if (biggestMover) {
    moments.push({ id: 'rocket', icon: '🚀', text: `${hostname(biggestMover.url)} jumped ↑${biggestMover.rankDelta} spots today` });
  } else {
    const rocketEntry = items.find((i, idx) => idx > 8 && Date.now() - i.createdAt < 7_200_000 && i.vibeScore >= 85);
    if (rocketEntry)
      moments.push({ id: 'rocket', icon: '🚀', text: `${hostname(rocketEntry.url)} just appeared in the top 10` });
  }

  return moments;
}

function buildApiUrl(category: Category, time: TimeFilter): string {
  const limit = category === 'recent' ? 50 : 30;
  let url = `/api/scans?type=${category}&limit=${limit}`;
  if ((category === 'vibe' || category === 'secure' || category === 'popular') && time !== 'all') {
    url += `&time=${time}`;
  }
  return url;
}

// ── Icons ──────────────────────────────────────────────────────────────────

function IconHeart({ filled }: { filled?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  );
}
function IconReply() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
    </svg>
  );
}
function IconEdit() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
}
function IconTrash() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6"/>
    </svg>
  );
}
function IconArrowUp() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7"/>
    </svg>
  );
}
function IconShield() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  );
}
function IconClock() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
    </svg>
  );
}
function IconUser() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  );
}
function IconScan() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/>
      <path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
      <line x1="7" y1="12" x2="17" y2="12"/>
    </svg>
  );
}

// Tech stack color map
const TECH_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  'next.js':     { color: '#ffffff', bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)' },
  'react':       { color: '#61dafb', bg: 'rgba(97,218,251,0.08)',  border: 'rgba(97,218,251,0.2)' },
  'tailwind':    { color: '#38bdf8', bg: 'rgba(56,189,248,0.08)',  border: 'rgba(56,189,248,0.2)' },
  'tailwind css':{ color: '#38bdf8', bg: 'rgba(56,189,248,0.08)',  border: 'rgba(56,189,248,0.2)' },
  'vercel':      { color: '#ffffff', bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.1)' },
  'supabase':    { color: '#3ecf8e', bg: 'rgba(62,207,142,0.08)',  border: 'rgba(62,207,142,0.2)' },
  'firebase':    { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.2)' },
  'stripe':      { color: '#a78bfa', bg: 'rgba(167,139,250,0.08)', border: 'rgba(167,139,250,0.2)' },
  'typescript':  { color: '#3b82f6', bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.2)' },
  'vue':         { color: '#4ade80', bg: 'rgba(74,222,128,0.08)',  border: 'rgba(74,222,128,0.2)' },
  'wordpress':   { color: '#60a5fa', bg: 'rgba(96,165,250,0.08)',  border: 'rgba(96,165,250,0.2)' },
  'cloudflare':  { color: '#f97316', bg: 'rgba(249,115,22,0.08)',  border: 'rgba(249,115,22,0.2)' },
};

function getTechStyle(name: string) {
  return TECH_COLORS[name.toLowerCase()] ?? { color: 'rgba(255,255,255,0.55)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.1)' };
}

// ── ProgressBar ────────────────────────────────────────────────────────────

function ProgressBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: color, boxShadow: `0 0 6px ${color}60` }}
      />
    </div>
  );
}

// ── SectionHeader ──────────────────────────────────────────────────────────

function SectionHeader({ label, icon }: { label: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon && <span className="text-white/35">{icon}</span>}
      <p className="text-[11px] font-bold text-white/40 uppercase tracking-widest">{label}</p>
    </div>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`rounded-lg bg-white/5 animate-pulse ${className ?? ''}`} />;
}

// ── RankDeltaChip ──────────────────────────────────────────────────────────

function RankDeltaChip({ delta, isNew }: { delta: number | null; isNew?: boolean }) {
  if (isNew) {
    return (
      <span
        className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-full"
        style={{ color: '#a78bfa', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)' }}
      >
        NEW
      </span>
    );
  }
  if (delta === null || delta === 0) return null;
  const up = delta > 0;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
      style={up
        ? { color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)' }
        : { color: '#f87171', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)' }
      }
    >
      {up ? '↑' : '↓'}{Math.abs(delta)}
    </span>
  );
}

// ── ActivityPulse ──────────────────────────────────────────────────────────

function ActivityPulse({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-white/35">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
      {count > 0
        ? `${count} scan${count !== 1 ? 's' : ''} in the last hour`
        : 'Live rankings'}
    </span>
  );
}

// ── SpotlightBanner ────────────────────────────────────────────────────────

function SpotlightBanner({ item, isOwn }: { item: LeaderboardItem; isOwn: boolean }) {
  const vc = getVibeColor(item.vibeScore);
  const sc = getSecColor(item.securityScore);
  const site = hostname(item.url);
  const streak = item.topStreak ?? 0;

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl border mb-5"
      style={{ background: 'rgba(251,191,36,0.04)', borderColor: 'rgba(251,191,36,0.18)' }}
    >
      <span className="text-base shrink-0" aria-hidden="true">👑</span>
      <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
        <span className="text-[10px] font-bold tracking-widest text-amber-400/60 uppercase shrink-0">
          {isOwn ? 'You hold #1' : 'Current #1'}
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/favicon?domain=${encodeURIComponent(site)}`}
          alt=""
          width={14}
          height={14}
          className="rounded shrink-0"
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
        <span className="text-sm font-bold text-white/85 font-mono">{site}</span>
        <span className="text-xs font-black tabular-nums" style={{ color: vc }}>{item.vibeScore}</span>
        <span className="text-[10px] text-white/25">vibe</span>
        <span className="text-xs font-black tabular-nums" style={{ color: sc }}>{item.securityScore}</span>
        <span className="text-[10px] text-white/25">sec</span>
        {streak > 1 && (
          <span className="text-[10px] text-amber-400/45 shrink-0">{streak} days at the top</span>
        )}
      </div>
      {isOwn && (
        <span className="text-[10px] text-amber-400/50 italic shrink-0 hidden sm:block">
          Something feels different up here.
        </span>
      )}
    </div>
  );
}

// ── FlawlessWall ───────────────────────────────────────────────────────────

function FlawlessWall({ items }: { items: LeaderboardItem[] }) {
  const flawless = items.filter(i => i.vibeScore >= 95 && i.securityScore >= 95);
  if (flawless.length === 0) return null;

  return (
    <div
      className="mt-4 rounded-xl border px-4 py-4"
      style={{ background: 'rgba(255,255,255,0.01)', borderColor: 'rgba(255,255,255,0.06)' }}
    >
      <p className="text-[10px] font-bold tracking-widest text-white/25 uppercase mb-3">
        Sites that hit the ceiling
      </p>
      <div className="flex items-center gap-4 flex-wrap">
        {flawless.map(i => {
          const site = hostname(i.url);
          return (
            <button
              key={i.id}
              className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/65 transition-colors"
              onClick={() => { /* handled by parent via prop if needed */ }}
              title={`Vibe ${i.vibeScore} · Sec ${i.securityScore}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/favicon?domain=${encodeURIComponent(site)}`}
                alt=""
                width={14}
                height={14}
                className="rounded shrink-0 opacity-60"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
              {site}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── LiveTicker ─────────────────────────────────────────────────────────────

function buildTickerEvents(items: LeaderboardItem[]): string[] {
  return items.map((item, i) => {
    const domain = hostname(item.url);
    const rank = i + 1;
    const age = Date.now() - item.createdAt;
    if (item.rankDelta !== null && item.rankDelta >= 5) return `${domain} jumped ↑${item.rankDelta} spots`;
    if (item.rankDelta !== null && item.rankDelta <= -3) return `${domain} dropped ↓${Math.abs(item.rankDelta)} spots`;
    if (age < 600_000) return `${domain} just entered the leaderboard`;
    if (item.vibeScore >= 99 && item.securityScore >= 99) return `${domain} hit a perfect score`;
    if (rank <= 5) return `${domain} is holding #${rank}`;
    return `${domain} scanned — vibe ${item.vibeScore}`;
  });
}

function LiveTicker({ items }: { items: LeaderboardItem[] }) {
  if (items.length === 0) return null;

  const events = buildTickerEvents(items);
  const all = [...events, ...events];
  const duration = Math.max(30, events.length * 6);

  return (
    <div
      className="border-b border-white/6 overflow-hidden"
      style={{ background: 'rgba(139,92,246,0.03)', height: '34px' }}
    >
      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-track { animation: ticker-scroll ${duration}s linear infinite; }
        .ticker-track:hover { animation-play-state: paused; }
      `}</style>
      <div className="ticker-track flex items-center h-full gap-0 whitespace-nowrap">
        {all.map((event, i) => (
          <span key={i} className="flex items-center gap-2 px-5 text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400/40 shrink-0" aria-hidden="true" />
            <span className="text-white/45">{event}</span>
            <span className="text-white/10 ml-3">│</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── MomentToasts ───────────────────────────────────────────────────────────

function MomentToasts({ moments }: { moments: Moment[] }) {
  const [visible, setVisible] = useState<Moment | null>(null);
  const [queue, setQueue] = useState<Moment[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (moments.length > 0) {
      setTimeout(() => setQueue(moments), 2000);
    }
  }, [moments]);

  useEffect(() => {
    if (!visible && queue.length > 0) {
      const [next, ...rest] = queue;
      setVisible(next);
      setQueue(rest);
    }
  }, [visible, queue]);

  useEffect(() => {
    if (!visible) return;
    timerRef.current = setTimeout(() => setVisible(null), 5000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="fixed top-20 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl"
      style={{
        background: 'rgba(13,13,22,0.95)',
        borderColor: 'rgba(139,92,246,0.3)',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(139,92,246,0.1)',
        animation: 'moment-in 0.3s ease',
      }}
    >
      <style>{`
        @keyframes moment-in {
          from { opacity: 0; transform: translateY(-8px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <span className="text-base">{visible.icon}</span>
      <p className="text-xs text-white/70 max-w-[220px]">{visible.text}</p>
      <button
        onClick={() => setVisible(null)}
        className="ml-1 text-white/25 hover:text-white/55 transition-colors text-sm leading-none"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

// ── PersonalRankStrip ──────────────────────────────────────────────────────

const RANK_BADGES = [
  {
    id: 'top10',
    icon: '🏆',
    label: 'Top 10 Builder',
    color: '#fbbf24',
    bg: 'rgba(251,191,36,0.1)',
    border: 'rgba(251,191,36,0.28)',
  },
  {
    id: 'flawless',
    icon: '💯',
    label: 'Flawless',
    color: '#a78bfa',
    bg: 'rgba(167,139,250,0.1)',
    border: 'rgba(167,139,250,0.28)',
  },
];

function PersonalRankStrip({ items, category }: { items: LeaderboardItem[]; category: Category }) {
  const { user } = useAuth();
  if (!user) return null;

  const myRankIdx = items.findIndex(i => i.scannedBy === user.name);
  if (myRankIdx === -1) return null;

  const item = items[myRankIdx];
  const rank = myRankIdx + 1;

  const rivalAbove = myRankIdx > 0 ? items[myRankIdx - 1] : null;
  const rivalBelow = myRankIdx < items.length - 1 ? items[myRankIdx + 1] : null;

  let nearMiss: string | null = null;
  if (rank === 1)        nearMiss = "You're sitting at #1. Something feels different up here.";
  else if (rank <= 3)    nearMiss = `You're on the podium at #${rank}. Don't slip.`;
  else if (rank <= 10)   nearMiss = `You're in the Top 10. ${rivalAbove ? `${hostname(rivalAbove.url)} is just ahead.` : "Don't give up the spot."}`;
  else if (rank === 11)  nearMiss = 'One more scan could push you into Top 10.';
  else if (rank <= 14)   nearMiss = `${rank - 10} spot${rank - 10 > 1 ? 's' : ''} from Top 10.`;
  else if (rank <= 20)   nearMiss = 'Top 10 is within reach.';

  const top10Unlocked = rank <= 10;
  const flawlessUnlocked = item.vibeScore >= 95 && item.securityScore >= 95;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-violet-500/12"
      style={{ background: 'rgba(9,9,18,0.97)', backdropFilter: 'blur(20px)' }}
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 space-y-2">

        {/* Main rank row */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.25)' }}
            >
              {user.name[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs text-white/70">
                  <span className="font-semibold text-white/90">@{user.name}</span>
                  {' · '}
                  <span
                    className="font-black tabular-nums text-sm"
                    style={{ color: rank === 1 ? '#fbbf24' : rank <= 3 ? '#cd7f32' : rank <= 10 ? '#a78bfa' : 'rgba(255,255,255,0.45)' }}
                  >
                    #{rank}
                  </span>
                  {' on '}
                  <span className="text-white/45 font-mono text-[11px]">{hostname(item.url)}</span>
                </p>
                {item.rankDelta !== null && item.rankDelta !== 0 && (
                  <RankDeltaChip delta={item.rankDelta} />
                )}
                {item.rankDelta === null && item.previousRank === null && (
                  <RankDeltaChip delta={null} isNew />
                )}
              </div>
              {nearMiss && (
                <p
                  className="text-[10px] mt-0.5 truncate"
                  style={{ color: rank <= 3 ? 'rgba(251,191,36,0.65)' : 'rgba(167,139,250,0.55)' }}
                >
                  {nearMiss}
                </p>
              )}
            </div>
          </div>

          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all shrink-0 hover:scale-[1.02]"
            style={{ background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.3)' }}
          >
            <IconScan />
            Scan again
          </Link>
        </div>

        {/* Badges + rivals row */}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-none">
          {RANK_BADGES.map(b => {
            const unlocked = b.id === 'top10' ? top10Unlocked : flawlessUnlocked;
            const progress = b.id === 'top10'
              ? `${rank} → Top 10`
              : `vibe ${item.vibeScore}/95 · sec ${item.securityScore}/95`;
            return (
              <div
                key={b.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg border whitespace-nowrap shrink-0"
                style={unlocked
                  ? { color: b.color, background: b.bg, borderColor: b.border }
                  : { color: 'rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.07)' }
                }
              >
                <span className="text-[11px]">{unlocked ? b.icon : '🔒'}</span>
                <span className="text-[10px] font-semibold">{b.label}</span>
                {!unlocked && (
                  <span className="text-[9px] font-mono opacity-50">{progress}</span>
                )}
              </div>
            );
          })}

          {rivalBelow && (
            <span className="text-[10px] text-white/20 shrink-0 ml-1">
              <span className="text-white/30">{hostname(rivalBelow.url)}</span> is right behind you
            </span>
          )}

          {category === 'vibe' || category === 'secure' ? (
            <span className="text-[10px] text-white/18 shrink-0 ml-auto">
              Today&apos;s rank locks in {timeUntilReset()}
            </span>
          ) : null}
        </div>

      </div>
    </div>
  );
}

// ── Comment component ──────────────────────────────────────────────────────

interface CommentProps {
  comment: Comment;
  onLike: (id: string) => void;
  onReply: (id: string, name: string) => void;
  onEdit: (id: string, body: string) => void;
  onDelete: (id: string) => void;
  isReply?: boolean;
}

function CommentCard({ comment: c, onLike, onReply, onEdit, onDelete, isReply }: CommentProps) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(c.body);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function submitEdit() {
    if (!editBody.trim() || editBody === c.body) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/comments/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: editBody.trim() }),
      });
      const data = await res.json();
      if (res.ok) { onEdit(c.id, data.body); setEditing(false); }
    } finally {
      setSaving(false);
    }
  }

  async function submitDelete() {
    const res = await fetch(`/api/comments/${c.id}`, { method: 'DELETE' });
    if (res.ok) onDelete(c.id);
    setConfirmDelete(false);
  }

  return (
    <div className={`group ${isReply ? 'ml-8 mt-2' : ''}`}>
      <div
        className="rounded-xl border transition-all"
        style={{
          background: isReply ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.025)',
          borderColor: 'rgba(255,255,255,0.07)',
        }}
      >
        <div className="p-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.2)' }}
              >
                {c.user_name[0]?.toUpperCase()}
              </div>
              <div>
                <span className="text-xs font-semibold text-white/70">@{c.user_name}</span>
                <span className="text-[10px] text-white/25 ml-2">{timeAgo(c.created_at)}</span>
                {c.edited_at && <span className="text-[9px] text-white/20 ml-1.5 italic">edited</span>}
              </div>
            </div>
            {c.is_mine && !editing && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => { setEditBody(c.body); setEditing(true); }}
                  aria-label="Edit comment"
                  className="p-1 rounded text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
                >
                  <IconEdit />
                </button>
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    aria-label="Delete comment"
                    className="p-1 rounded text-white/30 hover:text-red-400 hover:bg-red-500/8 transition-colors"
                  >
                    <IconTrash />
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <button onClick={submitDelete} className="px-2 py-0.5 rounded text-[10px] text-red-400 bg-red-500/12 border border-red-500/25 hover:bg-red-500/20 transition-colors">
                      Delete
                    </button>
                    <button onClick={() => setConfirmDelete(false)} className="px-2 py-0.5 rounded text-[10px] text-white/35 hover:bg-white/5 transition-colors">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {editing ? (
            <div className="space-y-2">
              <textarea
                value={editBody}
                onChange={e => setEditBody(e.target.value)}
                rows={2}
                maxLength={500}
                autoFocus
                className="w-full px-3 py-2 rounded-lg text-xs text-white/80 placeholder-white/20 outline-none resize-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(139,92,246,0.35)' }}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={submitEdit}
                  disabled={saving || !editBody.trim()}
                  className="px-3 py-1 rounded-lg text-[11px] font-semibold text-white disabled:opacity-40 transition-colors"
                  style={{ background: 'rgba(139,92,246,0.7)' }}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditing(false)} className="px-3 py-1 rounded-lg text-[11px] text-white/35 hover:bg-white/5 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-white/60 leading-relaxed">{c.body}</p>
          )}

          {!editing && (
            <div className="flex items-center gap-3 mt-2.5">
              <button
                onClick={() => onLike(c.id)}
                aria-label={c.liked_by_me ? 'Unlike comment' : 'Like comment'}
                className="flex items-center gap-1.5 text-[11px] transition-colors"
                style={{ color: c.liked_by_me ? '#f43f5e' : 'rgba(255,255,255,0.25)' }}
              >
                <IconHeart filled={c.liked_by_me} />
                {c.like_count > 0 && <span>{c.like_count}</span>}
              </button>
              {!isReply && (
                <button
                  onClick={() => onReply(c.id, c.user_name)}
                  className="flex items-center gap-1.5 text-[11px] text-white/25 hover:text-white/55 transition-colors"
                >
                  <IconReply />
                  Reply
                </button>
              )}
            </div>
          )}
        </div>

        {c.replies && c.replies.length > 0 && (
          <div className="border-t border-white/5 px-3 pb-3 pt-2 space-y-2">
            {c.replies.map(reply => (
              <CommentCard
                key={reply.id}
                comment={reply}
                onLike={onLike}
                onReply={onReply}
                onEdit={onEdit}
                onDelete={onDelete}
                isReply
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── CommentsSection ────────────────────────────────────────────────────────

function CommentsSection({ scanId }: { scanId: string }) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/comments?scanId=${scanId}`)
      .then(r => r.json())
      .then(d => {
        if (!Array.isArray(d)) return;
        const top: Comment[] = [];
        const map = new Map<string, Comment>();
        for (const c of d) { map.set(c.id, { ...c, replies: [] }); }
        for (const c of map.values()) {
          if (c.parent_id && map.has(c.parent_id)) {
            map.get(c.parent_id)!.replies!.push(c);
          } else {
            top.push(c);
          }
        }
        top.sort((a, b) => b.created_at - a.created_at);
        setComments(top);
      })
      .finally(() => setLoading(false));
  }, [scanId]);

  useEffect(() => {
    if (replyTo) textRef.current?.focus();
  }, [replyTo]);

  async function handlePost(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setError('');
    setPosting(true);
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId, body: body.trim(), parentId: replyTo?.id ?? null }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to post'); return; }
      if (replyTo) {
        setComments(prev => prev.map(c =>
          c.id === replyTo.id ? { ...c, replies: [...(c.replies ?? []), data] } : c
        ));
        setReplyTo(null);
      } else {
        setComments(prev => [data, ...prev]);
      }
      setBody('');
    } finally {
      setPosting(false);
    }
  }

  function handleLike(commentId: string) {
    if (!user) return;
    fetch('/api/comments/like', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentId }),
    }).then(r => r.json()).then(data => {
      function update(c: Comment): Comment {
        if (c.id === commentId) return { ...c, liked_by_me: data.liked, like_count: data.count };
        if (c.replies) return { ...c, replies: c.replies.map(update) };
        return c;
      }
      setComments(prev => prev.map(update));
    });
  }

  function handleEdit(commentId: string, newBody: string) {
    function update(c: Comment): Comment {
      if (c.id === commentId) return { ...c, body: newBody, edited_at: Date.now() };
      if (c.replies) return { ...c, replies: c.replies.map(update) };
      return c;
    }
    setComments(prev => prev.map(update));
  }

  function handleDelete(commentId: string) {
    function remove(list: Comment[]): Comment[] {
      return list.filter(c => c.id !== commentId).map(c => ({ ...c, replies: remove(c.replies ?? []) }));
    }
    setComments(prev => remove(prev));
  }

  const topCount = comments.length;
  const totalCount = comments.reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0);

  return (
    <div>
      <SectionHeader
        label={`Discussion ${totalCount > 0 ? `· ${totalCount}` : ''}`}
        icon={
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        }
      />

      {user ? (
        <form onSubmit={handlePost} className="mb-4">
          {replyTo && (
            <div className="flex items-center gap-2 mb-2 px-3 py-1.5 rounded-lg bg-violet-500/8 border border-violet-500/20">
              <IconReply />
              <span className="text-xs text-violet-300/70">Replying to @{replyTo.name}</span>
              <button type="button" onClick={() => setReplyTo(null)} className="ml-auto text-white/30 hover:text-white/55 text-xs">✕</button>
            </div>
          )}
          <div className="flex items-start gap-2.5">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5"
              style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.2)' }}
            >
              {user.name[0]?.toUpperCase()}
            </div>
            <div className="flex-1 space-y-2">
              <textarea
                ref={textRef}
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder={replyTo ? `Reply to @${replyTo.name}…` : 'Add to the discussion…'}
                rows={2}
                maxLength={500}
                className="w-full px-3 py-2.5 rounded-xl text-sm text-white/80 placeholder-white/20 outline-none resize-none transition-all"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                onFocus={e => (e.currentTarget.style.borderColor = 'rgba(139,92,246,0.35)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
              />
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/20">{body.length}/500</span>
                <button
                  type="submit"
                  disabled={posting || !body.trim()}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-all"
                  style={{ background: 'rgba(139,92,246,0.7)', border: '1px solid rgba(139,92,246,0.35)' }}
                >
                  {posting ? 'Posting…' : replyTo ? 'Reply' : 'Post'}
                </button>
              </div>
            </div>
          </div>
        </form>
      ) : (
        <div
          className="mb-4 rounded-xl border px-4 py-3 flex items-center justify-between gap-3"
          style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.08)' }}
        >
          <div className="flex items-center gap-2 text-xs text-white/35">
            <IconUser />
            Sign in to join the discussion
          </div>
          <Link href="/login" className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: 'rgba(139,92,246,0.7)', border: '1px solid rgba(139,92,246,0.35)' }}>
            Sign in
          </Link>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-16" />)}</div>
      ) : topCount === 0 ? (
        <div className="text-center py-8 rounded-xl border border-white/5" style={{ background: 'rgba(255,255,255,0.015)' }}>
          <p className="text-xs text-white/25">No comments yet. Start the discussion.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {comments.map(c => (
            <CommentCard
              key={c.id}
              comment={c}
              onLike={handleLike}
              onReply={(id, name) => setReplyTo({ id, name })}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── MoreInfoModal ──────────────────────────────────────────────────────────

function MoreInfoModal({ item, onClose }: { item: LeaderboardItem; onClose: () => void }) {
  const { user } = useAuth();
  const [fullScan, setFullScan] = useState<FullScan | null>(null);
  const [scanLoading, setScanLoading] = useState(true);
  const [scanLikes, setScanLikes] = useState(0);
  const [likedScan, setLikedScan] = useState(false);
  const [likingScanning, setLikingScanning] = useState(false);

  const vc = getVibeColor(item.vibeScore);
  const sc = getSecColor(item.securityScore);
  const riskColor  = RISK_COLOR[item.riskLevel]  ?? '#94a3b8';
  const riskBg     = RISK_BG[item.riskLevel]     ?? 'rgba(148,163,184,0.08)';
  const riskBorder = RISK_BORDER[item.riskLevel] ?? 'rgba(148,163,184,0.15)';
  const site = hostname(item.url);

  useEffect(() => {
    setScanLoading(true);
    Promise.all([
      fetch(`/api/scans/${item.id}`).then(r => r.json()),
      fetch(`/api/scans/${item.id}/like`).then(r => r.json()),
    ]).then(([scan, likes]) => {
      setFullScan(scan);
      setScanLikes(likes.count ?? 0);
      setLikedScan(likes.likedByMe ?? false);
    }).finally(() => setScanLoading(false));
  }, [item.id]);

  async function toggleScanLike() {
    if (!user || likingScanning) return;
    setLikingScanning(true);
    const res = await fetch(`/api/scans/${item.id}/like`, { method: 'POST' });
    const data = await res.json();
    setScanLikes(data.count ?? 0);
    setLikedScan(data.liked ?? false);
    setLikingScanning(false);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  const missingHeaders = fullScan?.result.security.headers.filter(h => !h.present) ?? [];
  const exposedKeys    = fullScan?.result.publicKeys.filter(k => k.risk === 'high' || k.risk === 'medium') ?? [];
  const noHttps        = fullScan && !fullScan.result.security.httpsEnabled;
  const vibeReasons    = fullScan?.result.vibe.reasons ?? [];
  const allTech = [...(fullScan?.result.techStack.map(t => t.name) ?? item.techStack)];
  if (item.hosting && !allTech.some(t => t.toLowerCase() === item.hosting?.toLowerCase())) {
    allTech.push(item.hosting);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={handleBackdrop}
    >
      <div
        className="w-full sm:max-w-2xl max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-white/10 shadow-2xl"
        style={{ background: '#0d0d16' }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="sticky top-0 z-10 rounded-t-2xl sm:rounded-t-2xl border-b border-white/8 px-5 py-4"
          style={{ background: 'rgba(13,13,22,0.98)', backdropFilter: 'blur(16px)' }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/favicon?domain=${encodeURIComponent(site)}`}
                alt=""
                width={28}
                height={28}
                className="rounded-md mt-0.5 shrink-0 opacity-90"
                loading="lazy"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="min-w-0">
                <p className="font-bold text-base text-white/90 truncate leading-tight">{site}</p>
                <p className="text-[11px] text-white/30 truncate mt-0.5 font-mono">{item.url}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border"
                    style={{ color: riskColor, background: riskBg, borderColor: riskBorder }}
                  >
                    <span className="w-1 h-1 rounded-full inline-block" style={{ background: riskColor }} />
                    {item.riskLevel} Risk
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={toggleScanLike}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                style={likedScan
                  ? { color: '#a78bfa', background: 'rgba(139,92,246,0.12)', borderColor: 'rgba(139,92,246,0.3)' }
                  : { color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)' }
                }
                aria-label={user ? (likedScan ? 'Unlike scan' : 'Upvote scan') : 'Sign in to upvote'}
              >
                <IconArrowUp />
                {scanLikes > 0 && <span>{scanLikes}</span>}
              </button>
              <button
                onClick={onClose}
                aria-label="Close"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white/35 hover:bg-white/8 hover:text-white/60 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-6">
          <div>
            <SectionHeader label="Overview" />
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border p-4" style={{ background: `${vc}0d`, borderColor: `${vc}30` }}>
                <p className="text-[10px] text-white/35 uppercase tracking-wider mb-2">Vibe-Coded Score</p>
                <p className="text-3xl font-black tabular-nums mb-1" style={{ color: vc }}>{item.vibeScore}<span className="text-sm font-medium text-white/30">%</span></p>
                <p className="text-xs mb-2.5" style={{ color: `${vc}cc` }}>{item.vibeLabel}</p>
                <ProgressBar value={item.vibeScore} color={vc} />
              </div>
              <div className="rounded-xl border p-4" style={{ background: `${sc}0d`, borderColor: `${sc}30` }}>
                <p className="text-[10px] text-white/35 uppercase tracking-wider mb-2">Security Score</p>
                <p className="text-3xl font-black tabular-nums mb-1" style={{ color: sc }}>{item.securityScore}<span className="text-sm font-medium text-white/30">/100</span></p>
                <p className="text-xs font-semibold mb-2.5" style={{ color: riskColor }}>{item.riskLevel} Risk</p>
                <ProgressBar value={item.securityScore} color={sc} />
              </div>
            </div>
          </div>

          {allTech.length > 0 && (
            <div>
              <SectionHeader label="Tech Stack" />
              <div className="flex flex-wrap gap-2">
                {allTech.map(t => {
                  const s = getTechStyle(t);
                  return (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border"
                      style={{ color: s.color, background: s.bg, borderColor: s.border }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.color }} />
                      {t}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <SectionHeader label="Risk Breakdown" icon={<IconShield />} />
            <div className="rounded-xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <div className="divide-y divide-white/5">
                <div className="px-4 py-3 flex items-center gap-4">
                  <p className="text-xs text-white/45 w-36 shrink-0">Vibe-coded likelihood</p>
                  <div className="flex-1"><ProgressBar value={item.vibeScore} color={vc} /></div>
                  <span className="text-xs font-bold tabular-nums w-10 text-right shrink-0" style={{ color: vc }}>{item.vibeScore}%</span>
                </div>
                <div className="px-4 py-3 flex items-center gap-4">
                  <p className="text-xs text-white/45 w-36 shrink-0">Security posture</p>
                  <div className="flex-1"><ProgressBar value={item.securityScore} color={sc} /></div>
                  <span className="text-xs font-bold tabular-nums w-10 text-right shrink-0" style={{ color: sc }}>{item.securityScore}</span>
                </div>
                <div className="px-4 py-3 flex items-center justify-between">
                  <p className="text-xs text-white/45">Overall risk level</p>
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border" style={{ color: riskColor, background: riskBg, borderColor: riskBorder }}>
                    {item.riskLevel} Risk
                  </span>
                </div>
              </div>
            </div>
          </div>

          {scanLoading ? (
            <div><SectionHeader label="Vibe Signals" /><div className="space-y-2"><Skeleton className="h-7" /><Skeleton className="h-7 w-4/5" /><Skeleton className="h-7 w-2/3" /></div></div>
          ) : vibeReasons.length > 0 ? (
            <div>
              <SectionHeader label="Vibe Signals" />
              <div className="rounded-xl border border-white/8 overflow-hidden" style={{ background: 'rgba(139,92,246,0.03)' }}>
                {vibeReasons.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-2.5 border-b border-white/5 last:border-0">
                    <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: vc }} />
                    <p className="text-xs text-white/55 leading-relaxed">{r}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : item.vibeScore < 25 ? null : (
            <div>
              <SectionHeader label="Vibe Signals" />
              <p className="text-xs text-white/25 italic">No specific signals logged.</p>
            </div>
          )}

          {scanLoading ? (
            <div><SectionHeader label="Security Findings" /><div className="space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8 w-5/6" /></div></div>
          ) : (noHttps || missingHeaders.length > 0 || exposedKeys.length > 0) ? (
            <div>
              <SectionHeader label="Security Findings" icon={
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              } />
              <div className="space-y-1.5">
                {noHttps && (
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border" style={{ background: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.2)' }}>
                    <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded text-red-400 bg-red-500/12 border border-red-500/25">CRITICAL</span>
                    <p className="text-xs text-white/60">No HTTPS — traffic is unencrypted</p>
                  </div>
                )}
                {exposedKeys.map(k => (
                  <div key={k.type} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border" style={{ background: 'rgba(249,115,22,0.06)', borderColor: 'rgba(249,115,22,0.2)' }}>
                    <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded text-orange-400 bg-orange-500/12 border border-orange-500/25">HIGH</span>
                    <p className="text-xs text-white/60">{k.type} exposed in page source</p>
                  </div>
                ))}
                {missingHeaders.slice(0, 5).map(h => (
                  <div key={h.name} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border" style={{ background: 'rgba(245,158,11,0.05)', borderColor: 'rgba(245,158,11,0.15)' }}>
                    <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded text-yellow-400/80 bg-yellow-500/10 border border-yellow-500/20">WARN</span>
                    <p className="text-xs text-white/55">Missing header: <span className="font-mono">{h.name}</span></p>
                  </div>
                ))}
              </div>
            </div>
          ) : !scanLoading ? (
            <div>
              <SectionHeader label="Security Findings" />
              <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-emerald-500/20" style={{ background: 'rgba(34,197,94,0.05)' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                <p className="text-xs text-emerald-400/80">No critical issues found in public data</p>
              </div>
            </div>
          ) : null}

          <div>
            <SectionHeader label="Most Recent Scan" icon={<IconClock />} />
            <div className="rounded-xl border p-4" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.08)' }}>
              <div className="flex items-start gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ background: 'rgba(139,92,246,0.12)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.2)' }}
                >
                  {(item.scannedBy ?? 'A')[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  {item.scannedBy && item.scannedBy !== 'Anonymous' ? (
                    <Link
                      href={`/u/${encodeURIComponent(item.scannedBy)}`}
                      className="text-sm font-semibold text-white/70 hover:text-violet-300 transition-colors"
                      onClick={e => e.stopPropagation()}
                    >
                      @{item.scannedBy}
                    </Link>
                  ) : (
                    <p className="text-sm font-semibold text-white/70">@Anonymous</p>
                  )}
                  <p className="text-xs text-white/35 mt-0.5 flex items-center gap-1.5">
                    <IconClock />
                    {fullDate(item.createdAt)}
                    <span className="text-white/20">·</span>
                    {timeAgo(item.createdAt)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <Link
            href={`/result/${item.id}`}
            className="flex items-center justify-between gap-3 w-full px-5 py-3.5 rounded-xl border border-violet-500/25 transition-all group hover:border-violet-500/45"
            style={{ background: 'rgba(139,92,246,0.07)' }}
          >
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(139,92,246,0.15)' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-violet-300">View Full Scan Report</p>
                <p className="text-[10px] text-white/30">Tech stack · Security · Vibe analysis · Roast mode</p>
              </div>
            </div>
            <div className="text-white/30 group-hover:text-violet-400 transition-colors group-hover:translate-x-0.5 transform">
              <IconChevronRight />
            </div>
          </Link>

          <div className="border-t border-white/6 pt-5">
            <CommentsSection scanId={item.id} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── LeaderboardRow ─────────────────────────────────────────────────────────

function LeaderboardRow({
  item,
  rank,
  onMoreInfo,
}: {
  item: LeaderboardItem;
  rank?: number;
  onMoreInfo: () => void;
}) {
  const vc = getVibeColor(item.vibeScore);
  const sc = getSecColor(item.securityScore);
  const site = hostname(item.url);
  const podium = rank !== undefined && rank <= 3 ? PODIUM[rank] : null;
  const badges = rank !== undefined ? getBadges(item, rank) : [];
  const isNewEntry = item.previousRank === null && Date.now() - item.createdAt < 86_400_000;

  return (
    <div
      className="relative flex items-center gap-3 sm:gap-4 px-4 py-3.5 border-b border-white/4 last:border-0 transition-colors group"
      style={podium
        ? { background: podium.bg, boxShadow: rank === 1 ? `inset 0 0 40px ${podium.glow}` : 'none' }
        : { background: 'transparent' }
      }
    >
      {/* Top shimmer line */}
      {rank === 1 && (
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(251,191,36,0.6) 50%, transparent 100%)' }}
        />
      )}

      {/* Rank column */}
      {rank !== undefined && (
        <div className="flex flex-col items-center justify-center w-8 shrink-0 gap-0.5">
          {rank === 1 && <span className="text-[10px] leading-none" aria-hidden="true">👑</span>}
          <span
            className={`font-black font-mono leading-none tabular-nums ${rank <= 3 ? 'text-base' : 'text-sm'}`}
            style={{ color: podium?.rank ?? 'rgba(255,255,255,0.2)' }}
          >
            {rank}
          </span>
          <RankDeltaChip delta={item.rankDelta} isNew={isNewEntry} />
        </div>
      )}

      {/* Favicon */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/favicon?domain=${encodeURIComponent(site)}`}
        alt=""
        className="w-5 h-5 rounded shrink-0"
        style={{ opacity: podium ? 0.9 : 0.65 }}
        loading="lazy"
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />

      {/* Site info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p
            className="text-sm font-semibold truncate"
            style={{ color: rank === 1 ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.8)' }}
          >
            {site}
          </p>
          {badges.map(b => (
            <span
              key={b.label}
              className="hidden sm:inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border whitespace-nowrap"
              style={{ color: b.color, background: b.bg, borderColor: b.border }}
            >
              {b.emoji} {b.label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {item.techStack.slice(0, 2).map(t => (
            <span key={t} className="text-[10px] text-white/30 bg-white/4 px-1.5 py-0.5 rounded">{t}</span>
          ))}
          {item.scannedBy && item.scannedBy !== 'Anonymous' ? (
            <Link
              href={`/u/${encodeURIComponent(item.scannedBy)}`}
              className="text-[10px] text-white/30 hover:text-violet-300 transition-colors"
              onClick={e => e.stopPropagation()}
            >
              @{item.scannedBy}
            </Link>
          ) : null}
          <span className="text-[10px] text-white/20">{timeAgo(item.createdAt)}</span>
        </div>
      </div>

      {/* Scores + CTA */}
      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
        <div className="text-center hidden sm:block">
          <p className="text-sm font-bold tabular-nums leading-none" style={{ color: vc }}>{item.vibeScore}</p>
          <p className="text-[10px] text-white/25 mt-0.5">vibe</p>
        </div>
        <div className="text-center">
          <p className="text-sm font-bold tabular-nums leading-none" style={{ color: sc }}>{item.securityScore}</p>
          <p className="text-[10px] text-white/25 mt-0.5">sec</p>
        </div>
        <button
          onClick={onMoreInfo}
          aria-label="More Info"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all hover:border-violet-500/40 hover:text-violet-300"
          style={{ background: 'rgba(139,92,246,0.06)', borderColor: 'rgba(139,92,246,0.2)', color: 'rgba(167,139,250,0.7)' }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <span className="hidden sm:inline">More Info</span>
        </button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

const CATEGORIES: { id: Category; emoji: string; label: string }[] = [
  { id: 'vibe',    emoji: '🔥', label: 'Top Vibe Score' },
  { id: 'secure',  emoji: '🔒', label: 'Security Leaders' },
  { id: 'recent',  emoji: '⚡', label: 'Just Scanned' },
  { id: 'popular', emoji: '📊', label: 'Proving Themselves' },
];

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [category, setCategory] = useState<Category>('vibe');
  const [time, setTime] = useState<TimeFilter>('all');
  const [items, setItems] = useState<LeaderboardItem[]>([]);
  const [popular, setPopular] = useState<PopularItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<LeaderboardItem | null>(null);
  const [tickerItems, setTickerItems] = useState<LeaderboardItem[]>([]);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [activityCount, setActivityCount] = useState(0);
  const [newEntryToast, setNewEntryToast] = useState<string | null>(null);
  const [resetLabel, setResetLabel] = useState(timeUntilReset());

  const prevItemIdsRef = useRef<Set<string>>(new Set());
  const newEntryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update countdown every minute
  useEffect(() => {
    const interval = setInterval(() => setResetLabel(timeUntilReset()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Fetch hourly scan count
  useEffect(() => {
    fetch('/api/scans/activity')
      .then(r => r.json())
      .then(d => { if (typeof d.count === 'number') setActivityCount(d.count); })
      .catch(() => {});
    const interval = setInterval(() => {
      fetch('/api/scans/activity')
        .then(r => r.json())
        .then(d => { if (typeof d.count === 'number') setActivityCount(d.count); })
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Fetch ticker items
  useEffect(() => {
    const fetchTicker = () => {
      fetch('/api/scans?type=recent&limit=15')
        .then(r => r.json())
        .then(d => { if (Array.isArray(d)) setTickerItems(d); })
        .catch(() => {});
    };
    fetchTicker();
    const interval = setInterval(fetchTicker, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Fetch main leaderboard
  const fetchData = useCallback(() => {
    const ac = new AbortController();
    setLoading(true);
    const url = buildApiUrl(category, time);
    fetch(url, { signal: ac.signal })
      .then(r => r.json())
      .then(d => {
        if (category === 'popular') {
          setPopular(Array.isArray(d) ? d : []);
          setItems([]);
        } else {
          const newItems: LeaderboardItem[] = Array.isArray(d) ? d : [];
          setItems(newItems);
          setPopular([]);
        }
        setLoading(false);
      })
      .catch(e => { if (e.name !== 'AbortError') setLoading(false); });
    return () => ac.abort();
  }, [category, time]);

  useEffect(() => {
    const cleanup = fetchData();
    return cleanup;
  }, [fetchData]);

  // Auto-refresh recent tab + detect new entries
  useEffect(() => {
    if (category !== 'recent') return;
    const interval = setInterval(() => {
      fetch(buildApiUrl('recent', time))
        .then(r => r.json())
        .then(d => {
          if (!Array.isArray(d)) return;
          const newItems: LeaderboardItem[] = d;
          // Detect new entries in top 20
          const prev = prevItemIdsRef.current;
          const newTop20 = newItems.slice(0, 20);
          const newEntry = newTop20.find((item, i) => !prev.has(item.id) && i < 20);
          if (newEntry && prev.size > 0) {
            const rank = newTop20.indexOf(newEntry) + 1;
            setNewEntryToast(`${hostname(newEntry.url)} just ranked #${rank}`);
            if (newEntryTimerRef.current) clearTimeout(newEntryTimerRef.current);
            newEntryTimerRef.current = setTimeout(() => setNewEntryToast(null), 4000);
          }
          prevItemIdsRef.current = new Set(newItems.map(i => i.id));
          setItems(newItems);
        })
        .catch(() => {});
    }, 15_000);
    return () => clearInterval(interval);
  }, [category, time]);

  // Seed prevItemIds when items first load
  useEffect(() => {
    if (items.length > 0 && prevItemIdsRef.current.size === 0) {
      prevItemIdsRef.current = new Set(items.map(i => i.id));
    }
  }, [items]);

  // Generate moments when data loads
  useEffect(() => {
    if (items.length > 0) {
      setMoments(generateMoments(items, category));
    }
  }, [items, category]);

  const showTimeFilter = category === 'vibe' || category === 'secure' || category === 'popular';
  const hasPersonalRank = !loading && items.length > 0 && (category === 'vibe' || category === 'secure');

  const myItem = user ? items.find(i => i.scannedBy === user.name) : null;
  const topItem = items[0] ?? null;
  const showSpotlight = !loading && topItem && (category === 'vibe' || category === 'secure');

  const TIME_FILTERS: { id: TimeFilter; label: string }[] = [
    { id: 'today', label: `Today  ${resetLabel}` },
    { id: 'week',  label: 'This Week' },
    { id: 'all',   label: 'All Time' },
  ];

  return (
    <main className="min-h-screen" style={{ background: '#0a0a0f' }}>
      <style>{`
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes entry-in {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {/* Ambient gradient */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 70% 45% at 50% 0%, rgba(139,92,246,0.08) 0%, transparent 70%)' }}
      />

      {/* Live ticker */}
      <LiveTicker items={tickerItems} />

      {/* Moment toasts */}
      <MomentToasts moments={moments} />

      {/* New-entry toast */}
      {newEntryToast && (
        <div
          className="fixed bottom-24 left-4 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl border shadow-xl"
          style={{
            background: 'rgba(13,13,22,0.96)',
            borderColor: 'rgba(139,92,246,0.25)',
            backdropFilter: 'blur(16px)',
            animation: 'entry-in 0.3s ease',
          }}
        >
          <span className="text-violet-400 text-xs font-bold">↑ New entry</span>
          <span className="text-xs text-white/55">{newEntryToast}</span>
        </div>
      )}

      <div className="relative max-w-3xl mx-auto px-6 py-12" style={{ paddingBottom: hasPersonalRank ? '120px' : undefined }}>

        {/* ── Hero ── */}
        <div className="mb-10 text-center" style={{ animation: 'fade-up 0.5s ease' }}>
          <div className="flex items-center justify-center gap-3 mb-4">
            <ActivityPulse count={activityCount} />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3 tracking-tight">
            The Leaderboard
          </h1>
          <p className="text-white/40 text-sm mb-6">
            Every site ranked by what actually matters.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:scale-[1.02]"
              style={{
                background: 'linear-gradient(135deg, rgba(139,92,246,0.8) 0%, rgba(109,40,217,0.8) 100%)',
                border: '1px solid rgba(139,92,246,0.4)',
                boxShadow: '0 4px 20px rgba(139,92,246,0.25)',
              }}
            >
              <IconScan />
              {myItem ? 'Scan again to recalculate' : 'See where you rank'}
            </Link>
            {!user && (
              <p className="text-xs text-white/25">
                Your competitors are already ranked.
              </p>
            )}
          </div>
        </div>

        {/* ── Category tabs ── */}
        <div className="flex gap-1 p-1 rounded-xl bg-white/3 border border-white/6 mb-2 overflow-x-auto">
          {CATEGORIES.map(c => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap flex-1 justify-center"
              style={{
                background: category === c.id ? 'rgba(139,92,246,0.15)' : 'transparent',
                color: category === c.id ? 'rgba(167,139,250,0.9)' : 'rgba(255,255,255,0.4)',
              }}
            >
              <span>{c.emoji}</span>
              <span className="hidden sm:inline">{c.label}</span>
            </button>
          ))}
        </div>

        {/* ── Time filter ── */}
        {showTimeFilter && (
          <div className="flex gap-1 mb-5">
            {TIME_FILTERS.map(t => (
              <button
                key={t.id}
                onClick={() => setTime(t.id)}
                className="px-3 py-1 rounded-lg text-[11px] font-medium transition-colors"
                style={{
                  background: time === t.id ? 'rgba(255,255,255,0.08)' : 'transparent',
                  color: time === t.id ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* ── #1 Spotlight ── */}
        {showSpotlight && (
          <SpotlightBanner
            item={topItem}
            isOwn={myItem?.id === topItem.id}
          />
        )}

        {/* ── Column headers ── */}
        {(category === 'vibe' || category === 'secure') && !loading && items.length > 0 && (
          <div className="flex items-center gap-3 sm:gap-4 px-4 pb-2 text-[10px] text-white/25 uppercase tracking-wider">
            <span className="w-8 shrink-0">#</span>
            <span className="w-5 shrink-0" />
            <span className="flex-1">Site</span>
            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
              <span className="text-center hidden sm:block w-8">Vibe</span>
              <span className="text-center w-8">Sec</span>
              <span className="w-20 sm:w-24" />
            </div>
          </div>
        )}

        {/* ── Board ── */}
        <div className="rounded-xl border border-white/6 overflow-hidden" style={{ background: 'rgba(255,255,255,0.015)' }}>
          {loading ? (
            <div className="py-16 flex items-center justify-center gap-3 text-white/25 text-sm">
              <div className="w-4 h-4 border-2 border-white/20 border-t-violet-400 rounded-full animate-spin" />
              Loading…
            </div>
          ) : category === 'popular' ? (
            popular.length === 0 ? (
              <EmptyState category={category} time={time} />
            ) : (
              popular.map((item, i) => {
                const vc = getVibeColor(item.latestScan.result?.vibe?.score ?? 0);
                const sc = getSecColor(item.latestScan.result?.security?.score ?? 0);
                const rank = i + 1;
                const podium = rank <= 3 ? PODIUM[rank] : null;
                return (
                  <div
                    key={item.domain}
                    className="relative flex items-center gap-3 sm:gap-4 px-4 py-3.5 border-b border-white/4 last:border-0 transition-colors group"
                    style={podium ? { background: podium.bg } : undefined}
                  >
                    {rank === 1 && (
                      <div className="absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(251,191,36,0.5), transparent)' }} />
                    )}
                    <div className="flex flex-col items-center justify-center w-8 shrink-0">
                      {rank === 1 && <span className="text-[10px] leading-none mb-0.5" aria-hidden="true">👑</span>}
                      <span className={`font-black font-mono leading-none ${rank <= 3 ? 'text-base' : 'text-sm'}`} style={{ color: podium?.rank ?? 'rgba(255,255,255,0.2)' }}>{rank}</span>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/favicon?domain=${encodeURIComponent(item.domain)}`} alt="" className="w-5 h-5 rounded shrink-0" style={{ opacity: podium ? 0.9 : 0.65 }} loading="lazy" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: rank === 1 ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.8)' }}>{item.domain}</p>
                      <p className="text-[10px] text-white/30 mt-0.5">
                        scanned <span className="font-semibold text-white/45">{item.count}</span> time{item.count !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-center hidden sm:block">
                        <p className="text-sm font-bold tabular-nums leading-none" style={{ color: vc }}>{item.latestScan.result?.vibe?.score ?? '—'}</p>
                        <p className="text-[10px] text-white/25 mt-0.5">vibe</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold tabular-nums leading-none" style={{ color: sc }}>{item.latestScan.result?.security?.score ?? '—'}</p>
                        <p className="text-[10px] text-white/25 mt-0.5">sec</p>
                      </div>
                      <button
                        onClick={() => setSelected({
                          id: item.latestScan.id,
                          url: `https://${item.domain}`,
                          vibeScore: item.latestScan.result?.vibe?.score ?? 0,
                          vibeLabel: item.latestScan.result?.vibe?.label ?? '',
                          securityScore: item.latestScan.result?.security?.score ?? 0,
                          riskLevel: item.latestScan.result?.security?.riskLevel ?? '',
                          techStack: (item.latestScan.result?.techStack ?? []).map((t: { name: string }) => t.name),
                          scannedBy: item.latestScan.scannedBy,
                          createdAt: item.latestScan.createdAt,
                          likeCount: 0,
                          likedByMe: false,
                          rankDelta: null,
                          previousRank: null,
                        })}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all hover:border-violet-500/40 hover:text-violet-300"
                        style={{ background: 'rgba(139,92,246,0.06)', borderColor: 'rgba(139,92,246,0.2)', color: 'rgba(167,139,250,0.7)' }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                        </svg>
                        <span className="hidden sm:inline">More Info</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )
          ) : items.length === 0 ? (
            <EmptyState category={category} time={time} />
          ) : (
            items.map((item, i) => (
              <LeaderboardRow
                key={item.id}
                item={item}
                rank={(category === 'vibe' || category === 'secure') ? i + 1 : undefined}
                onMoreInfo={() => setSelected(item)}
              />
            ))
          )}
        </div>

        {/* ── Flawless Wall ── */}
        {(category === 'vibe' || category === 'secure') && !loading && (
          <FlawlessWall items={items} />
        )}

        {/* ── Footer notes ── */}
        {category === 'recent' && (
          <p className="text-center text-xs text-white/20 mt-4">
            Auto-refreshes every 15 seconds · New entries appear automatically
          </p>
        )}
        {time === 'today' && (category === 'vibe' || category === 'secure') && (
          <p className="text-center text-xs text-white/20 mt-4">
            Today&apos;s leaderboard resets in {resetLabel}
          </p>
        )}
        {time === 'week' && (category === 'vibe' || category === 'secure') && (
          <p className="text-center text-xs text-white/20 mt-4">
            Showing scans from the last 7 days
          </p>
        )}

        {/* ── Bottom CTA (non-users) ── */}
        {!user && !loading && (items.length > 0 || popular.length > 0) && (
          <div
            className="mt-6 rounded-xl border px-5 py-4 flex items-center justify-between gap-4"
            style={{ background: 'rgba(139,92,246,0.05)', borderColor: 'rgba(139,92,246,0.2)' }}
          >
            <div>
              <p className="text-sm font-semibold text-white/80">Your competitors are already ranked.</p>
              <p className="text-xs text-white/30 mt-0.5">Are you?</p>
            </div>
            <Link
              href="/"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-all hover:scale-[1.02]"
              style={{ background: 'rgba(139,92,246,0.5)', border: '1px solid rgba(139,92,246,0.35)' }}
            >
              <IconScan />
              Claim your rank
            </Link>
          </div>
        )}
      </div>

      {/* Personal rank strip */}
      {hasPersonalRank && <PersonalRankStrip items={items} category={category} />}

      {/* Detail modal */}
      {selected && <MoreInfoModal item={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}

// ── EmptyState ─────────────────────────────────────────────────────────────

function EmptyState({ category, time }: { category: Category; time: TimeFilter }) {
  const msg = time !== 'all'
    ? `Nothing here ${time === 'today' ? 'today' : 'this week'} yet.`
    : 'No entries yet.';
  return (
    <div className="py-16 text-center text-white/30 text-sm">
      {msg}{' '}
      {category === 'recent'
        ? <Link href="/" className="text-violet-400 hover:text-violet-300 transition-colors">Be the first →</Link>
        : <Link href="/" className="text-violet-400 hover:text-violet-300 transition-colors">Scan your site →</Link>
      }
    </div>
  );
}

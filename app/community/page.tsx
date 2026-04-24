'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import type { ReactionType } from '@/lib/store';

// ── Types ──────────────────────────────────────────────────────────────────

interface CommunityPost {
  id: string;
  deepScanId: string;
  userId: string;
  posterName: string;
  domain: string;
  caption: string | null;
  score: number;
  passCount: number;
  warnCount: number;
  failCount: number;
  certified: boolean;
  createdAt: number;
  reactions: Record<ReactionType, number>;
  myReactions: ReactionType[];
  commentCount: number;
}

type SortTab = 'new' | 'trending' | 'discussed' | 'score';

// ── Helpers ────────────────────────────────────────────────────────────────

const ONE_DAY = 86_400_000;

function timeAgo(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / (86400 * 30))}mo ago`;
}

function scoreColor(s: number) {
  if (s >= 90) return '#4ade80';
  if (s >= 75) return '#a78bfa';
  if (s >= 60) return '#fbbf24';
  if (s >= 40) return '#fb923c';
  return '#f87171';
}

function gradeLetter(s: number) {
  if (s >= 95) return 'A+';
  if (s >= 90) return 'A';
  if (s >= 85) return 'A−';
  if (s >= 80) return 'B+';
  if (s >= 75) return 'B';
  if (s >= 70) return 'B−';
  if (s >= 65) return 'C+';
  if (s >= 60) return 'C';
  if (s >= 55) return 'C−';
  if (s >= 50) return 'D';
  return 'F';
}

const REACTIONS: { type: ReactionType; label: string; emoji: string }[] = [
  { type: 'solid_build',       label: 'Solid build',          emoji: '⬆' },
  { type: 'interesting_stack', label: 'Interesting stack',     emoji: '🔍' },
  { type: 'surprised',         label: 'Surprised it passed',   emoji: '🤔' },
];

// ── Skeleton ───────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`rounded-xl bg-white/5 animate-pulse ${className ?? ''}`} />;
}

function PostSkeleton() {
  return (
    <div className="rounded-2xl border border-white/6 p-5 space-y-3" style={{ background: 'rgba(255,255,255,0.015)' }}>
      <div className="flex items-center gap-3">
        <Skeleton className="w-7 h-7 rounded-lg shrink-0" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-16 ml-auto" />
      </div>
      <Skeleton className="h-1.5 w-full rounded-full" />
      <div className="flex gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <Skeleton className="h-3 w-48" />
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-6 w-20 rounded-lg" />
        <Skeleton className="h-6 w-24 rounded-lg" />
        <Skeleton className="h-6 w-20 rounded-lg" />
      </div>
    </div>
  );
}

// ── Top This Week banner ───────────────────────────────────────────────────

function TopThisWeek({ posts }: { posts: CommunityPost[] }) {
  const cutoff = Date.now() - 7 * ONE_DAY;

  const top = useMemo(() => {
    const recent = posts.filter(p => p.createdAt >= cutoff);
    if (!recent.length) return null;
    return recent.reduce((best, p) => {
      const eng = (p: CommunityPost) =>
        Object.values(p.reactions).reduce((s, n) => s + n, 0) * 2 + p.commentCount;
      return eng(p) > eng(best) ? p : best;
    });
  // cutoff is stable per render, no need in deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts]);

  if (!top) return null;
  const totalReactions = Object.values(top.reactions).reduce((s, n) => s + n, 0);
  if (totalReactions === 0 && top.commentCount === 0) return null;

  const sc = scoreColor(top.score);

  return (
    <div
      className="rounded-2xl border p-4 mb-6"
      style={{ background: 'rgba(139,92,246,0.05)', borderColor: 'rgba(139,92,246,0.18)' }}
    >
      <p className="text-[10px] font-bold tracking-widest text-violet-400/60 uppercase mb-3">Top This Week</p>
      <div className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/favicon?domain=${encodeURIComponent(top.domain)}`}
          alt=""
          width={22}
          height={22}
          loading="lazy"
          className="rounded-md shrink-0 opacity-90"
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
        <span className="font-mono text-sm font-semibold text-white/80 truncate flex-1">{top.domain}</span>
        <span className="text-sm font-black tabular-nums" style={{ color: sc }}>{top.score}</span>
      </div>
      <div className="flex items-center gap-3 mt-2.5">
        <span className="text-[10px] text-white/25">
          {totalReactions} reaction{totalReactions !== 1 ? 's' : ''}
        </span>
        {top.commentCount > 0 && (
          <span className="text-[10px] text-white/25">
            {top.commentCount} comment{top.commentCount !== 1 ? 's' : ''}
          </span>
        )}
        <Link
          href={`/community/${top.id}`}
          className="text-[10px] text-violet-400/60 hover:text-violet-300 transition-colors ml-auto"
        >
          View →
        </Link>
      </div>
    </div>
  );
}

// ── Post card ──────────────────────────────────────────────────────────────

function PostCard({ post, onReact, isFirst, rank }: {
  post: CommunityPost;
  onReact: (postId: string, type: ReactionType) => void;
  isFirst: boolean;
  rank?: number;
}) {
  const sc = scoreColor(post.score);
  const grade = gradeLetter(post.score);
  const totalChecks = post.passCount + post.warnCount + post.failCount;
  const isFlawless = post.certified && post.warnCount === 0 && totalChecks > 0;
  const totalReactions = Object.values(post.reactions).reduce((s, n) => s + n, 0);
  const ageDays = Math.floor((Date.now() - post.createdAt) / ONE_DAY);
  const isStale = ageDays > 90;

  return (
    <article
      className="rounded-2xl border border-white/6 p-5 space-y-4 transition-all hover:border-white/10"
      style={{ background: 'rgba(255,255,255,0.015)' }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {/* Rank number */}
          {rank !== undefined && (
            <span
              className="text-sm font-bold font-mono w-6 text-right shrink-0"
              style={{ color: rank <= 3 ? '#fbbf24' : 'rgba(255,255,255,0.25)' }}
            >
              {rank}
            </span>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/favicon?domain=${encodeURIComponent(post.domain)}`}
            alt=""
            width={28}
            height={28}
            loading="lazy"
            className="rounded-lg shrink-0 opacity-90"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          <div className="min-w-0">
            <p className="font-mono text-sm font-semibold text-white/85 truncate">{post.domain}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-[10px] text-white/30">@{post.posterName}</span>
              <span className="text-[10px] text-white/20">·</span>
              <span className="text-[10px] text-white/20">{timeAgo(post.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* Score + grade + status badge */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-center">
            <p className="text-base font-black tabular-nums leading-none" style={{ color: sc }}>{post.score}</p>
            <p className="text-[9px] font-bold mt-0.5 tabular-nums" style={{ color: `${sc}99` }}>{grade}</p>
          </div>
          {post.certified ? (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border"
              style={{ color: '#a78bfa', background: 'rgba(139,92,246,0.1)', borderColor: 'rgba(139,92,246,0.25)' }}
              title={`Passed all Deep Scan checks — ${post.passCount} passed${post.warnCount > 0 ? `, ${post.warnCount} warnings` : ''}`}
            >
              <span aria-hidden="true" className="text-[8px]">✦</span> Certified
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border"
              style={{ color: '#fbbf24', background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.22)' }}
              title={`${post.failCount} check${post.failCount !== 1 ? 's' : ''} failed — score and non-sensitive info only`}
            >
              ⚠ {post.failCount} failed
            </span>
          )}
        </div>
      </div>

      {/* Score bar */}
      <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
        <div className="h-full rounded-full" style={{ width: `${post.score}%`, background: sc, opacity: 0.65 }} />
      </div>

      {/* Badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {isFlawless && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border" style={{ color: '#4ade80', background: 'rgba(74,222,128,0.07)', borderColor: 'rgba(74,222,128,0.18)' }}>
            ✓ Flawless
          </span>
        )}
        {totalChecks > 0 && (
          <span className="inline-flex items-center text-[10px] font-mono px-2 py-0.5 rounded-full border" style={{ color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.07)' }}>
            {post.passCount}/{totalChecks} checks passed
          </span>
        )}
        {!post.certified && post.failCount > 0 && (
          <span className="inline-flex items-center text-[10px] font-mono px-2 py-0.5 rounded-full border" style={{ color: '#f87171', background: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.18)' }}>
            {post.failCount} failed
          </span>
        )}
        {isFirst && post.certified && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border" style={{ color: '#fbbf24', background: 'rgba(251,191,36,0.07)', borderColor: 'rgba(251,191,36,0.18)' }}>
            ★ First Certified
          </span>
        )}
        {isStale && (
          <span
            className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-full border"
            style={{ color: 'rgba(255,255,255,0.28)', background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.06)' }}
            title={`Scan run ${ageDays} days ago — results may not reflect the current site`}
          >
            ⚠ {ageDays}d old
          </span>
        )}
      </div>

      {/* Caption or placeholder */}
      {post.caption ? (
        <p className="text-sm text-white/55 leading-relaxed">{post.caption}</p>
      ) : (
        <p className="text-xs text-white/18 italic">Results speak for themselves.</p>
      )}

      {/* Reactions + comments */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {REACTIONS.map(r => {
            const count = post.reactions[r.type];
            const active = post.myReactions.includes(r.type);
            return (
              <button
                key={r.type}
                onClick={() => onReact(post.id, r.type)}
                aria-label={r.label}
                aria-pressed={active}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-all"
                style={active
                  ? { background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)', color: '#a78bfa' }
                  : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }
                }
              >
                <span aria-hidden="true">{r.emoji}</span>
                {count > 0 && <span className="tabular-nums">{count}</span>}
              </button>
            );
          })}
          {totalReactions === 0 && (
            <span className="text-[10px] text-white/20 pl-1">Be the first to react</span>
          )}
        </div>

        <Link
          href={`/community/${post.id}`}
          className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          {post.commentCount > 0
            ? `${post.commentCount} comment${post.commentCount > 1 ? 's' : ''}`
            : 'Discuss'}
        </Link>
      </div>
    </article>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function CommunityPage() {
  const { user } = useAuth();
  const [sort, setSort] = useState<SortTab>('new');
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    let mounted = true;
    setLoading(true);

    fetch(`/api/community?sort=${sort}&limit=30`, { signal: ac.signal })
      .then(r => r.json())
      .then(d => { if (mounted && Array.isArray(d)) setPosts(d); })
      .catch(e => { if (e.name !== 'AbortError') console.error(e); })
      .finally(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; ac.abort(); };
  }, [sort]);

  function handleReact(postId: string, type: ReactionType) {
    if (!user) return;

    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p;
      const active = p.myReactions.includes(type);
      const reactions = { ...p.reactions, [type]: p.reactions[type] + (active ? -1 : 1) };
      const myReactions = active ? p.myReactions.filter(r => r !== type) : [...p.myReactions, type];
      return { ...p, reactions, myReactions };
    }));

    fetch(`/api/community/${postId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    })
      .then(r => r.json())
      .then(data => {
        setPosts(prev => prev.map(p =>
          p.id === postId ? { ...p, reactions: data.reactions, myReactions: data.myReactions } : p
        ));
      })
      .catch(() => {
        setPosts(prev => prev.map(p => {
          if (p.id !== postId) return p;
          const wasActive = !p.myReactions.includes(type);
          const reactions = { ...p.reactions, [type]: p.reactions[type] + (wasActive ? -1 : 1) };
          const myReactions = wasActive ? p.myReactions.filter(r => r !== type) : [...p.myReactions, type];
          return { ...p, reactions, myReactions };
        }));
      });
  }

  // The post with the earliest createdAt across the loaded set is the community pioneer
  const firstPostId = useMemo(() => {
    if (!posts.length) return null;
    return posts.reduce((min, p) => p.createdAt < min.createdAt ? p : min).id;
  }, [posts]);

  const tabs: { id: SortTab; label: string }[] = [
    { id: 'score',     label: 'Top Score' },
    { id: 'new',       label: 'Just posted' },
    { id: 'trending',  label: 'On fire' },
    { id: 'discussed', label: 'Getting talked about' },
  ];

  return (
    <main className="min-h-screen px-6 py-16" style={{ background: '#0a0a0f' }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(139,92,246,0.07) 0%, transparent 70%)' }}
        aria-hidden="true"
      />

      <div className="relative max-w-2xl mx-auto">
        {/* Page header */}
        <div className="mb-10 text-center">
          <div className="flex items-center justify-center gap-2 mb-4 flex-wrap">
            <span
              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border"
              style={{ color: '#a78bfa', background: 'rgba(139,92,246,0.1)', borderColor: 'rgba(139,92,246,0.25)' }}
            >
              <span aria-hidden="true" className="text-[8px]">✦</span> Certified
            </span>
            <span className="text-[10px] text-white/20">+</span>
            <span
              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border"
              style={{ color: '#fbbf24', background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.22)' }}
            >
              Scanned results
            </span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2 leading-tight">
            The internet&apos;s<br />security rankings.
          </h1>
          <p className="text-white/35 text-sm">
            Deep-scanned sites, ranked by score. Certified means every check passed.
          </p>
        </div>

        {/* Sort tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-white/3 border border-white/6 mb-6 overflow-x-auto" role="tablist">
          {tabs.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={sort === t.id}
              onClick={() => setSort(t.id)}
              className="px-4 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap flex-1"
              style={{
                background: sort === t.id ? 'rgba(139,92,246,0.15)' : 'transparent',
                color: sort === t.id ? 'rgba(167,139,250,0.9)' : 'rgba(255,255,255,0.4)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Top This Week — only on "Just posted" once loaded */}
        {!loading && posts.length > 0 && sort === 'new' && (
          <TopThisWeek posts={posts} />
        )}

        {/* Feed */}
        <div className="space-y-4">
          {loading ? (
            <>
              <PostSkeleton />
              <PostSkeleton />
              <PostSkeleton />
            </>
          ) : posts.length === 0 ? (
            <div
              className="text-center py-16 rounded-2xl border border-white/6"
              style={{ background: 'rgba(255,255,255,0.015)' }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-4"
                style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)' }}
                aria-hidden="true"
              >
                <span style={{ color: '#a78bfa', fontSize: 18 }}>✦</span>
              </div>
              <p className="text-sm font-semibold text-white/60 mb-1">Nothing here yet.</p>
              <p className="text-xs text-white/30 max-w-xs mx-auto leading-relaxed">
                Be the first to post a Deep Scan result — certified or not.
              </p>
              <p className="text-xs text-white/20 max-w-xs mx-auto leading-relaxed mt-1">
                Run a Deep Scan on any site you own and share your score.
              </p>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 mt-5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all"
                style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)' }}
              >
                Run a Deep Scan →
              </Link>
            </div>
          ) : (
            posts.map((post, i) => (
              <PostCard
                key={post.id}
                post={post}
                onReact={handleReact}
                isFirst={post.id === firstPostId}
                rank={sort === 'score' ? i + 1 : undefined}
              />
            ))
          )}
        </div>

        {/* Sign-in nudge for reactions */}
        {!user && posts.length > 0 && (
          <p className="text-center text-xs text-white/25 mt-8">
            <Link href="/login" className="text-violet-400 hover:text-violet-300 transition-colors">Sign in</Link>
            {' '}to react and join the discussion.
          </p>
        )}
      </div>
    </main>
  );
}

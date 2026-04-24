'use client';

import { useState, useEffect, useRef } from 'react';
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
  createdAt: number;
  reactions: Record<ReactionType, number>;
  myReactions: ReactionType[];
  commentCount: number;
}

type SortTab = 'new' | 'trending' | 'discussed';

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function scoreColor(s: number) {
  if (s >= 90) return '#4ade80';
  if (s >= 70) return '#a78bfa';
  if (s >= 50) return '#fbbf24';
  return '#f87171';
}

const REACTIONS: { type: ReactionType; label: string; emoji: string }[] = [
  { type: 'solid_build',       label: 'Solid build',       emoji: '⬆' },
  { type: 'interesting_stack', label: 'Interesting stack',  emoji: '🔍' },
  { type: 'surprised',         label: 'Surprised it passed', emoji: '🤔' },
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
      <Skeleton className="h-3 w-48" />
      <Skeleton className="h-3 w-64" />
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-6 w-20 rounded-lg" />
        <Skeleton className="h-6 w-24 rounded-lg" />
        <Skeleton className="h-6 w-18 rounded-lg" />
      </div>
    </div>
  );
}

// ── Post card ──────────────────────────────────────────────────────────────

function PostCard({ post, onReact }: {
  post: CommunityPost;
  onReact: (postId: string, type: ReactionType) => void;
}) {
  const sc = scoreColor(post.score);
  const totalReactions = Object.values(post.reactions).reduce((s, n) => s + n, 0);

  return (
    <article
      className="rounded-2xl border border-white/6 p-5 space-y-4 transition-all hover:border-white/10"
      style={{ background: 'rgba(255,255,255,0.015)' }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {/* Favicon */}
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

        {/* Score + Certified badge */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-center">
            <p className="text-base font-black tabular-nums leading-none" style={{ color: sc }}>{post.score}</p>
            <p className="text-[9px] text-white/25 mt-0.5">score</p>
          </div>
          <span
            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border"
            style={{ color: '#a78bfa', background: 'rgba(139,92,246,0.1)', borderColor: 'rgba(139,92,246,0.25)' }}
            title={`Passed all Deep Scan checks — ${post.passCount} passed${post.warnCount > 0 ? `, ${post.warnCount} warnings` : ''}`}
          >
            <span aria-hidden="true" className="text-[8px]">✦</span> Certified
          </span>
        </div>
      </div>

      {/* Caption */}
      {post.caption && (
        <p className="text-sm text-white/55 leading-relaxed">{post.caption}</p>
      )}

      {/* Scan summary strip */}
      <div
        className="flex items-center gap-3 px-3 py-2 rounded-xl flex-wrap"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
      >
        <span className="text-[11px] text-white/40">
          <span className="text-emerald-400 font-semibold">{post.passCount}</span> passed
        </span>
        {post.warnCount > 0 && (
          <span className="text-[11px] text-white/40">
            <span className="text-amber-400 font-semibold">{post.warnCount}</span> warnings
          </span>
        )}
        <span className="text-[11px] text-white/25 ml-auto font-mono">Deep Scan</span>
      </div>

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
          {post.commentCount > 0 ? `${post.commentCount} comment${post.commentCount > 1 ? 's' : ''}` : 'Discuss'}
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

    // Optimistic update
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
        // Revert optimistic update on failure
        setPosts(prev => prev.map(p => {
          if (p.id !== postId) return p;
          const wasActive = !p.myReactions.includes(type);
          const reactions = { ...p.reactions, [type]: p.reactions[type] + (wasActive ? -1 : 1) };
          const myReactions = wasActive ? p.myReactions.filter(r => r !== type) : [...p.myReactions, type];
          return { ...p, reactions, myReactions };
        }));
      });
  }

  const tabs: { id: SortTab; label: string }[] = [
    { id: 'new',       label: 'New' },
    { id: 'trending',  label: 'Trending' },
    { id: 'discussed', label: 'Most Discussed' },
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
          <div className="flex items-center justify-center gap-2 mb-3">
            <h1 className="text-3xl font-bold text-white">Community</h1>
            <span
              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border"
              style={{ color: '#a78bfa', background: 'rgba(139,92,246,0.1)', borderColor: 'rgba(139,92,246,0.25)' }}
            >
              <span aria-hidden="true" className="text-[8px]">✦</span> Certified only
            </span>
          </div>
          <p className="text-white/40 text-sm">Sites that passed the Deep Scan. Shared by real users.</p>
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
              <p className="text-2xl mb-3" aria-hidden="true">🛡</p>
              <p className="text-sm font-semibold text-white/60 mb-1">Nothing here yet.</p>
              <p className="text-xs text-white/30 max-w-xs mx-auto leading-relaxed">
                Once users share Deep Scan results, they&apos;ll show up here. Run a Deep Scan on a site you own to be the first.
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
            posts.map(post => (
              <PostCard
                key={post.id}
                post={post}
                onReact={handleReact}
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

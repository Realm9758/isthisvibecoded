'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  hosting: string | null;
  createdAt: number;
  scannedBy: string;
}

interface PopularItem {
  domain: string;
  count: number;
  latestScan: { id: string };
}

interface Comment {
  id: string;
  user_name: string;
  body: string;
  created_at: number;
}

type Tab = 'recent' | 'vibe' | 'secure' | 'popular';

// ── Helpers ────────────────────────────────────────────────────────────────

function getVibeColor(s: number) { return s >= 70 ? '#8b5cf6' : s >= 30 ? '#f59e0b' : '#22c55e'; }
function getSecColor(s: number)  { return s >= 70 ? '#22c55e' : s >= 40 ? '#f59e0b' : '#ef4444'; }
function hostname(url: string)   { try { return new URL(url).hostname; } catch { return url; } }

function timeAgo(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
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

const RISK_COLOR: Record<string, string> = {
  Low:      '#22c55e',
  Medium:   '#f59e0b',
  High:     '#f97316',
  Critical: '#ef4444',
};

// ── Comments section ───────────────────────────────────────────────────────

function CommentsSection({ scanId }: { scanId: string }) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/comments?scanId=${scanId}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setComments(d); })
      .finally(() => setLoading(false));
  }, [scanId]);

  async function handlePost(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setError('');
    setPosting(true);
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId, body: body.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to post'); return; }
      setComments(prev => [data, ...prev]);
      setBody('');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="mt-6 pt-6 border-t border-white/8">
      <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">
        Discussion {comments.length > 0 && <span className="text-white/25 font-normal normal-case">({comments.length})</span>}
      </h3>

      {/* Post form */}
      {user ? (
        <form onSubmit={handlePost} className="mb-5">
          <div className="flex items-start gap-3">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5"
              style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.25)' }}
            >
              {user.name[0]?.toUpperCase()}
            </div>
            <div className="flex-1 space-y-2">
              <textarea
                ref={textRef}
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Share your thoughts…"
                rows={2}
                maxLength={500}
                className="w-full px-3 py-2.5 rounded-xl text-sm text-white/80 placeholder-white/25 outline-none resize-none transition-all"
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
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-40"
                  style={{ background: 'rgba(139,92,246,0.7)', border: '1px solid rgba(139,92,246,0.4)' }}
                >
                  {posting ? 'Posting…' : 'Post'}
                </button>
              </div>
            </div>
          </div>
        </form>
      ) : (
        <div className="mb-5 rounded-xl border border-white/8 px-4 py-3 flex items-center justify-between gap-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <p className="text-xs text-white/35">Sign in to join the discussion</p>
          <Link href="/login" className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: 'rgba(139,92,246,0.7)', border: '1px solid rgba(139,92,246,0.4)' }}>
            Sign in
          </Link>
        </div>
      )}

      {/* Comment list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="h-12 rounded-xl bg-white/3 animate-pulse" />)}
        </div>
      ) : comments.length === 0 ? (
        <p className="text-xs text-white/25 text-center py-6">No comments yet. Be the first to comment.</p>
      ) : (
        <div className="space-y-3">
          {comments.map(c => (
            <div key={c.id} className="flex gap-3">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                {c.user_name[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-white/65">@{c.user_name}</span>
                  <span className="text-[10px] text-white/25">{timeAgo(c.created_at)}</span>
                </div>
                <p className="text-sm text-white/55 leading-relaxed">{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── More Info modal ────────────────────────────────────────────────────────

function MoreInfoModal({ item, onClose }: { item: LeaderboardItem; onClose: () => void }) {
  const vc = getVibeColor(item.vibeScore);
  const sc = getSecColor(item.securityScore);
  const riskColor = RISK_COLOR[item.riskLevel] ?? '#94a3b8';

  // Close on backdrop click
  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const site = hostname(item.url);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={handleBackdrop}
    >
      <div
        className="w-full sm:max-w-xl max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-white/10"
        style={{ background: '#0f0f18' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-white/8" style={{ background: '#0f0f18' }}>
          <div className="min-w-0">
            <p className="font-mono text-sm font-bold text-white/85 truncate">{site}</p>
            <p className="text-[10px] text-white/30 mt-0.5 truncate">{item.url}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:bg-white/8 hover:text-white/70 transition-colors shrink-0 ml-3"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Score cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/8 p-4 text-center" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <p className="text-3xl font-black tabular-nums" style={{ color: vc }}>{item.vibeScore}</p>
              <p className="text-[10px] text-white/30 uppercase tracking-wider mt-1">Vibe-Coded Score</p>
              <p className="text-xs text-white/45 mt-1">{item.vibeLabel}</p>
            </div>
            <div className="rounded-xl border border-white/8 p-4 text-center" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <p className="text-3xl font-black tabular-nums" style={{ color: sc }}>{item.securityScore}</p>
              <p className="text-[10px] text-white/30 uppercase tracking-wider mt-1">Security Score</p>
              <p className="text-xs font-semibold mt-1" style={{ color: riskColor }}>{item.riskLevel} Risk</p>
            </div>
          </div>

          {/* Tech stack */}
          {item.techStack.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-white/35 uppercase tracking-wider mb-2">Tech Stack</p>
              <div className="flex flex-wrap gap-1.5">
                {item.techStack.map(t => (
                  <span key={t} className="text-xs px-2.5 py-1 rounded-lg border border-white/8 text-white/55" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    {t}
                  </span>
                ))}
                {item.hosting && (
                  <span className="text-xs px-2.5 py-1 rounded-lg border border-emerald-500/20 text-emerald-400/70" style={{ background: 'rgba(34,197,94,0.06)' }}>
                    {item.hosting}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Risk breakdown */}
          <div className="rounded-xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <div className="px-4 py-2.5 border-b border-white/6">
              <p className="text-xs font-semibold text-white/35 uppercase tracking-wider">Risk Breakdown</p>
            </div>
            <div className="divide-y divide-white/5">
              {[
                { label: 'Vibe-coded likelihood', value: `${item.vibeScore}%`, color: vc },
                { label: 'Security posture', value: `${item.securityScore}/100`, color: sc },
                { label: 'Overall risk level', value: item.riskLevel, color: riskColor },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-xs text-white/45">{row.label}</span>
                  <span className="text-xs font-bold" style={{ color: row.color }}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Most recent scan */}
          <div
            className="rounded-xl border p-4 flex items-start gap-3"
            style={{ background: 'rgba(139,92,246,0.05)', borderColor: 'rgba(139,92,246,0.2)' }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.25)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-white/55 uppercase tracking-wider mb-1">Most Recent Scan</p>
              <p className="text-sm text-white/75 font-medium">{fullDate(item.createdAt)}</p>
              <p className="text-xs text-white/35 mt-0.5">Scanned by <span className="text-white/55 font-medium">@{item.scannedBy}</span></p>
            </div>
          </div>

          {/* Full result link */}
          <Link
            href={`/result/${item.id}`}
            className="flex items-center justify-between px-4 py-3 rounded-xl border border-white/8 hover:bg-white/3 transition-colors group"
            style={{ background: 'rgba(255,255,255,0.02)' }}
          >
            <span className="text-xs text-white/45 group-hover:text-white/65 transition-colors">View full scan report</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/25 group-hover:text-white/50 transition-colors">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </Link>

          {/* Comments */}
          <CommentsSection scanId={item.id} />
        </div>
      </div>
    </div>
  );
}

// ── Leaderboard row ────────────────────────────────────────────────────────

function LeaderboardRow({
  item,
  rank,
  onMoreInfo,
  commentCount,
}: {
  item: LeaderboardItem;
  rank?: number;
  onMoreInfo: () => void;
  commentCount?: number;
}) {
  const vc = getVibeColor(item.vibeScore);
  const sc = getSecColor(item.securityScore);
  const site = hostname(item.url);

  return (
    <div className="flex items-center gap-3 sm:gap-4 px-4 py-3.5 border-b border-white/4 last:border-0 hover:bg-white/2 transition-colors">
      {/* Rank */}
      {rank !== undefined && (
        <span className="text-sm font-bold w-6 text-right shrink-0" style={{ color: rank <= 3 ? '#a78bfa' : 'rgba(255,255,255,0.2)' }}>
          {rank}
        </span>
      )}

      {/* Site info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white/80 truncate">{site}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {item.techStack.slice(0, 2).map(t => (
            <span key={t} className="text-[10px] text-white/30 bg-white/5 px-1.5 py-0.5 rounded">{t}</span>
          ))}
          <span className="text-[10px] text-white/20">{timeAgo(item.createdAt)}</span>
        </div>
      </div>

      {/* Scores */}
      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
        <div className="text-center hidden sm:block">
          <p className="text-sm font-bold tabular-nums leading-none" style={{ color: vc }}>{item.vibeScore}</p>
          <p className="text-[10px] text-white/25 mt-0.5">vibe</p>
        </div>
        <div className="text-center">
          <p className="text-sm font-bold tabular-nums leading-none" style={{ color: sc }}>{item.securityScore}</p>
          <p className="text-[10px] text-white/25 mt-0.5">sec</p>
        </div>

        {/* More info button */}
        <button
          onClick={onMoreInfo}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all hover:border-violet-500/40 hover:text-violet-300"
          style={{ background: 'rgba(139,92,246,0.06)', borderColor: 'rgba(139,92,246,0.2)', color: 'rgba(167,139,250,0.7)' }}
        >
          {commentCount !== undefined && commentCount > 0 ? (
            <>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span className="hidden sm:inline">View Discussion</span>
              <span className="text-[10px] opacity-70">{commentCount}</span>
            </>
          ) : (
            <>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <span className="hidden sm:inline">More Info</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function LeaderboardPage() {
  const [tab, setTab] = useState<Tab>('vibe');
  const [items, setItems] = useState<LeaderboardItem[]>([]);
  const [popular, setPopular] = useState<PopularItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<LeaderboardItem | null>(null);

  const fetchTab = useCallback((t: Tab) => {
    setLoading(true);
    if (t === 'popular') {
      fetch('/api/scans?type=popular&limit=20')
        .then(r => r.json())
        .then(d => { setPopular(d); setLoading(false); })
        .catch(() => setLoading(false));
    } else {
      fetch(`/api/scans?type=${t}&limit=30`)
        .then(r => r.json())
        .then(d => { setItems(d); setLoading(false); })
        .catch(() => setLoading(false));
    }
  }, []);

  useEffect(() => { fetchTab(tab); }, [tab, fetchTab]);

  // Auto-refresh recent tab
  useEffect(() => {
    if (tab !== 'recent') return;
    const interval = setInterval(() => {
      fetch('/api/scans?type=recent&limit=30').then(r => r.json()).then(setItems);
    }, 15_000);
    return () => clearInterval(interval);
  }, [tab]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'vibe',    label: 'Most Vibe-Coded' },
    { id: 'secure',  label: 'Most Secure' },
    { id: 'recent',  label: 'Recent' },
    { id: 'popular', label: 'Most Scanned' },
  ];

  return (
    <main className="min-h-screen px-6 py-16" style={{ background: '#0a0a0f' }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(139,92,246,0.07) 0%, transparent 70%)' }}
      />
      <div className="relative max-w-3xl mx-auto">

        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold text-white mb-2">Leaderboard</h1>
          <p className="text-white/40 text-sm">Community-scanned sites ranked by security and vibe-code detection</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-white/3 border border-white/6 mb-6 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="px-4 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap flex-1"
              style={{
                background: tab === t.id ? 'rgba(139,92,246,0.15)' : 'transparent',
                color: tab === t.id ? 'rgba(167,139,250,0.9)' : 'rgba(255,255,255,0.4)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Table header */}
        {tab !== 'popular' && !loading && items.length > 0 && (
          <div className="flex items-center gap-3 sm:gap-4 px-4 pb-2 text-[10px] text-white/25 uppercase tracking-wider">
            <span className="w-6 text-right shrink-0">#</span>
            <span className="flex-1">Site</span>
            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
              <span className="text-center hidden sm:block w-8">Vibe</span>
              <span className="text-center w-8">Sec</span>
              <span className="w-20 sm:w-28" />
            </div>
          </div>
        )}

        {/* Content */}
        <div className="rounded-xl border border-white/6 overflow-hidden" style={{ background: 'rgba(255,255,255,0.015)' }}>
          {loading ? (
            <div className="py-16 flex items-center justify-center gap-3 text-white/25 text-sm">
              <div className="w-4 h-4 border-2 border-white/20 border-t-violet-400 rounded-full animate-spin" />
              Loading…
            </div>
          ) : tab === 'popular' ? (
            popular.length === 0 ? (
              <div className="py-16 text-center text-white/30 text-sm">
                No scans yet.{' '}
                <Link href="/" className="text-violet-400 hover:text-violet-300 transition-colors">Be the first →</Link>
              </div>
            ) : (
              popular.map((item, i) => (
                <Link
                  key={item.domain}
                  href={`/result/${item.latestScan.id}`}
                  className="flex items-center gap-4 px-5 py-4 border-b border-white/4 last:border-0 hover:bg-white/2 transition-colors"
                >
                  <span className="text-sm font-bold w-6 text-right shrink-0" style={{ color: i < 3 ? '#a78bfa' : 'rgba(255,255,255,0.2)' }}>{i + 1}</span>
                  <p className="flex-1 text-sm font-medium text-white/80 truncate">{item.domain}</p>
                  <span className="text-xs text-white/30">{item.count} scan{item.count !== 1 ? 's' : ''}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/20">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </Link>
              ))
            )
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-white/30 text-sm">
              No scans yet.{' '}
              <Link href="/" className="text-violet-400 hover:text-violet-300 transition-colors">Scan a site →</Link>
            </div>
          ) : (
            items.map((item, i) => (
              <LeaderboardRow
                key={item.id}
                item={item}
                rank={tab !== 'recent' ? i + 1 : undefined}
                onMoreInfo={() => setSelected(item)}
              />
            ))
          )}
        </div>

        {tab === 'recent' && (
          <p className="text-center text-xs text-white/20 mt-4">Auto-refreshes every 15 seconds</p>
        )}
      </div>

      {/* More Info modal */}
      {selected && (
        <MoreInfoModal item={selected} onClose={() => setSelected(null)} />
      )}
    </main>
  );
}

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
  hosting?: string | null;
  createdAt: number;
  scannedBy?: string;
  likeCount?: number;
  likedByMe?: boolean;
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

type Tab = 'recent' | 'vibe' | 'popular';

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

const RISK_COLOR: Record<string, string> = {
  Low: '#22c55e', Medium: '#f59e0b', High: '#f97316', Critical: '#ef4444',
};
const RISK_BG: Record<string, string> = {
  Low: 'rgba(34,197,94,0.1)', Medium: 'rgba(245,158,11,0.1)', High: 'rgba(249,115,22,0.1)', Critical: 'rgba(239,68,68,0.1)',
};
const RISK_BORDER: Record<string, string> = {
  Low: 'rgba(34,197,94,0.25)', Medium: 'rgba(245,158,11,0.25)', High: 'rgba(249,115,22,0.25)', Critical: 'rgba(239,68,68,0.25)',
};

// ── Small inline SVGs ──────────────────────────────────────────────────────

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

// ── Progress bar ───────────────────────────────────────────────────────────

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

// ── Section header ─────────────────────────────────────────────────────────

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
          {/* Header */}
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
            {/* Actions (visible on hover or if own) */}
            {c.is_mine && !editing && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => { setEditBody(c.body); setEditing(true); }}
                  className="p-1 rounded text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
                  title="Edit"
                >
                  <IconEdit />
                </button>
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="p-1 rounded text-white/30 hover:text-red-400 hover:bg-red-500/8 transition-colors"
                    title="Delete"
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

          {/* Body */}
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

          {/* Footer actions */}
          {!editing && (
            <div className="flex items-center gap-3 mt-2.5">
              <button
                onClick={() => onLike(c.id)}
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

        {/* Replies */}
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

// ── Comments section ───────────────────────────────────────────────────────

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
        // Nest replies under their parents
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
        // Sort top-level newest first, replies oldest first
        top.sort((a, b) => b.created_at - a.created_at);
        setComments(top);
      })
      .finally(() => setLoading(false));
  }, [scanId]);

  // Focus textarea when reply is set
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
          c.id === replyTo.id
            ? { ...c, replies: [...(c.replies ?? []), data] }
            : c
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
      function updateComment(c: Comment): Comment {
        if (c.id === commentId) return { ...c, liked_by_me: data.liked, like_count: data.count };
        if (c.replies) return { ...c, replies: c.replies.map(updateComment) };
        return c;
      }
      setComments(prev => prev.map(updateComment));
    });
  }

  function handleEdit(commentId: string, newBody: string) {
    function updateComment(c: Comment): Comment {
      if (c.id === commentId) return { ...c, body: newBody, edited_at: Date.now() };
      if (c.replies) return { ...c, replies: c.replies.map(updateComment) };
      return c;
    }
    setComments(prev => prev.map(updateComment));
  }

  function handleDelete(commentId: string) {
    function removeComment(list: Comment[]): Comment[] {
      return list
        .filter(c => c.id !== commentId)
        .map(c => ({ ...c, replies: removeComment(c.replies ?? []) }));
    }
    setComments(prev => removeComment(prev));
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

      {/* Post form */}
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

      {/* Comment list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <Skeleton key={i} className="h-16" />)}
        </div>
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

// ── More Info modal ────────────────────────────────────────────────────────

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

  // Fetch full scan data + scan likes
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

  // Keyboard + body scroll
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  // Security findings from full scan
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
        {/* ── Sticky header ── */}
        <div
          className="sticky top-0 z-10 rounded-t-2xl sm:rounded-t-2xl border-b border-white/8 px-5 py-4"
          style={{ background: 'rgba(13,13,22,0.98)', backdropFilter: 'blur(16px)' }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              {/* Favicon */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://www.google.com/s2/favicons?domain=${site}&sz=32`}
                alt=""
                width={28}
                height={28}
                className="rounded-md mt-0.5 shrink-0 opacity-90"
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
              {/* Scan upvote */}
              <button
                onClick={toggleScanLike}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                style={likedScan
                  ? { color: '#a78bfa', background: 'rgba(139,92,246,0.12)', borderColor: 'rgba(139,92,246,0.3)' }
                  : { color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)' }
                }
                title={user ? (likedScan ? 'Unlike' : 'Upvote') : 'Sign in to upvote'}
              >
                <IconArrowUp />
                {scanLikes > 0 && <span>{scanLikes}</span>}
              </button>
              {/* Close */}
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white/35 hover:bg-white/8 hover:text-white/60 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-6">

          {/* ── Overview scores ── */}
          <div>
            <SectionHeader label="Overview" />
            <div className="grid grid-cols-2 gap-3">
              {/* Vibe score */}
              <div
                className="rounded-xl border p-4"
                style={{ background: `${vc}0d`, borderColor: `${vc}30` }}
              >
                <p className="text-[10px] text-white/35 uppercase tracking-wider mb-2">Vibe-Coded Score</p>
                <p className="text-3xl font-black tabular-nums mb-1" style={{ color: vc }}>{item.vibeScore}<span className="text-sm font-medium text-white/30">%</span></p>
                <p className="text-xs mb-2.5" style={{ color: `${vc}cc` }}>{item.vibeLabel}</p>
                <ProgressBar value={item.vibeScore} color={vc} />
              </div>
              {/* Security score */}
              <div
                className="rounded-xl border p-4"
                style={{ background: `${sc}0d`, borderColor: `${sc}30` }}
              >
                <p className="text-[10px] text-white/35 uppercase tracking-wider mb-2">Security Score</p>
                <p className="text-3xl font-black tabular-nums mb-1" style={{ color: sc }}>{item.securityScore}<span className="text-sm font-medium text-white/30">/100</span></p>
                <p className="text-xs font-semibold mb-2.5" style={{ color: riskColor }}>{item.riskLevel} Risk</p>
                <ProgressBar value={item.securityScore} color={sc} />
              </div>
            </div>
          </div>

          {/* ── Tech stack ── */}
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

          {/* ── Risk breakdown ── */}
          <div>
            <SectionHeader label="Risk Breakdown" icon={<IconShield />} />
            <div className="rounded-xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <div className="divide-y divide-white/5">
                <div className="px-4 py-3 flex items-center gap-4">
                  <p className="text-xs text-white/45 w-36 shrink-0">Vibe-coded likelihood</p>
                  <div className="flex-1">
                    <ProgressBar value={item.vibeScore} color={vc} />
                  </div>
                  <span className="text-xs font-bold tabular-nums w-10 text-right shrink-0" style={{ color: vc }}>{item.vibeScore}%</span>
                </div>
                <div className="px-4 py-3 flex items-center gap-4">
                  <p className="text-xs text-white/45 w-36 shrink-0">Security posture</p>
                  <div className="flex-1">
                    <ProgressBar value={item.securityScore} color={sc} />
                  </div>
                  <span className="text-xs font-bold tabular-nums w-10 text-right shrink-0" style={{ color: sc }}>{item.securityScore}</span>
                </div>
                <div className="px-4 py-3 flex items-center justify-between">
                  <p className="text-xs text-white/45">Overall risk level</p>
                  <span
                    className="text-[11px] font-bold px-2.5 py-1 rounded-full border"
                    style={{ color: riskColor, background: riskBg, borderColor: riskBorder }}
                  >
                    {item.riskLevel} Risk
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Vibe signals ── */}
          {scanLoading ? (
            <div><SectionHeader label="Vibe Signals" /><div className="space-y-2"><Skeleton className="h-7" /><Skeleton className="h-7 w-4/5" /><Skeleton className="h-7 w-2/3" /></div></div>
          ) : vibeReasons.length > 0 ? (
            <div>
              <SectionHeader label="Vibe Signals" />
              <div className="rounded-xl border border-white/8 overflow-hidden" style={{ background: 'rgba(139,92,246,0.03)' }}>
                {vibeReasons.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 px-4 py-2.5 border-b border-white/5 last:border-0"
                  >
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

          {/* ── Security findings ── */}
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

          {/* ── Most recent scan ── */}
          <div>
            <SectionHeader label="Most Recent Scan" icon={<IconClock />} />
            <div
              className="rounded-xl border p-4"
              style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.08)' }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ background: 'rgba(139,92,246,0.12)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.2)' }}
                >
                  {(item.scannedBy ?? 'A')[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white/70">@{item.scannedBy ?? 'Anonymous'}</p>
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

          {/* ── Full report CTA ── */}
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

          {/* ── Discussion ── */}
          <div className="border-t border-white/6 pt-5">
            <CommentsSection scanId={item.id} />
          </div>

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
}: {
  item: LeaderboardItem;
  rank?: number;
  onMoreInfo: () => void;
}) {
  const vc = getVibeColor(item.vibeScore);
  const sc = getSecColor(item.securityScore);
  const site = hostname(item.url);

  return (
    <div className="flex items-center gap-3 sm:gap-4 px-4 py-3.5 border-b border-white/4 last:border-0 hover:bg-white/2 transition-colors group">
      {rank !== undefined && (
        <span className="text-sm font-bold w-6 text-right shrink-0" style={{ color: rank <= 3 ? '#a78bfa' : 'rgba(255,255,255,0.2)' }}>
          {rank}
        </span>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white/80 truncate">{site}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {item.techStack.slice(0, 2).map(t => (
            <span key={t} className="text-[10px] text-white/30 bg-white/5 px-1.5 py-0.5 rounded">{t}</span>
          ))}
          <span className="text-[10px] text-white/20">{timeAgo(item.createdAt)}</span>
        </div>
      </div>

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
      fetch('/api/scans?type=popular&limit=30')
        .then(r => r.json())
        .then(d => { setPopular(d); setLoading(false); })
        .catch(() => setLoading(false));
    } else {
      const limit = t === 'recent' ? 50 : 30;
      fetch(`/api/scans?type=${t}&limit=${limit}`)
        .then(r => r.json())
        .then(d => { setItems(d); setLoading(false); })
        .catch(() => setLoading(false));
    }
  }, []);

  useEffect(() => { fetchTab(tab); }, [tab, fetchTab]);

  useEffect(() => {
    if (tab !== 'recent') return;
    const interval = setInterval(() => {
      fetch('/api/scans?type=recent&limit=50').then(r => r.json()).then(setItems);
    }, 15_000);
    return () => clearInterval(interval);
  }, [tab]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'recent',  label: 'Most Recent' },
    { id: 'vibe',    label: 'Most Vibe-Coded' },
    { id: 'popular', label: 'Most Scanned' },
  ];

  return (
    <main className="min-h-screen px-6 py-16" style={{ background: '#0a0a0f' }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(139,92,246,0.07) 0%, transparent 70%)' }}
      />
      <div className="relative max-w-3xl mx-auto">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold text-white mb-2">Leaderboard</h1>
          <p className="text-white/40 text-sm">Community-scanned sites ranked by security and vibe-code detection</p>
        </div>

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

        {tab === 'vibe' && !loading && items.length > 0 && (
          <div className="flex items-center gap-3 sm:gap-4 px-4 pb-2 text-[10px] text-white/25 uppercase tracking-wider">
            <span className="w-6 text-right shrink-0">#</span>
            <span className="flex-1">Site</span>
            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
              <span className="text-center hidden sm:block w-8">Vibe</span>
              <span className="text-center w-8">Sec</span>
              <span className="w-20 sm:w-24" />
            </div>
          </div>
        )}

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
              popular.map((item, i) => {
                const vc = getVibeColor(item.latestScan.result?.vibe?.score ?? 0);
                const sc = getSecColor(item.latestScan.result?.security?.score ?? 0);
                return (
                  <div key={item.domain} className="flex items-center gap-3 sm:gap-4 px-4 py-3.5 border-b border-white/4 last:border-0 hover:bg-white/2 transition-colors group">
                    <span className="text-sm font-bold w-6 text-right shrink-0" style={{ color: i < 3 ? '#a78bfa' : 'rgba(255,255,255,0.2)' }}>{i + 1}</span>
                    <img src={`https://www.google.com/s2/favicons?domain=${item.domain}&sz=32`} alt="" className="w-5 h-5 rounded shrink-0 opacity-70" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white/80 truncate">{item.domain}</p>
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
            <div className="py-16 text-center text-white/30 text-sm">
              No scans yet.{' '}
              <Link href="/" className="text-violet-400 hover:text-violet-300 transition-colors">Scan a site →</Link>
            </div>
          ) : (
            items.map((item, i) => (
              <LeaderboardRow
                key={item.id}
                item={item}
                rank={tab === 'vibe' ? i + 1 : undefined}
                onMoreInfo={() => setSelected(item)}
              />
            ))
          )}
        </div>

        {tab === 'recent' && (
          <p className="text-center text-xs text-white/20 mt-4">Auto-refreshes every 15 seconds</p>
        )}
      </div>

      {selected && <MoreInfoModal item={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}

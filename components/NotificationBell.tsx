'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';

interface Notification {
  id: string;
  type: 'comment' | 'reply' | 'popular' | 'security' | 'system';
  title: string;
  description: string;
  link: string | null;
  read: boolean;
  createdAt: number;
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function NotifIcon({ type }: { type: Notification['type'] }) {
  const cls = 'w-7 h-7 rounded-lg flex items-center justify-center shrink-0';

  if (type === 'comment') return (
    <div className={cls} style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.2)' }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </div>
  );

  if (type === 'reply') return (
    <div className={cls} style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.2)' }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
      </svg>
    </div>
  );

  if (type === 'popular') return (
    <div className={cls} style={{ background: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.2)' }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fb923c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
    </div>
  );

  if (type === 'security') return (
    <div className={cls} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.2)' }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    </div>
  );

  // system
  return (
    <div className={cls} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    </div>
  );
}

export function NotificationBell() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const unreadCount = notifications.filter(n => !n.read).length;

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) setNotifications(await res.json());
    } catch { /* ignore */ }
  }, [user]);

  // Fetch on mount and poll every 30s
  useEffect(() => {
    if (!user) return;
    fetchNotifications();
    const id = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(id);
  }, [user, fetchNotifications]);

  // Re-fetch when tab regains focus
  useEffect(() => {
    const onFocus = () => { if (user) fetchNotifications(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user, fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  async function markRead(id: string) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    await fetch(`/api/notifications/${id}`, { method: 'PATCH' }).catch(() => null);
  }

  async function markAllRead() {
    setLoading(true);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    await fetch('/api/notifications', { method: 'PATCH' }).catch(() => null);
    setLoading(false);
  }

  async function handleNotifClick(n: Notification) {
    if (!n.read) await markRead(n.id);
    setOpen(false);
  }

  if (!user) return null;

  const unread = notifications.filter(n => !n.read);
  const read   = notifications.filter(n => n.read);

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={() => setOpen(v => !v)}
        className="relative w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-white/6"
        style={{ color: open ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)' }}
        aria-label="Notifications"
      >
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          style={{ transition: 'transform 0.15s', transform: open ? 'rotate(-15deg)' : 'rotate(0deg)' }}
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
            style={{ background: '#ef4444', boxShadow: '0 0 0 2px #0a0a0f' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 w-80 rounded-2xl border border-white/8 shadow-2xl overflow-hidden z-50"
          style={{
            background: '#0f0f18',
            boxShadow: '0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
            animation: 'notifSlide 0.15s ease-out',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/6">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white/80">Notifications</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white"
                  style={{ background: '#7c3aed' }}>
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={loading}
                className="text-[11px] text-violet-400 hover:text-violet-300 transition-colors disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Body */}
          <div className="max-h-[360px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-12 flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  </svg>
                </div>
                <p className="text-xs text-white/25">No notifications yet</p>
              </div>
            ) : (
              <>
                {/* Unread section */}
                {unread.length > 0 && (
                  <div>
                    {unread.map(n => (
                      <NotifItem key={n.id} n={n} onClick={() => handleNotifClick(n)} />
                    ))}
                  </div>
                )}

                {/* Read section */}
                {read.length > 0 && (
                  <div style={{ opacity: 0.55 }}>
                    {unread.length > 0 && read.length > 0 && (
                      <div className="px-4 py-1.5 border-t border-white/4">
                        <span className="text-[10px] text-white/25 uppercase tracking-wider">Earlier</span>
                      </div>
                    )}
                    {read.map(n => (
                      <NotifItem key={n.id} n={n} onClick={() => handleNotifClick(n)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="border-t border-white/6 px-4 py-2.5">
              <Link
                href="/profile#notifications"
                onClick={() => setOpen(false)}
                className="text-[11px] text-white/30 hover:text-white/55 transition-colors"
              >
                Notification settings →
              </Link>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes notifSlide {
          from { opacity: 0; transform: translateY(-6px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

function NotifItem({ n, onClick }: { n: Notification; onClick: () => void }) {
  const inner = (
    <div
      className="flex items-start gap-3 px-4 py-3 hover:bg-white/3 transition-colors cursor-pointer"
      style={{ background: !n.read ? 'rgba(139,92,246,0.04)' : undefined }}
      onClick={onClick}
    >
      <NotifIcon type={n.type} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-xs leading-snug ${n.read ? 'text-white/55' : 'text-white/85 font-medium'}`}>
            {n.title}
          </p>
          {!n.read && (
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0 mt-1" />
          )}
        </div>
        <p className="text-[11px] text-white/35 mt-0.5 line-clamp-2 leading-relaxed">{n.description}</p>
        <p className="text-[10px] text-white/20 mt-1">{relativeTime(n.createdAt)}</p>
      </div>
    </div>
  );

  if (n.link) {
    return <Link href={n.link}>{inner}</Link>;
  }
  return inner;
}

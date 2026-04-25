'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

// ── Constants ──────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#14b8a6',
  '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899',
];

const PLAN_BADGE: Record<string, { cls: string; label: string }> = {
  pro:  { cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30', label: 'Pro' },
  team: { cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30',          label: 'Team' },
  free: { cls: 'bg-white/5 text-white/40 border-white/10',              label: 'Free' },
};

type Tab = 'overview' | 'settings';

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}


// Compress image to base64 via canvas (max 120×120, JPEG 0.82)
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const size = 120;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      // Crop to square from center
      const s = Math.min(img.width, img.height);
      const ox = (img.width - s) / 2;
      const oy = (img.height - s) / 2;
      ctx.drawImage(img, ox, oy, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Invalid image')); };
    img.src = url;
  });
}

// ── Small shared components ────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="relative w-9 h-5 rounded-full transition-colors shrink-0"
      style={{ background: checked ? '#7c3aed' : 'rgba(255,255,255,0.1)' }}
    >
      <span
        className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm"
        style={{ left: checked ? 'calc(100% - 18px)' : '2px' }}
      />
    </button>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`rounded-lg bg-white/5 animate-pulse ${className ?? ''}`} />;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">{children}</h3>
  );
}

// ── Avatar (image or colour initial) ──────────────────────────────────────

function AvatarDisplay({
  name, color, url, size = 72,
}: {
  name: string; color: string; url?: string | null; size?: number;
}) {
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className="rounded-2xl object-cover shrink-0"
        style={{ width: size, height: size, border: `2px solid ${color}40` }}
      />
    );
  }
  return (
    <div
      className="rounded-2xl flex items-center justify-center font-bold select-none shrink-0"
      style={{
        width: size, height: size,
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

// ── Overview tab ──────────────────────────────────────────────────────────

function OverviewTab({
  user,
  passiveCount, deepCount,
  avatarColor,
  onEditProfile,
}: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
  passiveCount: number | null;
  deepCount: number | null;
  avatarColor: string;
  onEditProfile: () => void;
}) {
  const badge = PLAN_BADGE[user.plan] ?? PLAN_BADGE.free;

  const stats = [
    { label: 'Scans run',  value: passiveCount, color: 'rgba(255,255,255,0.7)' },
    { label: 'Deep scans', value: deepCount,    color: '#a78bfa' },
  ];

  return (
    <div className="space-y-5">
      {/* Profile card */}
      <div
        className="rounded-2xl border border-white/8 p-6 relative overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.02)' }}
      >
        {/* Edit hint */}
        <button
          onClick={onEditProfile}
          className="absolute top-4 right-4 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] text-white/35 hover:text-white/65 hover:bg-white/6 transition-colors border border-transparent hover:border-white/8"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Edit profile
        </button>

        <div className="flex items-start gap-5">
          <AvatarDisplay name={user.name} color={avatarColor} url={user.avatarUrl} size={72} />
          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <h1 className="text-xl font-bold text-white">{user.name}</h1>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${badge.cls}`}>
                {badge.label}
              </span>
            </div>
            <p className="text-xs text-white/30 font-mono mb-2">{user.email}</p>
            {user.bio ? (
              <p className="text-sm text-white/50 leading-relaxed">{user.bio}</p>
            ) : (
              <button
                onClick={onEditProfile}
                className="text-xs text-white/20 hover:text-violet-400 transition-colors italic"
              >
                + Add a bio to tell people about yourself
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map(stat => (
          <div
            key={stat.label}
            className="rounded-2xl border border-white/8 p-4 text-center"
            style={{ background: 'rgba(255,255,255,0.02)' }}
          >
            <p className="text-2xl font-bold mb-0.5" style={{ color: stat.color }}>
              {stat.value ?? '—'}
            </p>
            <p className="text-[10px] text-white/30 uppercase tracking-wider">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Leaderboard CTA */}
      <div
        className="rounded-2xl border p-5 relative overflow-hidden"
        style={{ background: 'rgba(139,92,246,0.04)', borderColor: 'rgba(139,92,246,0.2)' }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 60% 100% at 100% 50%, rgba(139,92,246,0.06), transparent)' }} />
        <div className="relative flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-white/85 mb-1">See how you rank</p>
            <p className="text-xs text-white/40 leading-relaxed max-w-xs">
              Public scans appear on the Leaderboard. Run a scan to compete for the top spot.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Link
              href="/"
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white transition-colors"
              style={{ background: 'rgba(139,92,246,0.85)', border: '1px solid rgba(139,92,246,0.5)' }}
            >
              Run a scan
            </Link>
            <Link
              href="/feed"
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white/50 hover:text-white/75 border border-white/10 hover:bg-white/4 transition-colors"
            >
              Leaderboard
            </Link>
          </div>
        </div>
      </div>

      {/* Plan info */}
      {user.plan === 'free' && (
        <div
          className="rounded-2xl border border-white/6 p-4 flex items-center justify-between gap-3"
          style={{ background: 'rgba(255,255,255,0.015)' }}
        >
          <div>
            <p className="text-xs text-white/50 mb-0.5">
              <span className="font-semibold text-white/65">{user.scansRemaining ?? 0}</span> passive scans left today
              · <span className="font-semibold text-white/65">{Math.max(0, 2 - (deepCount ?? 0))}</span> deep scans remaining
            </p>
            <p className="text-[11px] text-white/25">Upgrade for unlimited scans, deep analysis, and PDF export.</p>
          </div>
          <Link
            href="/pricing"
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap"
            style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)', color: '#a78bfa' }}
          >
            Upgrade — £4.99/mo
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Edit Profile modal ─────────────────────────────────────────────────────

function EditProfileModal({
  user,
  onClose,
  onSaved,
}: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const avatarColor = user.avatarColor ?? '#8b5cf6';
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio ?? '');
  const [selectedColor, setSelectedColor] = useState(avatarColor);
  const [previewUrl, setPreviewUrl] = useState<string | null>(user.avatarUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Please select an image file'); return; }
    setUploading(true);
    setError('');
    try {
      const compressed = await compressImage(file);
      setPreviewUrl(compressed);
    } catch {
      setError('Could not process image');
    } finally {
      setUploading(false);
    }
  }

  async function handleRemovePhoto() {
    setPreviewUrl(null);
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) { setError('Name cannot be empty'); return; }
    if (trimmed.length > 40) { setError('Name must be 40 characters or less'); return; }
    setSaving(true);
    setError('');
    try {
      // 1. Save profile fields
      const profileRes = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, bio, avatarColor: selectedColor }),
      });
      if (!profileRes.ok) {
        const d = await profileRes.json();
        throw new Error(d.error ?? 'Failed to save profile');
      }

      // 2. Handle avatar change
      const avatarChanged = previewUrl !== (user.avatarUrl ?? null);
      if (avatarChanged) {
        if (previewUrl) {
          // Upload new image
          const avatarRes = await fetch('/api/user/avatar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ avatarUrl: previewUrl }),
          });
          if (!avatarRes.ok) {
            const d = await avatarRes.json();
            throw new Error(d.error ?? 'Failed to upload avatar');
          }
        } else {
          // Remove avatar
          await fetch('/api/user/avatar', { method: 'DELETE' });
        }
      }

      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}>
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 overflow-hidden shadow-2xl"
        style={{ background: '#0f0f18' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <h2 className="text-base font-semibold text-white/85">Edit Profile</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors p-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Avatar section */}
          <div>
            <p className="text-[11px] font-bold text-white/30 uppercase tracking-widest mb-3">Profile photo</p>
            <div className="flex items-center gap-4">
              {/* Preview */}
              <div className="relative shrink-0">
                {previewUrl ? (
                  <img src={previewUrl} alt="Avatar" className="w-16 h-16 rounded-2xl object-cover" style={{ border: `2px solid ${selectedColor}40` }} />
                ) : (
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center font-bold text-xl"
                    style={{ background: `${selectedColor}22`, border: `2px solid ${selectedColor}50`, color: selectedColor }}
                  >
                    {name[0]?.toUpperCase() ?? '?'}
                  </div>
                )}
                {uploading && (
                  <div className="absolute inset-0 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  </div>
                )}
              </div>

              {/* Upload actions */}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/12 hover:bg-white/6 text-white/60 hover:text-white/80 transition-colors"
                >
                  {previewUrl ? 'Change photo' : 'Upload photo'}
                </button>
                {previewUrl && (
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="px-3 py-1.5 rounded-lg text-xs text-white/30 hover:text-red-400 hover:bg-red-500/8 transition-colors"
                  >
                    Remove photo
                  </button>
                )}
                <p className="text-[10px] text-white/20">JPG, PNG or GIF · Auto-cropped to square</p>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="sr-only" onChange={handleImageSelect} />
            </div>
          </div>

          {/* Avatar colour */}
          {!previewUrl && (
            <div>
              <p className="text-[11px] font-bold text-white/30 uppercase tracking-widest mb-3">Avatar colour</p>
              <div className="flex gap-2 flex-wrap">
                {AVATAR_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setSelectedColor(c)}
                    className="w-7 h-7 rounded-lg transition-all hover:scale-110"
                    style={{
                      background: c,
                      outline: c === selectedColor ? `2px solid white` : 'none',
                      outlineOffset: '2px',
                    }}
                    title={c}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-[11px] font-bold text-white/30 uppercase tracking-widest mb-2">
              Display name
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={40}
              placeholder="Your name"
              className="w-full px-4 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none transition-all"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(139,92,246,0.5)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)')}
            />
            <p className="text-[10px] text-white/20 mt-1 text-right">{name.length}/40</p>
          </div>

          {/* Bio */}
          <div>
            <label className="block text-[11px] font-bold text-white/30 uppercase tracking-widest mb-2">
              Bio <span className="font-normal normal-case text-white/20">(optional)</span>
            </label>
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value)}
              maxLength={200}
              rows={3}
              placeholder="Tell people a bit about yourself…"
              className="w-full px-4 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none transition-all resize-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(139,92,246,0.5)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)')}
            />
            <p className="text-[10px] text-white/20 mt-1 text-right">{bio.length}/200</p>
          </div>

          {error && (
            <p className="text-xs text-red-400 p-3 rounded-xl bg-red-500/8 border border-red-500/15">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/8 flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving || uploading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm text-white/40 border border-white/8 hover:bg-white/4 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────

function SettingsTab({
  user,
  onLogout,
}: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
  onLogout: () => void;
}) {
  const badge = PLAN_BADGE[user.plan] ?? PLAN_BADGE.free;
  const [notifEmail, setNotifEmail] = useState(user.notifEmail);
  const [notifInApp, setNotifInApp] = useState(user.notifInApp);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function saveNotifs() {
    setSaving(true);
    await fetch('/api/user/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notifEmail, notifInApp }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-5">
      {/* Account */}
      <div>
        <SectionTitle>Account</SectionTitle>
        <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/5">
            <div>
              <p className="text-[10px] text-white/25 uppercase tracking-wider mb-0.5">Email</p>
              <p className="text-sm text-white/60 font-mono">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <p className="text-[10px] text-white/25 uppercase tracking-wider mb-0.5">Subscription</p>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${badge.cls}`}>
                {badge.label}
              </span>
            </div>
            {user.plan === 'free' ? (
              <Link
                href="/pricing"
                className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)', color: '#a78bfa' }}
              >
                Upgrade to Pro
              </Link>
            ) : (
              <button
                onClick={async () => {
                  const res = await fetch('/api/stripe/portal', { method: 'POST' });
                  const d = await res.json();
                  if (d.url) window.location.href = d.url;
                }}
                className="px-3 py-1.5 rounded-lg text-xs text-white/40 border border-white/8 hover:bg-white/5 transition-colors"
              >
                Manage billing
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div>
        <SectionTitle>Notifications</SectionTitle>
        <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/5">
            <div>
              <p className="text-sm text-white/70">In-app notifications</p>
              <p className="text-xs text-white/30">Bell icon in the nav bar</p>
            </div>
            <Toggle checked={notifInApp} onChange={v => { setNotifInApp(v); }} />
          </div>
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/5">
            <div>
              <p className="text-sm text-white/70">Email notifications</p>
              <p className="text-xs text-white/30">Sent to {user.email}</p>
            </div>
            <Toggle checked={notifEmail} onChange={v => { setNotifEmail(v); }} />
          </div>
          <div className="px-4 py-3">
            <button
              onClick={saveNotifs}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-colors"
              style={{ background: saved ? 'rgba(34,197,94,0.2)' : 'rgba(139,92,246,0.2)', border: `1px solid ${saved ? 'rgba(34,197,94,0.3)' : 'rgba(139,92,246,0.3)'}`, color: saved ? '#4ade80' : '#a78bfa' }}
            >
              {saving ? 'Saving…' : saved ? 'Saved!' : 'Save preferences'}
            </button>
          </div>
        </div>
      </div>

      {/* Notify about */}
      <div
        className="rounded-xl border border-white/6 p-4"
        style={{ background: 'rgba(255,255,255,0.01)' }}
      >
        <p className="text-[10px] text-white/25 uppercase tracking-wider mb-3">You are notified when</p>
        <div className="space-y-2">
          {[
            { icon: '💬', label: 'Someone comments on your scan' },
            { icon: '↩', label: 'Someone replies to your comment' },
            { icon: '⚡', label: 'Your scan becomes popular' },
            { icon: '🔒', label: 'Security issues are detected' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-2.5 text-xs text-white/35">
              <span className="text-sm">{item.icon}</span>
              {item.label}
            </div>
          ))}
        </div>
      </div>

      {/* Session */}
      <div>
        <SectionTitle>Session</SectionTitle>
        <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <p className="text-[10px] text-white/25 uppercase tracking-wider mb-0.5">Signed in as</p>
              <p className="text-sm text-white/55 font-mono">{user.email}</p>
            </div>
            <button
              onClick={onLogout}
              className="px-3 py-1.5 rounded-lg text-xs text-white/40 border border-white/8 hover:bg-red-500/8 hover:text-red-400 hover:border-red-500/20 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { user, loading, logout, refreshUser } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [editModalOpen, setEditModalOpen] = useState(false);

  const [passiveCount, setPassiveCount] = useState<number | null>(null);
  const [deepCount, setDeepCount] = useState<number | null>(null);

  const fetchActivity = useCallback(() => {
    if (!user) return;
    Promise.all([
      fetch('/api/user/scans').then(r => r.json()).then(d => { if (Array.isArray(d)) setPassiveCount(d.length); }),
      fetch('/api/user/deep-scans').then(r => r.json()).then(d => { if (Array.isArray(d)) setDeepCount(d.length); }),
    ]);
  }, [user]);

  useEffect(() => { fetchActivity(); }, [fetchActivity]);

  async function handleLogout() {
    await logout();
    router.push('/');
  }

  // ── Guards ──
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

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <main className="min-h-screen px-4 py-10" style={{ background: '#0a0a0f' }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 30% at 50% 0%, rgba(139,92,246,0.05) 0%, transparent 60%)' }}
      />

      <div className="relative max-w-2xl mx-auto">
        {/* Back */}
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-white/30 hover:text-white/55 transition-colors mb-8">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          Home
        </Link>

        {/* Compact profile header */}
        <div className="flex items-center gap-4 mb-7">
          <AvatarDisplay name={user.name} color={avatarColor} url={user.avatarUrl} size={52} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold text-white/90">{user.name}</h1>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${PLAN_BADGE[user.plan]?.cls ?? ''}`}>
                {PLAN_BADGE[user.plan]?.label ?? user.plan}
              </span>
            </div>
            {user.bio && <p className="text-xs text-white/35 mt-0.5 truncate">{user.bio}</p>}
          </div>
          <button
            onClick={() => setEditModalOpen(true)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Edit
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 p-1 rounded-xl border border-white/8" style={{ background: 'rgba(255,255,255,0.02)' }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: activeTab === tab.id ? 'rgba(139,92,246,0.15)' : 'transparent',
                color: activeTab === tab.id ? '#a78bfa' : 'rgba(255,255,255,0.35)',
                border: activeTab === tab.id ? '1px solid rgba(139,92,246,0.25)' : '1px solid transparent',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'overview' && (
          <OverviewTab
            user={user}
            passiveCount={passiveCount}
            deepCount={deepCount}
            avatarColor={avatarColor}
            onEditProfile={() => setEditModalOpen(true)}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab user={user} onLogout={handleLogout} />
        )}
      </div>

      {/* Edit modal */}
      {editModalOpen && (
        <EditProfileModal
          user={user}
          onClose={() => setEditModalOpen(false)}
          onSaved={refreshUser}
        />
      )}
    </main>
  );
}

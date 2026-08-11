'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { isValidDisplayHandle } from '@/lib/policy';
import { FREE_LIFETIME_LIMIT } from '@/lib/scan-quota';
import { apiPath } from '@/lib/site';

/**
 * Account settings.
 *
 * Deliberately small. The public profile, bio, leaderboard rank and comment
 * notifications this page used to carry all described surfaces that no longer
 * exist, and a settings screen offering switches that control nothing is worse
 * than one that offers fewer.
 */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
      <span className="text-sm" style={{ color: 'var(--muted)' }}>{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative w-10 h-5 transition-colors shrink-0"
      style={{
        borderRadius: 999,
        background: checked ? 'var(--accent)' : 'rgba(255,255,255,0.12)',
      }}
    >
      <span
        className="absolute top-0.5 w-4 h-4 bg-white transition-transform"
        style={{ borderRadius: 999, left: 2, transform: `translateX(${checked ? 20 : 0}px)` }}
      />
    </button>
  );
}

export default function ProfilePage() {
  const { user, loading, logout, refreshUser } = useAuth();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function patchProfile(body: Record<string, unknown>) {
    setError('');
    const res = await fetch(apiPath('/api/user/profile'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Could not save');
      return false;
    }
    await refreshUser();
    return true;
  }

  async function saveName() {
    const trimmed = name.trim();
    if (!isValidDisplayHandle(trimmed)) {
      setError('Use 1 to 40 letters, numbers, dots, dashes or underscores.');
      return;
    }
    setSaving(true);
    if (await patchProfile({ name: trimmed })) setEditing(false);
    setSaving(false);
  }

  async function uploadAvatar(file: File) {
    setBusy(true);
    setError('');
    try {
      const reader = new FileReader();
      const dataUrl: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read that file'));
        reader.readAsDataURL(file);
      });
      const res = await fetch(apiPath('/api/user/avatar'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Could not upload that image');
      } else {
        await refreshUser();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload that image');
    } finally {
      setBusy(false);
    }
  }

  async function openBilling() {
    setBusy(true);
    const res = await fetch(apiPath('/api/stripe/portal'), { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (data.url) window.location.href = data.url;
    else { setError(data.error ?? 'Could not open the billing portal'); setBusy(false); }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <span className="font-mono text-sm" style={{ color: 'var(--ghost)' }}>loading…</span>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6" style={{ background: 'var(--bg)' }}>
        <div className="text-center">
          <h1 className="display text-white text-2xl mb-5">Sign in to see your account</h1>
          <Link
            href="/login"
            className="inline-block px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent)', borderRadius: 4 }}
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  const initial = user.name[0]?.toUpperCase() ?? '?';

  return (
    <main className="min-h-screen px-6 py-12" style={{ background: 'var(--bg)' }}>
      <div className="max-w-2xl mx-auto space-y-6">

        <header className="flex items-center gap-4">
          {user.avatarUrl ? (
            // Avatars are stored as compressed data URLs.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatarUrl} alt="" className="w-14 h-14 object-cover shrink-0" style={{ borderRadius: 4 }} />
          ) : (
            <div
              className="w-14 h-14 flex items-center justify-center font-mono text-xl font-bold shrink-0"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)', borderRadius: 4 }}
            >
              {initial}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="display text-white text-2xl truncate">{user.name}</h1>
            <p className="font-mono text-xs mt-1.5 truncate" style={{ color: 'var(--faint)' }}>{user.email}</p>
          </div>
        </header>

        {error && (
          <p className="border px-4 py-3 text-sm" style={{ borderColor: 'rgba(239,68,68,0.3)', color: 'var(--crit)', borderRadius: 4 }}>
            {error}
          </p>
        )}

        {/* Plan */}
        <section className="border" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
          <p className="label px-5 py-3.5">plan</p>

          <Row label="Current plan">
            <span className="font-mono text-sm" style={{ color: user.plan === 'free' ? 'var(--faint)' : 'var(--accent)' }}>
              {user.plan}
            </span>
          </Row>

          {user.plan === 'free' && (
            <Row label="Scans remaining">
              <span className="font-mono text-sm text-white/75">
                {user.scansRemaining ?? 0} of {FREE_LIFETIME_LIMIT}
              </span>
            </Row>
          )}

          <Row label={user.plan === 'free' ? 'Unlimited scans and history' : 'Payment method and invoices'}>
            {user.plan === 'free' ? (
              <Link
                href="/pricing"
                className="px-4 py-2 font-mono text-sm border transition-colors hover:bg-white/4"
                style={{ borderColor: 'var(--accent-line)', color: 'var(--accent)', borderRadius: 4 }}
              >
                upgrade
              </Link>
            ) : (
              <button
                onClick={openBilling}
                disabled={busy}
                className="px-4 py-2 font-mono text-sm border transition-colors hover:bg-white/4 disabled:opacity-50"
                style={{ borderColor: 'var(--border-2)', color: 'var(--muted)', borderRadius: 4 }}
              >
                manage billing
              </button>
            )}
          </Row>
        </section>

        {/* Profile */}
        <section className="border" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
          <p className="label px-5 py-3.5">profile</p>

          <Row label="Display name">
            {editing ? (
              <span className="flex items-center gap-2">
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoFocus
                  className="px-3 py-2 font-mono text-sm text-white outline-none w-44"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border-2)', borderRadius: 4 }}
                />
                <button
                  onClick={saveName}
                  disabled={saving}
                  className="px-3 py-2 font-mono text-sm text-white disabled:opacity-50"
                  style={{ background: 'var(--accent)', borderRadius: 4 }}
                >
                  save
                </button>
                <button
                  onClick={() => { setEditing(false); setError(''); }}
                  className="font-mono text-sm px-2"
                  style={{ color: 'var(--ghost)' }}
                >
                  cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => { setName(user.name); setEditing(true); }}
                className="px-4 py-2 font-mono text-sm border transition-colors hover:bg-white/4"
                style={{ borderColor: 'var(--border-2)', color: 'var(--muted)', borderRadius: 4 }}
              >
                edit
              </button>
            )}
          </Row>

          <Row label="Avatar">
            <span className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) void uploadAvatar(file);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="px-4 py-2 font-mono text-sm border transition-colors hover:bg-white/4 disabled:opacity-50"
                style={{ borderColor: 'var(--border-2)', color: 'var(--muted)', borderRadius: 4 }}
              >
                {busy ? 'uploading…' : 'upload'}
              </button>
              {user.avatarUrl && (
                <button
                  onClick={async () => {
                    setBusy(true);
                    await fetch(apiPath('/api/user/avatar'), { method: 'DELETE' });
                    await refreshUser();
                    setBusy(false);
                  }}
                  className="font-mono text-sm px-2 transition-colors hover:text-white"
                  style={{ color: 'var(--ghost)' }}
                >
                  remove
                </button>
              )}
            </span>
          </Row>
        </section>

        {/* Notifications */}
        <section className="border" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
          <p className="label px-5 py-3.5">notifications</p>
          <p className="px-5 pb-4 text-xs leading-relaxed" style={{ color: 'var(--faint)' }}>
            Security findings on your verified domains, and service notices. Nothing else: there is no feed
            to be mentioned in.
          </p>

          <Row label="In-app">
            <Toggle checked={user.notifInApp} onChange={value => void patchProfile({ notifInApp: value })} />
          </Row>
          <Row label="Email">
            <Toggle checked={user.notifEmail} onChange={value => void patchProfile({ notifEmail: value })} />
          </Row>
        </section>

        {/* Session */}
        <section className="border" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
          <p className="label px-5 py-3.5">session</p>
          <Row label="Sign out of this device">
            <button
              onClick={async () => { await logout(); router.push('/'); }}
              className="px-4 py-2 font-mono text-sm border transition-colors hover:bg-white/4"
              style={{ borderColor: 'var(--border-2)', color: 'var(--muted)', borderRadius: 4 }}
            >
              sign out
            </button>
          </Row>
        </section>
      </div>
    </main>
  );
}

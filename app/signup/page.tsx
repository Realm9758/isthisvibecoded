'use client';

import { useEffect, useState, useMemo } from 'react';
import { claimHeldScan } from '@/lib/claim-scan';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { ACCOUNT_POLICY_VERSION, DISPLAY_HANDLE_HTML_PATTERN, isValidDisplayHandle } from '@/lib/policy';
import { apiPath } from '@/lib/site';
import { LANE_CHECK_COUNTS } from '@/lib/scan-lanes';

function PasswordStrength({ password }: { password: string }) {
  const strength = useMemo(() => {
    if (!password || password.length < 8) return 0;
    let score = 0;
    if (password.length >= 8)  score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score;
  }, [password]);

  if (!password) return null;

  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'];
  const colors  = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#10b981', '#6366f1'];
  const label   = labels[Math.min(strength, 5)];
  const color   = colors[Math.min(strength, 5)];
  const width   = `${(strength / 5) * 100}%`;

  return (
    <div className="mt-2 space-y-1">
      <div className="h-1 rounded-full bg-white/8 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-300" style={{ width, background: color }} />
      </div>
      <p className="text-xs" style={{ color }}>{label}</p>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="relative w-9 h-5 rounded-full transition-colors shrink-0"
      style={{ background: checked ? 'var(--accent)' : 'rgba(255,255,255,0.1)' }}
    >
      <span
        className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm"
        style={{ left: checked ? 'calc(100% - 18px)' : '2px' }}
      />
    </button>
  );
}

export default function SignupPage() {
  const [step, setStep] = useState<'form' | 'notifications'>('form');

  // Form state
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [agreed, setAgreed]     = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  // Notification prefs state
  const [notifInApp, setNotifInApp] = useState(true);
  const [notifEmail, setNotifEmail] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const { signup } = useAuth();
  const router = useRouter();
  const [returnTo, setReturnTo] = useState('/');

  useEffect(() => {
    const candidate = new URLSearchParams(window.location.search).get('returnTo');
    if (candidate?.startsWith('/') && !candidate.startsWith('//')) setReturnTo(candidate);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const displayHandle = name.trim();
    if (!displayHandle) { setError('A public display handle is required.'); return; }
    if (!isValidDisplayHandle(displayHandle)) {
      setError('Use 1–40 letters, numbers, dots, underscores, or hyphens; start with a letter or number.');
      return;
    }
    if (!agreed) { setError('Please accept the privacy and account policy to continue.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setError('');
    setLoading(true);
    try {
      await signup(email, password, displayHandle, ACCOUNT_POLICY_VERSION);
      setStep('notifications');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  }

  async function saveNotificationPrefs() {
    setError('');
    setSavingPrefs(true);
    try {
      const response = await fetch(apiPath('/api/user/profile'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifInApp, notifEmail }),
      });
      if (!response.ok) throw new Error('Could not save notification preferences');
      router.push(await claimHeldScan(returnTo));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save notification preferences');
    } finally {
      setSavingPrefs(false);
    }
  }

  async function skipPrefs() {
    router.push(await claimHeldScan(returnTo));
  }

  return (
    <main
      className="min-h-[calc(100vh-57px)] flex items-center justify-center px-4 py-16"
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(139,92,246,0.1) 0%, transparent 70%)' }}
      />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2.5 group">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="12" y="1.5" width="14.85" height="14.85" transform="rotate(45 12 1.5)" fill="var(--accent)" />
            </svg>
            <span className="font-mono text-sm font-semibold tracking-[0.18em] text-white">IRONCLAD</span>
          </Link>

          {step === 'form' ? (
            <>
              <h1 className="text-2xl font-bold text-white mt-6 mb-1">Create your account</h1>
              <p className="text-white/40 text-sm">Free forever. No credit card required.</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-white mt-6 mb-1">Stay in the loop</h1>
              <p className="text-white/40 text-sm">Choose how you want to be notified</p>
            </>
          )}
        </div>

        {step === 'form' && (
          <>
            {/* Free tier perks */}
            <div className="flex items-center justify-center gap-4 mb-6 flex-wrap">
              {['3 full scans', `All ${LANE_CHECK_COUNTS.deep} assessment modules`, 'Private by default'].map(perk => (
                <span key={perk} className="flex items-center gap-1.5 text-xs text-white/40">
                  <span className="text-emerald-400 text-xs">✓</span>
                  {perk}
                </span>
              ))}
            </div>

            {/* Card */}
            <div
              className=" p-8 border border-white/8"
              style={{ background: 'rgba(255,255,255,0.025)', backdropFilter: 'blur(16px)' }}
            >
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Public display handle */}
                <div>
                  <label className="block text-xs font-medium text-white/50 mb-1.5" htmlFor="name">
                    Display name
                  </label>
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                    maxLength={40}
                    pattern={DISPLAY_HANDLE_HTML_PATTERN}
                    title="Use letters, numbers, dots, underscores, or hyphens; start with a letter or number."
                    autoComplete="username"
                    aria-describedby="handle-privacy-note"
                    placeholder="your name"
                    className="w-full px-4 py-3 text-sm text-white placeholder-white/25 outline-none transition-all"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-2)' }}
                    onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'var(--border-2)')}
                  />
                  <p id="handle-privacy-note" className="text-[11px] text-white/30 leading-relaxed mt-1.5">
                    Shown only to you, on your own dashboard. Ironclad has no public profiles, feed, or comments.
                  </p>
                </div>

                {/* Email */}
                <div>
                  <label className="block text-xs font-medium text-white/50 mb-1.5" htmlFor="email">
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="w-full px-4 py-3 text-sm text-white placeholder-white/25 outline-none transition-all"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-2)' }}
                    onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'var(--border-2)')}
                  />
                </div>

                {/* Password */}
                <div>
                  <label className="block text-xs font-medium text-white/50 mb-1.5" htmlFor="password">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      placeholder="Min. 8 characters"
                      className="w-full px-4 py-3 pr-11 text-sm text-white placeholder-white/25 outline-none transition-all"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-2)' }}
                      onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                      onBlur={e => (e.currentTarget.style.borderColor = 'var(--border-2)')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                      tabIndex={-1}
                    >
                      {showPw ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <PasswordStrength password={password} />
                </div>

                {/* Account policy consent */}
                <div className="flex items-start gap-3">
                  <input
                    id="account-policy"
                    type="checkbox"
                    checked={agreed}
                    onChange={e => setAgreed(e.target.checked)}
                    required
                    aria-describedby="account-policy-copy"
                    className="w-4 h-4 mt-0.5 rounded accent-[color:var(--accent)] shrink-0"
                  />
                  <p id="account-policy-copy" className="text-xs text-white/40 leading-relaxed">
                    I accept the{' '}
                    <Link href="/privacy" className="hover:opacity-70 transition-opacity underline underline-offset-2" style={{ color: 'var(--accent)' }}>
                      privacy and account policy
                    </Link>
. I understand that scan results are private to my account, and that I may only scan sites I own or have permission to test.
                  </p>
                </div>

                {error && (
                  <div className="flex items-center gap-2 p-3  bg-red-500/10 border border-red-500/20">
                    <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-xs text-red-400">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3  text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background: 'var(--accent)', borderRadius: 4,
                    boxShadow: '0 0 24px rgba(124,58,237,0.25)',
                  }}
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Creating account…
                    </span>
                  ) : 'Create free account'}
                </button>
              </form>
            </div>

            <p className="text-center text-sm text-white/30 mt-6">
              Already have an account?{' '}
              <Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`} className="hover:opacity-70 transition-opacity font-medium" style={{ color: 'var(--accent)' }}>
                Sign in →
              </Link>
            </p>
          </>
        )}

        {/* ── Step 2: Notification prefs ───────────────────────────────────── */}
        {step === 'notifications' && (
          <>
            {/* Progress indicator */}
            <div className="flex items-center justify-center gap-2 mb-8">
              <div className="w-6 h-1.5 rounded-full bg-[color:var(--accent)]" />
              <div className="w-6 h-1.5 rounded-full bg-[color:var(--accent)]" />
            </div>

            <div
              className=" border border-white/8 overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.025)', backdropFilter: 'blur(16px)' }}
            >
              {/* Banner */}
              <div
                className="px-8 py-6 text-center"
                style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(79,70,229,0.08))' }}
              >
                <div
                  className="w-12 h-12  mx-auto mb-4 flex items-center justify-center"
                  style={{ background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.3)' }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  </svg>
                </div>
                <p className="text-xs text-white/40 leading-relaxed max-w-xs mx-auto">
                  Know when someone engages with your scans. You can change these any time in your profile.
                </p>
              </div>

              {/* Toggles */}
              <div className="px-8 py-6 space-y-1">
                {/* What you'll be notified about */}
                <div className="mb-5 p-3 " style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <p className="text-[10px] text-white/30 uppercase tracking-wider mb-3">You&apos;ll be notified when</p>
                  <div className="space-y-2">
                    {[
                      { icon: '💬', text: 'Someone comments on your scan' },
                      { icon: '↩', text: 'Someone replies to your comment' },
                    ].map(item => (
                      <div key={item.text} className="flex items-center gap-2.5 text-xs text-white/40">
                        <span className="text-sm">{item.icon}</span>
                        {item.text}
                      </div>
                    ))}
                  </div>
                </div>

                {/* In-app toggle */}
                <div className="flex items-center justify-between py-3.5 border-b border-white/6">
                  <div>
                    <p className="text-sm text-white/75 font-medium">In-app notifications</p>
                    <p className="text-xs text-white/30 mt-0.5">Bell icon in the navigation bar</p>
                  </div>
                  <Toggle checked={notifInApp} onChange={setNotifInApp} />
                </div>

                {/* Email toggle */}
                <div className="flex items-center justify-between py-3.5">
                  <div>
                    <p className="text-sm text-white/75 font-medium">Email notifications</p>
                    <p className="text-xs text-white/30 mt-0.5">Sent to your registered email</p>
                  </div>
                  <Toggle checked={notifEmail} onChange={setNotifEmail} />
                </div>
              </div>

              {/* Actions */}
              <div className="px-8 pb-8 space-y-2">
                {error && (
                  <div role="alert" className="flex items-center gap-2 p-3  bg-red-500/10 border border-red-500/20">
                    <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-xs text-red-400">{error}</p>
                  </div>
                )}
                <button
                  onClick={saveNotificationPrefs}
                  disabled={savingPrefs}
                  className="w-full py-3  text-sm font-semibold text-white transition-all disabled:opacity-50"
                  style={{
                    background: 'var(--accent)', borderRadius: 4,
                    boxShadow: '0 0 24px rgba(124,58,237,0.25)',
                  }}
                >
                  {savingPrefs ? 'Saving…' : 'Save & continue'}
                </button>
                <button
                  onClick={skipPrefs}
                  className="w-full py-2.5 text-sm text-white/30 hover:text-white/55 transition-colors"
                >
                  Skip for now
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

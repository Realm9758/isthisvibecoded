'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getHeaderGapBand, getSecurityColor, getVibeColor } from '@/lib/vibe-constants';

interface UserScan {
  id: string;
  url: string;
  vibeScore: number;
  securityScore: number;
  riskLevel: string;
  techStack: string[];
  createdAt: number;
}

interface PublicProfile {
  name: string;
  bio: string | null;
  avatarColor: string;
  avatarUrl: string | null;
  scans: UserScan[];
}

const vibeColor = getVibeColor;
const secColor = getSecurityColor;
const headerRiskBand = getHeaderGapBand;

const RISK_COLOR: Record<string, string> = {
  Few: '#22c55e', Some: '#f59e0b', Major: '#f97316', Unknown: '#94a3b8',
};

function timeAgo(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function hostname(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`rounded-lg bg-white/5 animate-pulse ${className ?? ''}`} />;
}

export default function PublicProfilePage() {
  const { name } = useParams<{ name: string }>();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/users/${encodeURIComponent(name)}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); setLoading(false); return null; }
        return r.json();
      })
      .then(d => { if (d) { setProfile(d); setLoading(false); } })
      .catch(() => setLoading(false));
  }, [name]);

  return (
    <main className="min-h-screen px-6 py-12" style={{ background: '#0a0a0f' }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 50% 35% at 50% 0%, rgba(139,92,246,0.07) 0%, transparent 70%)' }}
      />
      <div className="relative max-w-2xl mx-auto">

        {/* Back */}
        <Link href="/feed" className="inline-flex items-center gap-1.5 text-xs text-white/30 hover:text-white/55 transition-colors mb-8">
          ← Leaderboard
        </Link>

        {/* Not found */}
        {notFound && (
          <div className="text-center py-24">
            <p className="text-white/30 text-lg mb-2">Public profile not found</p>
            <p className="text-white/20 text-sm">@{name} doesn&apos;t exist or has no public activity.</p>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !notFound && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 mb-8">
              <Skeleton className="w-16 h-16 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
          </div>
        )}

        {/* Profile */}
        {profile && (
          <>
            {/* Header card */}
            <div
              className="rounded-2xl border p-6 mb-6"
              style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.08)' }}
            >
              <div className="flex items-start gap-4">
                {/* Avatar */}
                {profile.avatarUrl ? (
                  // User avatars are stored as compressed data URLs.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.avatarUrl}
                    alt={profile.name}
                    className="w-16 h-16 rounded-full object-cover shrink-0"
                    style={{ border: `2px solid ${profile.avatarColor}40` }}
                  />
                ) : (
                  <div
                    className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold shrink-0"
                    style={{ background: `${profile.avatarColor}18`, color: profile.avatarColor, border: `2px solid ${profile.avatarColor}35` }}
                  >
                    {profile.name[0]?.toUpperCase()}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h1 className="text-xl font-bold text-white">@{profile.name}</h1>
                  </div>

                  {profile.bio && (
                    <p className="text-sm text-white/50 leading-relaxed mb-2">{profile.bio}</p>
                  )}

                  <p className="text-xs text-white/30">
                    {profile.scans.length} public scan{profile.scans.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            </div>

            {/* Scans */}
            <div>
              <p className="text-[11px] font-bold text-white/35 uppercase tracking-widest mb-3">Public Scans</p>

              <div className="space-y-3">
                {profile.scans.map(scan => (
                  <Link
                    key={scan.id}
                    href={`/result/${scan.id}`}
                    className="block rounded-xl border transition-all hover:border-white/15"
                    style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.07)' }}
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white/80 truncate">{hostname(scan.url)}</p>
                          <p className="text-xs text-white/30 mt-0.5">{timeAgo(scan.createdAt)}</p>
                        </div>
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                          style={{ color: RISK_COLOR[headerRiskBand(scan.riskLevel)] ?? '#fff', background: `${RISK_COLOR[headerRiskBand(scan.riskLevel)] ?? '#fff'}15` }}
                        >
                          {headerRiskBand(scan.riskLevel)} observed header gaps
                        </span>
                      </div>

                      <div className="flex items-center gap-4">
                        {/* Vibe score */}
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ background: vibeColor(scan.vibeScore) }} />
                          <span className="text-xs text-white/40">Evidence</span>
                          <span className="text-xs font-bold" style={{ color: vibeColor(scan.vibeScore) }}>
                            {scan.vibeScore}
                          </span>
                        </div>
                        <div className="w-px h-3 bg-white/10" />
                        {/* Security score */}
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ background: secColor(scan.securityScore) }} />
                          <span className="text-xs text-white/40">Headers</span>
                          <span className="text-xs font-bold" style={{ color: secColor(scan.securityScore) }}>
                            {scan.securityScore}
                          </span>
                        </div>
                        {/* Tech stack */}
                        {scan.techStack.length > 0 && (
                          <>
                            <div className="w-px h-3 bg-white/10" />
                            <div className="flex gap-1 flex-wrap">
                              {scan.techStack.map(t => (
                                <span
                                  key={t}
                                  className="text-[10px] px-1.5 py-0.5 rounded-md"
                                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)' }}
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

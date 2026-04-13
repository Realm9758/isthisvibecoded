'use client';

import { useState } from 'react';
import type { AnalysisResult } from '@/types/analysis';
import { ScoreRing } from './ScoreRing';
import { OwnershipVerify } from './OwnershipVerify';
import { ShareModal } from './ShareModal';
import { VulnScanSection } from './VulnScanSection';
import { UpgradeGate, ProBadge } from './UpgradeGate';
import { useAuth } from '@/contexts/AuthContext';

const CATEGORY_COLORS: Record<string, string> = {
  framework: '#8b5cf6', library: '#06b6d4', hosting: '#22c55e',
  cdn: '#f59e0b', analytics: '#ec4899', backend: '#f97316', database: '#6366f1',
};
const CATEGORY_LABELS: Record<string, string> = {
  framework: 'Framework', library: 'Library', hosting: 'Hosting',
  cdn: 'CDN', analytics: 'Analytics', backend: 'Backend', database: 'Database',
};

function getVibeColor(s: number) { return s >= 70 ? '#8b5cf6' : s >= 30 ? '#f59e0b' : '#22c55e'; }
function getSecColor(s: number) { return s >= 70 ? '#22c55e' : s >= 40 ? '#f59e0b' : '#ef4444'; }
function getSevColor(s: string) {
  return s === 'critical' ? 'text-red-400' : s === 'high' ? 'text-orange-400' : s === 'medium' ? 'text-yellow-400' : 'text-white/40';
}
function getSevBg(s: string) {
  return s === 'critical' ? 'bg-red-500/10 border-red-500/20' : s === 'high' ? 'bg-orange-500/10 border-orange-500/20' : s === 'medium' ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-white/5 border-white/10';
}
function getRiskColor(r: string) {
  return r === 'high' ? 'text-red-400 bg-red-500/10 border-red-500/20' : r === 'medium' ? 'text-orange-400 bg-orange-500/10 border-orange-500/20' : r === 'low' ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' : 'text-white/50 bg-white/5 border-white/10';
}

function Card({ title, badge, children, className = '' }: { title: string; badge?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-white/6 bg-white/2 backdrop-blur-sm ${className}`}>
      <div className="px-5 py-4 border-b border-white/6 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">{title}</h3>
        {badge}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

interface Props {
  result: AnalysisResult & { scanId?: string; roasts?: string[]; scansRemaining?: number | null };
  onReset: () => void;
}

export function ResultsDashboard({ result, onReset }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<'overview' | 'security' | 'verify'>('overview');
  const [roastMode, setRoastMode] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const vibeColor = getVibeColor(result.vibe.score);
  const secColor = getSecColor(result.security.score);
  const roasts = result.roasts ?? [];

  const displayUrl = (() => { try { return new URL(result.url).hostname; } catch { return result.url; } })();
  const sensitiveFiles = result.publicFiles.filter(f => f.accessible && (f.path === '/.env' || f.path === '/config.json'));

  function printReport() { window.print(); }

  const isPro = user?.plan === 'pro' || user?.plan === 'team';

  return (
    <div className="w-full max-w-5xl mx-auto animate-fade-in-up">
      {/* Share modal */}
      {shareOpen && result.scanId && (
        <ShareModal result={result} onClose={() => setShareOpen(false)} />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-white/40 text-sm">Results for</span>
            <span className="text-white font-mono text-sm bg-white/5 px-2 py-0.5 rounded border border-white/10">{displayUrl}</span>
          </div>
          <p className="text-white/25 text-xs">{new Date(result.scannedAt).toLocaleString()}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setRoastMode(r => !r)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${roastMode ? 'bg-orange-500/15 border-orange-500/30 text-orange-400' : 'border-white/10 text-white/50 hover:bg-white/5'}`}
          >
            {roastMode ? '🔥 Roast On' : '🔥 Roast Mode'}
          </button>
          {result.scanId && (
            <button
              onClick={() => setShareOpen(true)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/15 transition-colors flex items-center gap-1.5"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share
            </button>
          )}
          <button onClick={onReset} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-white/10 text-white/50 hover:bg-white/5 transition-colors">
            Try Another
          </button>
        </div>
      </div>

      {/* Roast mode banner */}
      {roastMode && roasts.length > 0 && (
        <div className="mb-5 p-4 rounded-xl border border-orange-500/20 bg-orange-500/5 space-y-2 animate-fade-in-up">
          <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-3">🔥 AI Roast Mode</p>
          {roasts.map((r, i) => (
            <div key={i} className="flex gap-2 text-sm text-orange-200/80">
              <span className="text-orange-400 shrink-0">›</span>
              <span>{r}</span>
            </div>
          ))}
        </div>
      )}

      {/* Scan limit warning */}
      {result.scansRemaining !== undefined && result.scansRemaining !== null && result.scansRemaining <= 1 && (
        <div className="mb-5 p-3 rounded-xl border border-yellow-500/20 bg-yellow-500/5 flex items-center justify-between gap-3">
          <p className="text-xs text-yellow-400">
            {result.scansRemaining === 0 ? "You've used all free scans today." : "1 free scan remaining today."}
          </p>
          <a href="/pricing" className="text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors shrink-0">View Plans →</a>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-5 p-1 rounded-xl bg-white/3 border border-white/6 w-fit">
        {(['overview', 'security', 'verify'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${tab === t ? 'bg-white/10 text-white/90' : 'text-white/40 hover:text-white/70'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card title="Vibe Code Detection">
              <div className="flex items-center gap-6">
                <ScoreRing score={result.vibe.score} color={vibeColor} label={result.vibe.label} sublabel={`${result.vibe.confidence} confidence`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white/40 mb-2 uppercase tracking-wider">Signals</p>
                  {result.vibe.reasons.length === 0
                    ? <p className="text-sm text-white/50 italic">No signals detected.</p>
                    : <ul className="space-y-1.5">
                        {result.vibe.reasons.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-white/70">
                            <span className="mt-1 w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
                            {r}
                          </li>
                        ))}
                      </ul>
                  }
                </div>
              </div>
            </Card>

            <Card title="Security Posture">
              <div className="flex items-center gap-6">
                <ScoreRing score={result.security.score} color={secColor} label={result.security.riskLevel} sublabel={result.security.httpsEnabled ? 'HTTPS enabled' : 'HTTP only'} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white/40 mb-2 uppercase tracking-wider">Headers</p>
                  <div className="space-y-1.5">
                    {result.security.headers.map(h => (
                      <div key={h.name} className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono text-white/60 truncate">{h.name}</span>
                        <span className={`shrink-0 text-xs font-medium ${h.present ? 'text-emerald-400' : getSevColor(h.severity)}`}>
                          {h.present ? '✓' : `✗ ${h.severity}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <Card title="Tech Stack">
            {result.techStack.length === 0
              ? <p className="text-sm text-white/40 italic">No frameworks detected.</p>
              : <div className="flex flex-wrap gap-2">
                  {result.techStack.map(t => (
                    <span key={t.name} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border"
                      style={{ color: CATEGORY_COLORS[t.category], background: `${CATEGORY_COLORS[t.category]}18`, borderColor: `${CATEGORY_COLORS[t.category]}33` }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: CATEGORY_COLORS[t.category] }} />
                      {t.name}
                      <span className="opacity-50 text-[10px]">{CATEGORY_LABELS[t.category]}</span>
                    </span>
                  ))}
                </div>
            }
            {result.hosting.provider && (
              <div className="mt-4 pt-4 border-t border-white/6 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-white/40">Hosted on</span>
                <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">{result.hosting.provider}</span>
                {result.hosting.indicators[0] && <span className="text-xs text-white/25 font-mono">— {result.hosting.indicators[0]}</span>}
              </div>
            )}
          </Card>

          {result.publicKeys.length > 0 && (
            <Card title="Detected Public Keys">
              <div className="space-y-2">
                {result.publicKeys.map((k, i) => (
                  <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${getRiskColor(k.risk)}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold">{k.type}</p>
                      <p className="text-xs font-mono opacity-70 mt-0.5 truncate">{k.value}</p>
                      <p className="text-xs opacity-50 mt-0.5">Found in: {k.source}</p>
                    </div>
                    <span className="shrink-0 text-xs font-bold uppercase">{k.risk}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-white/30">Public-facing keys only. None were used or tested.</p>
            </Card>
          )}

          <UpgradeGate feature="PDF Export">
            <button
              onClick={printReport}
              className="w-full py-3 rounded-xl border border-white/10 bg-white/3 text-sm text-white/60 hover:bg-white/5 transition-colors"
            >
              Export PDF Report
            </button>
          </UpgradeGate>
        </div>
      )}

      {/* ── SECURITY TAB ── */}
      {tab === 'security' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Security Headers">
              <div className="space-y-2">
                {result.security.headers.map(h => (
                  <div key={h.name} className={`rounded-lg border p-3 ${h.present ? 'bg-emerald-500/5 border-emerald-500/15' : getSevBg(h.severity)}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-mono font-semibold text-white/80 truncate">{h.name}</p>
                        {h.present && h.value
                          ? <p className="text-xs text-white/30 font-mono truncate mt-0.5">{h.value.slice(0, 60)}{h.value.length > 60 ? '…' : ''}</p>
                          : <p className="text-xs text-white/40 mt-0.5">{h.recommendation}</p>
                        }
                      </div>
                      <span className={`shrink-0 text-xs font-bold ${h.present ? 'text-emerald-400' : getSevColor(h.severity)}`}>
                        {h.present ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Public Endpoints">
              <div className="space-y-1.5">
                {result.publicFiles.map(f => (
                  <div key={f.path} className="flex items-center justify-between gap-2 py-1 border-b border-white/4 last:border-0">
                    <span className="text-xs font-mono text-white/60">{f.path}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${sensitiveFiles.some(s => s.path === f.path) ? 'text-red-400 bg-red-500/10' : f.accessible ? 'text-emerald-400 bg-emerald-500/10' : 'text-white/25 bg-white/5'}`}>
                      {f.status === 0 ? 'timeout' : f.status}
                    </span>
                  </div>
                ))}
              </div>
              {sensitiveFiles.length > 0 && (
                <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-xs text-red-400 font-semibold">Sensitive file(s) publicly accessible!</p>
                  <p className="text-xs text-red-400/70 mt-0.5">{sensitiveFiles.map(f => f.path).join(', ')} — restrict access immediately.</p>
                </div>
              )}
            </Card>
          </div>

          <Card title="Recommendations">
            <div className="space-y-2">
              {!result.security.httpsEnabled && (
                <div className="flex gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <span className="text-red-400 shrink-0">⚠</span>
                  <div><p className="text-sm font-semibold text-red-300">Enable HTTPS</p><p className="text-xs text-white/50 mt-0.5">All traffic is unencrypted. Use a TLS certificate (Let's Encrypt is free).</p></div>
                </div>
              )}
              {result.security.headers.filter(h => !h.present && (h.severity === 'critical' || h.severity === 'high')).map(h => (
                <div key={h.name} className={`flex gap-3 p-3 rounded-lg ${h.severity === 'critical' ? 'bg-red-500/10 border border-red-500/20' : 'bg-orange-500/10 border border-orange-500/20'}`}>
                  <span className={h.severity === 'critical' ? 'text-red-400 shrink-0' : 'text-orange-400 shrink-0'}>!</span>
                  <div>
                    <p className={`text-sm font-semibold ${h.severity === 'critical' ? 'text-red-300' : 'text-orange-300'}`}>Add {h.name}</p>
                    <p className="text-xs text-white/50 mt-0.5">{h.recommendation}</p>
                  </div>
                </div>
              ))}
              {result.security.headers.every(h => h.present) && result.security.httpsEnabled && (
                <div className="flex gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <span className="text-emerald-400 shrink-0">✓</span>
                  <div><p className="text-sm font-semibold text-emerald-300">All security headers present</p><p className="text-xs text-white/50 mt-0.5">Great work — continue monitoring for changes.</p></div>
                </div>
              )}
            </div>
          </Card>

          {result.security.score >= 80 && (
            <UpgradeGate feature="Verified Secure Badge">
              <Card title={<span className="flex items-center gap-1">Verified Secure Badge <ProBadge /></span> as unknown as string}>
                <div className="flex items-center gap-4">
                  <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <p className="text-emerald-400 font-semibold text-sm">✓ Verified Secure</p>
                    <p className="text-xs text-white/50 mt-0.5">{displayUrl}</p>
                  </div>
                  <div className="text-xs text-white/40">
                    Security score ≥ 80. Add this badge to your site to show visitors you take security seriously.
                  </div>
                </div>
              </Card>
            </UpgradeGate>
          )}

          {/* Vulnerability scan section */}
          <VulnScanSection domain={displayUrl} />
        </div>
      )}

      {/* ── VERIFY TAB ── */}
      {tab === 'verify' && (
        <OwnershipVerify domain={displayUrl} />
      )}
    </div>
  );
}
